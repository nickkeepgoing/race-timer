import Link from "next/link";

const roles = [
  {
    href: "/start",
    title: "จุดเริ่ม",
    desc: "กดเมื่อนักวิ่งออกตัว — เริ่มได้หลายคนพร้อมกัน",
    accent: "text-pistol",
    ring: "group-hover:shadow-glow group-hover:border-pistol/40",
    icon: "🔫",
  },
  {
    href: "/stop",
    title: "เส้นชัย",
    desc: "แตะชื่อคนที่เข้าเส้นเพื่อหยุดเวลาของคนนั้น",
    accent: "text-finish",
    ring: "group-hover:shadow-glow-finish group-hover:border-finish/40",
    icon: "🏁",
  },
  {
    href: "/dashboard",
    title: "ผลการจับเวลา",
    desc: "ดูอันดับ เวลาทั้งหมด และดาวน์โหลด CSV",
    accent: "text-amber",
    ring: "group-hover:border-amber/40",
    icon: "🏆",
  },
];

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-16 gap-12">
      <div className="text-center animate-floatIn">
        <p className="uppercase tracking-[0.4em] text-[11px] text-amber/80 mb-4">
          ระบบจับเวลาสองจุด
        </p>
        <h1 className="font-display text-5xl sm:text-6xl font-bold text-lane tracking-tight">
          จับเวลา<span className="text-pistol">วิ่ง</span>
        </h1>
        <p className="text-chalk mt-4 max-w-sm mx-auto leading-relaxed">
          เลือกบทบาทของอุปกรณ์นี้ — จุดเริ่มกับเส้นชัยซิงก์เวลาผ่านเซิร์ฟเวอร์กลาง
          รองรับการจับเวลาหลายคนพร้อมกัน
        </p>
      </div>

      <div className="w-full max-w-sm flex flex-col gap-4">
        {roles.map((r, i) => (
          <Link
            key={r.href}
            href={r.href}
            style={{ animationDelay: `${i * 70}ms` }}
            className={`group card animate-floatIn tap-target rounded-2xl px-6 py-5 flex items-center gap-4 transition-all duration-200 active:scale-[0.98] ${r.ring}`}
          >
            <span className="text-3xl leading-none" aria-hidden>
              {r.icon}
            </span>
            <div className="min-w-0">
              <div className={`font-display text-2xl font-semibold ${r.accent}`}>
                {r.title}
              </div>
              <div className="text-sm text-chalk mt-0.5">{r.desc}</div>
            </div>
            <span className="ml-auto text-chalk/40 group-hover:text-lane transition-colors">
              →
            </span>
          </Link>
        ))}
      </div>

      <p className="text-chalk/40 text-xs text-center">
        เวลาอ้างอิงจากนาฬิกาเซิร์ฟเวอร์จุดเดียว — แม่นยำ ไม่ต้องกดพร้อมกัน
      </p>
    </main>
  );
}
