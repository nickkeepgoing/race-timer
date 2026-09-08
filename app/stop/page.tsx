"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useServerClock } from "@/lib/clock";

interface ActiveRun {
  id: string;
  name: string;
  startTime: number;
}

// A runner's fixed place on screen. Once a slot exists it NEVER moves and never
// disappears on its own — it only changes what it shows. That is the whole point
// of this screen: the finish judge aims at a position with their finger, and the
// row under that finger must still be the same runner a moment later.
//   running  — counting up, tappable
//   stopping — tap sent, waiting for the server
//   done     — finished here, shows the final time, dead to taps
//   ended    — stopped/cancelled from another device, dead to taps
type SlotStatus = "running" | "stopping" | "done" | "ended";

interface Slot {
  id: string;
  name: string;
  startTime: number;
  status: SlotStatus;
  durationMs?: number;
}

function fmt(ms: number, digits = 1): string {
  return (Math.max(0, ms) / 1000).toFixed(digits);
}

export default function StopPage() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [now, setNow] = useState(Date.now());
  const [lastResult, setLastResult] = useState<{ name: string; durationMs: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noSharedStore, setNoSharedStore] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
            const incoming: ActiveRun[] = data.active;
            setSlots((prev) => {
              const known = new Set(prev.map((s) => s.id));
              const activeIds = new Set(incoming.map((r) => r.id));
              // A runner that vanished server-side while we still show it as
              // running was stopped or cancelled elsewhere. Mark the slot in
              // place — never splice it out, that is what shifted the buttons.
              // Slots already stopping/done/ended are left alone, so an SSE
              // frame that was in transit when we tapped can't resurrect them.
              let next = prev;
              if (prev.some((s) => s.status === "running" && !activeIds.has(s.id))) {
                next = prev.map((s) =>
                  s.status === "running" && !activeIds.has(s.id)
                    ? { ...s, status: "ended" as const }
                    : s
                );
              }
              // Newcomers always append to the bottom — the existing rows keep
              // their exact position. Only the new batch is sorted.
              const fresh = incoming
                .filter((r) => !known.has(r.id))
                .sort((a, b) => a.startTime - b.startTime)
                .map((r) => ({ ...r, status: "running" as const }));
              return fresh.length ? [...next, ...fresh] : next;
            });
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

  useEffect(() => () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
  }, []);

  const setStatus = (id: string, patch: Partial<Slot>) =>
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const handleStop = async (slot: Slot) => {
    if (slot.status !== "running") return;
    // Capture the exact tap moment first, before any async work, so the
    // finish time reflects when the finger hit the button — not when the
    // request reached the server.
    const stopTime = serverNow();
    setError(null);
    setStatus(slot.id, { status: "stopping" });
    try {
      const res = await fetch("/api/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: slot.id, stopTime }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const durationMs = data.result?.durationMs ?? Math.max(0, stopTime - slot.startTime);
        setStatus(slot.id, { status: "done", durationMs });
        setLastResult({ name: slot.name, durationMs });
      } else if (res.status === 409) {
        // Already stopped/cancelled elsewhere — the row is finished either way.
        setStatus(slot.id, { status: "ended" });
      } else {
        // Real failure: hand the button back so the runner isn't lost.
        setStatus(slot.id, { status: "running" });
        setError(data.error ?? "หยุดไม่สำเร็จ ลองใหม่อีกครั้ง");
      }
    } catch {
      setStatus(slot.id, { status: "running" });
      setError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง");
    }
  };

  // Clearing finished rows is the ONLY thing that moves buttons, so it takes a
  // deliberate double tap and lives far from the runner list.
  const handleClearFinished = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      confirmTimer.current = setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirmClear(false);
    setSlots((prev) => prev.filter((s) => s.status === "running" || s.status === "stopping"));
  };

  const runningCount = slots.filter((s) => s.status === "running" || s.status === "stopping").length;
  const finishedCount = slots.length - runningCount;

  return (
    // Fixed-height page: header, status strip and list header never grow, and
    // the list itself is the only scrolling area — so nothing above the buttons
    // can ever push them up or down mid-race.
    <main className="h-[100dvh] flex flex-col items-center overflow-hidden px-5 pt-6">
      <header className="w-full max-w-md shrink-0 flex items-center justify-between h-10">
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
          <span className="text-[10px] text-chalk/50 tabular mt-0.5 h-3">
            {accuracyMs !== null ? `ซิงก์เวลา ±${accuracyMs}ms` : ""}
          </span>
        </div>
      </header>

      {/* Status strip: always exactly this tall, whatever it is showing. */}
      <div className="w-full max-w-md shrink-0 h-[76px] mt-4">
        {error ? (
          <div className="h-full card rounded-2xl px-4 flex items-center border-pistol/40 bg-pistol/10">
            <p className="text-pistol text-sm">{error}</p>
          </div>
        ) : noSharedStore ? (
          <div className="h-full card rounded-2xl px-4 flex items-center border-amber/40 bg-amber/10">
            <p className="text-amber text-xs leading-snug">
              ⚠️ ยังไม่ได้เชื่อมที่เก็บข้อมูลกลาง (Redis) — เครื่องนี้จะไม่เห็นคนที่จุดเริ่มกดออกตัว
            </p>
          </div>
        ) : lastResult ? (
          <div className="h-full card rounded-2xl px-4 flex items-center gap-3 border-finish/30">
            <span className="text-xl" aria-hidden>🏁</span>
            <div className="min-w-0">
              <p className="text-chalk text-[10px] uppercase tracking-wider">เข้าเส้นล่าสุด</p>
              <p className="font-display text-base text-lane truncate leading-tight">
                {lastResult.name}
              </p>
            </div>
            <span className="ml-auto tabular font-display text-2xl text-finish">
              {fmt(lastResult.durationMs, 2)}
              <span className="text-sm text-chalk/60">s</span>
            </span>
          </div>
        ) : (
          <div className="h-full rounded-2xl border border-dashed border-white/10 flex items-center justify-center">
            <p className="text-chalk/40 text-xs">ยังไม่มีใครเข้าเส้น</p>
          </div>
        )}
      </div>

      <div className="w-full max-w-md shrink-0 flex items-center justify-between h-10 mt-2">
        <h2 className="text-chalk text-sm uppercase tracking-wider">
          แตะคนที่เข้าเส้น
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-xs font-display text-finish tabular">
            {runningCount} คนกำลังวิ่ง
          </span>
          <button
            onClick={handleClearFinished}
            disabled={finishedCount === 0}
            className={`tap-target text-[11px] rounded-lg px-2.5 py-1.5 border transition-colors ${
              confirmClear
                ? "border-pistol/60 text-pistol bg-pistol/10"
                : "border-white/10 text-chalk/70 disabled:opacity-25"
            }`}
          >
            {confirmClear ? "ยืนยันล้าง?" : `ล้างที่จบแล้ว (${finishedCount})`}
          </button>
        </div>
      </div>

      {/* The only scrolling region. Rows are a fixed height and never reorder. */}
      <section className="w-full max-w-md flex-1 min-h-0 overflow-y-auto overscroll-contain slim-scroll pb-6">
        {slots.length === 0 ? (
          <p className="text-chalk/50 text-center text-sm py-14">
            ยังไม่มีใครกำลังวิ่ง — รอสัญญาณจากจุดเริ่ม
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {slots.map((s) => {
              const live = s.status === "running" || s.status === "stopping";
              return (
                <li key={s.id} className="h-[88px] shrink-0 animate-floatIn">
                  <button
                    onClick={() => handleStop(s)}
                    disabled={!live || s.status === "stopping"}
                    className={`tap-target group w-full h-full card rounded-2xl px-5 flex items-center gap-4 transition-colors ${
                      s.status === "running"
                        ? "border-finish/25 active:border-finish/60"
                        : s.status === "stopping"
                          ? "border-finish/25 opacity-60"
                          : s.status === "done"
                            ? "border-finish/40 bg-finish/5"
                            : "border-white/10 opacity-40"
                    }`}
                  >
                    <div className="min-w-0 text-left">
                      <div
                        className={`font-display text-xl truncate ${
                          s.status === "running" ? "text-lane" : "text-chalk"
                        }`}
                      >
                        {s.name}
                      </div>
                      <div
                        className={`tabular text-2xl font-display ${
                          s.status === "done" ? "text-finish" : "text-chalk"
                        }`}
                      >
                        {s.status === "done"
                          ? fmt(s.durationMs ?? 0, 2)
                          : s.status === "ended"
                            ? "—"
                            : fmt(now - s.startTime)}
                        {s.status !== "ended" && <span className="text-sm text-chalk/50">s</span>}
                      </div>
                    </div>
                    {/* Same box in every state, so the row height never shifts. */}
                    <span
                      className={`ml-auto shrink-0 rounded-xl font-display text-lg font-bold px-5 py-3 ${
                        s.status === "running"
                          ? "bg-finish text-track group-active:scale-95 transition-transform"
                          : s.status === "stopping"
                            ? "bg-finish/40 text-track"
                            : s.status === "done"
                              ? "border border-finish/40 text-finish text-sm"
                              : "border border-white/10 text-chalk text-sm"
                      }`}
                    >
                      {s.status === "running"
                        ? "หยุด"
                        : s.status === "stopping"
                          ? "…"
                          : s.status === "done"
                            ? "✓ จบ"
                            : "ยกเลิก"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
