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
  durationMs: number;
}

// A stop the server has not accepted yet. Holding the captured tap moment here
// is the whole point: every retry must re-send *that* instant, never a fresh
// clock reading — re-timing a finish that already happened is the bug this
// guards against.
interface PendingStop {
  id: string;
  stopTime: number; // server-clock instant of the tap
  accuracyMs: number | null; // sync accuracy at the moment of the tap
  snapshot: ActiveRun[]; // list to restore if the stop truly fails
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
  const [lastResult, setLastResult] = useState<ResultRun | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  // Kept after every automatic attempt failed, so the error UI can offer a
  // manual retry that reuses the original timestamp.
  const [pendingStop, setPendingStop] = useState<PendingStop | null>(null);
  const [noSharedStore, setNoSharedStore] = useState(false);
  // Ids we've already stopped locally — tombstones prevent a poll response
  // that was in flight when we tapped from resurrecting a runner we just
  // finished.
  const removedRef = useRef<Set<string>>(new Set());
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
          const removed = removedRef.current;
          // Drop tombstones the server has already confirmed gone.
          for (const id of [...removed]) {
            if (!data.active.some((r: ActiveRun) => r.id === id)) removed.delete(id);
          }
          // Never re-show a runner we stopped this session.
          const fresh = data.active.filter((r: ActiveRun) => !removed.has(r.id));
          setActive(fresh);
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

  // Sends one already-captured stop, retrying a flaky network on its own. The
  // button stays in its stopping state for the whole sequence so the runner is
  // never re-timed by a second tap.
  const submitStop = async (pending: PendingStop) => {
    const { id, stopTime, accuracyMs: tapAccuracyMs, snapshot } = pending;
    setStopping(id);
    setError(null);
    setPendingStop(null);
    removedRef.current.add(id); // tombstone: outlives any in-flight poll
    setActive((prev) => prev.filter((r) => r.id !== id)); // optimistic

    // Only clear the stopping flag if a later tap hasn't claimed it.
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
          setLastResult(data.result);
          finish();
          return;
        }
        if (res.status === 409) {
          // Already stopped/cancelled elsewhere — the optimistic removal was
          // correct, so just leave it removed. Retrying can't help.
          finish();
          return;
        }
        lastError = data.error ?? lastError;
      } catch {
        lastError = "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้";
      }
    }

    // Out of automatic attempts. Put the runner back so it isn't silently
    // lost, lift the tombstone so polls can show it again, and keep the
    // captured timestamp for the manual "ลองอีกครั้ง" button.
    removedRef.current.delete(id);
    setActive(snapshot);
    setError(`${lastError} — เวลาที่จับไว้ยังอยู่`);
    setPendingStop(pending);
    finish();
  };

  const handleStop = (id: string) => {
    // Capture the exact tap moment first, before any async work, so the
    // finish time reflects when the finger hit the button — not when the
    // request reached the server.
    const stopTime = serverNow();
    return submitStop({
      id,
      stopTime,
      accuracyMs,
      snapshot: active, // for rollback if the stop truly fails
    });
  };

  const running = active.slice().sort((a, b) => a.startTime - b.startTime);

  return (
    <main className="min-h-screen flex flex-col items-center px-5 py-8 gap-6">
      <header className="w-full max-w-md flex items-center justify-between">
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
        <div className="w-full max-w-md rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-amber text-sm">
          ⚠️ ยังไม่ได้เชื่อมที่เก็บข้อมูลกลาง (Redis) — เครื่องนี้จะไม่เห็นคนที่จุดเริ่ม
          กดออกตัว และกดหยุดไม่ได้ ให้เชื่อม Redis บน Vercel ก่อนใช้งานจริง
        </div>
      )}

      {lastResult && (
        <div className="w-full max-w-md card rounded-2xl p-4 flex items-center gap-4 animate-floatIn border-finish/30 shadow-glow-finish">
          <span className="text-2xl" aria-hidden>
            🏁
          </span>
          <div className="min-w-0">
            <p className="text-chalk text-xs uppercase tracking-wider">
              เข้าเส้นล่าสุด
            </p>
            <p className="font-display text-lg text-lane truncate">
              {lastResult.name}
            </p>
          </div>
          <span className="ml-auto tabular font-display text-3xl text-finish">
            {fmt(lastResult.durationMs, 2)}
            <span className="text-base text-chalk/60">s</span>
          </span>
        </div>
      )}

      <section className="w-full max-w-md flex-1">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-chalk text-sm uppercase tracking-wider">
            แตะคนที่เข้าเส้น
          </h2>
          <span className="text-xs font-display text-finish tabular">
            {running.length} คนกำลังวิ่ง
          </span>
        </div>

        {retrying && (
          <p className="text-amber text-sm mb-3">
            กำลังลองส่งใหม่… (ใช้เวลาที่จับไว้เดิม)
          </p>
        )}

        {error && (
          <div className="mb-3 flex items-center gap-3">
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
        )}

        {running.length === 0 ? (
          <p className="text-chalk/50 text-center text-sm py-14">
            ยังไม่มีใครกำลังวิ่ง — รอสัญญาณจากจุดเริ่ม
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {running.map((r) => (
              <li key={r.id} className="animate-floatIn">
                <button
                  onClick={() => handleStop(r.id)}
                  disabled={stopping === r.id}
                  className="tap-target group w-full card rounded-2xl px-5 py-4 flex items-center gap-4 border-finish/20 hover:border-finish/50 hover:shadow-glow-finish active:scale-[0.98] transition-all disabled:opacity-40"
                >
                  <div className="min-w-0 text-left">
                    <div className="font-display text-xl text-lane truncate">
                      {r.name}
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
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
