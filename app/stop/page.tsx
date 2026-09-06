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

export default function StopPage() {
  const [active, setActive] = useState<ActiveRun | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [lastResult, setLastResult] = useState<ResultRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        const data = await res.json();
        setActive(data.active);
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
    if (!active) {
      setElapsedMs(0);
      return;
    }
    const tick = () => setElapsedMs(Date.now() - active.startTime);
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [active]);

  const handleStop = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stop", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "หยุดไม่สำเร็จ");
        return;
      }
      setLastResult(data.result);
      setActive(null);
    } catch {
      setError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-between px-6 py-10">
      <div className="w-full max-w-sm flex items-center justify-between">
        <Link href="/" className="text-chalk text-sm underline underline-offset-4">
          ← กลับ
        </Link>
        <span className="uppercase tracking-[0.3em] text-xs text-finish">เส้นชัย</span>
      </div>

      <div className="w-full max-w-sm flex flex-col items-center gap-6 text-center">
        {active ? (
          <>
            <p className="text-chalk">กำลังจับเวลา</p>
            <p className="font-display text-3xl text-lane">{active.name}</p>
            <p className="tabular font-display text-6xl text-finish">
              {(elapsedMs / 1000).toFixed(1)}s
            </p>
          </>
        ) : lastResult ? (
          <>
            <p className="text-chalk">ผลล่าสุด</p>
            <p className="font-display text-2xl text-lane">{lastResult.name}</p>
            <p className="tabular font-display text-5xl text-finish">
              {(lastResult.durationMs / 1000).toFixed(2)}s
            </p>
            <p className="text-chalk text-sm">รอผู้จับเวลาที่จุดเริ่มกดเริ่มรอบถัดไป</p>
          </>
        ) : (
          <p className="text-chalk">ยังไม่มีการเริ่มจับเวลา — รอสัญญาณจากจุดเริ่ม</p>
        )}
        {error && <p className="text-pistol text-sm">{error}</p>}
      </div>

      <button
        onClick={handleStop}
        disabled={busy || !active}
        className="tap-target w-full max-w-sm aspect-square max-h-64 rounded-full bg-finish text-track font-display text-3xl font-semibold shadow-2xl shadow-finish/30 active:scale-95 transition-transform disabled:opacity-30 disabled:active:scale-100"
      >
        หยุด
      </button>
    </main>
  );
}
