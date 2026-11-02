/**
 * Short-lived, per-instance cache for router configuration that rarely changes.
 *
 * What may be cached (and only this): eligibility rules, quota cell definitions and the
 * marketplace entry config, keyed by project or client id.
 * What must NEVER be cached: supplier / project / assignment status and the quota
 * reservation decision. Those are read fresh on every click so a paused supplier or project
 * stops taking traffic immediately.
 *
 * Allowed staleness: a rule or quota-cell edit can take up to the TTL (default 60 seconds,
 * hard maximum 60 seconds) to reach a given Worker instance, and instances do not share the
 * cache. Set `ROUTER_CONFIG_CACHE_SECONDS=0` to disable caching entirely.
 */
export type ConfigCacheEnv = { ROUTER_CONFIG_CACHE_SECONDS?: string };

export const CONFIG_CACHE_DEFAULT_SECONDS = 60;
export const CONFIG_CACHE_MAX_SECONDS = 60;
export const CONFIG_CACHE_MAX_ENTRIES = 500;

type Entry = { value: unknown; expires: number };
const store = new Map<string, Entry>();

/** TTL in milliseconds. Unset or invalid falls back to the default; values are clamped to 0..60 seconds. */
export function configCacheTtlMs(env: ConfigCacheEnv | undefined): number {
  const raw = env?.ROUTER_CONFIG_CACHE_SECONDS;
  if (raw === undefined || raw === null || String(raw).trim() === "") return CONFIG_CACHE_DEFAULT_SECONDS * 1000;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return CONFIG_CACHE_DEFAULT_SECONDS * 1000;
  return Math.min(seconds, CONFIG_CACHE_MAX_SECONDS) * 1000;
}

const fullKey = (namespace: string, key: string) => `${namespace}\u0000${key}`;

export function readConfigCache<T>(namespace: string, key: string): { hit: true; value: T } | { hit: false } {
  const entry = store.get(fullKey(namespace, key));
  if (!entry) return { hit: false };
  if (entry.expires <= Date.now()) { store.delete(fullKey(namespace, key)); return { hit: false }; }
  return { hit: true, value: entry.value as T };
}

/** Stores a value. A ttl of 0 stores nothing. The cache is bounded: the oldest entry is evicted when full. */
export function writeConfigCache(namespace: string, key: string, value: unknown, ttlMs: number) {
  if (ttlMs <= 0) return;
  const id = fullKey(namespace, key);
  store.delete(id);
  while (store.size >= CONFIG_CACHE_MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
  store.set(id, { value, expires: Date.now() + ttlMs });
}

/** Returns the cached value or loads it. Loader failures are never cached. */
export async function cachedConfig<T>(env: ConfigCacheEnv | undefined, namespace: string, key: string, load: () => Promise<T>): Promise<T> {
  const ttl = configCacheTtlMs(env);
  if (ttl <= 0) return load();
  const cached = readConfigCache<T>(namespace, key);
  if (cached.hit) return cached.value;
  const value = await load();
  writeConfigCache(namespace, key, value, ttl);
  return value;
}

/** Drops one key, one namespace, or everything. Call after an edit if the same instance serves the change. */
export function invalidateConfigCache(namespace?: string, key?: string) {
  if (!namespace) { store.clear(); return; }
  if (key !== undefined) { store.delete(fullKey(namespace, key)); return; }
  for (const id of [...store.keys()]) if (id.startsWith(`${namespace}\u0000`)) store.delete(id);
}

export function configCacheSize() { return store.size; }
