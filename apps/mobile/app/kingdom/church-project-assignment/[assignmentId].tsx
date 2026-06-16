import React, { useEffect, useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";

const BG = "#0B0F17";
const SOFT = "rgba(255,255,255,0.72)";

const ASSIGNMENT_ROOM_META: Record<
  string,
  {
    title: string;
    subtitle: string;
    role: string;
    status: string;
    initials: string;
  }
> = {
  "mr-usa-1": {
    title: "Moral Reform • Dallas",
    subtitle: "assignment room",
    role: "MEMBER",
    status: "active member",
    initials: "M",
  },
  "mr-bi-1": {
    title: "Moral Reform • Bujumbura",
    subtitle: "assignment room",
    role: "MEMBER",
    status: "active member",
    initials: "M",
  },
  "mr-tz-1": {
    title: "Moral Reform • Dar",
    subtitle: "assignment room",
    role: "MEMBER",
    status: "active member",
    initials: "M",
  },
  "lo-usa-1": {
    title: "Leadership Order • Fort Worth",
    subtitle: "assignment room",
    role: "LEADER",
    status: "active member",
    initials: "L",
  },

  "sb-usa-1": {
    title: "Strategy Board • Fort Worth",
    subtitle: "Fort Worth assignment room",
    role: "LEADER",
    status: "active member",
    initials: "S",
  },
  "sb-ke-1": {
    title: "Strategy Board • Nairobi",
    subtitle: "Nairobi assignment room",
    role: "LEADER",
    status: "active member",
    initials: "S",
  },

  "cf-usa-1": {
    title: "Calendar Flow • Dallas",
    subtitle: "Dallas assignment room",
    role: "MEMBER",
    status: "active member",
    initials: "C",
  },
  "cf-tz-1": {
    title: "Calendar Flow • Dar",
    subtitle: "Dar assignment room",
    role: "MEMBER",
    status: "active member",
    initials: "C",
  },

  "tm-usa-1": {
    title: "Target Map • Dallas",
    subtitle: "Dallas assignment room",
    role: "MEMBER",
    status: "active member",
    initials: "T",
  },
  "tm-congo-1": {
    title: "Target Map • Goma",
    subtitle: "Goma assignment room",
    role: "MEMBER",
    status: "active member",
    initials: "T",
  },

  "pr-usa-1": {
    title: "Priority Room • Fort Worth",
    subtitle: "Fort Worth assignment room",
    role: "LEADER",
    status: "active member",
    initials: "P",
  },
  "pr-ug-1": {
    title: "Priority Room • Kampala",
    subtitle: "Kampala assignment room",
    role: "LEADER",
    status: "active member",
    initials: "P",
  },
};

export default function ChurchProjectAssignmentScreen() {
  const router = useRouter();
  const { assignmentId } = useLocalSearchParams<{ assignmentId?: string }>();

  const safeAssignmentId = String(assignmentId || "mr-usa-1");

  const meta = useMemo(
    () =>
      ASSIGNMENT_ROOM_META[safeAssignmentId] ?? {
        title: "Assignment Room",
        subtitle: "assignment room",
        role: "MEMBER",
        status: "active member",
        initials: "A",
      },
    [safeAssignmentId]
  );

  useEffect(() => {
    const t = setTimeout(() => {
      router.replace({
        pathname: "/(tabs)/more/my-church-room/messages/[id]",
        params: {
          id: safeAssignmentId,
          roomKind: "assignment",
          title: meta.title,
          sub: meta.subtitle,
          assignmentTitle: meta.title,
          assignmentSubtitle: meta.subtitle,
          assignmentRole: meta.role,
          assignmentStatus: meta.status,
          assignmentInitials: meta.initials,
          resetAssignmentCards: "1",
          backTo: "assignment-room",
          source: "assignment-room",
        },
      } as any);
    }, 10);

    return () => clearTimeout(t);
  }, [router, safeAssignmentId, meta]);

  return (
    <View style={s.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <Text style={s.text}>Opening assignment room...</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    color: SOFT,
    fontSize: 16,
    fontWeight: "700",
  },
});
