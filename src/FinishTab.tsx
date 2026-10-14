import { useEffect, useState } from "react";
import { duration, finishHeats, type Runner } from "./race.ts";
import type { TabProps } from "./RoomView.tsx";
import { Clock, IconUndo, LaneBadge, buzz, useTapTime, useTicker } from "./ui.tsx";

const UNDO_FOR_MS = 15000; // long enough to notice a mis-tap, short enough not to undo an old result

export function FinishTab({ room, heats }: TabProps) {
  const shown = finishHeats(heats);
  const total = shown.reduce((n, h) => n + h.runners.length, 0);
  const running = shown.reduce((n, h) => n + h.runners.filter((r) => !r.stop).length, 0);
  // 8 lanes must fit one phone screen: scrolling mid-finish is how taps go astray
  const compact = total > 6;
  const [last, setLast] = useState<{ rid: string; id: string; name: string; ms: number } | null>(null);
  const tap = useTapTime();
  useTicker(running > 0, 100);
  const now = room.now();

  useEffect(() => {
    if (!last) return;
    const id = setTimeout(() => setLast(null), UNDO_FOR_MS);
    return () => clearTimeout(id);
  }, [last]);

  const stop = (r: Runner) => {
    const at = tap.take(r.rid);
    if (r.stop) return;
    const ev = room.stop(r.rid, at);
    buzz(30);
    setLast({ rid: r.rid, id: ev.id, name: r.name, ms: ev.t - r.start });
  };

  if (!shown.length) {
    return (
      <div className="pt-16 text-center animate-rise">
        <div className="mx-auto h-20 w-20 rounded-full border-4 border-dashed border-line grid place-items-center">
          <span className="h-3 w-3 rounded-full bg-finish animate-pulse" />
        </div>
        <h2 className="mt-5 font-display text-2xl font-semibold">รอสัญญาณปล่อยตัว…</h2>
        <p className="mt-1 text-sm text-muted">นักวิ่งจะขึ้นที่นี่ทันทีที่จุดเริ่มกดปล่อยตัว</p>
        <p className={`mt-4 chip ${room.peers.start ? "text-finish border-finish/40" : "text-muted"}`}>
          {room.peers.start ? `จุดเริ่มเชื่อมต่ออยู่ (${room.peers.start} เครื่อง)` : "ยังไม่มีเครื่องที่จุดเริ่ม"}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="font-display text-2xl font-extrabold italic">แตะเมื่อเข้าเส้น</h2>
        <span className="text-sm text-muted tabular">{running ? `${running} คนกำลังวิ่ง` : "ทุกคนเข้าเส้นแล้ว"}</span>
      </div>

      {/* The undo for a mis-tap lives in a fixed slot up here, never floating
          over the list — a toast at the bottom covered the last lanes' stop
          buttons exactly when the next runners were crossing. */}
      <div className="card h-[52px] shrink-0 px-3 flex items-center gap-2.5" aria-live="polite">
        {last ? (
          <>
            <span className="h-2 w-2 shrink-0 rounded-full bg-finish" />
            <span className="min-w-0 truncate font-display font-semibold">{last.name}</span>
            <Clock ms={last.ms} className="font-display text-xl font-semibold text-finish" />
            <button
              onClick={() => {
                room.undo(last.id);
                setLast(null);
              }}
              className="btn ml-auto shrink-0 px-3 py-2 text-sm bg-ink text-paper"
            >
              <IconUndo /> แตะผิด
            </button>
          </>
        ) : (
          <span className="text-sm text-muted">แตะทั้งแถวเมื่อนักวิ่งเข้าเส้น · กดผิดแก้ได้ที่นี่</span>
        )}
      </div>

      {/* Fixed slots: rows keep lane order and never leave while anyone runs,
          so the row under a volunteer's thumb is always the one they meant. */}
      {shown.map((h) => (
        <section key={h.id}>
          <h3 className="mb-2 px-1 text-xs font-semibold tracking-wider text-muted">รอบ {h.n}</h3>
          <ul className={`grid sm:grid-cols-2 ${compact ? "gap-2" : "gap-2.5"}`}>
            {h.runners.map((r) => (
              <li key={r.rid}>
                {r.stop ? (
                  <div
                    className={`relative card ${compact ? "h-[60px]" : "h-[84px]"} overflow-hidden px-3 flex items-center gap-3 border-finish/30 bg-finish/[0.07] ${
                      r.rid === last?.rid ? "ring-2 ring-finish" : ""
                    }`}
                  >
                    {r.rid === last?.rid && <span key={r.stop.id} className="absolute inset-0 bg-finish/40 animate-flash" aria-hidden />}
                    <LaneBadge n={r.lane} tone="finish" />
                    <div className="min-w-0 flex-1">
                      <div className={`truncate font-display font-semibold ${compact ? "text-base leading-tight" : "text-lg"}`}>{r.name}</div>
                      <Clock ms={duration(r)} className={`font-display font-semibold text-finish ${compact ? "text-2xl leading-none" : "text-3xl"}`} />
                    </div>
                    <span className="shrink-0 w-[84px] text-center text-sm font-semibold text-finish">✓ เข้าเส้น</span>
                  </div>
                ) : (
                  <button
                    onPointerDown={tap.down(r.rid)}
                    onClick={() => stop(r)}
                    className={`group card ${compact ? "h-[60px]" : "h-[84px]"} w-full overflow-hidden pl-3 flex items-center gap-3 text-left hover:border-finish/50 active:scale-[0.985] transition`}
                  >
                    <LaneBadge n={r.lane} />
                    <div className="min-w-0 flex-1">
                      <div className={`truncate font-display font-semibold ${compact ? "text-base leading-tight" : "text-lg"}`}>{r.name}</div>
                      <Clock ms={now - r.start} digits={1} className={`font-display text-muted ${compact ? "text-2xl leading-none" : "text-3xl"}`} />
                    </div>
                    <span
                      className={`h-full w-[92px] shrink-0 grid place-items-center bg-finish font-display font-extrabold italic text-white group-active:brightness-110 ${
                        compact ? "text-xl" : "text-2xl"
                      }`}
                    >
                      หยุด
                    </span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
