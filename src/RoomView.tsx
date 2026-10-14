import { useEffect, useState } from "react";
import { renderSVG } from "uqr";
import type { Heat, Role } from "./race.ts";
import type { Room } from "./room.ts";
import type { Recent } from "./Home.tsx";
import { StartTab } from "./StartTab.tsx";
import { FinishTab } from "./FinishTab.tsx";
import { ResultsTab } from "./ResultsTab.tsx";
import {
  IconBack,
  IconFinish,
  IconResults,
  IconShare,
  IconStart,
  IconX,
  ThemeToggle,
  Toast,
  go,
  load,
  save,
  useRoom,
  useToast,
  type ToastData,
} from "./ui.tsx";

export interface TabProps {
  room: Room;
  heats: Heat[];
  toast: (t: Omit<ToastData, "key">) => void;
}

const TABS: { role: Role; label: string; Icon: () => JSX.Element; on: string }[] = [
  { role: "start", label: "จุดเริ่ม", Icon: IconStart, on: "text-start" },
  { role: "finish", label: "เส้นชัย", Icon: IconFinish, on: "text-finish" },
  { role: "results", label: "ผล", Icon: IconResults, on: "text-gold" },
];

export function RoomView({ code, tab }: { code: string; tab: Role }) {
  const { room, heats } = useRoom(code, tab);
  const { toast, show, clear } = useToast();
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    const rest = load<Recent[]>("rt:recent", []).filter((r) => r.code !== code);
    save("rt:recent", [{ code, at: Date.now() }, ...rest].slice(0, 6));
  }, [code]);

  // A timing device must not dim and lock mid-race.
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    const get = () =>
      document.visibilityState === "visible" &&
      (navigator as any).wakeLock
        ?.request("screen")
        .then((l: typeof lock) => (lock = l))
        .catch(() => {});
    get();
    document.addEventListener("visibilitychange", get);
    return () => {
      document.removeEventListener("visibilitychange", get);
      lock?.release().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!room.error) return;
    show({ text: room.error, tone: "start" });
    room.error = null;
  });

  const Tab = { start: StartTab, finish: FinishTab, results: ResultsTab }[tab];

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur pt-[env(safe-area-inset-top)]">
        <div className="mx-auto max-w-3xl h-16 px-2 flex items-center gap-1.5">
          <button onClick={() => go(null)} className="h-10 w-10 grid place-items-center rounded-xl text-muted hover:text-ink" aria-label="กลับหน้าแรก">
            <IconBack />
          </button>
          <button
            onClick={() => setSharing(true)}
            className="bib h-11 rounded-lg border border-line pl-4 pr-3 flex items-center gap-2 hover:border-ink/40 transition"
            aria-label={`รหัสการแข่งขัน ${code} — แตะเพื่อชวนเครื่องอื่น`}
          >
            <span className="font-display text-xl font-semibold tracking-[0.25em]">{code}</span>
            <span className="text-muted">
              <IconShare />
            </span>
          </button>
          <div className="ml-auto">
            <StatusPill room={room} />
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 w-full mx-auto max-w-3xl px-4 pt-4 pb-[calc(96px+env(safe-area-inset-bottom))]">
        <Tab room={room} heats={heats} toast={show} />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto max-w-3xl grid grid-cols-3">
          {TABS.map(({ role, label, Icon, on }) => {
            const active = role === tab;
            const peers = room.peers[role];
            return (
              <button
                key={role}
                onClick={() => go(code, role)}
                aria-current={active ? "page" : undefined}
                className={`relative h-[68px] flex flex-col items-center justify-center gap-0.5 font-display text-sm transition ${
                  active ? on : "text-muted hover:text-ink"
                }`}
              >
                {active && <span className="absolute inset-x-6 top-0 h-[3px] rounded-b bg-current" />}
                <Icon />
                <span className="font-semibold">{label}</span>
                {peers > 0 && (
                  <span className="absolute top-2 right-[calc(50%-26px)] min-w-4 h-4 px-1 rounded-full bg-current text-[10px] leading-4 tabular">
                    <span className="text-paper">{peers}</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      <Toast toast={toast} onDone={clear} />
      {sharing && <ShareSheet code={code} tab={tab} onClose={() => setSharing(false)} />}
    </div>
  );
}

function StatusPill({ room }: { room: Room }) {
  const n = room.pending.size;
  const devices = room.peers.start + room.peers.finish + room.peers.results;
  const [dot, text] =
    room.status === "online"
      ? ["bg-finish", n ? `กำลังส่ง ${n}` : `ออนไลน์ · ${devices} เครื่อง`]
      : room.status === "connecting"
        ? ["bg-gold animate-pulse", "กำลังเชื่อมต่อ"]
        : ["bg-start", n ? `ออฟไลน์ · รอส่ง ${n}` : "ออฟไลน์"];
  return (
    <div className="flex flex-col items-end leading-tight" aria-live="polite">
      <span className="flex items-center gap-1.5 text-xs font-semibold">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {text}
      </span>
      <span className="text-[10px] text-muted tabular">
        {room.acc === null ? "ยังไม่ซิงก์เวลา" : `เวลาตรงกัน ±${room.acc}ms`}
      </span>
    </div>
  );
}

function ShareSheet({ code, tab, onClose }: { code: string; tab: Role; onClose: () => void }) {
  // The device showing this is usually the start line inviting the finish line.
  const [role, setRole] = useState<Role>(tab === "start" ? "finish" : tab);
  const [base, setBase] = useState(location.origin);
  const [lan, setLan] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  // A "localhost" link is useless to a phone; ask the relay for this
  // machine's wifi address instead.
  useEffect(() => {
    if (!local) return;
    fetch("/info")
      .then((r) => r.json())
      .then((d: { lan: string[] }) => {
        setLan(d.lan);
        if (d.lan[0]) setBase(d.lan[0]);
      })
      .catch(() => {});
  }, [local]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const link = `${base}/#/${code}/${role}`;
  const svg = renderSVG(link, { border: 1, blackColor: "#14120E", whiteColor: "#FFFFFF" });
  const stillLocal = /\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(link);

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center" role="dialog" aria-modal aria-label="ชวนเครื่องอื่นเข้าร่วม">
      <button className="absolute inset-0 bg-ink/50 animate-[rise_.2s_both]" onClick={onClose} aria-label="ปิด" />
      <div className="card relative w-full max-w-sm rounded-b-none sm:rounded-2xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] animate-rise">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-display text-xl font-semibold">ชวนเครื่องอื่นเข้าร่วม</h2>
            <p className="text-sm text-muted">สแกน QR หรือพิมพ์รหัสที่หน้าแรก</p>
          </div>
          <button onClick={onClose} className="h-9 w-9 -mr-2 grid place-items-center text-muted" aria-label="ปิด">
            <IconX />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-ink/5 p-1">
          {TABS.map((t) => (
            <button
              key={t.role}
              onClick={() => setRole(t.role)}
              className={`rounded-lg py-2 font-display text-sm font-semibold transition ${
                role === t.role ? `bg-card shadow ${t.on}` : "text-muted"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-4">
          <img
            src={`data:image/svg+xml,${encodeURIComponent(svg)}`}
            alt={`QR ของลิงก์ ${link}`}
            className="w-40 shrink-0 rounded-xl border border-line [image-rendering:pixelated]"
          />
          <div className="min-w-0">
            <div className="text-xs text-muted">รหัส</div>
            <div className="font-display text-4xl font-extrabold italic tracking-[0.15em]">{code}</div>
          </div>
        </div>

        {stillLocal && (
          <p className="mt-3 text-xs text-start">
            ลิงก์นี้เปิดได้เฉพาะเครื่องนี้ — ให้เปิดแอปจากที่อยู่ IP ของเครื่อง (ดูในหน้าต่างที่รันเซิร์ฟเวอร์)
          </p>
        )}

        {lan.length > 1 ? (
          // several network adapters: let the host pick the wifi the phones are on
          <select
            value={base}
            onChange={(e) => setBase(e.target.value)}
            aria-label="เลือกเครือข่าย"
            className="mt-3 w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs"
          >
            {lan.map((u) => (
              <option key={u} value={u}>
                {u}/#/{code}/{role}
              </option>
            ))}
          </select>
        ) : (
          <p className="mt-3 break-all rounded-lg bg-ink/5 px-3 py-2 text-xs text-muted">{link}</p>
        )}
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => {
              navigator.clipboard?.writeText(link).then(
                () => setCopied(true),
                () => prompt("คัดลอกลิงก์นี้", link),
              ) ?? prompt("คัดลอกลิงก์นี้", link);
            }}
            className="btn flex-1 border border-line"
          >
            {copied ? "คัดลอกแล้ว ✓" : "คัดลอกลิงก์"}
          </button>
          {"share" in navigator && (
            <button onClick={() => navigator.share({ title: `จับเวลาวิ่ง ${code}`, url: link }).catch(() => {})} className="btn flex-1 bg-ink text-paper">
              <IconShare /> แชร์
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
