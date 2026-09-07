import { getActivesForPoll, getActives, storeBackend } from "@/lib/store";

export const dynamic = "force-dynamic";

// Server-Sent Events endpoint. Instead of the client polling every 1.5s, it
// holds one persistent connection here. We check Redis every 300ms server-side
// and push the diff immediately when the active list changes — so the finish
// device sees a new runner within ~300ms of the start tap instead of up to 1.5s.
//
// Vercel Hobby functions time out at 10s, so we auto-close at 9s and the
// client reconnects (EventSource does this automatically). On Pro the limit is
// 60s; raise the timeout constant below if you upgrade.
const CLOSE_AFTER_MS = 9000;
const POLL_INTERVAL_MS = 300;
const KEEPALIVE_INTERVAL_MS = 20000;

export async function GET() {
  const encoder = new TextEncoder();
  const storage = storeBackend();

  let closed = false;
  let dataInterval: ReturnType<typeof setInterval> | undefined;
  let keepaliveInterval: ReturnType<typeof setInterval> | undefined;
  let closeTimeout: ReturnType<typeof setTimeout> | undefined;

  const cleanup = () => {
    closed = true;
    clearInterval(dataInterval);
    clearInterval(keepaliveInterval);
    clearTimeout(closeTimeout);
  };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(chunk)); }
        catch { cleanup(); }
      };
      const push = (data: object) => send(`data: ${JSON.stringify(data)}\n\n`);
      const ping = () => send(": keepalive\n\n");

      // Fetch initial state — retry up to 3 times to survive a transient miss.
      let initial = null;
      for (let i = 0; i < 3 && initial === null; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 100));
        initial = await getActivesForPoll().catch(() => null);
      }
      const firstActive = initial ?? (await getActives().catch(() => []));
      push({ active: firstActive, serverTime: Date.now(), storage });
      let lastJson = JSON.stringify(firstActive);

      // Tight server-side poll: push only when the list actually changes.
      dataInterval = setInterval(async () => {
        if (closed) return;
        const active = await getActivesForPoll().catch(() => null);
        if (active === null) return; // uncertain read — skip this tick
        const json = JSON.stringify(active);
        if (json === lastJson) return;
        lastJson = json;
        push({ active, serverTime: Date.now(), storage });
      }, POLL_INTERVAL_MS);

      keepaliveInterval = setInterval(ping, KEEPALIVE_INTERVAL_MS);

      // Auto-close before Vercel kills the function; client reconnects instantly.
      closeTimeout = setTimeout(() => {
        cleanup();
        try { controller.close(); } catch { /* already closed */ }
      }, CLOSE_AFTER_MS);
    },
    cancel: cleanup,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // tell nginx/Vercel not to buffer the stream
    },
  });
}
