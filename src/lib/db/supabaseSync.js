import { parseJson, stringifyJson } from "./helpers/jsonCol.js";

const DEFAULT_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "9router-state";
const DEFAULT_OBJECT_PATH = process.env.SUPABASE_STORAGE_OBJECT || "db-snapshot.json";
const DEFAULT_TABLE = process.env.SUPABASE_STATE_TABLE || "router_state";
const DEFAULT_ROW_ID = process.env.SUPABASE_STATE_ID || "default";
const SYNC_DEBOUNCE_MS = Number(process.env.SUPABASE_SYNC_DEBOUNCE_MS || 500);

// Tables whose mutations trigger a cloud push. High-volume ephemeral tables
// (usageHistory, requestDetails) are excluded from per-request push spam;
// usageDaily and all core config/auth/provider tables are synced.
const SYNCED_TABLES_RE =
  /\b(INSERT|UPDATE|DELETE|REPLACE)\b[\s\S]*?\b(settings|providerConnections|providerNodes|proxyPools|apiKeys|combos|kv|usageDaily|_meta)\b/i;

if (!global._supabaseSyncState) {
  global._supabaseSyncState = {
    initialized: false,
    isApplyingRemote: false,
    syncTimer: null,
    inFlight: null,
    bucketReady: false,
    tableAvailable: null, // null = unknown, true = exists, false = missing
    lastPullAt: null,
    lastPushAt: null,
    lastError: null,
    mode: null,
  };
}
const syncState = global._supabaseSyncState;

export function getSupabaseConfig() {
  const url = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ""
  )
    .trim()
    .replace(/\/+$/, "");

  const key = (
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ""
  ).trim();

  return {
    enabled: Boolean(url && key && !key.includes("paste-your-")),
    url,
    key,
    bucket: DEFAULT_BUCKET,
    objectPath: DEFAULT_OBJECT_PATH,
    table: DEFAULT_TABLE,
    rowId: DEFAULT_ROW_ID,
  };
}

function buildHeaders(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...extra,
  };
}

/**
 * Export all persistent state from the SQLite adapter into a JSON-serializable snapshot.
 */
export function exportSnapshotFromAdapter(adapter) {
  const settingsRow = adapter.get(`SELECT data FROM settings WHERE id = 1`);
  const settings = settingsRow ? parseJson(settingsRow.data, {}) : {};

  const providerConnections = adapter.all(`SELECT * FROM providerConnections`);
  const providerNodes = adapter.all(`SELECT * FROM providerNodes`);
  const proxyPools = adapter.all(`SELECT * FROM proxyPools`);
  const apiKeys = adapter.all(`SELECT * FROM apiKeys`);
  const combos = adapter.all(`SELECT * FROM combos`);
  const kv = adapter.all(`SELECT scope, key, value FROM kv`);
  const usageDaily = adapter.all(`SELECT dateKey, data FROM usageDaily`);
  const meta = adapter.all(`SELECT key, value FROM _meta`);

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    settings,
    tables: {
      providerConnections,
      providerNodes,
      proxyPools,
      apiKeys,
      combos,
      kv,
      usageDaily,
      meta,
    },
  };
}

function hasAnyLocalData(adapter) {
  try {
    const counts = [
      adapter.get(`SELECT COUNT(*) as c FROM settings`)?.c ?? 0,
      adapter.get(`SELECT COUNT(*) as c FROM providerConnections`)?.c ?? 0,
      adapter.get(`SELECT COUNT(*) as c FROM providerNodes`)?.c ?? 0,
      adapter.get(`SELECT COUNT(*) as c FROM apiKeys`)?.c ?? 0,
      adapter.get(`SELECT COUNT(*) as c FROM combos`)?.c ?? 0,
      adapter.get(`SELECT COUNT(*) as c FROM kv`)?.c ?? 0,
    ];
    return counts.some((c) => c > 0);
  } catch {
    return false;
  }
}

/**
 * Apply a remote snapshot into the local SQLite adapter inside a transaction.
 */
