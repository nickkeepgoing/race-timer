"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface ResultRun {
  id: string;
  name: string;
  startTime: number;
  stopTime: number;
  durationMs: number;
  // Worst-case clock-sync error behind durationMs. Older results don't have it.
  marginMs?: number;
}

// Runner names are free text typed at the start line, so they can contain a
// comma, a quote or a newline — any of which would shift every later column if
// pasted in raw. Quote the field and double any embedded quote (RFC 4180).
// A leading =, +, - or @ is also prefixed with a quote so spreadsheets treat it
// as text instead of a formula.
function csvCell(value: string | number): string {
  const s = String(value);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

function toCSV(results: ResultRun[]): string {
  const header = [
    "อันดับ",
    "ชื่อ/เลน",
    "เวลา (วินาที)",
    "ความคลาดเคลื่อน (วินาที)",
    "เวลาที่บันทึก",
  ];
  const rows = results
    .slice()
    .sort((a, b) => a.durationMs - b.durationMs)
    .map((r, i) => {
      const time = new Date(r.stopTime).toLocaleTimeString("th-TH");
      // Blank rather than 0 when the margin is unknown (results recorded
      // before devices reported their sync accuracy).
      const margin =
        typeof r.marginMs === "number" ? (r.marginMs / 1000).toFixed(2) : "";
      return [i + 1, r.name, (r.durationMs / 1000).toFixed(2), margin, time];
    });
  // CRLF: what Excel expects, and harmless everywhere else.
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

const MEDALS = ["🥇", "🥈", "🥉"];

function rankStyle(i: number): {
  badge: string;
  time: string;
  row: string;
} {
  if (i === 0)
    return {
      badge: "bg-gold text-track",
      time: "text-gold",
      row: "border-gold/30 shimmer-gold animate-shimmer",
    };
  if (i === 1)
    return { badge: "bg-silver text-track", time: "text-silver", row: "border-silver/25" };
  if (i === 2)
    return { badge: "bg-bronze text-track", time: "text-bronze", row: "border-bronze/25" };
  return { badge: "bg-white/10 text-chalk", time: "text-lane", row: "border-white/5" };
}

export default function DashboardPage() {
  const [results, setResults] = useState<ResultRun[]>([]);
  const [runningCount, setRunningCount] = useState(0);
  const [noSharedStore, setNoSharedStore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const [rRes, sRes] = await Promise.all([
          fetch("/api/results", { cache: "no-store" }),
          fetch("/api/status", { cache: "no-store" }),
        ]);
        const rData = await rRes.json();
        const sData = await sRes.json();
        // Keep the last good values on a failed/rate-limited poll.
        if (Array.isArray(rData.results)) setResults(rData.results);
        if (Array.isArray(sData.active)) setRunningCount(sData.active.length);
        if (sData.storage) setNoSharedStore(sData.storage.usingKV === false);
      } catch {
        // network hiccup — keep last known values, try again next tick
      }
    };
    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const sorted = results.slice().sort((a, b) => a.durationMs - b.durationMs);
  const best = sorted[0];

  const handleExport = () => {
    // The BOM is what makes Excel read the file as UTF-8; without it the Thai
    // names open as mojibake.
    const blob = new Blob(["\uFEFF" + toCSV(results)], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ผลจับเวลา-${new Date().toISOString().slice(0, 10)}.csv`;
    // Firefox only follows a click on a link that is in the document.
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleReset = async () => {
    if (!confirm("ล้างผลทั้งหมดใช่ไหม? กู้คืนไม่ได้")) return;
    // Only clear the table once the server confirms — otherwise the next poll
    // brings every result back and it looks like the button did nothing.
    try {
      const res = await fetch("/api/reset", { method: "POST" });
      if (!res.ok) throw new Error("reset failed");
      setResults([]);
      setError(null);
    } catch {
      setError("ล้างผลไม่สำเร็จ — ลองใหม่อีกครั้ง");
    }
  };

  return (
    <main className="min-h-screen px-5 py-8 flex flex-col items-center">
      <header className="w-full max-w-lg flex items-center justify-between mb-6">
        <Link
          href="/"
          className="tap-target text-chalk text-sm hover:text-lane transition-colors"
        >
          ← กลับ
        </Link>
        <span className="uppercase tracking-[0.3em] text-xs text-amber">
          ผลการจับเวลา
        </span>
      </header>

      {noSharedStore && (
        <div className="w-full max-w-lg rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-amber text-sm mb-4">
          ⚠️ ยังไม่ได้เชื่อมที่เก็บข้อมูลกลาง (Redis) — ผลที่เห็นตรงนี้อาจไม่ใช่ผลจริง
          จากเครื่องจุดเริ่ม/เส้นชัย ให้เชื่อม Redis บน Vercel ก่อนใช้งานจริง
        </div>
      )}

      {error && (
        <p className="w-full max-w-lg text-pistol text-sm mb-4">{error}</p>
      )}

      {/* summary strip */}
      <div className="w-full max-w-lg grid grid-cols-3 gap-3 mb-6">
        <div className="card rounded-xl p-3 text-center">
          <div className="font-display text-2xl text-lane tabular">
            {results.length}
          </div>
          <div className="text-chalk text-xs mt-0.5">จบแล้ว</div>
        </div>
        <div className="card rounded-xl p-3 text-center">
          <div className="font-display text-2xl text-finish tabular flex items-center justify-center gap-1.5">
            {runningCount > 0 && (
              <span className="h-2 w-2 rounded-full bg-finish animate-pulse" />
            )}
            {runningCount}
          </div>
          <div className="text-chalk text-xs mt-0.5">กำลังวิ่ง</div>
        </div>
        <div className="card rounded-xl p-3 text-center">
          <div className="font-display text-2xl text-gold tabular">
            {best ? (best.durationMs / 1000).toFixed(1) : "—"}
          </div>
          <div className="text-chalk text-xs mt-0.5">เร็วสุด (วิ)</div>
        </div>
      </div>

      <div className="w-full max-w-lg">
        {sorted.length === 0 ? (
          <div className="text-center mt-16">
            <div className="text-5xl mb-4" aria-hidden>
              🏁
            </div>
            <p className="text-chalk">
              ยังไม่มีผลการจับเวลา — ผลจะขึ้นที่นี่ทันทีที่มีคนกดหยุด
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {sorted.map((r, i) => {
              const s = rankStyle(i);
              return (
                <li
                  key={r.id}
                  className={`card rounded-xl px-4 py-3 flex items-center gap-3 border ${s.row}`}
                >
                  <span
                    className={`shrink-0 h-9 w-9 rounded-full grid place-items-center font-display font-bold text-sm ${s.badge}`}
                  >
                    {i < 3 ? MEDALS[i] : i + 1}
                  </span>
                  <span className="font-display text-lg text-lane truncate">
                    {r.name}
                  </span>
                  <span
                    className={`ml-auto tabular font-display text-2xl ${s.time}`}
                  >
                    {(r.durationMs / 1000).toFixed(1)}
                    {typeof r.marginMs === "number" && (
                      <span className="text-sm text-chalk/50">
                        {" "}
                        ± {(r.marginMs / 1000).toFixed(1)}
                      </span>
                    )}
                    <span className="text-sm text-chalk/50">s</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="w-full max-w-lg flex gap-3 mt-8">
        <button
          onClick={handleExport}
          disabled={results.length === 0}
          className="tap-target flex-1 rounded-xl bg-amber text-track font-display font-semibold py-3 active:scale-[0.98] transition-transform disabled:opacity-30"
        >
          ⬇ ดาวน์โหลด CSV
        </button>
        <button
          onClick={handleReset}
          disabled={results.length === 0}
          className="tap-target rounded-xl border border-white/15 text-chalk px-5 py-3 hover:border-pistol/50 hover:text-pistol transition-colors disabled:opacity-30"
        >
          ล้างผล
        </button>
      </div>
    </main>
  );
}
