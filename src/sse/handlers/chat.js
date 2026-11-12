import "open-sse/index.js";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import {
  handleAntigravityQuotaError,
  handleAntigravityStallError,
  recordAntigravityHealthyAccount,
  clearAntigravityStrikes,
  getAntigravityQuotaCache,
  getAntigravityModelFamily,
  getAntigravityModelQuota,
  refreshAntigravityQuota,
} from "../services/antigravityQuota.js";
import { getSettings, updateProviderConnection } from "@/lib/localDb";
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";
import { getTransform as getPxpipeTransform } from "@/lib/pxpipe/loader.js";
import { appendPxpipeEvent } from "@/lib/pxpipe/events.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { upstreamResponseHeaders } from "open-sse/utils/upstreamHeaders.js";
import { handleComboChat, handleFusionChat, detectRequiredCapabilities } from "open-sse/services/combo.js";
import { augmentModelsWithCapacityAdapter, withCapacityAdapterStripping, getActiveAdapterStrategy } from "open-sse/services/capacityAdapter.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import { resolveSessionIdentity } from "open-sse/utils/sessionManager.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";
import { stripModelContextMarker } from "open-sse/utils/modelMarkers.js";
import { getKeyAccessContext, enforceKeyAccess, filterAdapterModels } from "../services/keyAccess.js";
import { resolveSmartChoice } from "../services/systemoneRouter.js";
import { isQuotaRoutingStrategy, orderComboTargets } from "../services/comboRouting.js";
import { enterConnection } from "../services/connectionResilience.js";
import { resolveResilienceConfig } from "@/shared/constants/resilience.js";
import { withResponseFinalizer } from "../utils/responseLifecycle.js";
import { formatRetryAfter } from "open-sse/services/accountFallback.js";
import { getDailySpendDenial, withKeySpendBudget } from "../services/keySpendBudget.js";
import { waitForKeySpendWrites } from "@/lib/db/keySpendWrites.js";
import { normalizeComboCompression } from "@/shared/constants/comboCompression.js";
import { withSemanticCache } from "../services/semanticCache.js";
import { handleEmbeddings } from "./embeddings.js";
import { readBoundedJson } from "../utils/readBoundedJson.js";
import { handlePipelineChat } from "../services/comboPipeline.js";
import { applyChatGuardrails, previewChatGuardrails } from "../services/chatGuardrails.js";

/**
 * Handle chat completion request
 * Supports: OpenAI, Claude, Gemini, OpenAI Responses API formats
 * Format detection and translation handled by translator
 */
