// Relay + static host in one Node process. Runs anywhere Node runs: a laptop on
// the field's wifi (no internet needed), a Raspberry Pi, a VPS, or any host
// that allows WebSockets (Render, Railway, Fly…). Not serverless: one process
// holds every room in memory, so reads are always complete and pushes are
// instant — the two things the old Vercel + Redis setup could not guarantee.
//
// The relay is deliberately dumb: it validates events, stores them, and fans
// them out. All race logic lives in the clients (src/race.ts).

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
const DIST = path.join(ROOT, "dist");
const DEV = process.argv.includes("--dev");

const ROOM_RE = /^[A-Z0-9]{4,8}$/;
const ID_RE = /^[a-z0-9]{8,32}$/;
const ROLES = ["start", "finish", "results"];
const MAX_EVENTS = 5000; // per room — a whole sports day is a few hundred
const MAX_RUNNERS = 100;
const MAX_NAME = 40;
const IDLE_MS = 20000; // clients ping every 4s; silence this long = dead socket

// ── validation: the trust boundary ───────────────────────────────────────
// Rebuild every event from checked fields only, so nothing a client invents
// gets stored or relayed.

const isId = (v) => typeof v === "string" && ID_RE.test(v);
const isTime = (v) => Number.isFinite(v) && v > 1.5e12 && v < Date.now() + 864e5;
const accOf = (v) => (Number.isFinite(v) && v >= 0 && v <= 60000 ? Math.round(v) : null);

function clean(e) {
  if (!e || typeof e !== "object" || !isId(e.id)) return null;
  const { id, type } = e;
  if (type === "start") {
    if (!isTime(e.t) || !Array.isArray(e.runners)) return null;
    if (e.runners.length < 1 || e.runners.length > MAX_RUNNERS) return null;
    const runners = [];
    for (const r of e.runners) {
      if (!r || !isId(r.rid) || typeof r.name !== "string") return null;
      runners.push({ rid: r.rid, name: r.name.trim().slice(0, MAX_NAME) });
    }
    return { id, type, t: Math.round(e.t), acc: accOf(e.acc), runners };
  }
  if (type === "stop") {
    if (!isTime(e.t) || !isId(e.rid)) return null;
    return { id, type, t: Math.round(e.t), acc: accOf(e.acc), rid: e.rid };
  }
  if (type === "cancel") {
    if (!Array.isArray(e.rids) || e.rids.length < 1 || e.rids.length > 500) return null;
    if (!e.rids.every(isId)) return null;
    return { id, type, rids: [...e.rids] };
  }
  if (type === "void") return isId(e.target) ? { id, type, target: e.target } : null;
  return null;
}

// ── rooms + persistence ──────────────────────────────────────────────────
// ponytail: every room lives in memory and in one append-only file. Fine for
// thousands of races; move to SQLite if one server ever hosts far more.

const rooms = new Map(); // code → { events: Map<id, ev>, sockets: Set<ws> }

function room(code) {
  let r = rooms.get(code);
  if (!r) rooms.set(code, (r = { events: new Map(), sockets: new Set() }));
  return r;
}

fs.mkdirSync(DATA_DIR, { recursive: true });
for (const f of fs.readdirSync(DATA_DIR)) {
  const code = f.replace(/\.jsonl$/, "");
  if (!ROOM_RE.test(code) || !f.endsWith(".jsonl")) continue;
  for (const line of fs.readFileSync(path.join(DATA_DIR, f), "utf8").split("\n")) {
    try {
      const ev = clean(JSON.parse(line));
      if (ev) room(code).events.set(ev.id, ev);
    } catch {
      // a torn last line from a crash: skip it, the devices still have it
    }
  }
}

function store(code, ev) {
  room(code).events.set(ev.id, ev);
  fs.appendFileSync(path.join(DATA_DIR, `${code}.jsonl`), JSON.stringify(ev) + "\n");
}

// ── http: static app + tiny helpers ──────────────────────────────────────

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".json": "application/json",
};

// Addresses other devices on the same wifi can open. Only told to a browser on
// this machine, which is the one that needs it (to show a usable share link).
// Virtual adapters (VMware, Hyper-V, WSL, Docker, VPNs) look like LAN
// addresses but no phone can reach them, so the real wifi goes first.
const VIRTUAL = /vmware|vethernet|virtual|vbox|wsl|docker|hyper-v|tailscale|zerotier|utun|bridge/i;
function lanUrls() {
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, addrs]) => (addrs ?? []).map((a) => ({ name, ...a })))
    .filter((a) => a.family === "IPv4" && !a.internal)
    .sort((a, b) => VIRTUAL.test(a.name) - VIRTUAL.test(b.name))
    .map((a) => `http://${a.address}:${PORT}`);
}

