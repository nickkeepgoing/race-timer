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

const ACTIVE_KEY = "race-timer:active";
const RESULTS_KEY = "race-timer:results";
const MAX_RESULTS = 500;
const MAX_ACTIVE = 100;

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

let memActive: ActiveRun[] = [];
let memResults: ResultRun[] = [];

export async function getActives(): Promise<ActiveRun[]> {
  if (kv) return (await kv.get<ActiveRun[]>(ACTIVE_KEY)) ?? [];
  return memActive;
}

async function setActives(runs: ActiveRun[]): Promise<void> {
  if (kv) {
    if (runs.length) await kv.set(ACTIVE_KEY, runs);
    else await kv.del(ACTIVE_KEY);
    return;
  }
  memActive = runs;
}

export async function addActive(run: ActiveRun): Promise<ActiveRun[]> {
  const current = await getActives();
  // Cap the number of concurrent runs to avoid runaway state.
  const updated = [...current, run].slice(-MAX_ACTIVE);
  await setActives(updated);
  return updated;
}

export async function removeActive(id: string): Promise<ActiveRun | null> {
  const current = await getActives();
  const found = current.find((r) => r.id === id) ?? null;
  if (found) await setActives(current.filter((r) => r.id !== id));
  return found;
}

export async function clearActives(): Promise<void> {
  await setActives([]);
}

export async function getResults(): Promise<ResultRun[]> {
  if (kv) return (await kv.get<ResultRun[]>(RESULTS_KEY)) ?? [];
  return memResults;
}

export async function addResult(result: ResultRun): Promise<ResultRun[]> {
  const current = await getResults();
  const updated = [result, ...current].slice(0, MAX_RESULTS);
  if (kv) await kv.set(RESULTS_KEY, updated);
  else memResults = updated;
  return updated;
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
