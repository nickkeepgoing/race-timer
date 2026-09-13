import { NextRequest, NextResponse } from "next/server";
import { removeActive, clearActives } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : null;

  // No id → cancel every running racer at once ("ยกเลิกทั้งหมด").
  if (!id) {
    await clearActives();
    return NextResponse.json({ ok: true });
  }

  await removeActive(id);
  return NextResponse.json({ ok: true });
}
