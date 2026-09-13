import { NextRequest, NextResponse } from "next/server";
import { addActives, getActives } from "@/lib/store";

export const dynamic = "force-dynamic";

// How many runners may be on the clock at once. The README promises this
// figure; enforcing it here keeps a stuck roster (or a bad request) from
// filling the active hash with thousands of entries that every poll then has
// to read back.
const MAX_ACTIVE = 100;

// Accept a device-supplied timestamp only if it is sane (a finite number
// within a minute of the server clock). Otherwise fall back to the server's
// own clock. This lets calibrated devices remove network latency from the
// measurement while rejecting garbage / badly-skewed clients.
function sanitizeTs(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v) && Math.abs(v - fallback) <= 60000) {
    return Math.round(v);
  }
  return fallback;
}

// Accept a device-reported clock-sync accuracy (± ms) only if it is a sane,
// non-negative figure. Anything missing, negative, infinite or absurdly large
// becomes undefined, so a result carries no margin at all rather than a made-up
// one.
function sanitizeAccuracy(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 5000) {
    return Math.round(v);
  }
  return undefined;
}

export async function POST(req: NextRequest) {
  const serverNow = Date.now();
  const body = await req.json().catch(() => ({}));

  // Single shared timestamp for the whole batch → a true mass ("gun") start.
  const startTime = sanitizeTs(body.startTime, serverNow);

  // How well *this* start device is synced to the server clock. Every runner
  // released in this batch shares the same gun, so they share this figure too.
  const startAccuracyMs = sanitizeAccuracy(body.accuracyMs);

  // Accept either { names: string[] } (mass start) or { name: string }.
  const raw: unknown[] = Array.isArray(body.names)
    ? body.names
    : typeof body.name === "string"
      ? [body.name]
      : [];

  const existingCount = (await getActives()).length;

  const runs = raw
    .map((n) => (typeof n === "string" ? n.trim() : ""))
    .map((name, i) => ({
      id: crypto.randomUUID(),
      name: name || `นักวิ่ง ${existingCount + i + 1}`,
      startTime,
      startAccuracyMs,
    }));

  if (runs.length === 0) {
    return NextResponse.json(
      { error: "ยังไม่มีรายชื่อให้ปล่อยตัว" },
      { status: 400 }
    );
  }

  if (existingCount + runs.length > MAX_ACTIVE) {
    return NextResponse.json(
      {
        error: `ปล่อยตัวพร้อมกันได้สูงสุด ${MAX_ACTIVE} คน (ตอนนี้กำลังวิ่งอยู่ ${existingCount} คน)`,
      },
      { status: 400 }
    );
  }

  const active = await addActives(runs);
  return NextResponse.json({ started: runs, active });
}
