import Link from "next/link";

export default function DashboardPage() {
  return (
    <div>
      <h1 style={{ fontSize: 44, fontWeight: 900, marginBottom: 6 }}>Dashboard</h1>
      <div style={{ opacity: 0.8, marginBottom: 18 }}>Karibu ndani ya Kristo App 🙏</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
        <StatCard title="Total Members" value="50" subtitle="Believers connected" />
        <StatCard title="Active" value="42" subtitle="Active this month" />
        <StatCard title="This Week" value="+12" subtitle="New members" />
        <StatCard title="Engagement" value="78%" subtitle="Interactions & attendance" />
      </div>

      <h2 style={{ marginTop: 22, fontSize: 18, fontWeight: 800, opacity: 0.9 }}>Quick Actions</h2>

      <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
        <QuickLink href="/dashboard/posts" title="Latest Posts" subtitle="Sermon / Worship / Testimony" />
        <QuickLink href="/dashboard/church" title="Church" subtitle="Vitendo • Matukio • Ujumbe" />
        <QuickLink href="/dashboard/messages" title="Messages" subtitle="Inbox & conversations" />
        <QuickLink href="/dashboard/donate" title="Donate" subtitle="Toa sadaka & michango" />
        <QuickLink href="/dashboard/settings" title="Settings" subtitle="Account settings (Clerk)" />
      </div>

      <div style={{ opacity: 0.6, marginTop: 14, fontSize: 12 }}>
        VIP GOLD PURE ready. Next: connect real data + donation payments.
      </div>
    </div>
  );
}

function StatCard({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(255,255,255,0.03)",
        borderRadius: 16,
        padding: 14,
      }}
    >
      <div style={{ opacity: 0.8, fontSize: 12, fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: 34, fontWeight: 900, marginTop: 4 }}>{value}</div>
      <div style={{ opacity: 0.65, fontSize: 12 }}>{subtitle}</div>
    </div>
  );
}

function QuickLink({ href, title, subtitle }: { href: string; title: string; subtitle: string }) {
  return (
    <Link
      href={href}
      style={{
        display: "block",
        color: "inherit",
        textDecoration: "none",
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(255,255,255,0.03)",
        borderRadius: 14,
        padding: 14,
      }}
    >
      <div style={{ fontWeight: 900 }}>{title}</div>
      <div style={{ opacity: 0.7, fontSize: 12, marginTop: 2 }}>{subtitle}</div>
    </Link>
  );
}
