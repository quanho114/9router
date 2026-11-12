import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import * as keyAccessUtils from "@/shared/utils/keyAccess.js";
import { KEY_ACCESS_UNRESTRICTED } from "@/shared/constants/keyAccess.js";

const { keyAccessFromColumns, keyAccessToColumns } = keyAccessUtils;

const _ensuredAdapters = new WeakSet();
const API_KEY_EXTRA_COLUMNS = [
  ["accessRestricted", "INTEGER DEFAULT 0"],
  ["accessAllow", "TEXT"],
  ["maxInputTokens", "INTEGER DEFAULT 0"],
  ["maxOutputTokens", "INTEGER DEFAULT 0"],
  ["usedInputTokens", "INTEGER DEFAULT 0"],
  ["usedOutputTokens", "INTEGER DEFAULT 0"],
  ["expiresAt", "TEXT"],
  ["dailyLimitUsd", "REAL DEFAULT 0"],
];

export function normalizeDailyLimitUsd(value) {
  const limit = Number(value);
  return Number.isFinite(limit) && limit > 0 ? limit : 0;
}

export function ensureApiKeysColumns(db) {
  if (!db || _ensuredAdapters.has(db)) return;
  try {
    const info = db.all(`PRAGMA table_info(apiKeys)`);
    if (!Array.isArray(info) || info.length === 0) return;
    const existing = new Set(info.map((c) => c.name));
    for (const [col, def] of API_KEY_EXTRA_COLUMNS) {
      if (!existing.has(col)) {
        db.exec(`ALTER TABLE apiKeys ADD COLUMN ${col} ${def}`);
      }
    }
    _ensuredAdapters.add(db);
  } catch (e) {
    console.warn(`[DB] ensureApiKeysColumns warning: ${e.message}`);
  }
}

function rowToKey(row) {
  if (!row) return null;
  const maxInputTokens = Number(row.maxInputTokens) > 0 ? Math.floor(Number(row.maxInputTokens)) : 0;
  const maxOutputTokens = Number(row.maxOutputTokens) > 0 ? Math.floor(Number(row.maxOutputTokens)) : 0;
  const usedInputTokens = Number(row.usedInputTokens) > 0 ? Math.floor(Number(row.usedInputTokens)) : 0;
  const usedOutputTokens = Number(row.usedOutputTokens) > 0 ? Math.floor(Number(row.usedOutputTokens)) : 0;
  const expiresAt = typeof row.expiresAt === "string" && row.expiresAt.trim() ? row.expiresAt.trim() : null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    access: keyAccessFromColumns(row.accessRestricted, row.accessAllow),
    maxInputTokens,
    maxOutputTokens,
    usedInputTokens,
    usedOutputTokens,
    expiresAt,
    dailyLimitUsd: normalizeDailyLimitUsd(row.dailyLimitUsd),
  };
}

export async function getApiKeys() {
  const db = await getAdapter();
  ensureApiKeysColumns(db);
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  ensureApiKeysColumns(db);
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

let _lastKeyMissPullAt = 0;
const KEY_MISS_PULL_COOLDOWN_MS = 5000;

async function getKeyRowWithLazySync(db, key) {
  let row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  if (row) return row;
  const now = Date.now();
  if (now - _lastKeyMissPullAt > KEY_MISS_PULL_COOLDOWN_MS) {
    _lastKeyMissPullAt = now;
    try {
      const { getSupabaseConfig, pullFromSupabase } = await import("../supabaseSync.js");
      if (getSupabaseConfig().enabled) {
        await pullFromSupabase(db);
        row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
      }
    } catch {
      // Ignore sync errors on lookup miss
    }
  }
  return row;
}

// Used by the /v1 handlers to read the presented key's access settings.
export async function getApiKeyByKey(key) {
  if (!key) return null;
  const db = await getAdapter();
  ensureApiKeysColumns(db);
  const row = await getKeyRowWithLazySync(db, key);
  return rowToKey(row);
}

export async function createApiKey(name, machineId, options = {}) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  ensureApiKeysColumns(db);
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const access = options.access || { restricted: false, allow: [] };
  const maxInputTokens = Number(options.maxInputTokens) > 0 ? Math.floor(Number(options.maxInputTokens)) : 0;
  const maxOutputTokens = Number(options.maxOutputTokens) > 0 ? Math.floor(Number(options.maxOutputTokens)) : 0;
  const expiresAt = typeof options.expiresAt === "string" && options.expiresAt.trim() ? options.expiresAt.trim() : null;
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
    access: { restricted: !!access.restricted, allow: Array.isArray(access.allow) ? access.allow : [] },
    maxInputTokens,
    maxOutputTokens,
    usedInputTokens: 0,
    usedOutputTokens: 0,
    expiresAt,
    dailyLimitUsd: normalizeDailyLimitUsd(options.dailyLimitUsd),
  };
  const cols = keyAccessToColumns(apiKey.access.restricted ? apiKey.access : KEY_ACCESS_UNRESTRICTED);
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, accessRestricted, accessAllow, maxInputTokens, maxOutputTokens, usedInputTokens, usedOutputTokens, expiresAt, dailyLimitUsd) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      apiKey.id,
      apiKey.key,
      apiKey.name,
      apiKey.machineId,
      1,
      apiKey.createdAt,
      cols.accessRestricted,
      cols.accessAllow,
      apiKey.maxInputTokens,
      apiKey.maxOutputTokens,
      0,
      0,
      apiKey.expiresAt,
      apiKey.dailyLimitUsd,
    ]
  );
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  ensureApiKeysColumns(db);
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToKey(row), ...data };
    const cols = keyAccessToColumns(merged.access);
    const maxInputTokens = Number(merged.maxInputTokens) > 0 ? Math.floor(Number(merged.maxInputTokens)) : 0;
    const maxOutputTokens = Number(merged.maxOutputTokens) > 0 ? Math.floor(Number(merged.maxOutputTokens)) : 0;
    const usedInputTokens = Number(merged.usedInputTokens) > 0 ? Math.floor(Number(merged.usedInputTokens)) : 0;
    const usedOutputTokens = Number(merged.usedOutputTokens) > 0 ? Math.floor(Number(merged.usedOutputTokens)) : 0;
    const expiresAt = typeof merged.expiresAt === "string" && merged.expiresAt.trim() ? merged.expiresAt.trim() : null;
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, accessRestricted = ?, accessAllow = ?, maxInputTokens = ?, maxOutputTokens = ?, usedInputTokens = ?, usedOutputTokens = ?, expiresAt = ?, dailyLimitUsd = ? WHERE id = ?`,
      [
        merged.key,
        merged.name,
        merged.machineId,
        merged.isActive ? 1 : 0,
        cols.accessRestricted,
        cols.accessAllow,
        maxInputTokens,
        maxOutputTokens,
        usedInputTokens,
        usedOutputTokens,
        expiresAt,
        normalizeDailyLimitUsd(merged.dailyLimitUsd),
        id,
      ]
    );
    result = rowToKey(db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]));
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  if (!key) return false;
  const db = await getAdapter();
  ensureApiKeysColumns(db);
  const row = await getKeyRowWithLazySync(db, key);
  if (!row) return false;
  const record = rowToKey(row);
  if (typeof keyAccessUtils.checkKeyStatus === "function") {
    return keyAccessUtils.checkKeyStatus(record).ok;
  }
  return !!record.isActive;
}
