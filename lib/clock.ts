"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Estimates the offset between this device's clock and the server clock so
 * timestamps captured at the moment of a tap can be expressed on the
 * server's timeline — without the network round-trip inflating them.
 *
 * Uses Cristian's algorithm: for each probe, the true server time when the
 * response arrives is approximately serverTime + rtt/2 (assuming roughly
 * symmetric latency). We take several probes and keep the one with the
 * smallest round-trip, since that sample has the least uncertainty.
 */
export function useServerClock() {
  const offsetRef = useRef(0); // serverClock - deviceClock, in ms
  const [ready, setReady] = useState(false);
  const [accuracyMs, setAccuracyMs] = useState<number | null>(null);

  const calibrate = useCallback(async (probes = 5) => {
    let best: { offset: number; rtt: number } | null = null;
    for (let i = 0; i < probes; i++) {
      try {
        const t0 = Date.now();
        const res = await fetch("/api/time", { cache: "no-store" });
        const t1 = Date.now();
        const data = await res.json();
        if (typeof data.serverTime !== "number") continue;
        const rtt = t1 - t0;
        // server clock at the instant we received the response
        const offset = data.serverTime + rtt / 2 - t1;
        if (!best || rtt < best.rtt) best = { offset, rtt };
      } catch {
        // ignore this probe
      }
    }
    if (best) {
      offsetRef.current = best.offset;
      setAccuracyMs(Math.round(best.rtt / 2)); // worst-case sync error
      setReady(true);
    }
  }, []);

  useEffect(() => {
    calibrate();
    // Re-sync periodically to absorb clock drift over a long session.
    const id = setInterval(() => calibrate(3), 30000);
    return () => clearInterval(id);
  }, [calibrate]);

  // Current time on the server's timeline.
  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  return { serverNow, ready, accuracyMs, recalibrate: calibrate };
}
