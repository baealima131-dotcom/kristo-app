import { OfflineActivationPlaceholderScreen } from "@/src/components/offlineActivation/OfflineActivationPlaceholderScreen";

export default function AgentScreen() {
  return (
    <OfflineActivationPlaceholderScreen
      route="agent"
      requiredRole="Agent"
      title="Agent"
      subtitle="Deliver codes • church activation"
      accent="#2DD4BF"
      sections={["My Codes", "Deliver Code to Church", "Redeemed / Delivered History"]}
    />
  );
}
