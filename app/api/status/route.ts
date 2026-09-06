import { NextResponse } from "next/server";
import { getActives } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const active = await getActives();
  return NextResponse.json({ active, serverTime: Date.now() });
}
