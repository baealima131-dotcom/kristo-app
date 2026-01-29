// app/dashboard/_components/StatCard.tsx
type Props = {
  icon: string;
  value: string;
  label: string;
};

export default function StatCard({ icon, value, label }: Props) {
  return (
    <div className="vip-card">
      <div className="text-3xl">{icon}</div>

      <div className="mt-6">
        <div className="text-4xl font-semibold text-gold leading-none">
          {value}
        </div>
        <div className="mt-2 text-white/70">{label}</div>
      </div>
    </div>
  );
}
