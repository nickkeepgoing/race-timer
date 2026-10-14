// สถานการณ์ภาคสนาม: โรงเรียนบางละมุง สนามดิน ช่วง 15:00–17:00
// เครือข่ายของมือถือแต่ละเครื่องผ่าน "สายจำลอง" ที่ทำตัวเหมือน 4G จริงได้:
// หน่วง (ขาขึ้น/ขาลงไม่เท่ากัน), กระตุก, ตัดขาด, หรือเงียบหายทั้งที่ยังต่ออยู่
// (เดินออกนอกสัญญาณ) — แล้ววัดว่าเวลาที่ได้ยังถูก และไม่มีอะไรหาย
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { duration, finishHeats, fold, margin, toCSV, type Role } from "../src/race.ts";
import { Room } from "../src/room.ts";

const PORT = 20000 + Math.floor(Math.random() * 20000);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "race-field-"));
let relay: ChildProcess | null = null;
const cleanup: (() => void)[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function startRelay() {
  relay = spawn(process.execPath, ["server.js"], { env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA }, stdio: "ignore" });
  await until(async () => (await fetch(`http://127.0.0.1:${PORT}/health`).catch(() => null))?.ok === true, 10000);
}
async function stopRelay() {
  const r = relay;
  if (!r) return;
  relay = null;
  await new Promise((done) => {
    r.once("exit", done);
    r.kill();
  });
}

async function until(cond: () => boolean | Promise<boolean>, ms: number, what = "condition") {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error(`timed out after ${ms}ms waiting for ${what}`);
    await sleep(10);
  }
}

// ── the simulated mobile network ─────────────────────────────────────────
// Holds each chunk for up/down ms (+ jitter), keeping order as TCP does.
// blackhole = the phone walked out of coverage: the connection stays "open"
// but nothing gets through in either direction.
function mobileLink() {
  const net_ = { up: 0, down: 0, jitter: 0, blackhole: false };
  const pairs = new Set<net.Socket[]>();
  const server = net.createServer((phone) => {
    const tower = net.connect(PORT, "127.0.0.1");
    const pair = [phone, tower];
    pairs.add(pair);
    const pipe = (from: net.Socket, to: net.Socket, dir: "up" | "down") => {
      let last = 0;
      from.on("data", (buf) => {
        if (net_.blackhole) return;
        const at = Math.max(Date.now() + net_[dir] + Math.random() * net_.jitter, last);
        last = at;
        setTimeout(() => !to.destroyed && to.write(buf), at - Date.now());
      });
    };
    pipe(phone, tower, "up");
    pipe(tower, phone, "down");
    const kill = () => {
      phone.destroy();
      tower.destroy();
      pairs.delete(pair);
    };
    for (const s of pair) s.on("error", kill).on("close", kill);
  });
  server.listen(0, "127.0.0.1");
  cleanup.push(() => server.close());
  return {
    net: net_,
    url: () => {
      const a = server.address() as net.AddressInfo | null;
      return a ? `ws://127.0.0.1:${a.port}/ws` : "";
    },
    cut: () => pairs.forEach((p) => p.forEach((s) => s.destroy())),
  };
}

function memStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

async function phone(code: string, role: Role, link = mobileLink(), store = memStore()) {
  while (!link.url()) await sleep(5);
  const room = new Room(code, link.url(), role, store);
  room.open();
  cleanup.push(() => room.close());
  return { room, link, store };
}

const online = (...rs: Room[]) => until(() => rs.every((r) => r.status === "online" && r.acc !== null), 15000, "devices online");
const runnersOf = (r: Room) => fold(r.events.values()).flatMap((h) => h.runners);

before(startRelay);
after(async () => {
  cleanup.forEach((f) => f());
  await stopRelay();
});

