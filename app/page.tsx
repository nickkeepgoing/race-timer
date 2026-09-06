import Link from "next/link";

const roles = [
  {
    href: "/start",
    title: "จุดเริ่ม",
    desc: "กดเมื่อนักวิ่งออกตัว",
    color: "bg-pistol",
  },
  {
    href: "/stop",
    title: "เส้นชัย",
    desc: "กดเมื่อนักวิ่งถึงเส้น",
    color: "bg-finish",
  },
  {
    href: "/dashboard",
    title: "ผลการจับเวลา",
    desc: "ดูอันดับและเวลาทั้งหมด",
    color: "bg-amber text-track",
  },
];

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-16 gap-10">
      <div className="text-center">
        <p className="uppercase tracking-[0.3em] text-xs text-chalk mb-3">
          ระบบจับเวลาสองจุด
        </p>
        <h1 className="font-display text-4xl sm:text-5xl font-semibold text-lane">
          จับเวลาวิ่ง
        </h1>
        <p className="text-chalk mt-3 max-w-sm mx-auto">
          เลือกบทบาทของอุปกรณ์นี้ — เครื่องที่จุดเริ่มกับเส้นชัยจะซิงก์เวลากันผ่านเซิร์ฟเวอร์กลาง
        </p>
      </div>

      <div className="w-full max-w-sm flex flex-col gap-4">
        {roles.map((r) => (
          <Link
            key={r.href}
            href={r.href}
            className={`tap-target rounded-2xl px-6 py-6 ${r.color} shadow-lg shadow-black/30 active:scale-[0.98] transition-transform`}
          >
            <div className="font-display text-2xl font-semibold">{r.title}</div>
            <div className="text-sm opacity-80 mt-1">{r.desc}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
