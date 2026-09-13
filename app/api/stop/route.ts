import { NextRequest, NextResponse } from "next/server";
import { removeActive, addResult } from "@/lib/store";

export const dynamic = "force-dynamic";

// Accept a device-supplied stop time only if it is sane; otherwise use the
// server clock. Lets a calibrated finish device record the exact tap moment
// without network latency inflating the result.
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
  const id = typeof body.id === "string" ? body.id : null;
  const stopTime = sanitizeTs(body.stopTime, serverNow);
  // Sync accuracy of the finish device that sent this tap.
  const stopAccuracyMs = sanitizeAccuracy(body.accuracyMs);

  if (!id) {
    return NextResponse.json(
      { error: "ไม่ได้ระบุว่าจะหยุดใคร" },
      { status: 400 }
    );
  }

  const active = await removeActive(id);
  if (!active) {
    return NextResponse.json(
      { error: "รอบนี้ถูกหยุดหรือยกเลิกไปแล้ว" },
      { status: 409 }
    );
  }

  // Worst case: both devices are off by their full sync error, in opposite
  // directions. If neither side reported an accuracy we leave the margin out
  // entirely — an unknown margin must not read as "accurate to ±0".
  const startAccuracyMs = active.startAccuracyMs;
  const marginMs =
    startAccuracyMs === undefined && stopAccuracyMs === undefined
      ? undefined
      : (startAccuracyMs ?? 0) + (stopAccuracyMs ?? 0);

  const result = {
    id: active.id,
    name: active.name,
    startTime: active.startTime,
    stopTime,
    durationMs: Math.max(0, stopTime - active.startTime),
    ...(marginMs !== undefined ? { marginMs } : {}),
  };

  await addResult(result);
  return NextResponse.json({ result });
}