export async function handleChat(request, clientRawRequest = null) {
  let body;
  try {
    body = await request.json();
    if (body && typeof body.__9router_b64 === "string") {
      body = JSON.parse(Buffer.from(body.__9router_b64, "base64").toString("utf8"));
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Expected an object");
  } catch {
    log.warn("CHAT", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  // Build clientRawRequest for logging (if not provided)
  if (!clientRawRequest) {
    const url = new URL(request.url);
    clientRawRequest = {
      endpoint: url.pathname,
      body,
      headers: Object.fromEntries(request.headers.entries())
    };
  }
  // Claude Code marks a 1M-context request as `<model>[1m]`; the marker matches
  // no combo, alias or provider/model pair, so it must not reach resolution.
  // The capability travels in the anthropic-beta header, forwarded as-is.
  const { model: modelStr, contextMarker } = stripModelContextMarker(body.model);
  if (contextMarker) body.model = modelStr;

  // Request summary is emitted as the unified "▶" line in chatCore (has fmt/thinking/account)

  // Log API key (masked)
  const authHeader = request.headers.get("Authorization");
  const apiKey = extractApiKey(request);
  if (authHeader && apiKey) {
    const masked = log.maskKey(apiKey);
    log.debug("AUTH", `API Key: ${masked}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  // Enforce API key if enabled in settings
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    const valid = await isValidApiKey(apiKey);
    if (!valid) {
      const deniedCtx = await getKeyAccessContext(request);
      if (deniedCtx?.deniedStatus) {
        log.warn("AUTH", `API key rejected (${deniedCtx.deniedStatus.reason})`);
        return errorResponse(deniedCtx.deniedStatus.status, deniedCtx.deniedStatus.message);
      }
      log.warn("AUTH", "Invalid API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
  }

  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  // Per-key access control: a restricted key may call only its listed combos and
  // models. Checked once on the requested target, before bypass, combo expansion
  // and any credential lookup; an allowed combo grants the members it routes to.
  const keyAccess = await getKeyAccessContext(request);
  const keyAccessDenied = await enforceKeyAccess(keyAccess, modelStr);
  if (keyAccessDenied) return keyAccessDenied;

  const guarded = applyChatGuardrails(body, settings.chatGuardrails);
  if (guarded.blocked) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Request blocked by the prompt injection guardrail");
  if (guarded.redactions) {
    log.info("GUARDRAILS", `Redacted ${guarded.redactions} sensitive text matches`);
    body = guarded.body;
    clientRawRequest = { ...clientRawRequest, body };
  }
  const sessionId = resolveSessionIdentity({ headers: clientRawRequest?.headers, body })?.sessionId || null;

  // Bypass naming/warmup requests before combo rotation to avoid wasting rotation slots
  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, !!settings.ccFilterNaming);
  if (bypassResponse) return bypassResponse.response || bypassResponse;

  return withKeySpendBudget(keyAccess, apiKey, () =>
    dispatchChatRequest(body, modelStr, { clientRawRequest, request, apiKey, settings, keyAccess, sessionId, contextMarker })
  );
}

async function dispatchChatRequest(body, modelStr, context) {
  const { clientRawRequest, request, apiKey, settings, keyAccess, sessionId, contextMarker } = context;
  const requiredCapabilities = detectRequiredCapabilities(body);

  const comboModels = await getComboModels(modelStr);
  if (comboModels) {
    const comboConfig = getComboConfig(settings, modelStr);
    const compression = normalizeComboCompression(comboConfig.compression);
    const dispatch = () => dispatchChatCombo(body, modelStr, comboModels, { ...context, requiredCapabilities });
    if (compression.semanticCacheModel && apiKey && (settings.requireApiKey || await isValidApiKey(apiKey))) {
      return withSemanticCache({
        request,
        body,
        apiKey,
        config: [modelStr, comboModels, comboConfig, settings, keyAccess?.allow],
        embed: (prompt) => embedForCache(request, apiKey, compression.semanticCacheModel, prompt),
        dispatch,
      });
    }
    return dispatch();
  }

  // Single model request — may still switch to a capacity-adapter model if the
  // target lacks a capability the request needs (e.g. no vision, request has an image).
  const soloAugmented = await filterAdapterModels(keyAccess, augmentModelsWithCapacityAdapter([modelStr], requiredCapabilities, settings), [modelStr]);
  if (soloAugmented.length > 1) {
    const adapterAdded = soloAugmented.filter((m) => m !== modelStr);
    log.info("CHAT", `Capacity adapter for [${[...requiredCapabilities].join(",")}] on "${modelStr}" → trying ${soloAugmented.join(", ")}`);
    return handleComboChat({
      body,
      models: soloAugmented,
      handleSingleModel: withCapacityAdapterStripping(
        (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
        adapterAdded
      ),
      log,
      comboName: modelStr,
      comboStrategy: getActiveAdapterStrategy(requiredCapabilities, settings)
    });
  }

  return handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKey, contextMarker ? `${modelStr.slice(modelStr.indexOf("/") + 1)}[${contextMarker}]` : null);
}

function getComboConfig(settings, name) {
  const strategies = settings.comboStrategies || {};
  return Object.hasOwn(strategies, name) ? strategies[name] || {} : {};
}

async function embedForCache(request, apiKey, model, input) {
  const timeout = AbortSignal.timeout(2000);
  const signal = AbortSignal.any([request.signal, timeout]);
  let onAbort;
  const canceled = new Promise((resolve) => {
    onAbort = () => resolve(null);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  if (signal.aborted) return null;

  const operation = async () => {
    const response = await handleEmbeddings(new Request(new URL("/v1/embeddings", request.url), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input, encoding_format: "float" }),
      signal,
    }), { withinMeteredRequest: true });
    if (!response.ok) {
      response.body?.cancel().catch(() => {});
      return null;
    }
    const data = await readBoundedJson(response, 262_144);
    return data?.data?.[0]?.embedding;
  };
  try {
    return await Promise.race([operation(), canceled]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function dispatchChatCombo(body, comboName, comboModels, context) {
  const { clientRawRequest, request, apiKey, settings, keyAccess, sessionId, requiredCapabilities } = context;
  const path = context.comboPath || [];
  if (path.includes(comboName) || path.length >= 8) {
    return errorResponse(400, "A combo cannot reference itself or exceed eight levels of nesting");
  }
  const comboPath = [...path, comboName];
  const comboCfg = getComboConfig(settings, comboName);
  const comboStrategy = comboCfg.fallbackStrategy || settings.comboStrategy || "fallback";
  const quotaStrategy = isQuotaRoutingStrategy(comboStrategy) ? comboStrategy : null;
  const compression = { ...context.compression, ...normalizeComboCompression(comboCfg.compression) };
  const inspectOutput = (text) => previewChatGuardrails(text, settings.chatGuardrails);
  const dispatch = (b, m, raw = clientRawRequest) =>
    handleSingleModelChat(b, m, raw, request, apiKey, null, { quotaStrategy, compression, comboPath, keyAccess });

  if (comboStrategy === "pipeline") {
    return handlePipelineChat({
      body,
      models: comboModels,
      dispatch: (step, model) => dispatch(step, model, { ...clientRawRequest, body: step }),
      signal: request?.signal,
      inspectOutput,
      beforeStep: keyAccess?.dailyLimitUsd > 0 ? async (index) => {
        if (index === 0) return null;
        await waitForKeySpendWrites(apiKey);
        const denial = await getDailySpendDenial(apiKey, keyAccess.dailyLimitUsd);
        return denial ? errorResponse(denial.status, denial.message, { "Retry-After": String(denial.retryAfter) }) : null;
      } : null,
    });
  }

  if (comboStrategy === "fusion") {
    return handleFusionChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m, isPanel) => {
        if (!isPanel || !clientRawRequest) return dispatch(b, m);
        const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
        return dispatch(b, m, { ...clientRawRequest, body: cleanBody });
      },
      log,
      comboName,
      judgeModel: comboCfg.judgeModel,
      tuning: comboCfg.fusionTuning,
      inspectOutput,
    });
  }

  const augmented = augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, settings);
  const models = await filterAdapterModels(keyAccess, augmented, comboModels);
  const adapterAdded = models.filter((model) => !comboModels.includes(model));
  const orderedModels = quotaStrategy ? await orderComboTargets(models, quotaStrategy) : models;
  log.info("CHAT", `Combo "${comboName}" with ${models.length} models (strategy: ${comboStrategy})`);
  return handleComboChat({
    body,
    models: orderedModels,
    handleSingleModel: withCapacityAdapterStripping(dispatch, adapterAdded),
    log,
    comboName,
    comboStrategy,
    signal: request?.signal,
    waitForTransientCooldown: settings.connectionResilience?.enabled !== true,
    comboStickyLimit: settings.comboStickyRoundRobinLimit,
    sessionId,
    smartPolicy: comboCfg.smartPolicy || "smart",
    sessionSticky: comboCfg.sessionSticky !== false,
    confidenceThreshold: typeof comboCfg.confidenceThreshold === "number" ? comboCfg.confidenceThreshold : 0.8,
    resolveSmartChoice: comboStrategy === "smart"
      ? (b, m) => resolveSmartChoice({ body: b, models: m, routerModel: comboCfg.routerModel, log })
      : null,
  });
}

/**
 * Handle single model chat request
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null, requestedModel = null, options = {}) {
  const modelInfo = await getModelInfo(modelStr);

  // If provider is null, this might be a combo name - check and handle
  if (!modelInfo.provider) {
    const comboModels = await getComboModels(modelStr);
    if (comboModels) {
      return dispatchChatCombo(body, modelStr, comboModels, {
        clientRawRequest,
        request,
        apiKey,
        compression: options.compression,
        comboPath: options.comboPath,
        settings: await getSettings(),
        keyAccess: options.keyAccess ?? await getKeyAccessContext(request),
        sessionId: resolveSessionIdentity({ headers: clientRawRequest?.headers, body })?.sessionId || null,
        requiredCapabilities: detectRequiredCapabilities(body),
      });
    }
    log.warn("CHAT", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;

  // Routing shown in the unified "▶" line (client model → provider/model)

  // Extract userAgent from request
  const userAgent = request?.headers?.get("user-agent") || "";
  const isCliPing = Boolean(request?.headers?.get("x-9r-cli-token"));
  let clearedStrikesOnPingFallback = false;

  // Try with available accounts (fallback on errors)
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;
  let lastHeaders = null;
  let queueRetryAt = Infinity;
  const chatSettings = await getSettings();
  const compression = { ...chatSettings, ...options.compression };
  const resilience = resolveResilienceConfig(chatSettings.connectionResilience);
  const signal = request?.signal;

  while (true) {
    if (signal?.aborted) return errorResponse(499, "Request aborted");
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model, {
      requestedModel: requestedModel || model,
      ...(options.quotaStrategy ? { quotaStrategy: options.quotaStrategy } : {}),
      ...(resilience.enabled ? { resilience: true } : {}),
    });

    // All accounts unavailable
    if (!credentials || credentials.allRateLimited) {
      if (provider === "antigravity" && isCliPing && !clearedStrikesOnPingFallback) {
        clearedStrikesOnPingFallback = true;
        clearAntigravityStrikes(null, model);
        continue;
      }
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("CHAT", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman, lastHeaders);
      }
      if (Number.isFinite(queueRetryAt)) {
        const retryAt = new Date(queueRetryAt).toISOString();
        return unavailableResponse(HTTP_STATUS.SERVICE_UNAVAILABLE,
          `[${provider}/${model}] Connection busy`, retryAt, formatRetryAfter(retryAt));
      }
      if (excludeConnectionIds.size === 0) {
        log.warn("AUTH", `No active credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.NOT_FOUND, `No active credentials for provider: ${provider}`);
      }
      log.warn("CHAT", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable", lastHeaders);
    }

    // Account selection shown in the unified "▶" line (acc:...)
    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    // Ensure real project ID is available for providers that need it (P0 fix: cold miss)
    if ((provider === "antigravity" || provider === "gemini-cli") && !refreshedCredentials.projectId) {
      const pid = await getProjectIdForConnection(credentials.connectionId, refreshedCredentials.accessToken, provider);
      if (pid) {
        refreshedCredentials.projectId = pid;
        // Persist to DB in background so subsequent requests have it immediately
        updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => { });
      }
    }

    // When routing to an Antigravity account for an Argon model whose quota/tier
    // is not yet cached, check quota upfront so free-tier/exhausted accounts are skipped immediately.
    if (
      provider === "antigravity" &&
      getAntigravityModelFamily(model) === "argon" &&
      !getAntigravityQuotaCache().has(credentials.connectionId)
    ) {
      const quotas = await refreshAntigravityQuota(
        credentials.connectionId,
        refreshedCredentials.accessToken,
        credentials.providerSpecificData
      );
      const quota = getAntigravityModelQuota(quotas, model);
      if (quota && Math.round(quota.remainingPercentage) <= 0 && quota.resetAt && new Date(quota.resetAt).getTime() > Date.now()) {
        log.info("AG_QUOTA", `${credentials.connectionId.slice(0, 8)} | PREFLIGHT_SKIP ${model} — unsupported/exhausted on fallback account`);
        excludeConnectionIds.add(credentials.connectionId);
        continue;
      }
    }

    const pxpipeTransform = compression.pxpipeEnabled ? await getPxpipeTransform() : null;
    const ticket = resilience.enabled
      ? await enterConnection(provider, credentials.connectionId, resilience, signal)
      : null;
    if (ticket?.aborted || signal?.aborted) {
      ticket?.complete?.("cancel");
      return errorResponse(499, "Request aborted");
    }
    if (ticket?.retryAt) {
      queueRetryAt = Math.min(queueRetryAt, ticket.retryAt);
      excludeConnectionIds.add(credentials.connectionId);
      continue;
    }

    // Use shared chatCore
    const providerThinking = (chatSettings.providerThinking || {})[provider] || null;
    let streamFailed = false;
    const result = await handleChatCore({
      body: { ...body, model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      clientRawRequest,
      connectionId: credentials.connectionId,
      userAgent,
      apiKey,
      signal,
      onStreamError: () => { streamFailed = true; },
      ccFilterNaming: !!chatSettings.ccFilterNaming,
      rtkEnabled: !!compression.rtkEnabled,
      toolDedupEnabled: compression.toolDedupEnabled === true,
      headroomEnabled: !!compression.headroomEnabled,
      headroomUrl: chatSettings.headroomUrl || DEFAULT_HEADROOM_URL,
      headroomCompressUserMessages: !!chatSettings.headroomCompressUserMessages,
      headroomTimeoutMs: chatSettings.headroomTimeoutMs,
      cavemanEnabled: !!compression.cavemanEnabled,
      cavemanLevel: chatSettings.cavemanLevel || "full",
      ponytailEnabled: !!compression.ponytailEnabled,
      ponytailLevel: chatSettings.ponytailLevel || "full",
      customPromptEnabled: !!chatSettings.customPromptEnabled,
      customPrompt: chatSettings.customPrompt || "",
      pxpipeEnabled: !!compression.pxpipeEnabled,
      pxpipeMinChars: chatSettings.pxpipeMinChars,
      pxpipeTimeoutMs: chatSettings.pxpipeTimeoutMs,
      // Lazily warms the in-process module on first use; null when not installed (fail-open)
      pxpipeTransform,
      onPxpipeEvent: appendPxpipeEvent,
      providerThinking,
      // Per-provider user overrides (custom headers / connect timeout) from settings
      providerOverrides: (chatSettings.providerOverrides || {})[provider] || null,
      // Detect source format by endpoint + body
      sourceFormatOverride: request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          ...newCreds,
          existingProviderSpecificData: credentials.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
        // "Consecutive" strikes: a success clears the breaker for this pair.
        clearAntigravityStrikes(credentials.connectionId, model);
        if (provider === "antigravity") {
          recordAntigravityHealthyAccount(credentials.connectionId, model);
          if ((credentials._connection?.priority || 1) > 1) {
            updateProviderConnection(credentials.connectionId, { priority: 1 }).catch(() => {});
          }
        }
      }
    }).catch((error) => {
      ticket?.complete("cancel");
      throw error;
    });

    if (result.success) {
      if (ticket && result.response.headers.get("content-type")?.includes("text/event-stream")) {
        return withResponseFinalizer(result.response, (outcome) => {
          ticket.complete(signal?.aborted || outcome === "cancel" ? "cancel" :
            streamFailed || outcome === "error" ? "failure" : "success");
        });
      }
      ticket?.complete("success");
      return result.response;
    }
    ticket?.complete(!signal?.aborted && result.status >= 500 ? "failure" : "cancel");
    if (signal?.aborted || result.status === 499) return result.response;

    // Antigravity 409/429 (or 400/403/404 on Argon models for free-tier accounts):
    // refresh live quota to detect exhausted/unsupported tier before locking.
    let quotaResetMs = null;
    let resetsAtMs = result.resetsAtMs;
    const isAntigravityArgonTierError =
      provider === "antigravity" &&
      getAntigravityModelFamily(model) === "argon" &&
      (result.status === 400 || result.status === 403 || result.status === 404);
    if (provider === "antigravity" && (result.status === 409 || result.status === 429 || isAntigravityArgonTierError)) {
      quotaResetMs = await handleAntigravityQuotaError(
        credentials.connectionId, result.status, model,
        refreshedCredentials.accessToken, credentials.providerSpecificData
      );
      if (quotaResetMs) resetsAtMs = quotaResetMs;
      else resetsAtMs = null;
    } else if (provider === "antigravity" && (result.status === 502 || result.status === 504)) {
      quotaResetMs = handleAntigravityStallError(
        credentials.connectionId, result.status, model, result.error
      );
      if (quotaResetMs) resetsAtMs = quotaResetMs;
    }

    // Antigravity 409/429 (and quota-exhausted tier errors) are managed in RAM
    // by antigravityQuotaCache + the 3-strike breaker. Do not persist modelLock_* in DB.
    const shouldFallback = provider === "antigravity" && (quotaResetMs || result.status === 409 || result.status === 429)
      ? true
      : (await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, resetsAtMs)).shouldFallback;

    if (shouldFallback) {
      log.warn("FALLBACK", `⇄ ACC:${credentials.connectionName} UNAVAILABLE (${result.status}) → NEXT ACCOUNT`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      lastHeaders = upstreamResponseHeaders(result.response?.headers);
      continue;
    }

    return result.response;
  }
}