test("F01 4G ช้าและขาขึ้น/ขาลงไม่เท่ากัน: เวลายังถูก และ ± ที่แสดงไม่โกหก", async () => {
  const s = await phone("BLM01", "start");
  const f = await phone("BLM01", "finish");
  // start line at the far end of the field: weak, lopsided 4G
  Object.assign(s.link.net, { up: 260, down: 90, jitter: 60 });
  Object.assign(f.link.net, { up: 70, down: 40, jitter: 30 });
  await online(s.room, f.room);
  await sleep(4000); // a few pings to settle the clock fix

  const T = Date.now();
  const ev = s.room.start(["ด.ช. ก้องภพ", "ด.ญ. ณัฐณิชา"], T);
  await until(() => f.room.events.has(ev.id), 3000, "heat at the finish line");
  f.room.stop(ev.runners[0].rid, T + 13_570); // a 13.57 s hundred metres
  await until(() => s.room.events.size === 2, 3000, "result back at the start");

  const r = runnersOf(s.room)[0];
  const err = Math.abs(duration(r) - 13_570);
  assert.ok(margin(r)! >= err, `error ${err}ms must be inside the shown ±${margin(r)}ms`);
  assert.ok(err < 120, `error ${err}ms on bad 4G`);
});

test("F02 เดินออกนอกสัญญาณ (ต่ออยู่แต่ไม่มีอะไรผ่าน) ระหว่างมีคนเข้าเส้น", async () => {
  const s = await phone("BLM02", "start");
  const f = await phone("BLM02", "finish");
  await online(s.room, f.room);
  const ev = s.room.start(["a", "b", "c"]);
  await until(() => f.room.events.has(ev.id), 3000, "heat at the finish line");

  f.link.net.blackhole = true;
  const taps = ev.runners.map((r, i) => f.room.stop(r.rid, Date.now() + i * 300));
  // must notice it's offline (not show "online" forever)
  await until(() => f.room.status !== "online", 20000, "finish phone to notice the dead link");
  await sleep(6000); // still out of coverage, and its reconnect attempts hang too
  f.link.net.blackhole = false;

  await until(() => taps.every((t) => s.room.events.has(t.id)), 20000, "taps to arrive after coverage returns");
  assert.equal(f.room.pending.size, 0);
  assert.deepEqual(runnersOf(s.room).map((r) => r.stop?.id), taps.map((t) => t.id));
});

test("F03 เน็ตตัดๆ ติดๆ 8 ครั้งระหว่างรอบเดียว", async () => {
  const s = await phone("BLM03", "start");
  const f = await phone("BLM03", "finish");
  await online(s.room, f.room);
  const ev = s.room.start(Array.from({ length: 8 }, (_, i) => `เลน ${i + 1}`));
  await until(() => f.room.events.has(ev.id), 3000, "heat at the finish line");
  for (const [i, r] of ev.runners.entries()) {
    f.room.stop(r.rid);
    (i % 2 ? s : f).link.cut();
    await sleep(150);
  }
  await until(() => runnersOf(s.room).every((r) => r.stop) && f.room.pending.size === 0, 20000, "all 8 results everywhere");
  assert.equal(JSON.stringify(fold(s.room.events.values())), JSON.stringify(fold(f.room.events.values())));
});

test("F04 เซิร์ฟเวอร์ Render ยังหลับตอนเปิดแอป ปล่อยตัวไปก่อนที่มันจะตื่น", async () => {
  await stopRelay(); // free tier asleep after a break between events
  const s = await phone("BLM04", "start");
  const f = await phone("BLM04", "finish");
  await sleep(500);
  const T = Date.now();
  const ev = s.room.start(["ก", "ข"], T); // fired before ever syncing
  assert.equal(ev.u, 1);
  await sleep(3000);
  await startRelay(); // wakes up
  await online(s.room, f.room);
  await until(() => f.room.events.has(ev.id), 10000, "heat to reach the finish line");
  f.room.stop(ev.runners[1].rid, T + 15_000);
  await until(() => runnersOf(s.room)[1].stop !== null, 5000, "result");
  assert.ok(Math.abs(duration(runnersOf(s.room)[1]) - 15_000) < 30);
});

