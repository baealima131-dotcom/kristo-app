import { OfflineActivationPlaceholderScreen } from "@/src/components/offlineActivation/OfflineActivationPlaceholderScreen";

export default function SystemAdminScreen() {
  return (
    <OfflineActivationPlaceholderScreen
      route="system-admin"
      requiredRole="System_Admin"
      title="System Admin"
      subtitle="Full platform control • activation codes"
      accent="#9C76FF"
      sections={[
        "Subscription Activation Codes",
        "Supervisors",
        "Agents",
        "Code Activity",
      ]}
    />
  );
}
