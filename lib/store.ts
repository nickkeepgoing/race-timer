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
const MAX_ACTIVE = 100;

// Vercel KV is only configured when these env vars are present (set
// automatically once a KV store is linked to the project in Vercel).
// Without them we fall back to an in-memory store so `next dev` still
// works locally. The in-memory store does NOT persist across server
// restarts and does NOT work across multiple serverless instances,
// so it is dev-only.
const hasKV = Boolean(process.env.KV_REST_API_URL);

let memActive: ActiveRun[] = [];
let memResults: ResultRun[] = [];

export async function getActives(): Promise<ActiveRun[]> {
  if (hasKV) return (await kv.get<ActiveRun[]>(ACTIVE_KEY)) ?? [];
  return memActive;
}

async function setActives(runs: ActiveRun[]): Promise<void> {
  if (hasKV) {
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
