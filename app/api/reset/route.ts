import { NextResponse } from "next/server";
import { clearResults } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST() {
  await clearResults();
  return NextResponse.json({ ok: true });
}
