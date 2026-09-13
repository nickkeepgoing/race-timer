import { NextResponse } from "next/server";
import { getResults } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const results = await getResults();
    return NextResponse.json({ results });
  } catch {
    // Transient Redis error — return null so the client keeps its last
    // known leaderboard instead of showing an empty one.
    return NextResponse.json({ results: null }, { status: 200 });
  }
}