test("F05 เข้าเส้นพร้อมกัน 8 คนใน 1 วินาที และครู 2 คนกดซ้อนกัน", async () => {
  const s = await phone("BLM05", "start");
  const f1 = await phone("BLM05", "finish");
  const f2 = await phone("BLM05", "finish");
  Object.assign(f2.link.net, { up: 120, down: 120, jitter: 80 });
  await online(s.room, f1.room, f2.room);
  const ev = s.room.start(Array.from({ length: 8 }, (_, i) => `n${i}`));
  await until(() => f1.room.events.has(ev.id) && f2.room.events.has(ev.id), 3000, "heat everywhere");

  const T = Date.now();
  const order = [3, 0, 5, 1, 7, 2, 6, 4];
  const first = order.map((lane, i) => f1.room.stop(ev.runners[lane].rid, T + i * 120).id);
  [3, 0, 5, 1].forEach((lane, i) => f2.room.stop(ev.runners[lane].rid, T + i * 120 + 40)); // second teacher, a bit late
  await until(() => s.room.events.size === 1 + 8 + 4, 8000, "all taps");

  const ranked = runnersOf(s.room).sort((a, b) => duration(a) - duration(b));
  assert.deepEqual(ranked.map((r) => r.lane - 1), order, "finish order = earliest taps");
  assert.deepEqual(ranked.map((r) => r.stop!.id), first, "earlier teacher's tap wins every time");
});

test("F06 กดผิดคน → แตะผิด → กดคนที่ถูก, และนิ้วเด้งกดซ้ำ", async () => {
  const s = await phone("BLM06", "start");
  const f = await phone("BLM06", "finish");
  await online(s.room, f.room);
  const ev = s.room.start(["ต้น", "ตาล"]);
  await until(() => f.room.events.has(ev.id), 3000, "heat");
  const T = Date.now();
  const wrong = f.room.stop(ev.runners[1].rid, T);
  f.room.undo(wrong.id);
  const right = f.room.stop(ev.runners[0].rid, T + 50);
  f.room.stop(ev.runners[0].rid, T + 90); // bounce
  await until(() => s.room.events.size === 5, 3000, "all events");
  const [ton, tan] = runnersOf(s.room);
  assert.equal(ton.stop!.id, right.id, "first tap counts, bounce ignored");
  assert.equal(tan.stop, null, "wrongly-tapped runner is running again");
});

test("F07 ออกตัวผิด: ยกเลิกรอบแล้วปล่อยใหม่ ไม่มีชื่อผีค้าง", async () => {
  const s = await phone("BLM07", "start");
  const f = await phone("BLM07", "finish");
  await online(s.room, f.room);
  const bad = s.room.start(["a", "b", "c", "d"]);
  await sleep(300);
  s.room.undo(bad.id);
  const rerun = s.room.start(["a", "b", "c", "d"]);
  await until(() => f.room.events.size === 3, 3000, "events");
  const heats = finishHeats(fold(f.room.events.values()));
  assert.equal(heats.length, 1);
  assert.equal(heats[0].id, rerun.id);
  assert.equal(heats[0].n, 1, "the re-run is still heat 1");
});

test("F08 เครื่องเส้นชัยรีเฟรช/ปิดแอปกลางการแข่ง แล้วเปิดกลับมากดต่อ", async () => {
  const s = await phone("BLM08", "start");
  const f = await phone("BLM08", "finish");
  await online(s.room, f.room);
  const ev = s.room.start(["a", "b"]);
  await until(() => f.room.events.has(ev.id), 3000, "heat");
  f.room.stop(ev.runners[0].rid);
  f.room.close(); // app closed
  const back = await phone("BLM08", "finish", f.link, f.store); // reopened
  assert.equal(runnersOf(back.room).filter((r) => !r.stop).length, 1, "still shows who is running, even before reconnecting");
  await online(back.room);
  back.room.stop(ev.runners[1].rid);
  await until(() => runnersOf(s.room).every((r) => r.stop), 3000, "both results");
});

