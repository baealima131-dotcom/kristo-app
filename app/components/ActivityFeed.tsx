export default function ActivityFeed() {
  const items = [
    "New member joined",
    "Donation received",
    "Live stream scheduled",
    "Message sent",
  ];

  return (
    <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
      <h2 className="font-semibold mb-3">Recent Activity</h2>
      <ul className="space-y-2 text-sm text-gray-300">
        {items.map((item, i) => (
          <li key={i}>• {item}</li>
        ))}
      </ul>
    </div>
  );
}
