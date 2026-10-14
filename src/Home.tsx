import { useState } from "react";
import { CODE_RE, randomCode } from "./room.ts";
import { ThemeToggle, go, load } from "./ui.tsx";

export interface Recent {
  code: string;
  at: number;
}

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "เมื่อสักครู่";
  if (m < 60) return `${m} นาทีที่แล้ว`;
  if (m < 1440) return `${Math.round(m / 60)} ชม.ที่แล้ว`;
  return new Date(t).toLocaleDateString("th-TH", { day: "numeric", month: "short" });
};

export function Home() {
  const [code, setCode] = useState("");
  const recent = load<Recent[]>("rt:recent", []);
  const valid = CODE_RE.test(code);

  return (
    <main className="min-h-dvh flex flex-col">
      {/* the start of a running track, seen from the blocks */}
      <section className="tartan relative h-[46dvh] min-h-[300px] overflow-hidden text-white">
        <div className="absolute right-3 top-3 text-white/80 [&_button]:text-white/80">
          <ThemeToggle />
        </div>
        <div className="absolute inset-x-0 top-0 px-6 pt-[max(2.5rem,env(safe-area-inset-top))]">
          <p className="font-display text-sm tracking-[0.3em] text-white/85 animate-rise">RACE TIMER</p>
          <h1
            className="mt-2 font-display text-[clamp(3.5rem,17vw,6.5rem)] leading-[0.85] font-extrabold italic drop-shadow-[0_3px_0_rgba(0,0,0,0.18)] animate-rise"
            style={{ animationDelay: "60ms" }}
          >
            จับเวลา
            <br />
            วิ่ง
          </h1>
        </div>
        {/* painted lane numbers on the start line */}
        <div className="absolute inset-x-0 bottom-0 [perspective:340px]">
          <div className="h-1.5 bg-white/90" />
          <div className="grid grid-cols-4 [transform:rotateX(38deg)] origin-top">
            {[1, 2, 3, 4].map((n, i) => (
              <span
                key={n}
                className="text-center font-display font-extrabold italic text-6xl text-white/90 py-3 animate-rise"
                style={{ animationDelay: `${140 + i * 60}ms` }}
              >
                {n}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="relative -mt-6 mx-auto w-full max-w-md px-4 pb-10 flex-1">
        <div className="card p-5 animate-rise" style={{ animationDelay: "200ms" }}>
          <button onClick={() => go(randomCode())} className="btn w-full py-4 text-xl bg-ink text-paper">
            สร้างการแข่งขันใหม่ <span aria-hidden>→</span>
          </button>

          <div className="my-5 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" /> หรือเข้าร่วมด้วยรหัสจากอีกเครื่อง <span className="h-px flex-1 bg-line" />
          </div>

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) go(code);
            }}
          >
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
              placeholder="รหัส"
              aria-label="รหัสการแข่งขัน"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="bib min-w-0 flex-1 rounded-xl border border-line px-4 py-3 text-center font-display text-3xl font-semibold tracking-[0.35em] placeholder:tracking-normal placeholder:text-lg placeholder:text-muted/60 focus:outline-none focus:border-ink"
            />
            <button disabled={!valid} className="btn bg-start text-white px-5">
              เข้าร่วม
            </button>
          </form>
        </div>

        {recent.length > 0 && (
          <div className="mt-6 animate-rise" style={{ animationDelay: "260ms" }}>
            <h2 className="px-1 mb-2 text-xs font-semibold tracking-wider text-muted">การแข่งขันล่าสุดในเครื่องนี้</h2>
            <ul className="flex flex-col gap-2">
              {recent.map((r) => (
                <li key={r.code}>
                  <button
                    onClick={() => go(r.code)}
                    className="card w-full px-4 py-3 flex items-center gap-3 text-left hover:border-ink/40 transition"
                  >
                    <span className="font-display text-xl font-semibold tracking-[0.2em]">{r.code}</span>
                    <span className="text-xs text-muted">{ago(r.at)}</span>
                    <span className="ml-auto text-muted" aria-hidden>
                      →
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <ul className="mt-8 grid grid-cols-3 gap-2 text-center text-[11px] leading-snug text-muted">
          <li>
            <b className="block font-display text-base text-ink">ทุกเครื่อง</b>มือถือ แท็บเล็ต โน้ตบุ๊ก
          </li>
          <li>
            <b className="block font-display text-base text-ink">เรียลไทม์</b>เห็นกันทันทีทุกเครื่อง
          </li>
          <li>
            <b className="block font-display text-base text-ink">เน็ตหลุดได้</b>บันทึกในเครื่องก่อนเสมอ
          </li>
        </ul>
      </section>
    </main>
  );
}
