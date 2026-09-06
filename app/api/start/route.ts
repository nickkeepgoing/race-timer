import { NextRequest, NextResponse } from "next/server";
import { addActives, getActives } from "@/lib/store";

export const dynamic = "force-dynamic";

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

export async function POST(req: NextRequest) {
  const serverNow = Date.now();
  const body = await req.json().catch(() => ({}));

  // Single shared timestamp for the whole batch → a true mass ("gun") start.
  const startTime = sanitizeTs(body.startTime, serverNow);

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
    }));

  if (runs.length === 0) {
    return NextResponse.json(
      { error: "ยังไม่มีรายชื่อให้ปล่อยตัว" },
      { status: 400 }
    );
  }

  const active = await addActives(runs);
  return NextResponse.json({ started: runs, active });
}
