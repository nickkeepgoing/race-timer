import { createClient, type VercelKV } from "@vercel/kv";

export interface ActiveRun {
  id: string;
  name: string;
  startTime: number; // ms, server clock
}

export interface ResultRun {
  id: string;
  name: string;
  startTime: number;
  stopTime: number;
  durationMs: number;
}

// v2 keys: the original code stored these as plain JSON strings via kv.set.
// We now use a Redis hash (active) and list (results) for atomic writes, and
// hash/list ops on a string key throw WRONGTYPE — so we use fresh key names.
// (Any old data under the v1 keys was test data and is simply abandoned.)
const ACTIVE_KEY = "race-timer:active:v2";
const RESULTS_KEY = "race-timer:results:v2";
const MAX_RESULTS = 500;

// The @vercel/kv client talks to Upstash over its REST API, so it needs a
// REST url + token. Different Vercel integrations expose these under
// different env var names, so we look through the common ones instead of
// relying on the single default (KV_REST_API_URL). If none are present we
// fall back to an in-memory store so `next dev` works locally — but that
// store is per-instance and dev-only: on Vercel it makes the start and
// stop devices unable to see each other. `storeBackend()` reports which
// mode is active so the app can warn when it is not really using Redis.
const REST_URL =
  process.env.KV_REST_API_URL ??
  process.env.UPSTASH_REDIS_REST_URL ??
  process.env.REDIS_REST_API_URL ??
  null;
const REST_TOKEN =
  process.env.KV_REST_API_TOKEN ??
  process.env.UPSTASH_REDIS_REST_TOKEN ??
  process.env.REDIS_REST_API_TOKEN ??
  null;

const kv: VercelKV | null =
  REST_URL && REST_TOKEN
    ? createClient({ url: REST_URL, token: REST_TOKEN })
    : null;

// In-memory dev fallback. Active runs are keyed by id (mirrors the Redis
// hash); results are newest-first (mirrors the Redis list).
const memActive = new Map<string, ActiveRun>();
let memResults: ResultRun[] = [];

// ── Active runs ──────────────────────────────────────────────────────────
// Stored as a Redis HASH (field = run id, value = run). Add and remove act
// on a single field, so concurrent starts/stops/cancels can't clobber each
// other's writes — the lost-update bug that made started runners sometimes
// never appear on the finish device.

export async function getActives(): Promise<ActiveRun[]> {
  if (kv) {
    const all = await kv.hgetall<Record<string, ActiveRun>>(ACTIVE_KEY);
    return all ? Object.values(all) : [];
  }
  return [...memActive.values()];
}

// Like getActives, but for the display poll — where "empty" must be trustworthy
// because the finish device uses it to decide whether to clear its stop
// buttons. hgetall can transiently return null/empty (replica lag, a hiccupy
// read) even while runners are still active; forwarding that as [] is what made
// every stop button vanish mid-race. So on an empty read we do a second,
// independent check: only report [] when the key genuinely does not exist.
// Otherwise return null → "unknown, keep the current list". A throw here (real
// outage / rate limit) propagates and is handled by the caller the same way.
export async function getActivesForPoll(): Promise<ActiveRun[] | null> {
  if (!kv) return [...memActive.values()];
  const all = await kv.hgetall<Record<string, ActiveRun>>(ACTIVE_KEY);
  if (all && Object.keys(all).length > 0) return Object.values(all);
  // Empty/null read — could be "truly nobody" or a transient miss. The hash is
  // deleted only when its last field is removed (hdel) or on cancel-all (del),
  // so a missing key is the one reliable signal that nobody is running.
  const exists = await kv.exists(ACTIVE_KEY);
  return exists ? null : [];
}

export async function addActive(run: ActiveRun): Promise<ActiveRun[]> {
  return addActives([run]);
}

export async function addActives(runs: ActiveRun[]): Promise<ActiveRun[]> {
  if (runs.length === 0) return getActives();
  if (kv) {
    const fields: Record<string, ActiveRun> = {};
    for (const r of runs) fields[r.id] = r;
    await kv.hset(ACTIVE_KEY, fields);
  } else {
    for (const r of runs) memActive.set(r.id, r);
  }
  return getActives();
}

export async function removeActive(id: string): Promise<ActiveRun | null> {
  if (kv) {
    const run = await kv.hget<ActiveRun>(ACTIVE_KEY, id);
    if (!run) return null;
    // hdel is atomic: only the caller that actually deletes the field (→ 1)
    // "wins", so two simultaneous stops of the same runner can't both
    // record a result.
    const deleted = await kv.hdel(ACTIVE_KEY, id);
    return deleted ? run : null;
  }
  const run = memActive.get(id);
  if (!run) return null;
  memActive.delete(id);
  return run;
}

export async function clearActives(): Promise<void> {
  if (kv) await kv.del(ACTIVE_KEY);
  else memActive.clear();
}

// ── Results ──────────────────────────────────────────────────────────────
// Stored as a Redis LIST via LPUSH (atomic append), so simultaneous
// finishers can't overwrite each other. Newest is at the head.

export async function getResults(): Promise<ResultRun[]> {
  if (kv) return (await kv.lrange<ResultRun>(RESULTS_KEY, 0, -1)) ?? [];
  return memResults;
}

export async function addResult(result: ResultRun): Promise<void> {
  if (kv) {
    await kv.lpush(RESULTS_KEY, result);
    await kv.ltrim(RESULTS_KEY, 0, MAX_RESULTS - 1);
    return;
  }
  memResults = [result, ...memResults].slice(0, MAX_RESULTS);
}

export async function clearResults(): Promise<void> {
  if (kv) await kv.del(RESULTS_KEY);
  else memResults = [];
}

export function isUsingKV(): boolean {
  return kv !== null;
}

// Diagnostic: reports whether shared Redis storage is active and which
// KV-related env var names Vercel actually exposed (names only, no secret
// values). Handy for confirming a deploy is really talking to Redis.
export function storeBackend(): {
  usingKV: boolean;
  detectedEnvVars: string[];
} {
  const known = [
    "KV_REST_API_URL",
    "KV_REST_API_TOKEN",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "REDIS_REST_API_URL",
    "REDIS_REST_API_TOKEN",
    "REDIS_URL",
    "KV_URL",
  ];
  return {
    usingKV: kv !== null,
    detectedEnvVars: known.filter((k) => Boolean(process.env[k])),
  };
}
