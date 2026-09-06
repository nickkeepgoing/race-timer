"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface ResultRun {
  id: string;
  name: string;
  startTime: number;
  stopTime: number;
  durationMs: number;
}

function toCSV(results: ResultRun[]): string {
  const header = "อันดับ,ชื่อ/เลน,เวลา (วินาที),เวลาที่บันทึก\n";
  const rows = results
    .slice()
    .sort((a, b) => a.durationMs - b.durationMs)
    .map((r, i) => {
      const time = new Date(r.stopTime).toLocaleTimeString("th-TH");
      return `${i + 1},${r.name},${(r.durationMs / 1000).toFixed(2)},${time}`;
    });
  return header + rows.join("\n");
}

export default function DashboardPage() {
  const [results, setResults] = useState<ResultRun[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/results", { cache: "no-store" });
        const data = await res.json();
        setResults(data.results ?? []);
      } catch {
        // network hiccup — try again next tick
      }
    };
    poll();
    pollRef.current = setInterval(poll, 1000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const sorted = results.slice().sort((a, b) => a.durationMs - b.durationMs);

  const handleExport = () => {
    const blob = new Blob([toCSV(results)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ผลจับเวลา-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleReset = async () => {
    if (!confirm("ล้างผลทั้งหมดใช่ไหม? กู้คืนไม่ได้")) return;
    await fetch("/api/reset", { method: "POST" });
    setResults([]);
  };

  return (
    <main className="min-h-screen px-6 py-10 flex flex-col items-center">
      <div className="w-full max-w-lg flex items-center justify-between mb-8">
        <Link href="/" className="text-chalk text-sm underline underline-offset-4">
          ← กลับ
        </Link>
        <span className="uppercase tracking-[0.3em] text-xs text-amber">ผลการจับเวลา</span>
      </div>

      <div className="w-full max-w-lg">
        {sorted.length === 0 ? (
          <p className="text-chalk text-center mt-16">
            ยังไม่มีผลการจับเวลา — ผลจะขึ้นที่นี่ทันทีที่มีคนกดหยุด
          </p>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="text-chalk text-xs uppercase tracking-wider border-b border-white/10">
                <th className="py-3 pr-2 w-10">#</th>
                <th className="py-3 pr-2">ชื่อ / เลน</th>
                <th className="py-3 text-right tabular">เวลา</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={r.id} className="border-b border-white/5">
                  <td className="py-3 pr-2 text-chalk">{i + 1}</td>
                  <td className="py-3 pr-2 text-lane font-display text-lg">{r.name}</td>
                  <td className="py-3 text-right tabular font-display text-lg text-amber">
                    {(r.durationMs / 1000).toFixed(2)}s
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="w-full max-w-lg flex gap-3 mt-10">
        <button
          onClick={handleExport}
          disabled={results.length === 0}
          className="tap-target flex-1 rounded-xl bg-amber text-track font-display font-semibold py-3 disabled:opacity-30"
        >
          ดาวน์โหลด CSV
        </button>
        <button
          onClick={handleReset}
          disabled={results.length === 0}
          className="tap-target rounded-xl border border-white/15 text-chalk px-4 py-3 disabled:opacity-30"
        >
          ล้างผล
        </button>
      </div>
    </main>
  );
}
