// End-to-end: the real relay process + the real client sync code, several
// "devices" at once, including the relay dying, coming back, and coming back
// with its disk wiped.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fold, type Role, type StartEv } from "../src/race.ts";
import { Room } from "../src/room.ts";

const PORT = 20000 + Math.floor(Math.random() * 20000);
const URL_WS = `ws://127.0.0.1:${PORT}/ws`;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "race-timer-"));
let relay: ChildProcess | null = null;
const rooms: Room[] = [];

async function startRelay(dataDir: string) {
  relay = spawn(process.execPath, ["server.js"], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir }, stdio: "ignore" });
  await until(async () => (await fetch(`http://127.0.0.1:${PORT}/health`).catch(() => null))?.ok === true);
}

async function stopRelay() {
  const r = relay!;
  relay = null;
  await new Promise((done) => {
    r.once("exit", done);
    r.kill();
  });
}

async function until(cond: () => boolean | Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
}

function memStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

function device(code: string, role: Role, store = memStore()) {
  const room = new Room(code, URL_WS, role, store);
  rooms.push(room);
  room.open();
  return room;
}

const ready = (...rs: Room[]) => until(() => rs.every((r) => r.status === "online" && r.acc !== null));
const same = (...rs: Room[]) => rs.every((r) => JSON.stringify(fold(r.events.values())) === JSON.stringify(fold(rs[0].events.values())));

after(async () => {
  rooms.forEach((r) => r.close());
  if (relay) await stopRelay();
});

test("devices see each other in real time and agree on every result", async () => {
  await startRelay(tmp());
  const startDev = device("RACE1", "start");
  const finishDev = device("RACE1", "finish");
  const board = device("RACE1", "results");
  await ready(startDev, finishDev, board);
  assert.deepEqual(board.peers, { start: 1, finish: 1, results: 1 });
  assert.ok(startDev.acc! < 50, `clock sync ±${startDev.acc}ms on localhost`);

  const t0 = Date.now();
  const ev = startDev.start(["ก", "ข", "ค"]);
  await until(() => finishDev.events.has(ev.id));
  const pushMs = Date.now() - t0;
  assert.ok(pushMs < 250, `start reached the finish line in ${pushMs}ms`);
  assert.equal(startDev.pending.size, 0, "relay confirmed the start");

  // two finish volunteers tap the same runner; plus a mis-tap that is undone
  const second = device("RACE1", "finish");
  await ready(second);
  const rid = ev.runners[0].rid;
  finishDev.stop(rid, Date.now());
  second.stop(rid, Date.now() + 40);
  const oops = finishDev.stop(ev.runners[1].rid);
  finishDev.undo(oops.id);
  await until(() => board.events.size === 5 && same(startDev, finishDev, second, board));

  const runners = fold(board.events.values())[0].runners;
  assert.equal(runners[0].stop?.rid, rid);
  assert.equal(runners[1].stop, null, "undone stop → running again");
  assert.ok(runners[0].stop!.t - ev.t >= 0);
});

test("rooms are isolated and the relay rejects junk", async () => {
  const other = device("OTHER", "results");
  await ready(other);
  assert.equal(other.events.size, 0);

  const raw = new WebSocket(URL_WS);
  const replies: any[] = [];
  raw.onmessage = (m) => replies.push(JSON.parse(String(m.data)));
  await until(() => raw.readyState === 1);
  raw.send(JSON.stringify({ k: "hello", room: "OTHER", role: "start" }));
  raw.send("not json");
  raw.send(JSON.stringify({ k: "ev", ev: { id: "badbadbad1", type: "start", t: "soon", runners: [] } }));
  raw.send(JSON.stringify({ k: "ev", ev: { id: "evilevil01", type: "stop", t: Date.now(), rid: "abcdefgh12", acc: 3, extra: "<script>" } }));
  await until(() => replies.some((m) => m.k === "bad") && other.events.size === 1);
  const kept = [...other.events.values()][0] as unknown as Record<string, unknown>;
  assert.equal(kept.extra, undefined, "unknown fields are stripped");
  raw.close();
});

test("a tap with no network is kept, then delivered when the relay is back", async () => {
  const data = tmp();
  await stopRelay();
  await startRelay(data);
  const store = memStore();
  const startDev = device("RACE2", "start", store);
  const finishDev = device("RACE2", "finish");
  await ready(startDev, finishDev);

  await stopRelay();
  await until(() => startDev.status === "offline");
  const ev = startDev.start(["ออฟไลน์"]);
  assert.equal(startDev.pending.size, 1);

  // the page is reloaded while still offline: nothing is lost
  startDev.close();
  const reloaded = device("RACE2", "start", store);
  assert.ok(reloaded.events.has(ev.id));
  assert.equal(reloaded.pending.size, 1);

  await startRelay(data);
  await until(() => finishDev.events.has(ev.id) && reloaded.pending.size === 0);
  assert.ok(fs.readFileSync(path.join(data, "RACE2.jsonl"), "utf8").includes(ev.id), "persisted to disk");
});

test("two tabs sharing one browser's storage never erase each other's unsent taps", () => {
  const shared = memStore();
  const startTab = new Room("TABS1", URL_WS, "start", shared); // never opened = offline
  const resultsTab = new Room("TABS1", URL_WS, "results", shared);
  const ev = startTab.start(["x"]);
  resultsTab.cancel(["abcdefgh12"]); // the other tab saves its own view
  const reloaded = new Room("TABS1", URL_WS, "start", shared);
  assert.ok(reloaded.events.has(ev.id), "event survived the other tab's save");
  assert.ok(reloaded.pending.has(ev.id), "and is still queued for sending");
});

test("a relay that lost its disk is rebuilt by the devices", async () => {
  const startDev = rooms.find((r) => r.code === "RACE2" && r.status === "online")!;
  const before = JSON.stringify(fold(startDev.events.values()));
  await stopRelay();
  await startRelay(tmp()); // empty data dir
  await until(() => startDev.status === "online" && startDev.acc !== null);
  const newcomer = device("RACE2", "results");
  await until(() => newcomer.status === "online" && JSON.stringify(fold(newcomer.events.values())) === before);
});

test("a device that was never synced still gets correct times", async () => {
  const realNow = Date.now;
  const SKEW = 5000; // this "phone" runs 5s fast
  Date.now = () => realNow() + SKEW;
  try {
    const lonely = new Room("RACE3", URL_WS, "start", memStore());
    rooms.push(lonely);
    const tapped = realNow();
    const ev = lonely.start(["ยังไม่ซิงก์"]) as StartEv;
    assert.equal(ev.u, 1, "flagged as unsynced");

    lonely.open();
    const board = new Room("RACE3", URL_WS, "results", memStore());
    rooms.push(board);
    board.open();
    await until(() => board.events.has(ev.id));
    const got = board.events.get(ev.id) as StartEv;
    assert.equal(got.u, undefined);
    assert.ok(Math.abs(got.t - tapped) < 50, `relay time off by ${got.t - tapped}ms despite a ${SKEW}ms skew`);
  } finally {
    Date.now = realNow;
  }
});
