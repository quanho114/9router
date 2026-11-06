"use client";

import { useState, useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import Modal from "@/shared/components/Modal";
import Button from "@/shared/components/Button";
import Input from "@/shared/components/Input";
import Toggle from "@/shared/components/Toggle";
import ProviderIcon from "@/shared/components/ProviderIcon";
import {
  OAUTH_PROVIDERS,
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  APIKEY_PROVIDERS,
  getProviderAlias,
} from "@/shared/constants/providers";
import { getModelsByProviderId } from "@/shared/constants/models";
import { formatTokenCompact } from "./TokenQuotaRing";

const ALL_PROVIDERS = {
  ...OAUTH_PROVIDERS,
  ...FREE_PROVIDERS,
  ...FREE_TIER_PROVIDERS,
  ...APIKEY_PROVIDERS,
};

const ALIAS_TO_PROVIDER_META = Object.entries(ALL_PROVIDERS).reduce((acc, [id, info]) => {
  const alias = getProviderAlias(id) || id;
  acc[alias.toLowerCase()] = { id, name: info.name || id, alias, color: info.color || "#6366f1" };
  acc[id.toLowerCase()] = { id, name: info.name || id, alias, color: info.color || "#6366f1" };
  return acc;
}, {});

const INPUT_TOKEN_PRESETS = [
  { label: "100K", value: 100_000 },
  { label: "500K", value: 500_000 },
  { label: "1M", value: 1_000_000 },
  { label: "5M", value: 5_000_000 },
  { label: "10M", value: 10_000_000 },
  { label: "50M", value: 50_000_000 },
  { label: "∞ Không giới hạn", value: 0 },
];

const OUTPUT_TOKEN_PRESETS = [
  { label: "50K", value: 50_000 },
  { label: "200K", value: 200_000 },
  { label: "500K", value: 500_000 },
  { label: "1M", value: 1_000_000 },
  { label: "5M", value: 5_000_000 },
  { label: "10M", value: 10_000_000 },
  { label: "∞ Không giới hạn", value: 0 },
];

const EXPIRY_PRESETS = [
  { label: "+1 ngày", days: 1 },
  { label: "+7 ngày", days: 7 },
  { label: "+30 ngày", days: 30 },
  { label: "+90 ngày", days: 90 },
  { label: "+365 ngày", days: 365 },
];

function toDatetimeLocalValue(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function UserKeyProvisionModal({
  isOpen,
  onClose,
  onSubmit,
  initialKey = null,
}) {
  const isEdit = !!initialKey;

  const [name, setName] = useState("");
  const [restricted, setRestricted] = useState(true);
  const [selectedModels, setSelectedModels] = useState([]);
  const [maxInputTokens, setMaxInputTokens] = useState(1_000_000);
  const [maxOutputTokens, setMaxOutputTokens] = useState(500_000);
  const [noDate, setNoDate] = useState(true);
  const [expiresAtInput, setExpiresAtInput] = useState("");
  const [resetUsage, setResetUsage] = useState(false);

  const [detecting, setDetecting] = useState(false);
  const [detectedGroups, setDetectedGroups] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Populate state on open
  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg("");
    setSearchQuery("");
    setResetUsage(false);

    if (initialKey) {
      setName(initialKey.name || "");
      const isRestr = !!initialKey.access?.restricted;
      setRestricted(isRestr);
      setSelectedModels(Array.isArray(initialKey.access?.allow) ? initialKey.access.allow : []);
      setMaxInputTokens(Number(initialKey.maxInputTokens) > 0 ? Number(initialKey.maxInputTokens) : 0);
      setMaxOutputTokens(Number(initialKey.maxOutputTokens) > 0 ? Number(initialKey.maxOutputTokens) : 0);
      if (initialKey.expiresAt) {
        setNoDate(false);
        setExpiresAtInput(toDatetimeLocalValue(initialKey.expiresAt));
      } else {
        setNoDate(true);
        setExpiresAtInput("");
      }
    } else {
      setName("");
      setRestricted(true);
      setSelectedModels([]);
      setMaxInputTokens(1_000_000);
      setMaxOutputTokens(500_000);
      setNoDate(true);
      setExpiresAtInput("");
    }
  }, [isOpen, initialKey]);

  // Detect available models in the system when modal opens
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const loadDetectedModels = async () => {
      setDetecting(true);
      try {
        const [v1ModelsRes, providersRes, combosRes, customRes, disabledRes] = await Promise.all([
          fetch("/api/v1/models", { cache: "no-store" }).catch(() => null),
          fetch("/api/providers", { cache: "no-store" }).catch(() => null),
          fetch("/api/combos", { cache: "no-store" }).catch(() => null),
          fetch("/api/models/custom", { cache: "no-store" }).catch(() => null),
          fetch("/api/models/disabled", { cache: "no-store" }).catch(() => null),
        ]);

        const v1Data = v1ModelsRes?.ok ? await v1ModelsRes.json() : { data: [] };
        const connections = providersRes?.ok ? (await providersRes.json()).connections || [] : [];
        const combos = combosRes?.ok ? (await combosRes.json()).combos || [] : [];
        const customModels = customRes?.ok ? (await customRes.json()).models || [] : [];
        const disabledMap = disabledRes?.ok ? (await disabledRes.json()).disabled || {} : {};

        const isModelDisabled = (aliasOrId, modelId) => {
          const list = disabledMap[aliasOrId];
          return Array.isArray(list) && list.includes(modelId);
        };

        const groupsMap = new Map();

        const ensureGroup = (key, title, providerId, alias, isCombo = false) => {
          if (!groupsMap.has(key)) {
            groupsMap.set(key, {
              key,
              title,
              providerId,
              alias,
              isCombo,
              models: [],
              seen: new Set(),
            });
          }
          return groupsMap.get(key);
        };

        // 1. Add Combos group first if any combos exist
        for (const combo of combos) {
          if (!combo?.name) continue;
          const g = ensureGroup("__combos__", "Combos (Model Fallback)", "combo", "combo", true);
          const val = combo.name;
          const lower = val.toLowerCase();
          if (!g.seen.has(lower)) {
            g.seen.add(lower);
            g.models.push({
              value: val,
              label: combo.name,
              sublabel: Array.isArray(combo.models) ? `${combo.models.length} models` : "combo",
            });
          }
        }

        // 2. Add models returned by /api/v1/models (reflects live detected models from active accounts)
        const v1List = Array.isArray(v1Data?.data) ? v1Data.data : [];
        for (const item of v1List) {
          if (!item?.id) continue;
          if (item.owned_by === "combo") {
            const g = ensureGroup("__combos__", "Combos (Model Fallback)", "combo", "combo", true);
            const lower = item.id.toLowerCase();
            if (!g.seen.has(lower)) {
              g.seen.add(lower);
              g.models.push({
                value: item.id,
                label: item.id,
                sublabel: "combo",
              });
            }
            continue;
          }

          const slashIdx = item.id.indexOf("/");
          const prefix = slashIdx > 0 ? item.id.slice(0, slashIdx) : (item.owned_by || "other");
          const rawModelId = slashIdx > 0 ? item.id.slice(slashIdx + 1) : item.id;
          const meta = ALIAS_TO_PROVIDER_META[prefix.toLowerCase()] || {
            id: prefix,
            name: prefix.toUpperCase(),
            alias: prefix,
          };

          if (isModelDisabled(meta.alias, rawModelId) || isModelDisabled(meta.id, rawModelId)) {
            continue;
          }

          const g = ensureGroup(meta.id, meta.name, meta.id, prefix, false);
          const lower = item.id.toLowerCase();
          if (!g.seen.has(lower)) {
            g.seen.add(lower);
            g.models.push({
              value: item.id,
              label: rawModelId,
              sublabel: item.id,
            });
          }
        }

        // 3. Also merge models from active provider connections in case live resolver skipped any
        const activeConns = connections.filter((c) => c && c.isActive !== false);
        for (const conn of activeConns) {
          const providerId = conn.provider;
          if (!providerId) continue;
          const meta = ALIAS_TO_PROVIDER_META[providerId.toLowerCase()] || {
            id: providerId,
            name: conn.name || providerId,
            alias: conn.providerSpecificData?.prefix || getProviderAlias(providerId) || providerId,
          };
          const alias = conn.providerSpecificData?.prefix || meta.alias || providerId;
          const staticModels = getModelsByProviderId(providerId) || [];
          const enabledModels = Array.isArray(conn.providerSpecificData?.enabledModels)
            ? conn.providerSpecificData.enabledModels
            : null;

          for (const m of staticModels) {
            if (!m?.id) continue;
            if (isModelDisabled(alias, m.id) || isModelDisabled(providerId, m.id)) continue;
            if (enabledModels && enabledModels.length > 0) {
              const full = `${alias}/${m.id}`;
              if (!enabledModels.includes(m.id) && !enabledModels.includes(full)) continue;
            }
            const g = ensureGroup(meta.id, meta.name, meta.id, alias, false);
            const fullVal = `${alias}/${m.id}`;
            const lower = fullVal.toLowerCase();
            if (!g.seen.has(lower)) {
              g.seen.add(lower);
              g.models.push({
                value: fullVal,
                label: m.name || m.id,
                sublabel: fullVal,
              });
            }
          }
        }

        // 4. Merge custom models
        for (const cm of customModels) {
          if (!cm?.id || !cm?.providerAlias) continue;
          const meta = ALIAS_TO_PROVIDER_META[cm.providerAlias.toLowerCase()] || {
            id: cm.providerAlias,
            name: cm.providerAlias,
            alias: cm.providerAlias,
          };
          const fullVal = `${cm.providerAlias}/${cm.id}`;
          const g = ensureGroup(meta.id, meta.name, meta.id, cm.providerAlias, false);
          const lower = fullVal.toLowerCase();
          if (!g.seen.has(lower)) {
            g.seen.add(lower);
            g.models.push({
              value: fullVal,
              label: cm.name || cm.id,
              sublabel: fullVal,
            });
          }
        }

        if (!cancelled) {
          const finalGroups = Array.from(groupsMap.values()).filter((g) => g.models.length > 0);
          setDetectedGroups(finalGroups);
        }
      } catch (err) {
        console.error("Failed to detect models:", err);
      } finally {
        if (!cancelled) setDetecting(false);
      }
    };

    loadDetectedModels();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const selectedSet = useMemo(
    () => new Set(selectedModels.map((m) => m.toLowerCase())),
    [selectedModels]
  );

  // Filter groups & models by search query
  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return detectedGroups;
    return detectedGroups
      .map((group) => {
        const groupMatches =
          group.title.toLowerCase().includes(q) ||
          group.alias.toLowerCase().includes(q);
        const matchingModels = groupMatches
          ? group.models
          : group.models.filter(
              (m) =>
                m.label.toLowerCase().includes(q) ||
                m.value.toLowerCase().includes(q)
            );
        if (matchingModels.length === 0) return null;
        return { ...group, models: matchingModels };
      })
      .filter(Boolean);
  }, [detectedGroups, searchQuery]);

  const totalDetectedCount = useMemo(
    () => detectedGroups.reduce((sum, g) => sum + g.models.length, 0),
    [detectedGroups]
  );

  const visibleModelValues = useMemo(
    () => filteredGroups.flatMap((g) => g.models.map((m) => m.value)),
    [filteredGroups]
  );

  const toggleModel = (value) => {
    const lower = value.toLowerCase();
    setSelectedModels((prev) => {
      const exists = prev.some((m) => m.toLowerCase() === lower);
      if (exists) return prev.filter((m) => m.toLowerCase() !== lower);
      return [...prev, value];
    });
  };

  const toggleProviderGroup = (group) => {
    const groupValues = group.models.map((m) => m.value);
    const groupLowers = new Set(groupValues.map((v) => v.toLowerCase()));
    const allSelected = groupValues.every((v) => selectedSet.has(v.toLowerCase()));

    setSelectedModels((prev) => {
      if (allSelected) {
        return prev.filter((m) => !groupLowers.has(m.toLowerCase()));
      }
      const existingLowers = new Set(prev.map((m) => m.toLowerCase()));
      const additions = groupValues.filter((v) => !existingLowers.has(v.toLowerCase()));
      return [...prev, ...additions];
    });
  };

  const selectAllVisible = () => {
    setSelectedModels((prev) => {
      const existingLowers = new Set(prev.map((m) => m.toLowerCase()));
      const additions = visibleModelValues.filter((v) => !existingLowers.has(v.toLowerCase()));
      return [...prev, ...additions];
    });
  };

  const clearAllSelected = () => {
    setSelectedModels([]);
  };

  const toggleCollapseGroup = (key) => {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const applyExpiryPreset = (days) => {
    setNoDate(false);
    const target = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    setExpiresAtInput(toDatetimeLocalValue(target.toISOString()));
  };

  const handleSubmit = async () => {
    setErrorMsg("");
    if (!name.trim()) {
      setErrorMsg("Vui lòng nhập tên API Key.");
      return;
    }
    if (restricted && selectedModels.length === 0) {
      setErrorMsg("Vui lòng tick chọn ít nhất 1 model (hoặc tắt giới hạn model).");
      return;
    }

    let expiresAtIso = null;
    if (!noDate) {
      if (!expiresAtInput) {
        setErrorMsg("Vui lòng chọn ngày hết hạn hoặc bật chế độ No Date.");
        return;
      }
      const parsed = new Date(expiresAtInput);
      if (Number.isNaN(parsed.getTime())) {
        setErrorMsg("Định dạng ngày hết hạn không hợp lệ.");
        return;
      }
      expiresAtIso = parsed.toISOString();
    }

    const payload = {
      name: name.trim(),
      access: {
        restricted: Boolean(restricted),
        allow: selectedModels,
      },
      maxInputTokens: Math.max(0, Math.floor(Number(maxInputTokens) || 0)),
      maxOutputTokens: Math.max(0, Math.floor(Number(maxOutputTokens) || 0)),
      expiresAt: expiresAtIso,
    };

    if (isEdit && resetUsage) {
      payload.resetUsage = true;
    }

    setSubmitting(true);
    try {
      const result = await onSubmit(payload);
      if (result?.error) {
        setErrorMsg(result.error);
      }
    } catch (err) {
      setErrorMsg(err?.message || "Có lỗi xảy ra khi lưu API Key.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      title={isEdit ? `Cấu hình Key: ${initialKey?.name}` : "Cấp API Key mới cho User"}
      onClose={onClose}
      size="xl"
    >
      <div className="flex flex-col gap-5 max-h-[78vh] overflow-y-auto pr-1">
        {/* 1. Key Name */}
        <div>
          <Input
            label="Tên Key / Tên User"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="VD: User Minh - Gói 5M Token"
          />
        </div>

        {/* 2. Detected Models Checklist */}
        <div className="rounded-xl border border-border p-4 bg-surface/40">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[18px]">
                  checklist
                </span>
                <p className="text-sm font-semibold text-text-main">
                  Danh sách Model hệ thống phát hiện ({totalDetectedCount})
                </p>
              </div>
              <p className="text-xs text-text-muted mt-0.5">
                Tick chọn từng model cụ thể mà key của user này được phép gọi
              </p>
            </div>
            <Toggle
              size="sm"
              checked={restricted}
              label={restricted ? "Giới hạn theo model đã tick" : "Cho phép mọi model"}
              onChange={(checked) => setRestricted(checked)}
            />
          </div>

          {restricted && (
            <>
              {/* Search & bulk actions */}
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <div className="relative flex-1 min-w-[200px]">
                  <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-[16px]">
                    search
                  </span>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Tìm model hoặc provider (vd: claude, gemini, gpt-5, ag/)..."
                    className="w-full rounded-lg border border-border bg-input pl-8 pr-3 py-1.5 text-xs text-text-main focus:outline-none focus:border-primary"
                  />
                </div>
                <button
                  type="button"
                  onClick={selectAllVisible}
                  className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                >
                  Chọn tất cả ({visibleModelValues.length})
                </button>
                <button
                  type="button"
                  onClick={clearAllSelected}
                  className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-text-muted hover:text-red-500 hover:border-red-500/40 transition-colors"
                >
                  Bỏ chọn hết
                </button>
                <span className="rounded-lg bg-primary/10 px-2.5 py-1.5 font-mono text-xs font-semibold text-primary">
                  Đã chọn: {selectedModels.length}
                </span>
              </div>

              {/* Models checklist grouped by provider */}
              <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border bg-background/50">
                {detecting ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-xs text-text-muted">
                    <span className="material-symbols-outlined animate-spin text-sm">
                      progress_activity
                    </span>
                    Đang quét danh sách model từ các provider đang kết nối...
                  </div>
                ) : filteredGroups.length === 0 ? (
                  <div className="py-8 text-center text-xs text-text-muted">
                    Không tìm thấy model nào khớp với từ khóa.
                  </div>
                ) : (
                  filteredGroups.map((group) => {
                    const selectedInGroup = group.models.filter((m) =>
                      selectedSet.has(m.value.toLowerCase())
                    ).length;
                    const allGroupSelected =
                      group.models.length > 0 && selectedInGroup === group.models.length;
                    const someGroupSelected =
                      selectedInGroup > 0 && selectedInGroup < group.models.length;
                    const isCollapsed = !!collapsedGroups[group.key];

                    return (
                      <div key={group.key} className="flex flex-col">
                        {/* Provider group header */}
                        <div className="flex items-center justify-between px-3 py-2 bg-surface-2/60 hover:bg-surface-2 transition-colors">
                          <label className="flex items-center gap-2.5 cursor-pointer select-none flex-1 min-w-0">
                            <input
                              type="checkbox"
                              checked={allGroupSelected}
                              ref={(el) => {
                                if (el) el.indeterminate = someGroupSelected;
                              }}
                              onChange={() => toggleProviderGroup(group)}
                              className="h-4 w-4 rounded border-border text-primary focus:ring-primary cursor-pointer accent-primary"
                            />
                            {group.isCombo ? (
                              <span className="material-symbols-outlined text-primary text-[16px]">
                                hub
                              </span>
                            ) : (
                              <ProviderIcon
                                providerId={group.providerId}
                                alt={group.title}
                                fallbackText={(group.alias || group.title || "?").slice(0, 2).toUpperCase()}
                                size={16}
                                className="shrink-0"
                              />
                            )}
                            <span className="text-xs font-semibold text-text-main truncate">
                              {group.title}
                            </span>
                            <span className="font-mono text-[11px] text-text-muted">
                              ({selectedInGroup}/{group.models.length})
                            </span>
                          </label>
                          <button
                            type="button"
                            onClick={() => toggleCollapseGroup(group.key)}
                            className="p-1 text-text-muted hover:text-text-main rounded"
                            title={isCollapsed ? "Mở rộng" : "Thu gọn"}
                          >
                            <span className="material-symbols-outlined text-[16px]">
                              {isCollapsed ? "expand_more" : "expand_less"}
                            </span>
                          </button>
                        </div>

                        {/* Individual model checkboxes */}
                        {!isCollapsed && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 p-2">
                            {group.models.map((model) => {
                              const checked = selectedSet.has(model.value.toLowerCase());
                              return (
                                <label
                                  key={model.value}
                                  className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer select-none border transition-colors ${
                                    checked
                                      ? "border-primary/40 bg-primary/10 text-text-main"
                                      : "border-transparent hover:bg-black/[0.03] dark:hover:bg-white/[0.03] text-text-muted"
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleModel(model.value)}
                                    className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary cursor-pointer accent-primary shrink-0"
                                  />
                                  <div className="flex flex-col min-w-0 flex-1">
                                    <span className="font-medium text-text-main truncate">
                                      {model.label}
                                    </span>
                                    <span className="font-mono text-[10px] text-text-muted truncate">
                                      {model.value}
                                    </span>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>

        {/* 3. Input / Output Token Quota Limits */}
        <div className="rounded-xl border border-border p-4 bg-surface/40">
          <div className="flex items-center gap-2 mb-1">
            <span className="material-symbols-outlined text-primary text-[18px]">
              data_usage
            </span>
            <p className="text-sm font-semibold text-text-main">
              Giới hạn Quota Token (Gói cố định Input / Output)
            </p>
          </div>
          <p className="text-xs text-text-muted mb-3">
            User sử dụng hết hạn mức Input hoặc Output được cấp sẽ tự động dừng (đặt = 0 nếu không giới hạn).
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Input Token Limit */}
            <div className="rounded-lg border border-border p-3 bg-background/40">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label className="text-xs font-semibold text-cyan-500 uppercase tracking-wider whitespace-nowrap">
                  Input Token Tối Đa
                </label>
                <span className="font-mono text-xs font-semibold text-text-main whitespace-nowrap">
                  {Number(maxInputTokens) > 0
                    ? `${formatTokenCompact(maxInputTokens)} tokens`
                    : "∞ Không giới hạn"}
                </span>
              </div>
              <input
                type="number"
                min="0"
                step="1000"
                value={maxInputTokens}
                onChange={(e) => setMaxInputTokens(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded-lg border border-border bg-input px-3 py-1.5 font-mono text-sm text-text-main focus:outline-none focus:border-primary mb-2"
                placeholder="0 = Không giới hạn"
              />
              <div className="flex flex-wrap gap-1">
                {INPUT_TOKEN_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setMaxInputTokens(preset.value)}
                    className={`rounded-md px-2 py-0.5 font-mono text-[11px] border transition-colors ${
                      Number(maxInputTokens) === preset.value
                        ? "border-cyan-500 bg-cyan-500/15 text-cyan-500 font-semibold"
                        : "border-border text-text-muted hover:text-text-main"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Output Token Limit */}
            <div className="rounded-lg border border-border p-3 bg-background/40">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label className="text-xs font-semibold text-violet-500 uppercase tracking-wider whitespace-nowrap">
                  Output Token Tối Đa
                </label>
                <span className="font-mono text-xs font-semibold text-text-main whitespace-nowrap">
                  {Number(maxOutputTokens) > 0
                    ? `${formatTokenCompact(maxOutputTokens)} tokens`
                    : "∞ Không giới hạn"}
                </span>
              </div>
              <input
                type="number"
                min="0"
                step="1000"
                value={maxOutputTokens}
                onChange={(e) => setMaxOutputTokens(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded-lg border border-border bg-input px-3 py-1.5 font-mono text-sm text-text-main focus:outline-none focus:border-primary mb-2"
                placeholder="0 = Không giới hạn"
              />
              <div className="flex flex-wrap gap-1">
                {OUTPUT_TOKEN_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setMaxOutputTokens(preset.value)}
                    className={`rounded-md px-2 py-0.5 font-mono text-[11px] border transition-colors ${
                      Number(maxOutputTokens) === preset.value
                        ? "border-violet-500 bg-violet-500/15 text-violet-500 font-semibold"
                        : "border-border text-text-muted hover:text-text-main"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {isEdit && (
            <div className="mt-3 pt-3 border-t border-border flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-text-muted font-mono">
                Đã dùng:{" "}
                <strong className="text-text-main">
                  {(initialKey?.usedInputTokens || 0).toLocaleString("en-US")}
                </strong>{" "}
                Input /{" "}
                <strong className="text-text-main">
                  {(initialKey?.usedOutputTokens || 0).toLocaleString("en-US")}
                </strong>{" "}
                Output
              </div>
              <label className="flex items-center gap-2 text-xs font-medium text-amber-500 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={resetUsage}
                  onChange={(e) => setResetUsage(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border accent-amber-500"
                />
                Reset bộ đếm token đã dùng về 0 khi lưu
              </label>
            </div>
          )}
        </div>

        {/* 4. Expiration Date or No Date */}
        <div className="rounded-xl border border-border p-4 bg-surface/40">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[18px]">
                  event_available
                </span>
                <p className="text-sm font-semibold text-text-main">
                  Thời hạn sử dụng (Ngày hết hạn / No Date)
                </p>
              </div>
              <p className="text-xs text-text-muted mt-0.5">
                Chọn No Date để không giới hạn ngày (vẫn dừng ngay khi dùng hết gói token)
              </p>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg border border-border p-1 bg-background/60">
              <button
                type="button"
                onClick={() => setNoDate(true)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  noDate
                    ? "bg-primary text-white"
                    : "text-text-muted hover:text-text-main"
                }`}
              >
                No Date (Không thời hạn)
              </button>
              <button
                type="button"
                onClick={() => {
                  setNoDate(false);
                  if (!expiresAtInput) applyExpiryPreset(30);
                }}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  !noDate
                    ? "bg-primary text-white"
                    : "text-text-muted hover:text-text-main"
                }`}
              >
                Giới hạn ngày
              </button>
            </div>
          </div>

          {!noDate && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="datetime-local"
                value={expiresAtInput}
                onChange={(e) => setExpiresAtInput(e.target.value)}
                className="rounded-lg border border-border bg-input px-3 py-1.5 font-mono text-xs text-text-main focus:outline-none focus:border-primary"
              />
              <div className="flex flex-wrap items-center gap-1">
                {EXPIRY_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => applyExpiryPreset(preset.days)}
                    className="rounded-md border border-border px-2 py-1 font-mono text-[11px] text-text-muted hover:text-primary hover:border-primary/40 transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {errorMsg && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500 flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]">error</span>
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Footer Buttons */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            onClick={handleSubmit}
            fullWidth
            disabled={submitting || !name.trim()}
            icon={isEdit ? "save" : "vpn_key"}
          >
            {submitting
              ? "Đang xử lý..."
              : isEdit
              ? "Lưu cấu hình Key"
              : "Generate Key"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth disabled={submitting}>
            Hủy
          </Button>
        </div>
      </div>
    </Modal>
  );
}

UserKeyProvisionModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
  initialKey: PropTypes.object,
};
