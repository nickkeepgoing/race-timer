import { NextResponse } from "next/server";
import { getActives, storeBackend } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const storage = storeBackend();
  try {
    const active = await getActives();
    return NextResponse.json({ active, serverTime: Date.now(), storage });
  } catch {
    // A transient Redis error (e.g. rate limit) must not look like "no
    // runners". Return active:null so the client keeps its last good list
    // instead of wiping the timers.
    return NextResponse.json(
      { active: null, serverTime: Date.now(), storage, error: "storage_unavailable" },
      { status: 200 }
    );
  }
}
