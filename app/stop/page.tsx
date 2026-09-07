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

function fmt(ms: number, digits = 1): string {
  return (Math.max(0, ms) / 1000).toFixed(digits);
}

export default function StopPage() {
  const [active, setActive] = useState<ActiveRun[]>([]);
  const [now, setNow] = useState(Date.now());
  const [lastResult, setLastResult] = useState<ResultRun | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noSharedStore, setNoSharedStore] = useState(false);
  // Ids we've already stopped locally — tombstones prevent an SSE push that
  // was in transit when we tapped from resurrecting a runner we just finished.
  const removedRef = useRef<Set<string>>(new Set());
  const { serverNow, accuracyMs } = useServerClock();

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      es = new EventSource("/api/events");

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (Array.isArray(data.active)) {
            const removed = removedRef.current;
            // Drop tombstones the server has already confirmed gone.
            for (const id of [...removed]) {
              if (!data.active.some((r: ActiveRun) => r.id === id)) removed.delete(id);
            }
            // Never re-show a runner we stopped this session.
            const fresh = data.active.filter((r: ActiveRun) => !removed.has(r.id));
            setActive(fresh); // SSE push is authoritative — trust it immediately
          }
          if (data.storage) setNoSharedStore(data.storage.usingKV === false);
        } catch { /* malformed frame — ignore */ }
      };

      // EventSource reconnects automatically on error, but the server also
      // closes the connection every ~9s (Vercel function limit) so we'll see
      // frequent onerror events — just reopen immediately.
      es.onerror = () => {
        es?.close();
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 300);
        }
      };
    };

    connect();
    return () => {
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), 100);
    return () => clearInterval(id);
  }, [serverNow]);

  const handleStop = async (id: string) => {
    // Capture the exact tap moment first, before any async work, so the
    // finish time reflects when the finger hit the button — not when the
    // request reached the server.
    const stopTime = serverNow();
    setStopping(id);
    setError(null);
    const snapshot = active; // for rollback if the stop truly fails
    removedRef.current.add(id); // tombstone: outlives any in-flight poll
    setActive((prev) => prev.filter((r) => r.id !== id)); // optimistic
    try {
      const res = await fetch("/api/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, stopTime }),
      });
      const data = await res.json();
      if (res.ok) {
        setLastResult(data.result);
      } else if (res.status === 409) {
        // Already stopped/cancelled elsewhere — the optimistic removal was
        // correct, so just leave it removed.
      } else {
        // Real failure: put the runner back so it isn't silently lost, and
        // lift the tombstone so future polls can show it again.
        removedRef.current.delete(id);
        setActive(snapshot);
        setError(data.error ?? "หยุดไม่สำเร็จ ลองใหม่อีกครั้ง");
      }
    } catch {
      removedRef.current.delete(id);
      setActive(snapshot);
      setError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง");
    } finally {
      setStopping(null);
    }
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

        {error && <p className="text-pistol text-sm mb-3">{error}</p>}

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
