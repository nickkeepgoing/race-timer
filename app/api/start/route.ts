import { NextRequest, NextResponse } from "next/server";
import { addActives, getActives } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Single server-clock timestamp shared by everyone in this batch, so a
  // mass ("gun") start gives every runner the exact same start time.
  const startTime = Date.now();
  const body = await req.json().catch(() => ({}));

  // Accept either { names: string[] } (mass start) or { name: string }
  // (single runner) for backwards compatibility.
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
