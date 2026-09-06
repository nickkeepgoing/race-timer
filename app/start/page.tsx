"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface ActiveRun {
  id: string;
  name: string;
  startTime: number;
}

export default function StartPage() {
  const [name, setName] = useState("");
  const [active, setActive] = useState<ActiveRun | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
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

  const handleStart = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "เริ่มไม่สำเร็จ");
        setActive(data.active ?? null);
        return;
      }
      setActive(data.active);
    } catch {
      setError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    setBusy(true);
    try {
      await fetch("/api/cancel", { method: "POST" });
      setActive(null);
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
        <span className="uppercase tracking-[0.3em] text-xs text-pistol">จุดเริ่ม</span>
      </div>

      <div className="w-full max-w-sm flex flex-col items-center gap-6">
        {active ? (
          <>
            <p className="text-chalk text-center">กำลังจับเวลา</p>
            <p className="font-display text-3xl text-lane text-center">{active.name}</p>
            <p className="tabular font-display text-6xl text-pistol">
              {(elapsedMs / 1000).toFixed(1)}s
            </p>
            <button
              onClick={handleCancel}
              disabled={busy}
              className="tap-target text-chalk text-sm underline underline-offset-4 disabled:opacity-40"
            >
              ยกเลิกรอบนี้ (กดผิด)
            </button>
          </>
        ) : (
          <>
            <label className="w-full text-left text-sm text-chalk">
              ชื่อ / เลน (ไม่บังคับ)
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="เช่น เลน 3 หรือ ด.ช. สมชาย"
                className="mt-2 w-full rounded-xl bg-black/30 border border-white/10 px-4 py-3 text-lane placeholder:text-chalk/50 focus:outline-none focus:ring-2 focus:ring-pistol"
              />
            </label>
            {error && <p className="text-pistol text-sm">{error}</p>}
          </>
        )}
      </div>

      <button
        onClick={handleStart}
        disabled={busy || !!active}
        className="tap-target w-full max-w-sm aspect-square max-h-64 rounded-full bg-pistol text-track font-display text-3xl font-semibold shadow-2xl shadow-pistol/30 active:scale-95 transition-transform disabled:opacity-30 disabled:active:scale-100"
      >
        {active ? "กำลังวิ่ง…" : "เริ่ม"}
      </button>
    </main>
  );
}
