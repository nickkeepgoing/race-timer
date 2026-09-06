import { NextResponse } from "next/server";
import { getResults } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const results = await getResults();
  return NextResponse.json({ results });
}
