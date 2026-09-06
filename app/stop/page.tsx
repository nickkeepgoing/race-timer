"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        const data = await res.json();
        setActive(Array.isArray(data.active) ? data.active : []);
        setNoSharedStore(data.storage ? data.storage.usingKV === false : false);
      } catch {
        // network hiccup — try again next tick
      }
    };
    poll();
    pollRef.current = setInterval(poll, 500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  const handleStop = async (id: string) => {
    setStopping(id);
    setError(null);
    setActive((prev) => prev.filter((r) => r.id !== id)); // optimistic
    try {
      const res = await fetch("/api/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "หยุดไม่สำเร็จ");
        return;
      }
      setLastResult(data.result);
    } catch {
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
        <span className="flex items-center gap-2 uppercase tracking-[0.3em] text-xs text-finish">
          <span className="h-2 w-2 rounded-full bg-finish animate-pulse" />
          เส้นชัย
        </span>
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
