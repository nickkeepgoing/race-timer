// Everything a device does is an immutable event, and a race's state is a pure
// function of the *set* of events. Devices only ever exchange events they are
// missing, so arrival order, duplicates, late arrivals and stale reads cannot
// change the outcome — every device that holds the same events shows the same
// race. This replaces the old "read the shared state from the server" model,
// whose partial/empty reads were the source of vanishing runners.

export type Role = "start" | "finish" | "results";

// `t` is on the relay's timeline (device clock + measured offset). `acc` is the
// device's worst-case sync error at that moment, null when unknown. `u`/`lt`
// mark an event taken before this device ever synced: `lt` is the raw device
// clock, and `t` is filled in from it once the offset is known.
export interface StartEv {
  id: string;
  type: "start";
  t: number;
  acc: number | null;
  runners: { rid: string; name: string }[];
  u?: 1;
  lt?: number;
}
export interface StopEv {
  id: string;
  type: "stop";
  t: number;
  acc: number | null;
  rid: string;
  u?: 1;
  lt?: number;
}
export interface CancelEv {
  id: string;
  type: "cancel";
  rids: string[];
}
// Undo: voiding a start withdraws the heat, a stop puts the runner back on the
// clock, a cancel brings the runner back.
export interface VoidEv {
  id: string;
  type: "void";
  target: string;
}
export type Ev = StartEv | StopEv | CancelEv | VoidEv;

export interface Runner {
  rid: string;
  name: string; // never blank — unnamed runners are "เลน N"
  heat: number;
  lane: number;
  start: number;
  startAcc: number | null;
  stop: StopEv | null;
}

export interface Heat {
  id: string;
  n: number;
  t: number;
  runners: Runner[];
}

export const MAX_NAME = 40;
export const MAX_RUNNERS = 100;

const byTime = (a: { t: number; id: string }, b: { t: number; id: string }) =>
  a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function fold(events: Iterable<Ev>): Heat[] {
  const all = [...events];
  const voided = new Set<string>();
  for (const e of all) if (e.type === "void") voided.add(e.target);

  const cancelled = new Set<string>();
  const starts: StartEv[] = [];
  const stops: StopEv[] = [];
  for (const e of all) {
    if (voided.has(e.id)) continue;
    if (e.type === "start") starts.push(e);
    else if (e.type === "stop") stops.push(e);
    else if (e.type === "cancel") for (const r of e.rids) cancelled.add(r);
  }

  // Two volunteers may tap the same runner; the earlier tap is the finish.
  const stopOf = new Map<string, StopEv>();
  for (const s of stops.sort(byTime)) if (!stopOf.has(s.rid)) stopOf.set(s.rid, s);

  const heats: Heat[] = [];
  const seen = new Set<string>();
  for (const s of starts.sort(byTime)) {
    const n = heats.length + 1;
    const runners: Runner[] = [];
    s.runners.forEach((r, i) => {
      if (cancelled.has(r.rid) || seen.has(r.rid)) return;
      seen.add(r.rid);
      runners.push({
        rid: r.rid,
        name: r.name || `เลน ${i + 1}`,
        heat: n,
        lane: i + 1, // a physical lane: keeps its number when others are cancelled
        start: s.t,
        startAcc: s.acc,
        stop: stopOf.get(r.rid) ?? null,
      });
    });
    // A false start that was fully cancelled is not a heat; the re-run is.
    if (runners.length) heats.push({ id: s.id, n, t: s.t, runners });
  }
  return heats;
}

export const duration = (r: Runner) => (r.stop ? Math.max(0, r.stop.t - r.start) : 0);

// Worst case: both devices off by their full sync error in opposite
// directions. Unknown on both sides stays unknown rather than reading as ±0.
export function margin(r: Runner): number | null {
  if (!r.stop || (r.startAcc === null && r.stop.acc === null)) return null;
  return (r.startAcc ?? 0) + (r.stop.acc ?? 0);
}

// Rows on the finish screen must never move under a volunteer's thumb, so a
// heat leaves the screen only at a quiet moment: when a new heat starts onto an
// empty track (everyone earlier already finished or cancelled). Until then the
// last heats stay in place with their final times.
export function finishHeats(heats: Heat[]): Heat[] {
  let from = 0;
  for (let i = 1; i < heats.length; i++) {
    const t = heats[i].t;
    const clear = heats
      .slice(from, i)
      .every((h) => h.runners.every((r) => r.stop !== null && r.stop.t <= t));
    if (clear) from = i;
  }
  return heats.slice(from);
}

// Integer maths, truncating: a displayed time never runs ahead of the real one.
export function fmtTime(ms: number, digits = 2): string {
  const unit = 10 ** digits;
  const n = Math.floor((Math.max(0, ms) * unit) / 1000);
  const m = Math.floor(n / (60 * unit));
  const s = Math.floor(n / unit) % 60;
  const f = digits ? "." + String(n % unit).padStart(digits, "0") : "";
  return m ? `${m}:${String(s).padStart(2, "0")}${f}` : `${s}${f}`;
}

// Runner names are free text, so they can contain a comma, a quote or a
// newline. Quote every field and double embedded quotes (RFC 4180); prefix a
// leading = + - @ so spreadsheets read it as text, not a formula.
function csvCell(value: string | number): string {
  const s = String(value);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function toCSV(runners: Runner[]): string {
  const header = ["อันดับ", "ชื่อ", "รอบ", "เลน", "เวลา", "± (วินาที)", "เวลาเข้าเส้น"];
  const rows = runners
    .filter((r) => r.stop)
    .sort((a, b) => duration(a) - duration(b))
    .map((r, i) => {
      const m = margin(r);
      return [
        i + 1,
        r.name,
        r.heat,
        r.lane,
        fmtTime(duration(r)),
        m === null ? "" : (m / 1000).toFixed(2),
        new Date(r.stop!.t).toLocaleTimeString("th-TH"),
      ];
    });
  // CRLF: what Excel expects, harmless elsewhere.
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}
