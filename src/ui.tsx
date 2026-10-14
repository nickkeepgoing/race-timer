import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { fmtTime, fold, type Role } from "./race.ts";
import { Room } from "./room.ts";

// ── storage ──────────────────────────────────────────────────────────────

export const storage = (() => {
  try {
    localStorage.setItem("rt:probe", "1");
    return localStorage;
  } catch {
    return null; // private mode / blocked: the app still works, just not across reloads
  }
})();

export function load<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(storage?.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // full / unavailable: not fatal
  }
}

// ── routing: #/CODE/tab — works on any static host, no rewrites needed ─────

export type Route = { code: string | null; tab: Role };

function parse(): Route {
  const m = /^#\/([A-Z0-9]{4,8})(?:\/(start|finish|results))?/.exec(location.hash);
  return { code: m?.[1] ?? null, tab: (m?.[2] as Role) ?? "start" };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export const go = (code: string | null, tab?: Role) =>
  (location.hash = code ? `#/${code}${tab ? `/${tab}` : ""}` : "#/");

// ── room ─────────────────────────────────────────────────────────────────

// The relay lives next to the page unless the build says otherwise, so the UI
// can also be put on any static host pointing at a relay elsewhere.
const relayUrl = () =>
  import.meta.env.VITE_RELAY_URL ?? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

export function useRoom(code: string, role: Role) {
  const room = useMemo(() => new Room(code, relayUrl(), role, storage), [code]);
  useEffect(() => {
    room.open();
    return () => room.close();
  }, [room]);
  useEffect(() => room.setRole(role), [room, role]);
  const version = useSyncExternalStore(room.subscribe, () => room.version);
  const heats = useMemo(() => fold(room.events.values()), [room, version]);
  return { room, heats };
}

// Re-render on an interval while something is ticking.
export function useTicker(active: boolean, ms = 50) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(tick, ms);
    return () => clearInterval(id);
  }, [active, ms]);
}

// A tap's moment is when the finger lands (pointerdown), not when it lifts
// (click) — that is 80-150ms earlier. The click still decides whether it was a
// tap at all, so a scroll that started on a button never counts.
// The event's own timeStamp says when the touch happened, so a slow phone busy
// redrawing doesn't delay the reading; only the (short, monotonic) gap is used,
// never performance time as a wall clock.
export function useTapTime() {
  const down = useRef<{ key: string; at: number } | null>(null);
  return {
    down: (key: string) => (e: { timeStamp: number }) => {
      const ago = performance.now() - e.timeStamp;
      down.current = { key, at: Date.now() - (ago >= 0 && ago < 1000 ? ago : 0) };
    },
    take: (key: string) => {
      const d = down.current;
      down.current = null;
      return d && d.key === key && Date.now() - d.at < 1500 ? d.at : Date.now();
    },
  };
}

export const buzz = (ms = 25) => navigator.vibrate?.(ms);

// ── visuals ──────────────────────────────────────────────────────────────

export function Clock({ ms, digits = 2, className = "" }: { ms: number; digits?: number; className?: string }) {
  const text = fmtTime(ms, digits);
  return (
    <span className={`digits tabular ${className}`} aria-label={text}>
      {[...text].map((c, i) =>
        /\d/.test(c) ? (
          <span key={i} className="d" aria-hidden>
            {c}
          </span>
        ) : (
          <span key={i} aria-hidden className="opacity-60">
            {c}
          </span>
        ),
      )}
    </span>
  );
}

const BADGE = {
  ink: "bg-ink text-paper",
  start: "bg-start text-white",
  finish: "bg-finish text-white",
  dim: "bg-ink/10 text-muted",
};

export function LaneBadge({ n, tone = "ink", size = "md" }: { n: number; tone?: keyof typeof BADGE; size?: "sm" | "md" }) {
  const s = size === "sm" ? "h-7 min-w-7 text-sm" : "h-11 min-w-11 text-xl";
  return (
    <span className={`${s} ${BADGE[tone]} shrink-0 rounded-lg px-1 grid place-items-center font-display font-bold italic tabular`}>
      {n}
    </span>
  );
}

export interface ToastData {
  key: number;
  text: ReactNode;
  tone?: "finish" | "start" | "ink";
  action?: { label: string; run: () => void };
  ms?: number;
}

// One transient message at a time, pinned above the tab bar so it never pushes
// rows around. An undo action beats a confirm dialog: nothing blocks the next tap.
export function Toast({ toast, onDone }: { toast: ToastData | null; onDone: () => void }) {
  const ms = toast?.ms ?? 6000;
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(onDone, ms);
    return () => clearTimeout(id);
  }, [toast, ms, onDone]);
  if (!toast) return null;
  const tone = { finish: "border-finish/40", start: "border-start/40", ink: "border-line" }[toast.tone ?? "ink"];
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-30 flex justify-center px-4">
      <div
        key={toast.key}
        role="status"
        className={`pointer-events-auto card ${tone} relative w-full max-w-md overflow-hidden px-4 py-3 flex items-center gap-3 animate-rise`}
      >
        <div className="flex-1 min-w-0 text-sm">{toast.text}</div>
        {toast.action && (
          <button
            onClick={() => {
              toast.action!.run();
              onDone();
            }}
            className="btn shrink-0 px-3 py-2 text-sm bg-ink text-paper"
          >
            <IconUndo /> {toast.action.label}
          </button>
        )}
        <span
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-ink/30 animate-shrink"
          style={{ animationDuration: `${ms}ms` }}
        />
      </div>
    </div>
  );
}

export function useToast() {
  const [toast, setToast] = useState<ToastData | null>(null);
  const show = (t: Omit<ToastData, "key">) => setToast({ ...t, key: Date.now() });
  const clear = useMemo(() => () => setToast(null), []);
  return { toast, show, clear };
}

// ── icons (inline, so they render identically on every platform) ──────────

const I = ({ children, size = 20 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);
export const IconStart = () => (
  <I>
    <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
  </I>
);
export const IconFinish = () => (
  <I>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2.5 2.5M10 2h4" />
  </I>
);
export const IconResults = () => (
  <I>
    <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" />
  </I>
);
export const IconBack = () => (
  <I>
    <path d="M15 18l-6-6 6-6" />
  </I>
);
export const IconX = ({ size = 18 }: { size?: number }) => (
  <I size={size}>
    <path d="M18 6 6 18M6 6l12 12" />
  </I>
);
export const IconUndo = () => (
  <I size={16}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
  </I>
);
export const IconShare = () => (
  <I size={18}>
    <path d="M12 3v13M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
  </I>
);
export const IconTheme = () => (
  <I size={18}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </I>
);
export const IconDownload = () => (
  <I size={18}>
    <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
  </I>
);

export function ThemeToggle() {
  return (
    <button
      onClick={() => {
        const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        try {
          storage?.setItem("rt:theme", next); // raw, read by the script in index.html
        } catch {
          // not remembered across reloads: fine
        }
      }}
      className="h-10 w-10 grid place-items-center rounded-xl text-muted hover:text-ink transition"
      aria-label="สลับโหมดสว่าง/มืด"
      title="สลับโหมดกลางแจ้ง / กลางคืน"
    >
      <IconTheme />
    </button>
  );
}