test("F09 ทั้งบ่าย 40 รอบ × 8 คน: โน้ตบุ๊กประกาศผลเข้าทีหลังก็ได้ครบ และเครื่องไม่หน่วง", async () => {
  const s = await phone("BLM09", "start");
  const f = await phone("BLM09", "finish");
  await online(s.room, f.room);
  for (let h = 0; h < 40; h++) {
    const ev = s.room.start(Array.from({ length: 8 }, (_, i) => `ม.${1 + (h % 6)}/${1 + i} คนที่ ${i + 1}`));
    for (const [i, r] of ev.runners.entries()) if (i !== 7 || h % 10) f.room.stop(r.rid, ev.t + 12_000 + i * 400);
    if (h % 9 === 0) f.room.undo([...f.room.events.values()].filter((e) => e.type === "stop").at(-1)!.id);
  }
  await until(() => s.room.pending.size === 0 && f.room.pending.size === 0, 10000, "all sent");
  const board = await phone("BLM09", "results");
  await online(board.room);
  await until(() => board.room.events.size === s.room.events.size, 5000, "late laptop catches up");

  const t0 = performance.now();
  for (let i = 0; i < 20; i++) finishHeats(fold(board.room.events.values()));
  const ms = (performance.now() - t0) / 20;
  assert.ok(ms < 15, `fold of ${board.room.events.size} events takes ${ms.toFixed(1)}ms (phones ~5× slower)`);
  const rows = toCSV(runnersOf(board.room)).split("\r\n").length - 1;
  assert.ok(rows > 300, `${rows} results in the CSV`);
});

test("F10 นาฬิกามือถือเครื่องเส้นชัยตั้งผิดไป 7 นาที", async () => {
  const s = await phone("BLM10", "start");
  await online(s.room);
  const link = mobileLink();
  while (!link.url()) await sleep(5);
  // a real second process, so only *its* clock is wrong
  const finishPhone = spawn(process.execPath, ["--input-type=module", "-e", `
    const real = Date.now; const SKEW = 7 * 60 * 1000; Date.now = () => real() + SKEW;
    const { Room } = await import(${JSON.stringify(new URL("../src/room.ts", import.meta.url).href)});
    const room = new Room("BLM10", ${JSON.stringify(link.url())}, "finish", null);
    room.open();
    const wait = (f) => new Promise((ok) => { const id = setInterval(() => f() && (clearInterval(id), ok()), 5); });
    await wait(() => room.acc !== null && [...room.events.values()].some((e) => e.type === "start"));
    const ev = [...room.events.values()].find((e) => e.type === "start");
    await wait(() => real() >= ev.t + 11000);
    room.stop(ev.runners[0].rid, Date.now()); // its own (wrong) clock
    await wait(() => room.pending.size === 0);
    process.exit(0);
  `], { stdio: "inherit" });
  cleanup.push(() => finishPhone.kill());

  const ev = s.room.start(["ผิดนาฬิกา"]);
  await until(() => runnersOf(s.room)[0].stop !== null, 20000, "the skewed phone's result");
  const r = runnersOf(s.room)[0];
  assert.ok(Math.abs(duration(r) - 11_000) < 40, `11.00 s measured as ${duration(r)}ms despite a 7-minute clock error`);
  assert.equal(r.rid, ev.runners[0].rid);
});

test("F11 ชื่อภาษาไทยมีสระ/วรรณยุกต์ ชื่อยาว อีโมจิ ชื่อซ้ำในรอบเดียว", async () => {
  const s = await phone("BLM11", "start");
  const f = await phone("BLM11", "finish");
  await online(s.room, f.room);
  const names = ["ด.ญ. ณัฐณิชา ศรีสุวรรณ์", "ด.ช. สมชาย", "ด.ช. สมชาย", "🏃‍♀️ ทีมฟ้า", "ก".repeat(60), ""];
  const ev = s.room.start(names);
  await until(() => f.room.events.has(ev.id), 3000, "heat");
  const got = runnersOf(f.room);
  assert.deepEqual(got.slice(0, 4).map((r) => r.name), names.slice(0, 4), "names arrive exactly");
  assert.equal(got[4].name.length, 40, "very long names are cut to 40");
  assert.equal(got[5].name, "เลน 6", "a blank name becomes its lane");
  assert.notEqual(got[1].rid, got[2].rid, "two runners with the same name stay two runners");
});
