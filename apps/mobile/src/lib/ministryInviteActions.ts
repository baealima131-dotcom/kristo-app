import { Alert } from "react-native";
import { router } from "expo-router";
import {
  getMinistryInviteById,
  markMinistryInviteLive,
  respondToMinistryLiveInvite,
} from "@/src/lib/ministryInvites";
import { setMinistryLiveState } from "@/src/lib/ministryLive";

export function openMinistryInviteDecision(input: {
  inviteId: string;
  ministryId: string;
  ministryTitle: string;
  currentRole?: string;
}) {
  const invite = getMinistryInviteById(input.inviteId);

  if (!invite) {
    Alert.alert("Invite not found", "Invitation haikuonekana.");
    return;
  }

  const myTarget =
    Array.isArray(invite.targets)
      ? invite.targets.find((t) => String(t.id) === String(input.ministryId))
      : null;

  if (!myTarget) {
    Alert.alert("Not allowed", "Invite hii si ya ministry hii.");
    return;
  }

  if (myTarget.status === "declined") {
    Alert.alert("Already declined", "Invitation hii ilishakataliwa.");
    return;
  }

  if (myTarget.status === "accepted") {
    router.push({
      pathname: "/(tabs)/more/my-church-room/messages/live-room" as any,
      params: {
        title: invite.title || invite.sourceTitle,
        ministryId: input.ministryId,
        role: input.currentRole || "member",
        host: "0",
        live: "1",
        inviteId: invite.id,
        membersCount: "26",
        leadersCount: "4",
      },
    });
    return;
  }

  Alert.alert(
    "Live invitation",
    [
      `From: ${invite.sourceTitle}`,
      `Title: ${invite.title}`,
      `Date: ${invite.eventDate}`,
      `Time: ${invite.eventTime}`,
      invite.description ? `About: ${invite.description}` : "",
      "",
      `${input.ministryTitle} admin/leader akubali ndipo ministry ijiunge live.`,
    ]
      .filter(Boolean)
      .join("\n"),
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Decline",
        style: "destructive",
        onPress: () => {
          respondToMinistryLiveInvite({
            inviteId: invite.id,
            ministryId: input.ministryId,
            response: "declined",
          });
          Alert.alert("Declined", `${input.ministryTitle} imekataa invitation.`);
        },
      },
      {
        text: "Accept",
        onPress: () => {
          respondToMinistryLiveInvite({
            inviteId: invite.id,
            ministryId: input.ministryId,
            response: "accepted",
          });

          markMinistryInviteLive(invite.id);

          setMinistryLiveState(String(input.ministryId), {
            name: input.ministryTitle,
            isLive: true,
            liveHostName: invite.sourceTitle,
            liveStartedAt: new Date().toISOString(),
          });

          router.push({
            pathname: "/(tabs)/more/my-church-room/messages/live-room" as any,
            params: {
              title: invite.title || invite.sourceTitle,
              ministryId: input.ministryId,
              role: input.currentRole || "member",
              host: "0",
              live: "1",
              inviteId: invite.id,
              membersCount: "26",
              leadersCount: "4",
            },
          });
        },
      },
    ]
  );
}
