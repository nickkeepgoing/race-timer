import { test } from "node:test";
import assert from "node:assert/strict";
import { duration, finishHeats, fmtTime, fold, margin, toCSV, type Ev } from "../src/race.ts";

const start = (id: string, t: number, names: string[], acc: number | null = 5): Ev => ({
  id,
  type: "start",
  t,
  acc,
  runners: names.map((name, i) => ({ rid: `${id}r${i}`, name })),
});
const stop = (id: string, rid: string, t: number, acc: number | null = 7): Ev => ({ id, type: "stop", t, acc, rid });
const T = 1.8e12;

test("a stop gives duration and worst-case margin", () => {
  const [h] = fold([start("s1", T, ["ก", ""]), stop("x1", "s1r0", T + 12345)]);
  assert.equal(h.runners[0].name, "ก");
  assert.equal(h.runners[1].name, "เลน 2"); // blank → lane name
  assert.equal(duration(h.runners[0]), 12345);
  assert.equal(margin(h.runners[0]), 12);
  assert.equal(h.runners[1].stop, null);
  assert.equal(margin({ ...h.runners[0], startAcc: null, stop: { ...h.runners[0].stop!, acc: null } }), null);
});

test("arrival order and duplicates never change the outcome", () => {
  const evs: Ev[] = [
    start("s1", T, ["a", "b", "c"]),
    start("s2", T + 5000, ["d"]),
    stop("x1", "s1r1", T + 9000),
    stop("x2", "s1r1", T + 9500), // second volunteer, later tap
    { id: "c1", type: "cancel", rids: ["s1r2"] },
    stop("x3", "s2r0", T + 8000),
    { id: "v1", type: "void", target: "x3" },
  ];
  const want = JSON.stringify(fold(evs));
  for (let i = 0; i < 200; i++) {
    const shuffled = [...evs, ...evs.slice(0, 3)].sort(() => Math.random() - 0.5);
    assert.equal(JSON.stringify(fold(shuffled)), want);
  }
  const [h1, h2] = fold(evs);
  assert.equal(h1.runners.length, 2, "cancelled runner gone");
  assert.equal(h1.runners[1].stop?.id, "x1", "earliest tap wins");
  assert.equal(h2.runners[0].stop, null, "voided stop puts runner back on the clock");
});

test("undo: void a stop, a cancel, or a whole start", () => {
  const base = [start("s1", T, ["a", "b"]), stop("x1", "s1r0", T + 1000)];
  const undone = fold([...base, { id: "v1", type: "void", target: "x1" }, stop("x2", "s1r0", T + 2000)]);
  assert.equal(duration(undone[0].runners[0]), 2000, "a fresh stop after undo counts");

  const cancelled = [...base, { id: "c1", type: "cancel", rids: ["s1r1"] } as Ev];
  assert.equal(fold(cancelled)[0].runners.length, 1);
  assert.equal(fold([...cancelled, { id: "v2", type: "void", target: "c1" }])[0].runners.length, 2);

  // false start withdrawn: the re-run is heat 1, lanes keep their numbers
  const rerun = fold([start("s1", T, ["a"]), { id: "v3", type: "void", target: "s1" }, start("s2", T + 60000, ["a", "b"])]);
  assert.equal(rerun.length, 1);
  assert.equal(rerun[0].n, 1);
  const partial = fold([start("s1", T, ["a", "b", "c"]), { id: "c2", type: "cancel", rids: ["s1r0"] }]);
  assert.deepEqual(partial[0].runners.map((r) => r.lane), [2, 3]);
});

test("finish screen keeps rows in place until a heat starts onto an empty track", () => {
  const h1 = start("s1", T, ["a", "b"]);
  const h2 = start("s2", T + 10_000, ["c"]);
  // heat 2 starts while heat 1 still runs → both stay, even after heat 1 ends
  let heats = fold([h1, h2, stop("x1", "s1r0", T + 5000), stop("x2", "s1r1", T + 15_000)]);
  assert.deepEqual(finishHeats(heats).map((h) => h.n), [1, 2]);
  // everyone done, nothing new: last heats still shown with final times
  heats = fold([h1, h2, stop("x1", "s1r0", T + 5000), stop("x2", "s1r1", T + 15_000), stop("x3", "s2r0", T + 16_000)]);
  assert.deepEqual(finishHeats(heats).map((h) => h.n), [1, 2]);
  // heat 3 onto an empty track → the old heats leave
  const h3 = start("s3", T + 30_000, ["d"]);
  heats = fold([h1, h2, h3, stop("x1", "s1r0", T + 5000), stop("x2", "s1r1", T + 15_000), stop("x3", "s2r0", T + 16_000)]);
  assert.deepEqual(finishHeats(heats).map((h) => h.n), [3]);
  // a runner from heat 1 put back on the clock brings their heats back
  heats = fold([h1, h2, h3, stop("x2", "s1r1", T + 15_000), stop("x3", "s2r0", T + 16_000)]);
  assert.deepEqual(finishHeats(heats).map((h) => h.n), [1, 2, 3]);
});

test("fmtTime truncates and rolls into minutes", () => {
  assert.equal(fmtTime(0), "0.00");
  assert.equal(fmtTime(9999), "9.99");
  assert.equal(fmtTime(59_999), "59.99");
  assert.equal(fmtTime(60_000), "1:00.00");
  assert.equal(fmtTime(754_219, 1), "12:34.2");
  assert.equal(fmtTime(-5), "0.00");
  assert.equal(fmtTime(3_601_000, 0), "60:01");
});

test("CSV quotes names and defuses formulas", () => {
  const heats = fold([start("s1", T, ['=HYPERLINK("x")', 'a,"b"', "slow"]), stop("x1", "s1r0", T + 2000), stop("x2", "s1r1", T + 1000)]);
  const lines = toCSV(heats.flatMap((h) => h.runners)).split("\r\n");
  assert.equal(lines.length, 3, "unfinished runner left out");
  assert.match(lines[1], /^"1","a,""b""","1","2","1\.00","0\.01"/);
  assert.match(lines[2], /^"2","'=HYPERLINK\(""x""\)"/);
});
