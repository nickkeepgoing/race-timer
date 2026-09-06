import { NextResponse } from "next/server";
import { getActive, setActive, addResult } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST() {
  const active = await getActive();
  if (!active) {
    return NextResponse.json(
      { error: "ยังไม่มีการเริ่มจับเวลา" },
      { status: 409 }
    );
  }

  const stopTime = Date.now(); // server clock, same source as start
  const result = {
    id: active.id,
    name: active.name,
    startTime: active.startTime,
    stopTime,
    durationMs: stopTime - active.startTime,
  };

  await addResult(result);
  await setActive(null);

  return NextResponse.json({ result });
}
