"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface ActiveRun {
  id: string;
  name: string;
  startTime: number;
}

function fmt(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(1);
}

export default function StartPage() {
  const [name, setName] = useState("");
  const [active, setActive] = useState<ActiveRun[]>([]);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        const data = await res.json();
        setActive(Array.isArray(data.active) ? data.active : []);
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
        return;
      }
      setActive(data.active ?? []);
      setName("");
    } catch {
      setError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async (id: string) => {
    setActive((prev) => prev.filter((r) => r.id !== id)); // optimistic
    try {
      await fetch("/api/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {
      // will re-sync on next poll
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
        <span className="flex items-center gap-2 uppercase tracking-[0.3em] text-xs text-pistol">
          <span className="h-2 w-2 rounded-full bg-pistol animate-pulse" />
          จุดเริ่ม
        </span>
      </header>

      <div className="w-full max-w-md card rounded-2xl p-5">
        <label className="block text-sm text-chalk mb-2">
          ชื่อ / เลน (ไม่บังคับ)
        </label>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) handleStart();
            }}
            placeholder="เช่น เลน 3 หรือ ด.ช. สมชาย"
            className="flex-1 min-w-0 rounded-xl bg-black/40 border border-white/10 px-4 py-3 text-lane placeholder:text-chalk/40 focus:outline-none focus:ring-2 focus:ring-pistol/70"
          />
        </div>
        {error && <p className="text-pistol text-sm mt-3">{error}</p>}
        <button
          onClick={handleStart}
          disabled={busy}
          className="tap-target mt-4 w-full rounded-2xl bg-pistol text-track font-display text-2xl font-bold py-5 shadow-glow active:scale-[0.98] transition-transform disabled:opacity-40 disabled:active:scale-100"
        >
          {busy ? "กำลังเริ่ม…" : "▶ เริ่มจับเวลา"}
        </button>
        <p className="text-chalk/50 text-xs mt-3 text-center">
          กดได้เรื่อย ๆ เพื่อเริ่มจับเวลาหลายคนพร้อมกัน
        </p>
      </div>

      <section className="w-full max-w-md flex-1">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-chalk text-sm uppercase tracking-wider">
            กำลังวิ่ง
          </h2>
          <span className="text-xs font-display text-pistol tabular">
            {running.length} คน
          </span>
        </div>

        {running.length === 0 ? (
          <p className="text-chalk/50 text-center text-sm py-10">
            ยังไม่มีใครออกตัว — พิมพ์ชื่อแล้วกด “เริ่มจับเวลา”
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5 slim-scroll max-h-[46vh] overflow-y-auto pr-1">
            {running.map((r) => (
              <li
                key={r.id}
                className="card animate-floatIn rounded-xl px-4 py-3 flex items-center gap-3"
              >
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-pistol animate-pulseRing" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-pistol" />
                </span>
                <span className="font-display text-lg text-lane truncate">
                  {r.name}
                </span>
                <span className="ml-auto tabular font-display text-2xl text-pistol">
                  {fmt(now - r.startTime)}
                  <span className="text-sm text-chalk/60">s</span>
                </span>
                <button
                  onClick={() => handleCancel(r.id)}
                  className="tap-target text-chalk/50 hover:text-pistol text-xs px-2 py-1 transition-colors"
                  aria-label={`ยกเลิก ${r.name}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
