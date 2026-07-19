import {
  evaluateRecipientCallPrivacy,
  evaluateRecipientMessagePrivacy,
  type RecipientCallGateResult,
  type RecipientMessageGateResult,
} from "@/app/api/_lib/messagePrivacySettings";
import { getMessagePrivacySettings } from "@/app/api/_lib/store/messagePrivacySettingsDb";

export async function assertRecipientAllowsDirectMessage(args: {
  recipientUserId: string;
  shareActiveChurch: boolean;
  hasExistingConversation: boolean;
  isEstablishedConversation: boolean;
  isCrossChurchRequest: boolean;
  initiatorOutboundCount?: number;
}): Promise<RecipientMessageGateResult> {
  const recipientUserId = String(args.recipientUserId || "").trim();
  if (!recipientUserId) {
    return {
      ok: false,
      reason: "nobody",
      code: "DM_PRIVACY_NOBODY",
      error: "This person is not accepting new messages.",
    };
  }

  const settings = await getMessagePrivacySettings(recipientUserId);
  return evaluateRecipientMessagePrivacy({
    settings,
    shareActiveChurch: args.shareActiveChurch,
    hasExistingConversation: args.hasExistingConversation,
    isEstablishedConversation: args.isEstablishedConversation,
    isCrossChurchRequest: args.isCrossChurchRequest,
    initiatorOutboundCount: args.initiatorOutboundCount,
  });
}

export async function assertRecipientAllowsPrivateCall(args: {
  recipientUserId: string;
  shareActiveChurch: boolean;
  hasExistingConversation: boolean;
  callKind: "voice" | "video";
  isUnknownCaller: boolean;
}): Promise<RecipientCallGateResult> {
  const recipientUserId = String(args.recipientUserId || "").trim();
  if (!recipientUserId) {
    return {
      ok: false,
      reason: "call_nobody",
      code: "CALL_PRIVACY_NOBODY",
      error: "This person is not accepting calls.",
    };
  }

  const settings = await getMessagePrivacySettings(recipientUserId);
  return evaluateRecipientCallPrivacy({
    settings,
    shareActiveChurch: args.shareActiveChurch,
    hasExistingConversation: args.hasExistingConversation,
    callKind: args.callKind,
    isUnknownCaller: args.isUnknownCaller,
  });
}

export async function getPairReadReceiptVisibility(args: {
  viewerUserId: string;
  peerUserId: string;
}): Promise<boolean> {
  const [viewer, peer] = await Promise.all([
    getMessagePrivacySettings(args.viewerUserId),
    getMessagePrivacySettings(args.peerUserId),
  ]);
  return viewer.showReadReceipts === true && peer.showReadReceipts === true;
}