function serveStatic(req, res) {
  let rel;
  try {
    rel = path.normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  } catch {
    res.writeHead(400);
    return res.end();
  }
  rel = rel.replace(/^([\\/]|\.\.)+/, "");
  let file = path.join(DIST, rel);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, "index.html");
  }
  if (!fs.existsSync(file)) {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    return res.end("ยังไม่ได้ build — รัน npm run build ก่อน (หรือ npm run dev)");
  }
  const hashed = rel.startsWith("assets" + path.sep) || rel.startsWith("assets/");
  res.writeHead(200, {
    "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
    "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
  });
  fs.createReadStream(file).pipe(res);
}

let vite = null;
const server = http.createServer((req, res) => {
  if (req.url === "/health") return res.end("ok");
  if (req.url === "/info") {
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host ?? "");
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ lan: local ? lanUrls() : [] }));
  }
  if (vite) return vite.middlewares(req, res);
  serveStatic(req, res);
});

if (DEV) {
  const { createServer } = await import("vite");
  vite = await createServer({ server: { middlewareMode: true, hmr: { server } }, appType: "spa" });
}

// ── websocket relay ──────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/ws") wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  else if (!vite) socket.destroy(); // in dev, vite's HMR socket handles its own path
});

const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));

function peers(code) {
  const r = rooms.get(code);
  if (!r) return;
  const counts = { start: 0, finish: 0, results: 0 };
  for (const s of r.sockets) counts[s.role]++;
  for (const s of r.sockets) send(s, { k: "peers", peers: counts });
}

function leave(ws) {
  if (!ws.room) return;
  const r = rooms.get(ws.room);
  r?.sockets.delete(ws);
  if (r && !r.sockets.size && !r.events.size) rooms.delete(ws.room); // a probe, not a race
  else peers(ws.room);
  ws.room = null;
}

wss.on("connection", (ws) => {
  ws.room = null;
  ws.role = "results";
  ws.seen = Date.now();

  ws.on("message", (data) => {
    ws.seen = Date.now();
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (msg.k === "ping") return send(ws, { k: "pong", c: msg.c, s: Date.now() });

    if (msg.k === "hello") {
      if (typeof msg.room !== "string" || !ROOM_RE.test(msg.room)) return ws.close(1008, "bad room");
      leave(ws);
      ws.room = msg.room;
      ws.role = ROLES.includes(msg.role) ? msg.role : "results";
      const r = room(ws.room);
      r.sockets.add(ws);
      send(ws, { k: "log", events: [...r.events.values()] });
      return peers(ws.room);
    }
    if (!ws.room) return;

    if (msg.k === "role" && ROLES.includes(msg.role)) {
      ws.role = msg.role;
      return peers(ws.room);
    }
    if (msg.k === "ev") {
      const r = room(ws.room);
      const id = msg.ev?.id;
      // Already have it: just confirm to the sender (a resend after reconnect).
      if (r.events.has(id)) return send(ws, { k: "ev", ev: r.events.get(id) });
      const ev = clean(msg.ev);
      if (!ev) return send(ws, { k: "bad", id, reason: "ข้อมูลไม่ถูกต้อง" });
      if (r.events.size >= MAX_EVENTS) {
        return send(ws, { k: "bad", id, reason: "ห้องนี้ข้อมูลเต็มแล้ว — สร้างการแข่งขันใหม่" });
      }
      store(ws.room, ev);
      for (const s of r.sockets) send(s, { k: "ev", ev }); // includes the sender = ack
    }
  });

  ws.on("close", () => leave(ws));
});

const sweep = setInterval(() => {
  for (const ws of wss.clients) if (Date.now() - ws.seen > IDLE_MS) ws.terminate();
}, 5000);

server.on("error", (err) => {
  if (err.code !== "EADDRINUSE") throw err;
  console.error(`\n  พอร์ต ${PORT} มีโปรแกรมอื่นใช้อยู่ (อาจเป็นเซิร์ฟเวอร์ตัวนี้ที่เปิดค้างไว้อีกหน้าต่าง)`);
  console.error(`  ปิดตัวเดิมก่อน หรือใช้พอร์ตอื่น เช่น  PowerShell: $env:PORT=8788; npm run dev`);
  console.error(`                                     bash:       PORT=8788 npm run dev\n`);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`\n  จับเวลาวิ่ง — relay พร้อมแล้ว${DEV ? " (dev)" : ""}`);
  console.log(`  เครื่องนี้:      http://localhost:${PORT}`);
  for (const u of lanUrls()) console.log(`  WiFi เดียวกัน:  ${u}`);
  console.log(`  ข้อมูลเก็บที่:   ${DATA_DIR}\n`);
});

const shutdown = () => {
  clearInterval(sweep);
  wss.clients.forEach((ws) => ws.terminate());
  server.close(() => process.exit(0));
  vite?.close();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
