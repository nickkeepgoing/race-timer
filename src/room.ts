import { MAX_NAME, type Ev, type Role, type StartEv, type StopEv } from "./race.ts";

// One device's live view of a race room. Local-first: every event is written to
// this device's storage before anything touches the network, so a tap is never
// lost to a dead spot or a reload. The relay is only a meeting point — on every
// (re)connect the device downloads the events it lacks and uploads the ones the
// relay lacks, so even a relay that lost its disk is rebuilt by the devices.

export type Status = "connecting" | "online" | "offline";
export type Peers = Record<Role, number>;

type ToRelay =
  | { k: "hello"; room: string; role: Role }
  | { k: "role"; role: Role }
  | { k: "ev"; ev: Ev }
  | { k: "ping"; c: number };
type FromRelay =
  | { k: "log"; events: Ev[] }
  | { k: "ev"; ev: Ev }
  | { k: "pong"; c: number; s: number }
  | { k: "peers"; peers: Peers }
  | { k: "bad"; id: string; reason: string };

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
export const CODE_RE = /^[A-Z0-9]{4,8}$/;

// crypto.randomUUID is secure-context only — it is missing when the app is
// opened over plain http on a LAN, so ids come from getRandomValues instead.
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));
export const randomCode = () => [...rand(4)].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
export const uid = () => [...rand(12)].map((b) => (b % 36).toString(36)).join("");

const PING_EVERY_MS = 4000;
const DEAD_AFTER_MS = 12000; // mobile networks drop sockets silently
const KEEP_SAMPLES = 8; // ~30s of pings: absorbs drift and clock steps
const SYNCED_AFTER = 3;

export class Room {
  events = new Map<string, Ev>();
  pending = new Set<string>(); // made here, not yet confirmed by the relay
  status: Status = "connecting";
  peers: Peers = { start: 0, finish: 0, results: 0 };
  acc: number | null = null; // ± ms of the clock fix; null = not synced yet
  error: string | null = null;
  version = 0;

  private offset = 0; // relay clock − device clock
  private samples: { off: number; rtt: number }[] = [];
  private ws: WebSocket | null = null;
  private relayHas = new Set<string>(); // per connection
  private dropped = new Set<string>(); // rejected by the relay
  private gotLog = false;
  private closed = true;
  private retry = 0;
  private lastMsg = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();

  readonly code: string;
  private url: string;
  private role: Role;
  private storage: Pick<Storage, "getItem" | "setItem"> | null;

  constructor(code: string, url: string, role: Role, storage: Room["storage"] = null) {
    this.code = code;
    this.url = url;
    this.role = role;
    this.storage = storage;
    try {
      const saved = JSON.parse(storage?.getItem(this.key) ?? "null");
      for (const ev of saved?.events ?? []) this.events.set(ev.id, ev);
      for (const id of saved?.pending ?? []) if (this.events.has(id)) this.pending.add(id);
    } catch {
      // unreadable storage: start empty, the relay has the rest
    }
  }

  private get key() {
    return `rt:room:${this.code}`;
  }

  // ── public API ─────────────────────────────────────────────────────────

