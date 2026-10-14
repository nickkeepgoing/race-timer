import { useEffect, useRef, useState } from "react";
import { MAX_RUNNERS } from "./race.ts";
import type { TabProps } from "./RoomView.tsx";
import { Clock, IconX, LaneBadge, buzz, load, save, useTapTime, useTicker } from "./ui.tsx";

export function StartTab({ room, heats, toast }: TabProps) {
  const key = `rt:roster:${room.code}`;
  const [roster, setRoster] = useState<string[]>(() => load(key, []));
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const tap = useTapTime();
  useEffect(() => save(key, roster), [key, roster]);

  const live = heats.filter((h) => h.runners.some((r) => !r.stop));
  useTicker(live.length > 0, 50);
  const now = room.now();
  const nextHeat = heats.length + 1;
  const full = roster.length >= MAX_RUNNERS;

  const add = (names: string[]) => setRoster((r) => [...r, ...names].slice(0, MAX_RUNNERS));

  const commitDraft = () => {
    if (!draft.trim()) return;
    add([draft.trim()]);
    setDraft("");
    input.current?.focus();
  };

  const fire = () => {
    const at = tap.take("go");
    if (!roster.length) return;
    const names = roster;
    const ev = room.start(names, at);
    buzz(60);
    setRoster([]);
    toast({
      tone: "start",
      text: (
        <>
          ปล่อยตัว <b>รอบ {nextHeat}</b> แล้ว · {names.length} คน
        </>
      ),
      action: {
        label: "ยกเลิกรอบนี้",
        run: () => {
          room.undo(ev.id);
          setRoster(names);
        },
      },
    });
  };

  const cancel = (rids: string[], what: string) => {
    const ev = room.cancel(rids);
    toast({ text: `ยกเลิก${what}แล้ว`, action: { label: "เอาคืน", run: () => room.undo(ev.id) } });
  };

  return (
    <div className="flex flex-col gap-4">
      <Readiness finish={room.peers.finish} status={room.status} />

      <section className="card p-4 animate-rise">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-2xl font-extrabold italic">
            รอบที่ <span className="text-start">{nextHeat}</span>
          </h2>
          <span className="text-sm text-muted tabular">{roster.length} คน</span>
        </div>

        <div className="mt-3 flex gap-2">
          <input
            ref={input}
            value={draft}
            disabled={full}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commitDraft()}
            onPaste={(e) => {
              // A class list pasted from a spreadsheet becomes one runner per line.
              const lines = e.clipboardData.getData("text").split(/\r?\n|\t/).map((s) => s.trim()).filter(Boolean);
              if (lines.length < 2) return;
              e.preventDefault();
              add(lines);
            }}
            placeholder="ชื่อนักวิ่ง (วางรายชื่อหลายบรรทัดได้)"
            aria-label="ชื่อนักวิ่ง"
            className="min-w-0 flex-1 rounded-xl border border-line bg-paper px-4 py-3 placeholder:text-muted/70 focus:outline-none focus:border-ink"
          />
          <button onClick={commitDraft} disabled={!draft.trim() || full} className="btn bg-ink text-paper">
            เพิ่ม
          </button>
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          <button onClick={() => add([""])} disabled={full} className="chip hover:border-ink/40">
            + เลนว่าง
          </button>
          {roster.length < 8 && (
            <button onClick={() => add(Array(8 - roster.length).fill(""))} className="chip hover:border-ink/40">
              เติมให้ครบ 8 เลน
            </button>
          )}
          {roster.length > 0 && (
            <button onClick={() => setRoster([])} className="chip text-muted hover:text-start">
              ล้างรายชื่อ
            </button>
          )}
        </div>

        {roster.length > 0 && (
          <ol className="mt-3 flex flex-col gap-1.5 max-h-[36dvh] overflow-y-auto slim-scroll pr-1">
            {roster.map((name, i) => (
              <li key={i} className="flex items-center gap-2 animate-rise">
                <LaneBadge n={i + 1} size="sm" />
                <input
                  value={name}
                  onChange={(e) => setRoster((r) => r.map((x, j) => (j === i ? e.target.value : x)))}
                  placeholder={`เลน ${i + 1}`}
                  aria-label={`ชื่อเลน ${i + 1}`}
                  className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 placeholder:text-muted/60 hover:border-line focus:outline-none focus:border-ink"
                />
                <button
                  onClick={() => setRoster((r) => r.filter((_, j) => j !== i))}
                  className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:text-start"
                  aria-label={`ลบเลน ${i + 1}`}
                >
                  <IconX size={16} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      <button
        onPointerDown={tap.down("go")}
        onClick={fire}
        disabled={!roster.length}
        className="group relative overflow-hidden rounded-3xl bg-start text-white py-6 shadow-[0_14px_30px_-14px_rgb(var(--start))] active:scale-[0.985] transition disabled:opacity-30 disabled:shadow-none"
      >
        <span className="tartan absolute inset-0 opacity-25" aria-hidden />
        <span className="relative block font-display text-5xl font-extrabold italic leading-none">ปล่อยตัว!</span>
        <span className="relative mt-1 block text-sm text-white/85">
          {roster.length ? `${roster.length} คนออกตัวพร้อมกัน — เวลานับจากจังหวะที่นิ้วแตะ` : "เพิ่มรายชื่ออย่างน้อย 1 คน"}
        </span>
      </button>

      {live.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="px-1 text-xs font-semibold tracking-wider text-muted">กำลังวิ่ง</h2>
          {live
            .slice()
            .reverse()
            .map((h) => {
              const running = h.runners.filter((r) => !r.stop);
              return (
                <div key={h.id} className="card p-4 animate-rise">
                  <div className="flex items-center gap-3">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inset-0 rounded-full bg-start animate-ping2" />
                      <span className="relative h-2.5 w-2.5 rounded-full bg-start" />
                    </span>
                    <span className="font-display text-lg font-semibold">รอบ {h.n}</span>
                    <span className="text-xs text-muted">
                      เข้าเส้น {h.runners.length - running.length}/{h.runners.length}
                    </span>
                    <Clock ms={now - h.t} digits={1} className="ml-auto font-display text-3xl font-semibold text-start" />
                  </div>
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {running.map((r) => (
                      <li key={r.rid} className="flex items-center gap-1.5 rounded-lg border border-line pl-1 pr-0.5 py-0.5">
                        <LaneBadge n={r.lane} size="sm" tone="dim" />
                        <span className="max-w-[9rem] truncate text-sm">{r.name}</span>
                        <button
                          onClick={() => cancel([r.rid], r.name)}
                          className="h-7 w-7 grid place-items-center rounded text-muted hover:text-start"
                          aria-label={`ยกเลิก ${r.name}`}
                        >
                          <IconX size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => cancel(running.map((r) => r.rid), `รอบ ${h.n}`)}
                    className="mt-3 text-xs text-muted underline underline-offset-4 hover:text-start"
                  >
                    ยกเลิกทั้งรอบ (ออกตัวผิด)
                  </button>
                </div>
              );
            })}
        </section>
      )}
    </div>
  );
}

function Readiness({ finish, status }: { finish: number; status: string }) {
  if (status === "offline")
    return (
      <p className="rounded-xl border border-start/30 bg-start/10 px-4 py-2.5 text-sm">
        <b>ออฟไลน์</b> — ปล่อยตัวได้ตามปกติ เวลาถูกบันทึกในเครื่องแล้ว และจะส่งให้เครื่องอื่นเองเมื่อกลับมาออนไลน์
      </p>
    );
  if (status !== "online") return null;
  return finish > 0 ? (
    <p className="flex items-center gap-2 px-1 text-sm text-finish">
      <span className="h-2 w-2 rounded-full bg-finish" /> เส้นชัยพร้อม ({finish} เครื่อง)
    </p>
  ) : (
    <p className="rounded-xl border border-gold/40 bg-gold/10 px-4 py-2.5 text-sm">
      ยังไม่มีเครื่องที่เส้นชัย — ปล่อยตัวได้เลย เครื่องที่เปิดเส้นชัยทีหลังจะเห็นนักวิ่งทันที
    </p>
  );
}
