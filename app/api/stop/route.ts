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

export async function POST(req: NextRequest) {
  const serverNow = Date.now();
  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : null;
  const stopTime = sanitizeTs(body.stopTime, serverNow);

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

  const result = {
    id: active.id,
    name: active.name,
    startTime: active.startTime,
    stopTime,
    durationMs: Math.max(0, stopTime - active.startTime),
  };

  await addResult(result);
  return NextResponse.json({ result });
}
