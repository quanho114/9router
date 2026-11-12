// Per-API-key access control: pure helpers (no DB, no
// request objects), shared by the DB repo, the API routes and the engine.
import {
  KEY_ACCESS_MAX_ENTRIES,
  KEY_ACCESS_MAX_ENTRY_LENGTH,
  KEY_ACCESS_UNRESTRICTED,
} from "@/shared/constants/keyAccess.js";

/**
 * Normalize an allow list: keep strings only, trim, drop empties, de-duplicate
 * case-insensitively (the first spelling wins). Order is preserved.
 */
export function normalizeAllowList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const entry = item.trim();
    if (!entry) continue;
    const k = entry.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(entry);
  }
  return out;
}

/**
 * Build the access object from the two apiKeys columns.
 *
 * Fails CLOSED: the restricted flag has its own INTEGER column, so a corrupt or
 * unparsable allow list can only ever shrink what a restricted key may call
 * (to nothing); it can never turn a restricted key into an unrestricted one.
 */
export function keyAccessFromColumns(restrictedCol, allowCol) {
  const restricted = restrictedCol === 1 || restrictedCol === true;
  if (!restricted) return { restricted: false, allow: [] };
  let parsed = [];
  if (typeof allowCol === "string" && allowCol) {
    try { parsed = JSON.parse(allowCol); } catch { parsed = []; }
  }
  return { restricted: true, allow: normalizeAllowList(parsed) };
}

/** Columns to persist for an access object (already validated/normalized). */
export function keyAccessToColumns(access) {
  const value = access || KEY_ACCESS_UNRESTRICTED;
  return {
    accessRestricted: value.restricted ? 1 : 0,
    accessAllow: JSON.stringify(value.restricted ? normalizeAllowList(value.allow) : []),
  };
}

/**
 * Validate client input for an access update ({ restricted, allow }).
 * Rejects rather than repairs: wrong types, too many entries, overlong entries.
 * @returns {{ ok: true, value: {restricted: boolean, allow: string[]} } | { ok: false, error: string }}
 */
export function validateKeyAccessInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "access must be an object { restricted, allow }" };
  }
  const extra = Object.keys(input).filter((k) => k !== "restricted" && k !== "allow");
  if (extra.length) return { ok: false, error: `access: unexpected field(s) ${extra.join(", ")}` };
  if (typeof input.restricted !== "boolean") {
    return { ok: false, error: "access.restricted must be a boolean" };
  }
  const allow = input.allow === undefined ? [] : input.allow;
  if (!Array.isArray(allow) || allow.some((e) => typeof e !== "string")) {
    return { ok: false, error: "access.allow must be an array of strings" };
  }
  if (allow.length > KEY_ACCESS_MAX_ENTRIES) {
    return { ok: false, error: `access.allow has more than ${KEY_ACCESS_MAX_ENTRIES} entries` };
  }
  if (allow.some((e) => e.trim().length > KEY_ACCESS_MAX_ENTRY_LENGTH)) {
    return { ok: false, error: `access.allow entries must be at most ${KEY_ACCESS_MAX_ENTRY_LENGTH} characters` };
  }
  return { ok: true, value: { restricted: input.restricted, allow: normalizeAllowList(allow) } };
}

/**
 * Evaluate whether a key record is currently usable (active, not expired, and
 * within its configured input/output token limits).
 * @param {object} record
 * @param {number} [nowMs]
 */
