/**
 * Conversation Settings church-membership label for person-to-person DMs.
 * Role alone must never imply shared church membership.
 */

export type DmMembershipLabelInput = {
  loading?: boolean;
  sharesActiveChurch?: boolean | null;
  viewerChurchId?: string;
  peerChurchId?: string;
  peerChurchName?: string;
  peerChurchRole?: string;
};

export type DmMembershipLabelResult = {
  sameChurch: boolean;
  role: string;
  status: string;
  pill: string;
  renderedLabel: string;
  viewerChurchId: string;
  peerChurchId: string;
  sharesActiveChurch: boolean;
  peerChurchRole: string;
};

function norm(value: unknown) {
  return String(value || "").trim();
}

function roleLabel(role: string) {
  const raw = norm(role);
  if (!raw) return "Member";
  if (/pastor/i.test(raw)) return "Pastor";
  return raw;
}

/**
 * Build the CHURCH MEMBERSHIP fact-card copy.
 * `sharesActiveChurch` wins when explicitly provided by the backend.
 * Otherwise require matching non-empty viewer/peer church IDs.
 */
export function buildDmMembershipLabel(
  input: DmMembershipLabelInput
): DmMembershipLabelResult {
  const viewerChurchId = norm(input.viewerChurchId);
  const peerChurchId = norm(input.peerChurchId);
  const peerChurchName = norm(input.peerChurchName);
  const peerChurchRole = roleLabel(input.peerChurchRole || "");

  const sharesActiveChurch =
    input.sharesActiveChurch === true ||
    (input.sharesActiveChurch !== false &&
      Boolean(viewerChurchId) &&
      Boolean(peerChurchId) &&
      viewerChurchId === peerChurchId);

  if (input.loading) {
    return {
      sameChurch: false,
      role: "…",
      status: "Checking church membership...",
      pill: "Checking",
      renderedLabel: "Checking church membership...",
      viewerChurchId,
      peerChurchId,
      sharesActiveChurch: false,
      peerChurchRole,
    };
  }

  if (sharesActiveChurch) {
    const renderedLabel = `Member of your church • Role: ${peerChurchRole}`;
    return {
      sameChurch: true,
      role: peerChurchRole,
      status: "Member of your church",
      pill: peerChurchRole,
      renderedLabel,
      viewerChurchId,
      peerChurchId,
      sharesActiveChurch: true,
      peerChurchRole,
    };
  }

  if (!peerChurchId) {
    return {
      sameChurch: false,
      role: "Unavailable",
      status: "Church membership unavailable",
      pill: "Unavailable",
      renderedLabel: "Church membership unavailable",
      viewerChurchId,
      peerChurchId,
      sharesActiveChurch: false,
      peerChurchRole,
    };
  }

  if (peerChurchName) {
    const renderedLabel =
      peerChurchRole === "Pastor"
        ? `Pastor at ${peerChurchName}`
        : `${peerChurchRole} at ${peerChurchName}`;
    return {
      sameChurch: false,
      role: peerChurchRole,
      status: renderedLabel,
      pill: peerChurchRole,
      renderedLabel,
      viewerChurchId,
      peerChurchId,
      sharesActiveChurch: false,
      peerChurchRole,
    };
  }

  const renderedLabel =
    peerChurchRole === "Pastor"
      ? "Pastor at another church"
      : peerChurchRole === "Member"
        ? "Member of another church"
        : `${peerChurchRole} at another church`;

  return {
    sameChurch: false,
    role: peerChurchRole,
    status: renderedLabel,
    pill: peerChurchRole,
    renderedLabel,
    viewerChurchId,
    peerChurchId,
    sharesActiveChurch: false,
    peerChurchRole,
  };
}