export function applySnapshotToAdapter(adapter, snapshot) {
  if (!snapshot || typeof snapshot !== "object") return false;

  syncState.isApplyingRemote = true;
  try {
    adapter.transaction(() => {
      if (snapshot.settings && typeof snapshot.settings === "object") {
        adapter.run(
          `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
          [stringifyJson(snapshot.settings)]
        );
      }

      const t = snapshot.tables || {};

      if (Array.isArray(t.providerConnections)) {
        adapter.run(`DELETE FROM providerConnections`);
        for (const r of t.providerConnections) {
          adapter.run(
            `INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              r.id,
              r.provider,
              r.authType || "oauth",
              r.name ?? null,
              r.email ?? null,
              r.priority ?? null,
              r.isActive ?? 1,
              typeof r.data === "string" ? r.data : stringifyJson(r.data || {}),
              r.createdAt || new Date().toISOString(),
              r.updatedAt || new Date().toISOString(),
            ]
          );
        }
      }

      if (Array.isArray(t.providerNodes)) {
        adapter.run(`DELETE FROM providerNodes`);
        for (const r of t.providerNodes) {
          adapter.run(
            `INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
            [
              r.id,
              r.type ?? null,
              r.name ?? null,
              typeof r.data === "string" ? r.data : stringifyJson(r.data || {}),
              r.createdAt || new Date().toISOString(),
              r.updatedAt || new Date().toISOString(),
            ]
          );
        }
      }

      if (Array.isArray(t.proxyPools)) {
        adapter.run(`DELETE FROM proxyPools`);
        for (const r of t.proxyPools) {
          adapter.run(
            `INSERT OR REPLACE INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
            [
              r.id,
              r.isActive ?? 1,
              r.testStatus || "unknown",
              typeof r.data === "string" ? r.data : stringifyJson(r.data || {}),
              r.createdAt || new Date().toISOString(),
              r.updatedAt || new Date().toISOString(),
            ]
          );
        }
      }

      if (Array.isArray(t.apiKeys)) {
        adapter.run(`DELETE FROM apiKeys`);
        for (const r of t.apiKeys) {
          adapter.run(
            `INSERT OR REPLACE INTO apiKeys(id, key, name, machineId, isActive, createdAt, accessRestricted, accessAllow) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              r.id,
              r.key,
              r.name ?? null,
              r.machineId ?? null,
              r.isActive ?? 1,
              r.createdAt || new Date().toISOString(),
              r.accessRestricted ?? 0,
              r.accessAllow ?? null,
            ]
          );
        }
      }

      if (Array.isArray(t.combos)) {
        adapter.run(`DELETE FROM combos`);
        for (const r of t.combos) {
          adapter.run(
            `INSERT OR REPLACE INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
            [
              r.id,
              r.name,
              r.kind ?? null,
              typeof r.models === "string" ? r.models : stringifyJson(r.models || []),
              r.createdAt || new Date().toISOString(),
              r.updatedAt || new Date().toISOString(),
            ]
          );
        }
      }

      if (Array.isArray(t.kv)) {
        adapter.run(`DELETE FROM kv`);
        for (const r of t.kv) {
          adapter.run(
            `INSERT OR REPLACE INTO kv(scope, key, value) VALUES(?, ?, ?)`,
            [
              r.scope,
              r.key,
              typeof r.value === "string" ? r.value : stringifyJson(r.value),
            ]
          );
        }
      }

      if (Array.isArray(t.usageDaily)) {
        for (const r of t.usageDaily) {
          adapter.run(
            `INSERT OR REPLACE INTO usageDaily(dateKey, data) VALUES(?, ?)`,
            [
              r.dateKey,
              typeof r.data === "string" ? r.data : stringifyJson(r.data || {}),
            ]
          );
        }
      }

      if (Array.isArray(t.meta)) {
        for (const r of t.meta) {
          if (r.key === "schemaVersion" || r.key === "backupSchemaVersion") continue;
          adapter.run(
            `INSERT OR REPLACE INTO _meta(key, value) VALUES(?, ?)`,
            [String(r.key), String(r.value)]
          );
        }
      }
    });
    return true;
  } finally {
    syncState.isApplyingRemote = false;
  }
}

// ─── PostgREST Table Backend (`public.router_state`) ─────────────────────────

async function tryPullFromTable(cfg) {
  if (syncState.tableAvailable === false) return null;
  const endpoint = `${cfg.url}/rest/v1/${encodeURIComponent(cfg.table)}?id=eq.${encodeURIComponent(cfg.rowId)}&select=data,updated_at`;
  const res = await fetch(endpoint, {
    method: "GET",
    headers: buildHeaders(cfg.key, { Accept: "application/json" }),
  });

  if (res.status === 404 || res.status === 400) {
    // 42P01 / PGRST205 when table does not exist yet
    syncState.tableAvailable = false;
    return null;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (body.includes("PGRST205") || body.includes("42P01") || body.includes("relation") || body.includes("schema cache")) {
      syncState.tableAvailable = false;
      return null;
    }
    throw new Error(`Supabase table GET failed (${res.status}): ${body.slice(0, 200)}`);
  }

  syncState.tableAvailable = true;
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0]?.data || null;
}