export function checkKeyStatus(record, nowMs = Date.now()) {
  if (!record) {
    return { ok: false, reason: "invalid", status: 401, message: "Invalid API key" };
  }
  if (record.isActive === false || record.isActive === 0) {
    return { ok: false, reason: "revoked", status: 403, message: "This API key has been revoked" };
  }
  if (typeof record.expiresAt === "string" && record.expiresAt.trim()) {
    const expMs = Date.parse(record.expiresAt.trim());
    if (Number.isFinite(expMs) && expMs <= nowMs) {
      return { ok: false, reason: "expired", status: 403, message: "This API key has expired" };
    }
  }
  const maxIn = Number(record.maxInputTokens) > 0 ? Number(record.maxInputTokens) : 0;
  const usedIn = Number(record.usedInputTokens) > 0 ? Number(record.usedInputTokens) : 0;
  if (maxIn > 0 && usedIn >= maxIn) {
    return {
      ok: false,
      reason: "input_quota_exceeded",
      status: 429,
      message: `This API key has reached its input token quota limit (${usedIn.toLocaleString("en-US")} / ${maxIn.toLocaleString("en-US")})`,
    };
  }
  const maxOut = Number(record.maxOutputTokens) > 0 ? Number(record.maxOutputTokens) : 0;
  const usedOut = Number(record.usedOutputTokens) > 0 ? Number(record.usedOutputTokens) : 0;
  if (maxOut > 0 && usedOut >= maxOut) {
    return {
      ok: false,
      reason: "output_quota_exceeded",
      status: 429,
      message: `This API key has reached its output token quota limit (${usedOut.toLocaleString("en-US")} / ${maxOut.toLocaleString("en-US")})`,
    };
  }
  return { ok: true, reason: null, status: 200, message: null };
}

/**
 * Validate optional quota & expiration fields on key create/update.
 */
export function validateKeyQuotaInput(input = {}) {
  const out = {};

  if (input.dailyLimitUsd !== undefined) {
    const raw = input.dailyLimitUsd;
    const limit = raw === null ? 0 : Number(raw);
    if ((raw !== null && typeof raw !== "number" && typeof raw !== "string") ||
        !Number.isFinite(limit) || limit < 0) {
      return { ok: false, error: "dailyLimitUsd must be a non-negative amount in USD" };
    }
    out.dailyLimitUsd = limit;
  }

  if (input.maxInputTokens !== undefined) {
    if (input.maxInputTokens === null || input.maxInputTokens === "") {
      out.maxInputTokens = 0;
    } else {
      const n = Number(input.maxInputTokens);
      if (!Number.isFinite(n) || n < 0) {
        return { ok: false, error: "maxInputTokens must be a non-negative number" };
      }
      out.maxInputTokens = Math.floor(n);
    }
  }

  if (input.maxOutputTokens !== undefined) {
    if (input.maxOutputTokens === null || input.maxOutputTokens === "") {
      out.maxOutputTokens = 0;
    } else {
      const n = Number(input.maxOutputTokens);
      if (!Number.isFinite(n) || n < 0) {
        return { ok: false, error: "maxOutputTokens must be a non-negative number" };
      }
      out.maxOutputTokens = Math.floor(n);
    }
  }

  if (input.usedInputTokens !== undefined) {
    const n = Number(input.usedInputTokens);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: "usedInputTokens must be a non-negative number" };
    }
    out.usedInputTokens = Math.floor(n);
  }

  if (input.usedOutputTokens !== undefined) {
    const n = Number(input.usedOutputTokens);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: "usedOutputTokens must be a non-negative number" };
    }
    out.usedOutputTokens = Math.floor(n);
  }

  if (input.resetUsage === true) {
    out.usedInputTokens = 0;
    out.usedOutputTokens = 0;
  }

  if (input.expiresAt !== undefined) {
    if (input.expiresAt === null || input.expiresAt === "") {
      out.expiresAt = null;
    } else if (typeof input.expiresAt === "string") {
      const parsed = Date.parse(input.expiresAt.trim());
      if (Number.isNaN(parsed)) {
        return { ok: false, error: "expiresAt must be a valid ISO date string or null" };
      }
      out.expiresAt = new Date(parsed).toISOString();
    } else {
      return { ok: false, error: "expiresAt must be a valid ISO date string or null" };
    }
  }

  return { ok: true, value: out };
}
