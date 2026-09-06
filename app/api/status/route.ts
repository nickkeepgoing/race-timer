import { NextResponse } from "next/server";
import { getActive } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const active = await getActive();
  return NextResponse.json({ active, serverTime: Date.now() });
}