  now = () => Date.now() + this.offset;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  open() {
    if (!this.closed) return;
    this.closed = false;
    this.heartbeat = setInterval(() => this.beat(), PING_EVERY_MS);
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.wake);
      document.addEventListener("visibilitychange", this.onVisible);
    }
    this.connect();
  }

  close() {
    this.closed = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.timers.forEach(clearTimeout);
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.wake);
      document.removeEventListener("visibilitychange", this.onVisible);
    }
    this.drop();
  }

  setRole(role: Role) {
    this.role = role;
    this.send({ k: "role", role });
  }

  // `at` is the raw device clock at the moment of the tap (pointerdown), so
  // neither React nor the network adds to the measured time.
  start(names: string[], at = Date.now()): StartEv {
    const runners = names.map((n) => ({ rid: uid(), name: n.trim().slice(0, MAX_NAME) }));
    return this.commit({ id: uid(), type: "start", runners, ...this.stamp(at) });
  }

  stop(rid: string, at = Date.now()): StopEv {
    return this.commit({ id: uid(), type: "stop", rid, ...this.stamp(at) });
  }

  cancel(rids: string[]) {
    return this.commit({ id: uid(), type: "cancel", rids });
  }

  undo(target: string) {
    return this.commit({ id: uid(), type: "void", target });
  }

  // ── events ─────────────────────────────────────────────────────────────

  private stamp(at: number) {
    const t = Math.round(at + this.offset);
    return this.acc === null ? { t, acc: null, u: 1 as const, lt: at } : { t, acc: this.acc };
  }

  private commit<E extends Ev>(ev: E): E {
    this.events.set(ev.id, ev);
    this.pending.add(ev.id);
    this.changed();
    this.flush();
    return ev;
  }

  // Events stamped before the first sync get their relay time now: the device
  // clock kept running, so raw time + the offset measured now is still right.
  private fixUnsynced() {
    for (const id of this.pending) {
      const ev = this.events.get(id);
      if (!ev || !("u" in ev) || ev.lt === undefined) continue;
      const fixed = { ...ev, t: Math.round(ev.lt + this.offset), acc: this.acc };
      delete fixed.u;
      delete fixed.lt;
      this.events.set(id, fixed);
    }
  }

  private flush() {
    if (!this.gotLog || this.acc === null) return;
    for (const ev of this.events.values()) if (!this.relayHas.has(ev.id)) this.send({ k: "ev", ev });
  }

  private learn(ev: Ev) {
    if (!this.events.has(ev.id) || this.pending.has(ev.id)) this.events.set(ev.id, ev);
    this.pending.delete(ev.id);
    this.relayHas.add(ev.id);
  }

  private changed(persist = true) {
    this.version++;
    if (persist) this.save();
    this.listeners.forEach((fn) => fn());
  }

  // Merge, never overwrite: two tabs of the same room in one browser share
  // this key, and a plain write from one would erase the other's unsent taps.
  private save() {
    try {
      const prev = JSON.parse(this.storage?.getItem(this.key) ?? "null");
      const events = new Map<string, Ev>((prev?.events ?? []).map((e: Ev) => [e.id, e]));
      for (const ev of this.events.values()) events.set(ev.id, ev);
      const pending = new Set<string>([...(prev?.pending ?? []), ...this.pending]);
      for (const id of this.relayHas) pending.delete(id);
      for (const id of this.dropped) events.delete(id), pending.delete(id);
      this.storage?.setItem(this.key, JSON.stringify({ events: [...events.values()], pending: [...pending] }));
    } catch {
      // storage full / unavailable: the relay still has everything
    }
  }

  // ── network ────────────────────────────────────────────────────────────

  private connect() {
    if (this.closed || this.ws) return;
    this.gotLog = false;
    this.relayHas = new Set();
    this.status = "connecting";
    this.changed(false);

    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.lastMsg = Date.now();
      this.send({ k: "hello", room: this.code, role: this.role });
      this.burst();
    };
    ws.onmessage = (m) => {
      this.lastMsg = Date.now();
      try {
        this.receive(JSON.parse(String(m.data)));
      } catch {
        // malformed frame: ignore
      }
    };
    ws.onclose = () => {
      if (this.ws === ws) this.lost();
    };
    ws.onerror = () => ws.close();
  }

  private receive(msg: FromRelay) {
    switch (msg.k) {
      case "log":
        for (const ev of msg.events) this.learn(ev);
        this.gotLog = true;
        this.status = "online";
        this.flush(); // upload whatever the relay is missing
        break;
      case "ev":
        this.learn(msg.ev);
        break;
      case "pong":
        this.clock(msg.c, msg.s);
        return this.changed(false);
      case "peers":
        this.peers = msg.peers;
        return this.changed(false);
      case "bad":
        // The relay will never accept it, so keeping it would only retry forever.
        this.events.delete(msg.id);
        this.pending.delete(msg.id);
        this.dropped.add(msg.id);
        this.error = msg.reason;
        break;
    }
    this.changed();
  }

  // NTP-style: the relay's clock at the moment the pong arrives is s + rtt/2.
  // The sample with the smallest round trip has the least uncertainty, so it
  // wins among the recent ones.
  private clock(c: number, s: number) {
    const t1 = Date.now();
    const rtt = t1 - c;
    this.samples.push({ off: s + rtt / 2 - t1, rtt });
    if (this.samples.length > KEEP_SAMPLES) this.samples.shift();
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.offset = best.off;
    if (this.acc === null && this.samples.length < SYNCED_AFTER) return;
    const first = this.acc === null;
    this.acc = Math.max(1, Math.ceil(best.rtt / 2));
    if (!first) return;
    this.fixUnsynced();
    this.save();
    this.flush();
  }

  private burst() {
    for (let i = 0; i < 5; i++) this.timers.push(setTimeout(() => this.ping(), i * 150));
  }

  private ping() {
    this.send({ k: "ping", c: Date.now() });
  }

  private beat() {
    if (!this.ws) return;
    if (this.ws.readyState === 1 && Date.now() - this.lastMsg > DEAD_AFTER_MS) this.lost();
    else this.ping();
  }

  private send(msg: ToRelay) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  private drop() {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onclose = ws.onmessage = ws.onopen = ws.onerror = null;
    try {
      ws.close();
    } catch {
      // already closed
    }
  }

  private lost() {
    this.drop();
    if (this.closed) return;
    this.status = "offline";
    this.peers = { start: 0, finish: 0, results: 0 }; // unknown until we're back
    this.changed(false);
    const delay = Math.min(5000, 300 * 2 ** this.retry++) * (0.75 + Math.random() / 2);
    this.timers.push(setTimeout(() => this.connect(), delay));
  }

  private wake = () => {
    if (this.ws) return;
    this.retry = 0;
    this.connect();
  };

  private onVisible = () => {
    if (document.visibilityState !== "visible") return;
    // A phone that slept may have had its clock adjusted: measure afresh.
    this.samples = [];
    if (this.ws?.readyState === 1) this.burst();
    else this.wake();
  };
}
