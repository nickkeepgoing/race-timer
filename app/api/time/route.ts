import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Minimal, storage-free endpoint used purely to measure the offset between
// a device's clock and the server clock. Keeping it trivial makes the
// round-trip time a clean estimate of network latency.
export async function GET() {
  return NextResponse.json({ serverTime: Date.now() });
}
