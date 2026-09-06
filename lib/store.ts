import { kv } from "@vercel/kv";

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

// Vercel KV is only configured when these env vars are present (set
// automatically once a KV store is linked to the project in Vercel).
// Without them we fall back to an in-memory store so `next dev` still
// works locally. The in-memory store does NOT persist across server
// restarts and does NOT work across multiple serverless instances,
// so it is dev-only.
const hasKV = Boolean(process.env.KV_REST_API_URL);

let memActive: ActiveRun | null = null;
let memResults: ResultRun[] = [];

export async function getActive(): Promise<ActiveRun | null> {
  if (hasKV) return (await kv.get<ActiveRun>(ACTIVE_KEY)) ?? null;
  return memActive;
}

export async function setActive(run: ActiveRun | null): Promise<void> {
  if (hasKV) {
    if (run) await kv.set(ACTIVE_KEY, run);
    else await kv.del(ACTIVE_KEY);
    return;
  }
  memActive = run;
}

export async function getResults(): Promise<ResultRun[]> {
  if (hasKV) return (await kv.get<ResultRun[]>(RESULTS_KEY)) ?? [];
  return memResults;
}

export async function addResult(result: ResultRun): Promise<ResultRun[]> {
  const current = await getResults();
  const updated = [result, ...current].slice(0, MAX_RESULTS);
  if (hasKV) await kv.set(RESULTS_KEY, updated);
  else memResults = updated;
  return updated;
}

export async function clearResults(): Promise<void> {
  if (hasKV) await kv.del(RESULTS_KEY);
  else memResults = [];
}

export function isUsingKV(): boolean {
  return hasKV;
}
