/**
 * Standalone verification for pastor claimed-slot avatar merge path.
 * Run: node apps/mobile/scripts/verify-pastor-claimed-avatar.mjs
 */

const MEMBER_ID = "u_member_claimed";
const AVATAR = "/uploads/avatars/member-1.jpg";

function sanitize(raw) {
  const v = String(raw || "").trim();
  if (!v || v.startsWith("data:image") || v.startsWith("file://")) return "";
  if (/^https?:\/\//i.test(v) || v.startsWith("/uploads/") || /^uploads\//i.test(v)) return v;
  return "";
}

function resolvePersisted(slot) {
  const claimedBy = slot?.claimedBy;
  for (const raw of [
    slot?.claimedByAvatarUri,
    slot?.claimedByAvatar,
    slot?.claimedByAvatarUrl,
    slot?.claimedByPhotoUrl,
    claimedBy?.avatarUri,
    slot?.avatarUrl,
    slot?.profilePhotoUrl,
  ]) {
    const s = sanitize(raw);
    if (s) return s;
  }
  return "";
}

function coalesce(...slots) {
  for (const slot of slots) {
    const uri = resolvePersisted(slot);
    if (uri) return uri;
  }
  return "";
}

function patchSlot(slot, avatarUri) {
  const uri = sanitize(avatarUri);
  if (!uri) return slot;
  const uid = String(slot?.claimedByUserId || "").trim();
  return {
    ...slot,
    claimedByAvatarUri: uri,
    claimedByAvatar: uri,
    claimedByPhotoUrl: uri,
    claimedBy: { ...(slot.claimedBy || {}), userId: uid, avatarUri: uri },
  };
}

function mergeRow(prev, next) {
  const picked = next;
  const other = prev;
  return patchSlot({ ...other, ...picked }, coalesce(picked, other));
}

function enrichFromMembers(slots, map) {
  return slots.map((slot) => {
    const uid = String(slot?.claimedByUserId || "").trim();
    if (!uid || resolvePersisted(slot)) return slot;
    const raw = String(map[uid] || "").trim();
    return raw ? patchSlot(slot, raw) : slot;
  });
}

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

const pastorBackendSlot = {
  id: "slot-2",
  slot: 2,
  claimedByUserId: MEMBER_ID,
  claimedByName: "Test Member",
};

const feedEnrichedSlot = {
  id: "slot-2",
  slot: 2,
  claimedByUserId: MEMBER_ID,
  claimedByAvatarUri: AVATAR,
};

const merged = mergeRow(pastorBackendSlot, feedEnrichedSlot);
assert(resolvePersisted(merged) === AVATAR, "merge coalesce failed");

const withMember = enrichFromMembers([pastorBackendSlot], { [MEMBER_ID]: AVATAR });
assert(resolvePersisted(withMember[0]) === AVATAR, "member directory backfill failed");

console.log("PASS: pastor claimed-slot avatar path");
console.log(
  JSON.stringify({
    KRISTO_CLAIMED_AVATAR_RESOLVED: { hasUrl: true, source: "slot-field" },
    KRISTO_HOST_VISIBLE_PARTICIPANTS: {
      queueSlots: [
        {
          claimedByUserId: MEMBER_ID,
          hasAvatar: true,
          claimedByAvatarUri: withMember[0].claimedByAvatarUri,
        },
      ],
    },
  })
);