async function tryPushToTable(cfg, snapshot) {
  if (syncState.tableAvailable === false) return false;
  const endpoint = `${cfg.url}/rest/v1/${encodeURIComponent(cfg.table)}?on_conflict=id`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: buildHeaders(cfg.key, {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify({
      id: cfg.rowId,
      data: snapshot,
      updated_at: snapshot.updatedAt || new Date().toISOString(),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 404 || body.includes("PGRST205") || body.includes("42P01") || body.includes("schema cache")) {
      syncState.tableAvailable = false;
      return false;
    }
    throw new Error(`Supabase table UPSERT failed (${res.status}): ${body.slice(0, 200)}`);
  }

  syncState.tableAvailable = true;
  return true;
}

// ─── Supabase Storage Backend (`9router-state/db-snapshot.json`) ─────────────

async function ensureStorageBucket(cfg) {
  if (syncState.bucketReady) return true;
  const checkUrl = `${cfg.url}/storage/v1/bucket/${encodeURIComponent(cfg.bucket)}`;
  const checkRes = await fetch(checkUrl, {
    method: "GET",
    headers: buildHeaders(cfg.key),
  });

  if (checkRes.ok) {
    syncState.bucketReady = true;
    return true;
  }

  const createRes = await fetch(`${cfg.url}/storage/v1/bucket`, {
    method: "POST",
    headers: buildHeaders(cfg.key, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      id: cfg.bucket,
      name: cfg.bucket,
      public: false,
    }),
  });

  if (createRes.ok || createRes.status === 409) {
    syncState.bucketReady = true;
    return true;
  }

  const errText = await createRes.text().catch(() => "");
  if (errText.toLowerCase().includes("already exists") || errText.toLowerCase().includes("duplicate")) {
    syncState.bucketReady = true;
    return true;
  }
  throw new Error(`Supabase Storage bucket init failed (${createRes.status}): ${errText.slice(0, 200)}`);
}

async function pullFromStorage(cfg) {
  await ensureStorageBucket(cfg);
  const objUrl = `${cfg.url}/storage/v1/object/${encodeURIComponent(cfg.bucket)}/${cfg.objectPath}`;
  const res = await fetch(objUrl, {
    method: "GET",
    headers: buildHeaders(cfg.key),
  });

  if (res.status === 404 || res.status === 400) {
    return null;
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    if (errText.includes("not_found") || errText.includes("Object not found") || errText.includes("NoSuchKey")) {
      return null;
    }
    throw new Error(`Supabase Storage GET failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

async function pushToStorage(cfg, snapshot) {
  await ensureStorageBucket(cfg);
  const objUrl = `${cfg.url}/storage/v1/object/${encodeURIComponent(cfg.bucket)}/${cfg.objectPath}`;
  const res = await fetch(objUrl, {
    method: "POST",
    headers: buildHeaders(cfg.key, {
      "Content-Type": "application/json",
      "x-upsert": "true",
    }),
    body: JSON.stringify(snapshot),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Supabase Storage PUT failed (${res.status}): ${errText.slice(0, 200)}`);
  }
  return true;
}

// ─── Public Pull / Push Orchestration ────────────────────────────────────────

export async function pullFromSupabase(adapter) {
  const cfg = getSupabaseConfig();
  if (!cfg.enabled) return { synced: false, reason: "disabled" };

  try {
    let snapshot = await tryPullFromTable(cfg);
    let source = "table";
    if (!snapshot) {
      snapshot = await pullFromStorage(cfg);
      source = "storage";
    }

    if (!snapshot) {
      syncState.mode = syncState.tableAvailable ? "table+storage" : "storage";
      return { synced: false, reason: "empty_remote", mode: syncState.mode };
    }

    applySnapshotToAdapter(adapter, snapshot);
    syncState.lastPullAt = new Date().toISOString();
    syncState.lastError = null;
    syncState.mode = source;
    return { synced: true, source, updatedAt: snapshot.updatedAt };
  } catch (err) {
    syncState.lastError = err.message;
    console.warn(`[SupabaseSync] Pull failed: ${err.message}`);
    return { synced: false, error: err.message };
  }
}

export async function pushToSupabase(adapter) {
  const cfg = getSupabaseConfig();
  if (!cfg.enabled) return { synced: false, reason: "disabled" };
  if (syncState.isApplyingRemote) return { synced: false, reason: "applying_remote" };

  if (syncState.inFlight) {
    return syncState.inFlight;
  }

  syncState.inFlight = (async () => {
    try {
      const snapshot = exportSnapshotFromAdapter(adapter);
      const tableOk = await tryPushToTable(cfg, snapshot).catch((e) => {
        console.warn(`[SupabaseSync] Table push skipped: ${e.message}`);
        return false;
      });
      const storageOk = await pushToStorage(cfg, snapshot);
      syncState.lastPushAt = new Date().toISOString();
      syncState.lastError = null;
      syncState.mode = tableOk && storageOk ? "table+storage" : tableOk ? "table" : "storage";
      return { synced: true, mode: syncState.mode, updatedAt: snapshot.updatedAt };
    } catch (err) {
      syncState.lastError = err.message;
      console.warn(`[SupabaseSync] Push failed: ${err.message}`);
      return { synced: false, error: err.message };
    } finally {
      syncState.inFlight = null;
    }
  })();

  return syncState.inFlight;
}

export function scheduleSupabasePush(adapter) {
  const cfg = getSupabaseConfig();
  if (!cfg.enabled || syncState.isApplyingRemote) return;

  if (syncState.syncTimer) clearTimeout(syncState.syncTimer);
  syncState.syncTimer = setTimeout(() => {
    syncState.syncTimer = null;
    pushToSupabase(adapter).catch(() => {});
  }, SYNC_DEBOUNCE_MS);
  if (typeof syncState.syncTimer.unref === "function") {
    syncState.syncTimer.unref();
  }
}

/**
 * Wrap a SQLite adapter so any mutation on core tables triggers a debounced push to Supabase.
 */
export function withSupabaseSync(adapter) {
  return {
    ...adapter,
    run(sql, params = []) {
      const result = adapter.run(sql, params);
      if (!syncState.isApplyingRemote && SYNCED_TABLES_RE.test(sql)) {
        scheduleSupabasePush(adapter);
      }
      return result;
    },
    exec(sql) {
      const result = adapter.exec(sql);
      if (!syncState.isApplyingRemote && SYNCED_TABLES_RE.test(sql)) {
        scheduleSupabasePush(adapter);
      }
      return result;
    },
    transaction(fn) {
      const result = adapter.transaction(fn);
      if (!syncState.isApplyingRemote) {
        scheduleSupabasePush(adapter);
      }
      return result;
    },
  };
}

/**
 * Initialize Supabase sync on startup:
 * - Pull remote state if available
 * - Or push local state if remote is empty
 */
export async function initSupabaseSync(adapter) {
  const cfg = getSupabaseConfig();
  if (!cfg.enabled) return;
  if (syncState.initialized) return;
  syncState.initialized = true;

  const pullResult = await pullFromSupabase(adapter);
  if (pullResult.synced) {
    console.log(`[SupabaseSync] Restored state from Supabase (${pullResult.source}) @ ${pullResult.updatedAt}`);
  } else if (pullResult.reason === "empty_remote") {
    const pushResult = await pushToSupabase(adapter);
    if (pushResult.synced) {
      console.log(`[SupabaseSync] Initialized Supabase remote state (${pushResult.mode})`);
    }
  } else if (!pullResult.error) {
    console.log(`[SupabaseSync] Connected to ${cfg.url} (${pullResult.mode || "ready"})`);
  }

  const flushOnExit = () => {
    if (syncState.syncTimer) {
      clearTimeout(syncState.syncTimer);
      syncState.syncTimer = null;
      pushToSupabase(adapter).catch(() => {});
    }
  };
  process.once("beforeExit", flushOnExit);
}

export function getSupabaseSyncStatus() {
  const cfg = getSupabaseConfig();
  return {
    enabled: cfg.enabled,
    url: cfg.url || null,
    bucket: cfg.bucket,
    table: cfg.table,
    mode: syncState.mode,
    tableAvailable: syncState.tableAvailable,
    lastPullAt: syncState.lastPullAt,
    lastPushAt: syncState.lastPushAt,
    lastError: syncState.lastError,
  };
}
