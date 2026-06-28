import React from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  AnalyticsChip,
  ContactAvatar,
  DangerIconButton,
  GlassButton,
  GlassCard,
  GoldButton,
  SA_GOLD,
  SA_GREEN,
  SA_PURPLE,
} from "@/src/components/systemAdminSupervisorUi";
import type { SupervisorAgent } from "@/src/lib/offlineActivationSupervisorApi";
import {
  OFFLINE_ADMIN_MUTED as MUTED,
  OFFLINE_ADMIN_TEXT as TEXT,
} from "@/src/lib/offlineActivationAdminTheme";

export function AgentStatusBadge({ status }: { status: "active" | "inactive" }) {
  const active = status === "active";
  return (
    <View style={[styles.statusBadge, active ? styles.statusActive : styles.statusInactive]}>
      <Text style={styles.statusBadgeText}>{active ? "Active" : "Inactive"}</Text>
    </View>
  );
}

export function SupervisorAgentCard({
  agent,
  onAssign,
  onView,
  onEdit,
  onDelete,
}: {
  agent: SupervisorAgent;
  onAssign: () => void;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <GlassCard pad={0} style={styles.agentCard}>
      <View style={styles.agentCardInner}>
        <View style={styles.agentTop}>
          <ContactAvatar
            uri={agent.avatarUrl}
            name={agent.fullName}
            fallbackId={agent.phone}
            size={52}
            online={agent.status === "active"}
          />
          <View style={styles.agentHead}>
            <View style={styles.agentNameRow}>
              <Text style={styles.agentName} numberOfLines={1}>
                {agent.fullName}
              </Text>
              <AgentStatusBadge status={agent.status} />
            </View>
            <Text style={styles.agentPhone} numberOfLines={1}>
              {agent.phone}
            </Text>
          </View>
        </View>
        <View style={styles.agentStats}>
          <AnalyticsChip dotColor={SA_PURPLE} value={agent.stats.assignedCodes} label="Assigned" />
          <AnalyticsChip dotColor={SA_GOLD} value={agent.stats.remainingCodes} label="Remaining" />
          <AnalyticsChip dotColor={SA_GREEN} value={agent.stats.redeemedCodes} label="Redeemed" />
        </View>
      </View>
      <View style={styles.agentActions}>
        {agent.status === "active" ? <GoldButton label="Assign Codes" onPress={onAssign} compact /> : null}
        <GlassButton label="View" onPress={onView} compact />
        <GlassButton label="Edit" onPress={onEdit} compact />
        <DangerIconButton onPress={onDelete} size={32} />
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  agentCard: { overflow: "hidden" },
  agentCardInner: { paddingHorizontal: 10, paddingTop: 10, paddingBottom: 8, gap: 8 },
  agentTop: { flexDirection: "row", gap: 10 },
  agentHead: { flex: 1, minWidth: 0, gap: 3 },
  agentNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  agentName: { flex: 1, color: TEXT, fontSize: 16, fontWeight: "800" },
  agentPhone: { color: MUTED, fontSize: 12, fontWeight: "600" },
  agentStats: { flexDirection: "row", gap: 6 },
  agentActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.06)",
    backgroundColor: "rgba(0,0,0,0.10)",
  },
  statusBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statusActive: {
    backgroundColor: "rgba(110,231,168,0.12)",
    borderColor: "rgba(110,231,168,0.28)",
  },
  statusInactive: {
    backgroundColor: "rgba(251,191,36,0.10)",
    borderColor: "rgba(251,191,36,0.25)",
  },
  statusBadgeText: { color: MUTED, fontSize: 9, fontWeight: "800" },
});
