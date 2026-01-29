// app/dashboard/_components/VipPill.tsx
type Props = {
  label: string;
  value: string;
};

export default function VipPill({ label, value }: Props) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-black/40 px-3 py-1">
      <span className="text-white/60 text-xs">{label}</span>
      <span className="text-gold text-xs font-semibold">{value}</span>
    </div>
  );
}
