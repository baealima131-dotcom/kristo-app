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

function agentStatusLabel(status: SupervisorAgent["status"]): string {
  if (status === "accepted" || (status as string) === "active") return "Accepted";
  if (status === "pending") return "Pending";
  if (status === "declined") return "Declined";
  if (status === "inactive") return "Inactive";
  return String(status || "—");
}

function agentStatusTone(status: SupervisorAgent["status"]) {
  if (status === "accepted" || (status as string) === "active") {
    return { badge: styles.statusAccepted, text: styles.statusAcceptedText };
  }
  if (status === "pending") {
    return { badge: styles.statusPending, text: styles.statusPendingText };
  }
  if (status === "declined") {
    return { badge: styles.statusDeclined, text: styles.statusDeclinedText };
  }
  return { badge: styles.statusInactive, text: styles.statusInactiveText };
}

export function AgentStatusBadge({ status }: { status: SupervisorAgent["status"] }) {
  const tone = agentStatusTone(status);
  return (
    <View style={[styles.statusBadge, tone.badge]}>
      <Text style={[styles.statusBadgeText, tone.text]}>{agentStatusLabel(status)}</Text>
    </View>
  );
}

export function isAssignableSupervisorAgent(status: SupervisorAgent["status"]): boolean {
  return status === "accepted" || (status as string) === "active";
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
  const assignable = isAssignableSupervisorAgent(agent.status);

  return (
    <GlassCard pad={0} style={styles.agentCard}>
      <View style={styles.agentCardInner}>
        <View style={styles.agentTop}>
          <ContactAvatar
            uri={agent.avatarUrl}
            name={agent.fullName}
            fallbackId={agent.kristoId || agent.phone}
            size={52}
            online={assignable && agent.status !== "inactive"}
          />
          <View style={styles.agentHead}>
            <View style={styles.agentNameRow}>
              <Text style={styles.agentName} numberOfLines={1}>
                {agent.fullName}
              </Text>
              <AgentStatusBadge status={agent.status} />
            </View>
            <Text style={styles.agentPhone} numberOfLines={1}>
              {agent.kristoId || agent.phone || "—"}
            </Text>
            {agent.churchId ? (
              <Text style={styles.agentChurch} numberOfLines={1}>
                Church · {agent.churchId}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.agentStats}>
          <AnalyticsChip dotColor={SA_PURPLE} value={agent.stats.assignedCodes} label="Assigned" />
          <AnalyticsChip dotColor={SA_GOLD} value={agent.stats.remainingCodes} label="Remaining" />
          <AnalyticsChip dotColor={SA_GREEN} value={agent.stats.redeemedCodes} label="Redeemed" />
        </View>
      </View>
      <View style={styles.agentActions}>
        {assignable ? <GoldButton label="Assign Codes" onPress={onAssign} compact /> : null}
        <GlassButton label="View" onPress={onView} compact />
        {agent.status === "accepted" || agent.status === "inactive" ? (
          <GlassButton label="Edit" onPress={onEdit} compact />
        ) : null}
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
  agentChurch: { color: MUTED, fontSize: 10, fontWeight: "600" },
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
  statusAccepted: {
    backgroundColor: "rgba(110,231,168,0.12)",
    borderColor: "rgba(110,231,168,0.28)",
  },
  statusAcceptedText: { color: "#86EFAC" },
  statusPending: {
    backgroundColor: "rgba(96,165,250,0.12)",
    borderColor: "rgba(96,165,250,0.28)",
  },
  statusPendingText: { color: "#93C5FD" },
  statusDeclined: {
    backgroundColor: "rgba(248,113,113,0.10)",
    borderColor: "rgba(248,113,113,0.24)",
  },
  statusDeclinedText: { color: "#FCA5A5" },
  statusInactive: {
    backgroundColor: "rgba(251,191,36,0.10)",
    borderColor: "rgba(251,191,36,0.25)",
  },
  statusInactiveText: { color: MUTED },
  statusBadgeText: { fontSize: 9, fontWeight: "800" },
});
