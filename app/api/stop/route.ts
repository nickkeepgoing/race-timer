import { NextRequest, NextResponse } from "next/server";
import { removeActive, addResult } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const stopTime = Date.now(); // server clock, same source as start
  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : null;

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
    durationMs: stopTime - active.startTime,
  };

  await addResult(result);
  return NextResponse.json({ result });
}
