import { NextRequest, NextResponse } from "next/server";
import { getActive, setActive } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const existing = await getActive();
  if (existing) {
    return NextResponse.json(
      { error: "มีการจับเวลาที่ยังไม่จบอยู่แล้ว", active: existing },
      { status: 409 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "ไม่ระบุชื่อ";

  const run = {
    id: crypto.randomUUID(),
    name,
    startTime: Date.now(), // server clock — the single source of truth
  };

  await setActive(run);
  return NextResponse.json({ active: run });
}
