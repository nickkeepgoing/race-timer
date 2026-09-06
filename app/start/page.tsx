"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useServerClock } from "@/lib/clock";

interface ActiveRun {
  id: string;
  name: string;
  startTime: number;
}

const ROSTER_KEY = "race-timer:roster";

function fmt(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(1);
}

export default function StartPage() {
  const [roster, setRoster] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [active, setActive] = useState<ActiveRun[]>([]);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noSharedStore, setNoSharedStore] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const draftRef = useRef<HTMLInputElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { serverNow, accuracyMs } = useServerClock();

  // Load the saved roster once on mount.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ROSTER_KEY);
      if (saved) setRoster(JSON.parse(saved));
    } catch {
      // ignore malformed storage
    }
  }, []);

  // Persist roster whenever it changes.
  useEffect(() => {
    try {
      localStorage.setItem(ROSTER_KEY, JSON.stringify(roster));
    } catch {
      // storage may be unavailable — not fatal
    }
  }, [roster]);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        const data = await res.json();
        // Only replace the list when we actually got one — a failed or
        // rate-limited poll (active:null) must not wipe the timers.
        if (Array.isArray(data.active)) setActive(data.active);
        if (data.storage) setNoSharedStore(data.storage.usingKV === false);
      } catch {
        // network hiccup — keep the last known list, try again next tick
      }
    };
    poll();
    pollRef.current = setInterval(poll, 1500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), 100);
    return () => clearInterval(id);
  }, [serverNow]);

  const addToRoster = (name: string) => {
    const n = name.trim();
    setRoster((prev) => [...prev, n]); // blank allowed → auto-named on release
    setDraft("");
    draftRef.current?.focus();
  };

  const addNextLane = () => {
    // Next lane number based on existing "เลน N" entries.
    const nums = roster
      .map((r) => /เลน\s*(\d+)/.exec(r)?.[1])
      .filter(Boolean)
      .map(Number);
    const next = (nums.length ? Math.max(...nums) : roster.length) + 1;
    setRoster((prev) => [...prev, `เลน ${next}`]);
  };

  const updateRoster = (i: number, value: string) => {
    setRoster((prev) => prev.map((r, idx) => (idx === i ? value : r)));
  };

  const removeFromRoster = (i: number) => {
    setRoster((prev) => prev.filter((_, idx) => idx !== i));
  };

  const startAll = async () => {
    if (roster.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    // Capture the exact tap moment on the server timeline, so network
    // latency of this request doesn't get added to everyone's time.
    const startTime = serverNow();
    try {
      const res = await fetch("/api/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names: roster, startTime }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "ปล่อยตัวไม่สำเร็จ");
        return;
      }
      setActive(data.active ?? []);
      setFlash(`ปล่อยตัวแล้ว ${roster.length} คน!`);
      setTimeout(() => setFlash(null), 2500);
      setRoster([]); // clear the line-up for the next heat
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
    <main className="min-h-screen flex flex-col items-center px-5 py-8 gap-5">
      <header className="w-full max-w-md flex items-center justify-between">
        <Link
          href="/"
          className="tap-target text-chalk text-sm hover:text-lane transition-colors"
        >
          ← กลับ
        </Link>
        <div className="flex flex-col items-end">
          <span className="flex items-center gap-2 uppercase tracking-[0.3em] text-xs text-pistol">
            <span className="h-2 w-2 rounded-full bg-pistol animate-pulse" />
            จุดเริ่ม
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
          ⚠️ ยังไม่ได้เชื่อมที่เก็บข้อมูลกลาง (Redis) — เครื่องจุดเริ่มกับเส้นชัยจะ
          <b>ไม่เห็นกันและกดหยุดไม่ได้</b> ให้เชื่อม Redis บน Vercel ก่อนใช้งานจริง
        </div>
      )}

      {flash && (
        <div className="w-full max-w-md rounded-xl border border-finish/40 bg-finish/10 px-4 py-3 text-finish text-sm text-center animate-floatIn">
          🏃 {flash}
        </div>
      )}

      {/* ── Roster: prepare names before the gun ── */}
      <section className="w-full max-w-md card rounded-2xl p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-display text-lg text-lane">เตรียมรายชื่อ</h2>
          <span className="text-xs font-display text-pistol tabular">
            {roster.length} คน
          </span>
        </div>
        <p className="text-chalk/60 text-xs mb-3">
          เพิ่มรายชื่อ/เลนให้ครบก่อน แล้วกด “ปล่อยตัวทั้งหมด” ทีเดียว
        </p>

        <div className="flex gap-2">
          <input
            ref={draftRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) addToRoster(draft);
            }}
            placeholder="เช่น เลน 3 หรือ ด.ช. สมชาย"
            className="flex-1 min-w-0 rounded-xl bg-black/40 border border-white/10 px-4 py-3 text-lane placeholder:text-chalk/40 focus:outline-none focus:ring-2 focus:ring-pistol/70"
          />
          <button
            onClick={() => draft.trim() && addToRoster(draft)}
            disabled={!draft.trim()}
            className="tap-target shrink-0 rounded-xl bg-white/10 text-lane px-4 font-display text-lg disabled:opacity-30"
            aria-label="เพิ่มชื่อ"
          >
            เพิ่ม
          </button>
        </div>

        <button
          onClick={addNextLane}
          className="tap-target mt-2 text-chalk/70 hover:text-lane text-sm underline underline-offset-4"
        >
          + เพิ่มเลนถัดไปอัตโนมัติ
        </button>

        {roster.length > 0 && (
          <ul className="mt-4 flex flex-col gap-2 slim-scroll max-h-[30vh] overflow-y-auto pr-1">
            {roster.map((name, i) => (
              <li key={i} className="flex items-center gap-2 animate-floatIn">
                <span className="shrink-0 w-6 text-center text-chalk/50 tabular text-sm">
                  {i + 1}
                </span>
                <input
                  value={name}
                  onChange={(e) => updateRoster(i, e.target.value)}
                  placeholder={`นักวิ่ง ${i + 1}`}
                  className="flex-1 min-w-0 rounded-lg bg-black/30 border border-white/5 px-3 py-2 text-lane placeholder:text-chalk/30 focus:outline-none focus:ring-1 focus:ring-pistol/60"
                />
                <button
                  onClick={() => removeFromRoster(i)}
                  className="tap-target shrink-0 text-chalk/40 hover:text-pistol px-2 py-1"
                  aria-label={`ลบ ${name || "รายการ"}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="text-pistol text-sm mt-3">{error}</p>}

        <button
          onClick={startAll}
          disabled={busy || roster.length === 0}
          className="tap-target mt-4 w-full rounded-2xl bg-pistol text-track font-display text-2xl font-bold py-5 shadow-glow active:scale-[0.98] transition-transform disabled:opacity-30 disabled:active:scale-100"
        >
          {busy
            ? "กำลังปล่อยตัว…"
            : `▶ ปล่อยตัวทั้งหมด${roster.length ? ` (${roster.length} คน)` : ""}`}
        </button>
        {roster.length === 0 && (
          <p className="text-chalk/50 text-xs mt-2 text-center">
            เพิ่มรายชื่ออย่างน้อย 1 คนเพื่อปล่อยตัว
          </p>
        )}
      </section>

      {/* ── Currently running ── */}
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
          <p className="text-chalk/50 text-center text-sm py-8">
            ยังไม่มีใครออกตัว
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5 slim-scroll max-h-[40vh] overflow-y-auto pr-1">
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
