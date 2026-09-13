"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useServerClock } from "@/lib/clock";

interface ActiveRun {
  id: string;
  name: string;
  startTime: number;
}

interface ResultRun {
  id: string;
  name: string;
  startTime: number;
  durationMs: number;
  marginMs?: number;
}

// A stop the server has not accepted yet. Holding the captured tap moment here
// is the whole point: every retry must re-send *that* instant, never a fresh
// clock reading — re-timing a finish that already happened is the bug this
// guards against.
interface PendingStop {
  id: string;
  name: string;
  startTime: number;
  stopTime: number; // server-clock instant of the tap
  accuracyMs: number | null; // sync accuracy at the moment of the tap
}

// Automatic retry backoff, in ms. Three attempts after the first try.
const RETRY_DELAYS = [500, 1500, 3000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fmt(ms: number, digits = 1): string {
  return (Math.max(0, ms) / 1000).toFixed(digits);
}

export default function StopPage() {
  const [active, setActive] = useState<ActiveRun[]>([]);
  const [now, setNow] = useState(Date.now());
  // Every runner we've finished this session, kept forever so their row never
  // vanishes — a vanishing row shifts every runner below it up into the spot
  // you were about to tap. Keyed by id.
  const [finished, setFinished] = useState<ResultRun[]>([]);
  const [lastId, setLastId] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  // Kept after every automatic attempt failed, so the error UI can offer a
  // manual retry that reuses the original timestamp.
  const [pendingStop, setPendingStop] = useState<PendingStop | null>(null);
  const [noSharedStore, setNoSharedStore] = useState(false);
  const finishedRef = useRef<ResultRun[]>([]);
  finishedRef.current = finished;
  const { serverNow, accuracyMs } = useServerClock();

  useEffect(() => {
    // Plain polling, deliberately — not Server-Sent Events. On Vercel the
    // streamed response can sit buffered until the function closes (~9s), so a
    // "push within 300ms" design actually arrived 9-15s late. A finish-line tap
    // tolerates ~1s of latency fine, and polling has no buffering surprises.
    const POLL_MS = 1000;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        if (Array.isArray(data.active)) {
          // A runner we've finished must never reappear as "running", even if a
          // poll that was in flight when we tapped still lists them.
          const done = new Set(finishedRef.current.map((f) => f.id));
          setActive(data.active.filter((r: ActiveRun) => !done.has(r.id)));
        }
        // data.active === null → transient/uncertain read; keep current list.
        if (data.storage) setNoSharedStore(data.storage.usingKV === false);
      } catch {
        // network hiccup — keep current list, retry next tick
      } finally {
        if (!cancelled) timer = setTimeout(poll, POLL_MS);
      }
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), 100);
    return () => clearInterval(id);
  }, [serverNow]);

  const upsertFinished = (r: ResultRun) =>
    setFinished((prev) => {
      const i = prev.findIndex((f) => f.id === r.id);
      if (i === -1) return [...prev, r];
      const next = prev.slice();
      next[i] = r;
      return next;
    });

  // Sends one already-captured stop, retrying a flaky network on its own. The
  // runner's row flips to a finished result immediately (in place, so nothing
  // below it moves) using the locally-known time, then reconciles with the
  // server's authoritative result.
  const submitStop = async (pending: PendingStop) => {
    const { id, name, startTime, stopTime, accuracyMs: tapAccuracyMs } = pending;
    setStopping(id);
    setError(null);
    setPendingStop(null);
    // Optimistic finish, in the runner's own fixed slot. Same formula the
    // server uses (stopTime - startTime), so the shown time won't jump.
    upsertFinished({ id, name, startTime, durationMs: Math.max(0, stopTime - startTime) });
    setLastId(id);

    const finish = () => {
      setRetrying(false);
      setStopping((prev) => (prev === id ? null : prev));
    };

    let lastError = "หยุดไม่สำเร็จ ลองใหม่อีกครั้ง";

    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      if (attempt > 0) {
        setRetrying(true);
        await sleep(RETRY_DELAYS[attempt - 1]);
      }
      try {
        const res = await fetch("/api/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Same stopTime and accuracyMs on every attempt — the clock is
          // deliberately not read again here.
          body: JSON.stringify({ id, stopTime, accuracyMs: tapAccuracyMs }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          if (data.result) upsertFinished(data.result); // authoritative time/margin
          finish();
          return;
        }
        if (res.status === 409) {
          // Already stopped/cancelled elsewhere — our optimistic finish stands.
          finish();
          return;
        }
        lastError = data.error ?? lastError;
      } catch {
        lastError = "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้";
      }
    }

    // Out of automatic attempts. Pull the row back to "running" (its slot is
    // unchanged) and keep the captured timestamp for the manual retry.
    setFinished((prev) => prev.filter((f) => f.id !== id));
    if (lastId === id) setLastId(null);
    setError(`${lastError} — เวลาที่จับไว้ยังอยู่`);
    setPendingStop(pending);
    finish();
  };

  const handleStop = (r: ActiveRun) => {
    // Capture the exact tap moment first, before any async work, so the finish
    // time reflects when the finger hit the button — not when the request
    // reached the server.
    const stopTime = serverNow();
    return submitStop({ id: r.id, name: r.name, startTime: r.startTime, stopTime, accuracyMs });
  };

  // One stable, fixed-order slot per runner: sorted by startTime, which never
  // changes, and no row is ever removed. Finishing a runner recolours their own
  // row in place — the running rows below stay exactly where your thumb expects.
  const doneIds = new Set(finished.map((f) => f.id));
  const rows = [
    ...active.filter((a) => !doneIds.has(a.id)).map((a) => ({ ...a, done: false as const })),
    ...finished.map((f) => ({ ...f, done: true as const })),
  ].sort((a, b) => a.startTime - b.startTime);

  const runningCount = rows.filter((r) => !r.done).length;

  // Same name can legitimately belong to two different runners (no bib
  // numbers here) — append #1/#2 in start order only when it's ambiguous, so
  // whoever's tapping has something to tell them apart by.
  const rowNameCounts = new Map<string, number>();
  for (const r of rows) rowNameCounts.set(r.name, (rowNameCounts.get(r.name) ?? 0) + 1);
  const rowNameSeen = new Map<string, number>();
  const displayName = (r: { name: string }) => {
    if ((rowNameCounts.get(r.name) ?? 0) <= 1) return r.name;
    const n = (rowNameSeen.get(r.name) ?? 0) + 1;
    rowNameSeen.set(r.name, n);
    return `${r.name} #${n}`;
  };

  const lastResult = finished.find((f) => f.id === lastId) ?? null;

  return (
    <main className="h-screen flex flex-col items-center px-5 pt-8 pb-4 gap-5">
      <header className="w-full max-w-md flex items-center justify-between shrink-0">
        <Link
          href="/"
          className="tap-target text-chalk text-sm hover:text-lane transition-colors"
        >
          ← กลับ
        </Link>
        <div className="flex flex-col items-end">
          <span className="flex items-center gap-2 uppercase tracking-[0.3em] text-xs text-finish">
            <span className="h-2 w-2 rounded-full bg-finish animate-pulse" />
            เส้นชัย
          </span>
          {accuracyMs !== null && (
            <span className="text-[10px] text-chalk/50 tabular mt-0.5">
              ซิงก์เวลา ±{accuracyMs}ms
            </span>
          )}
        </div>
      </header>

      {noSharedStore && (
        <div className="w-full max-w-md shrink-0 rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-amber text-sm">
          ⚠️ ยังไม่ได้เชื่อมที่เก็บข้อมูลกลาง (Redis) — เครื่องนี้จะไม่เห็นคนที่จุดเริ่ม
          กดออกตัว และกดหยุดไม่ได้ ให้เชื่อม Redis บน Vercel ก่อนใช้งานจริง
        </div>
      )}

      <section className="w-full max-w-md flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between mb-3 shrink-0">
          <h2 className="text-chalk text-sm uppercase tracking-wider">
            แตะคนที่เข้าเส้น
          </h2>
          <span className="text-xs font-display text-finish tabular">
            {runningCount} คนกำลังวิ่ง
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="text-chalk/50 text-center text-sm py-14">
            ยังไม่มีใครกำลังวิ่ง — รอสัญญาณจากจุดเริ่ม
          </p>
        ) : (
          <ul className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto slim-scroll pr-1 pb-2">
            {rows.map((r) =>
              r.done ? (
                // Same footprint as the running row — same height, padding,
                // name and time sizes — so the row does not budge when stopped.
                // Only the live timer freezes (green) and the หยุด button
                // becomes an un-tappable หยุดแล้ว tag.
                <li
                  key={r.id}
                  className={`shrink-0 card rounded-2xl min-h-[88px] px-5 py-3 flex items-center gap-4 transition-colors ${
                    r.id === lastId
                      ? "border-finish/50 shadow-glow-finish"
                      : "border-finish/20 opacity-70"
                  }`}
                >
                  <div className="min-w-0 text-left">
                    <div className="font-display text-xl text-lane truncate">
                      {displayName(r)}
                    </div>
                    <div className="tabular text-2xl font-display text-finish">
                      {fmt((r as ResultRun).durationMs, 2)}
                      <span className="text-sm text-chalk/50">s</span>
                    </div>
                  </div>
                  <span className="ml-auto shrink-0 rounded-xl border border-finish/40 text-finish/80 font-display text-sm px-4 py-3">
                    หยุดแล้ว
                  </span>
                </li>
              ) : (
                <li key={r.id} className="shrink-0 animate-floatIn">
                  <button
                    onClick={() => handleStop(r)}
                    disabled={stopping === r.id}
                    className="tap-target group w-full card rounded-2xl min-h-[88px] px-5 py-3 flex items-center gap-4 border-finish/20 hover:border-finish/50 hover:shadow-glow-finish active:scale-[0.98] transition-[transform,border-color,box-shadow] disabled:opacity-40"
                  >
                    <div className="min-w-0 text-left">
                      <div className="font-display text-xl text-lane truncate">
                        {displayName(r)}
                      </div>
                      <div className="tabular text-2xl font-display text-chalk">
                        {fmt(now - r.startTime)}
                        <span className="text-sm text-chalk/50">s</span>
                      </div>
                    </div>
                    <span className="ml-auto shrink-0 rounded-xl bg-finish text-track font-display text-lg font-bold px-5 py-3 group-active:scale-95 transition-transform">
                      หยุด
                    </span>
                  </button>
                </li>
              )
            )}
          </ul>
        )}
      </section>

      {/* Transient status lives out of the layout flow (fixed) so it can never
          push the tap rows around. */}
      {(error || retrying || lastResult) && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 flex justify-center px-5 z-20">
          <div className="w-full max-w-md pointer-events-auto">
            {error ? (
              <div className="card rounded-2xl border-pistol/40 px-4 py-3 flex items-center gap-3 animate-floatIn">
                <p className="text-pistol text-sm flex-1">{error}</p>
                {pendingStop && (
                  <button
                    onClick={() => submitStop(pendingStop)}
                    disabled={stopping !== null}
                    className="tap-target shrink-0 rounded-lg border border-finish/50 text-finish text-xs px-3 py-2 hover:bg-finish/10 transition-colors disabled:opacity-40"
                  >
                    ลองอีกครั้ง (เวลาเดิม)
                  </button>
                )}
              </div>
            ) : retrying ? (
              <div className="card rounded-2xl border-amber/30 px-4 py-3 text-amber text-sm animate-floatIn">
                กำลังลองส่งใหม่… (ใช้เวลาที่จับไว้เดิม)
              </div>
            ) : (
              lastResult && (
                <div className="card rounded-2xl border-finish/30 shadow-glow-finish px-4 py-3 flex items-center gap-3 animate-floatIn">
                  <span className="text-xl" aria-hidden>
                    🏁
                  </span>
                  <p className="font-display text-lane truncate flex-1">
                    {lastResult.name}
                  </p>
                  <span className="tabular font-display text-2xl text-finish">
                    {fmt(lastResult.durationMs, 2)}
                    <span className="text-sm text-chalk/60">s</span>
                    {lastResult.marginMs !== undefined && (
                      <span className="ml-1 text-[10px] text-chalk/50">
                        ±{fmt(lastResult.marginMs, 2)}
                      </span>
                    )}
                  </span>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </main>
  );
}
