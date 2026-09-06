import { NextRequest, NextResponse } from "next/server";
import { addActive } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : "ไม่ระบุชื่อ";

  const run = {
    id: crypto.randomUUID(),
    name,
    startTime: Date.now(), // server clock — the single source of truth
  };

  const active = await addActive(run);
  return NextResponse.json({ run, active });
}
