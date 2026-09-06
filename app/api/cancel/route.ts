import { NextResponse } from "next/server";
import { setActive } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST() {
  await setActive(null);
  return NextResponse.json({ ok: true });
}
