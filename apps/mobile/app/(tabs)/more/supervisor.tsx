import { OfflineActivationPlaceholderScreen } from "@/src/components/offlineActivation/OfflineActivationPlaceholderScreen";

export default function SupervisorScreen() {
  return (
    <OfflineActivationPlaceholderScreen
      route="supervisor"
      requiredRole="Supervisor"
      title="Supervisor"
      subtitle="Manage agents • distribute codes"
      accent="#5A9CFF"
      sections={[
        "My Code Batches",
        "My Agents",
        "Assign Codes to Agent",
        "Code Activity",
      ]}
    />
  );
}
