// app/dashboard/_components/QuickAction.tsx
import Link from "next/link";

type Props = {
  icon: string;
  title: string;
  subtitle: string;
  href: string;
};

export default function QuickAction({ icon, title, subtitle, href }: Props) {
  return (
    <Link
      href={href}
      className="vip-action group flex items-center justify-between gap-4"
    >
      <div className="flex items-center gap-3">
        <div className="vip-action-icon">{icon}</div>

        <div>
          <div className="font-semibold text-white">{title}</div>
          <div className="text-sm text-white/60">{subtitle}</div>
        </div>
      </div>

      <div className="text-gold/80 group-hover:text-gold text-xl">›</div>
    </Link>
  );
}
