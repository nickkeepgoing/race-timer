import { useState } from "react";
import { duration, fmtTime, margin, toCSV, type Runner } from "./race.ts";
import type { TabProps } from "./RoomView.tsx";
import { Clock, IconDownload } from "./ui.tsx";

const MEDAL = ["bg-gold text-white", "bg-silver text-white", "bg-bronze text-white"];

export function ResultsTab({ room, heats, toast }: TabProps) {
  const [heat, setHeat] = useState<number | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const all = heats.flatMap((h) => h.runners);
  const done = all.filter((r) => r.stop);
  const running = all.filter((r) => !r.stop);

  const list = done.filter((r) => heat === null || r.heat === heat).sort((a, b) => duration(a) - duration(b));

  const exportCSV = () => {
    // The BOM makes Excel read UTF-8, otherwise Thai names open as mojibake.
    const blob = new Blob(["﻿" + toCSV(all)], { type: "text/csv;charset=utf-8" });
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: `ผลจับเวลา-${room.code}-${new Date().toISOString().slice(0, 10)}.csv`,
    });
    document.body.appendChild(a); // Firefox only follows links in the document
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  };

  const act = (r: Runner, what: "rerun" | "delete") => {
    setOpen(null);
    if (what === "rerun") {
      room.undo(r.stop!.id);
      toast({ text: `${r.name} กลับไปวิ่งต่อ — กดหยุดใหม่ที่เส้นชัย` });
    } else {
      const ev = room.cancel([r.rid]);
      toast({ text: `ลบผลของ ${r.name} แล้ว`, action: { label: "เอาคืน", run: () => room.undo(ev.id) } });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2.5 animate-rise">
        <Stat label="เข้าเส้นแล้ว" value={String(done.length)} />
        <Stat label="กำลังวิ่ง" value={String(running.length)} live={running.length > 0} />
        <Stat label="เร็วสุด" value={list[0] ? fmtTime(duration(list[0])) : "—"} tone="text-gold" />
      </div>

      {heats.length > 1 && (
        <div className="-mx-4 px-4 flex gap-2 overflow-x-auto slim-scroll pb-1">
          {[null, ...heats.map((h) => h.n)].map((n) => (
            <button
              key={n ?? "all"}
              onClick={() => setHeat(n)}
              className={`chip shrink-0 px-3.5 py-1.5 text-sm transition ${heat === n ? "bg-ink text-paper border-ink" : "hover:border-ink/40"}`}
            >
              {n === null ? "ทุกรอบ" : `รอบ ${n}`}
            </button>
          ))}
        </div>
      )}

      {list.length === 0 ? (
        <div className="pt-12 text-center animate-rise">
          <div className="font-display text-6xl font-extrabold italic text-line">1 2 3</div>
          <p className="mt-3 text-muted">ยังไม่มีผล — ผลจะขึ้นที่นี่ทันทีที่เส้นชัยกดหยุด</p>
        </div>
      ) : (
        <ol className="flex flex-col gap-2">
          {list.map((r, i) => {
            const rank = 1 + list.findIndex((x) => duration(x) === duration(r));
            const m = margin(r);
            const top = rank <= 3;
            return (
              <li key={r.rid} className="card overflow-hidden animate-rise" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                <div className={`flex items-center gap-3 px-3 ${top ? "py-3.5" : "py-2.5"}`}>
                  <span
                    className={`shrink-0 grid place-items-center rounded-full font-display font-bold italic tabular ${
                      top ? `h-11 w-11 text-xl ${MEDAL[rank - 1]}` : "h-9 w-9 bg-ink/5 text-muted"
                    }`}
                  >
                    {rank}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className={`truncate font-display font-semibold ${top ? "text-xl" : "text-lg"}`}>{r.name}</div>
                    <div className="text-xs text-muted">
                      รอบ {r.heat} · เลน {r.lane}
                    </div>
                  </div>
                  <div className="text-right">
                    <Clock ms={duration(r)} className={`font-display font-semibold ${top ? "text-3xl" : "text-2xl"}`} />
                    {m !== null && (
                      <div className="text-[11px] text-muted tabular">±{m < 1000 ? `${m}ms` : `${(m / 1000).toFixed(2)}s`}</div>
                    )}
                  </div>
                  <button
                    onClick={() => setOpen(open === r.rid ? null : r.rid)}
                    className="h-9 w-7 -mr-1 grid place-items-center rounded-lg text-muted hover:text-ink"
                    aria-label={`ตัวเลือกของ ${r.name}`}
                    aria-expanded={open === r.rid}
                  >
                    ⋮
                  </button>
                </div>
                {open === r.rid && (
                  <div className="flex gap-2 border-t border-line bg-ink/[0.03] px-3 py-2 animate-rise">
                    <button onClick={() => act(r, "rerun")} className="btn flex-1 py-2 text-sm border border-line">
                      หยุดผิด — ให้วิ่งต่อ
                    </button>
                    <button onClick={() => act(r, "delete")} className="btn flex-1 py-2 text-sm border border-start/40 text-start">
                      ลบผลนี้
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <button onClick={exportCSV} disabled={!done.length} className="btn mt-2 bg-gold text-white">
        <IconDownload /> ดาวน์โหลด CSV (เปิดใน Excel ได้)
      </button>
    </div>
  );
}

function Stat({ label, value, tone = "", live }: { label: string; value: string; tone?: string; live?: boolean }) {
  return (
    <div className="card px-3 py-3 text-center">
      <div className={`flex items-center justify-center gap-1.5 font-display text-3xl font-semibold tabular ${tone}`}>
        {live && <span className="h-2 w-2 rounded-full bg-finish animate-pulse" />}
        {value}
      </div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
