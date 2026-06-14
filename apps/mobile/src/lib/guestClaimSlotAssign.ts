import { apiPost } from "./kristoApi";
import { feedUpdateScheduleSlot } from "./homeFeedStore";

export async function assignScheduleSlotOnServer(args: {
  postId: string;
  slotId: string;
  userId?: string;
  kristoId?: string;
  name?: string;
  role?: string;
  avatarUri?: string;
  headers: Record<string, string>;
}) {
  const postId = String(args.postId || "").trim();
  const slotId = String(args.slotId || "").trim();
  if (!postId || !slotId) {
    throw new Error("Schedule link missing for this slot.");
  }

  const res: any = await apiPost(
    "/api/church/feed",
    {
      action: "assign_schedule_slot",
      postId,
      feedId: postId,
      slotId,
      userId: args.userId,
      kristoId: args.kristoId,
      name: args.name,
      role: args.role,
      claim: args.avatarUri ? { avatarUri: args.avatarUri } : undefined,
    },
    { headers: args.headers }
  );

  if (Number(res?.status || 0) === 403 && String(res?.error || "").includes("subscription")) {
    throw new Error(
      "This member's church must have an active subscription before they can be assigned."
    );
  }

  if (res?.ok === false || res?.error) {
    throw new Error(String(res?.error || "Could not assign member to this slot."));
  }

  const patch = res?.slot;
  if (patch) {
    feedUpdateScheduleSlot(postId, { slotId, patch });
  }

  return res;
}
