import type { FollowUpStatus, OnboardingStatus } from "@/src/lib/offlineActivationProgramApi";

/** Swahili labels. "Confirmed" is only ever shown for the leader's own confirmation. */
export const ONBOARDING_STATUS_LABEL: Record<OnboardingStatus, string> = {
  invited: "Amealikwa",
  registered: "Limesajiliwa",
  training_pending: "Mafunzo yanaendelea",
  awaiting_confirmation: "Linasubiri uthibitisho wa kiongozi",
  confirmed: "Kiongozi amethibitisha",
  needs_help: "Kiongozi anahitaji msaada zaidi",
  rejected: "Kiongozi amekataa",
};

export const ONBOARDING_STATUS_COLOR: Record<OnboardingStatus, string> = {
  invited: "rgba(255,255,255,0.72)",
  registered: "#9CC3FF",
  training_pending: "#F4D06F",
  awaiting_confirmation: "#F4D06F",
  confirmed: "#7EE2A8",
  needs_help: "#FFB86B",
  rejected: "#FF8A80",
};

export const FOLLOW_UP_LABEL: Record<FollowUpStatus, string> = {
  none: "Hakuna",
  scheduled: "Imepangwa",
  in_progress: "Inaendelea",
  completed: "Imekamilika",
};

export const FOLLOW_UP_ORDER: FollowUpStatus[] = ["none", "scheduled", "in_progress", "completed"];

export const INVITE_CODE_STATE_LABEL = {
  active: "Inatumika",
  expired: "Imeisha muda",
  revoked: "Imefutwa",
  used_up: "Imetumika yote",
} as const;

export function parseTopics(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((topic) => topic.trim())
    .filter(Boolean)
    .slice(0, 20);
}
