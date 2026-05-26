export type ElectionVoteType = "mc" | "branch_leader" | "department" | "internal";

export type ElectionCandidate = {
  id: string;
  name: string;
  role: string;
  branch: string;
  votes: number;
};

export type ChurchProjectElectionState = {
  assignmentId: string;
  title: string;
  subtitle: string;
  voteType: ElectionVoteType;
  durationDays: number;
  totalHours: number;
  hoursLeft: number;
  draftCreated: boolean;
  sentToMc: boolean;
  announcementLive: boolean;
  candidates: ElectionCandidate[];
};

const DEFAULT_CANDIDATES: ElectionCandidate[] = [
  { id: "c1", name: "Alicia Grant", role: "Admin", branch: "Dallas", votes: 13 },
  { id: "c2", name: "Joel Martin", role: "Pastor", branch: "Dallas", votes: 11 },
  { id: "c3", name: "Naomi Reed", role: "Admin", branch: "Dallas", votes: 8 },
  { id: "c4", name: "Michael Reed", role: "Member", branch: "Dallas", votes: 6 },
  { id: "c5", name: "Rachel Moore", role: "Admin", branch: "Dallas", votes: 5 },
];

function makeDefaultState(assignmentId: string): ChurchProjectElectionState {
  return {
    assignmentId,
    title: "Assignment Room",
    subtitle: "assignment room",
    voteType: "mc",
    durationDays: 7,
    totalHours: 7 * 24,
    hoursLeft: 7 * 24,
    draftCreated: false,
    sentToMc: false,
    announcementLive: false,
    candidates: DEFAULT_CANDIDATES,
  };
}

const store = new Map<string, ChurchProjectElectionState>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function subscribeChurchProjectElection(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getChurchProjectElectionState(assignmentId: string) {
  const key = assignmentId || "assignment";
  if (!store.has(key)) store.set(key, makeDefaultState(key));
  return store.get(key)!;
}

export function setChurchProjectElectionState(
  assignmentId: string,
  patch:
    | Partial<ChurchProjectElectionState>
    | ((prev: ChurchProjectElectionState) => Partial<ChurchProjectElectionState>)
) {
  const prev = getChurchProjectElectionState(assignmentId);
  const nextPatch = typeof patch === "function" ? patch(prev) : patch;
  const next: ChurchProjectElectionState = {
    ...prev,
    ...nextPatch,
  };
  store.set(assignmentId || "assignment", next);
  emit();
  return next;
}

export function configureChurchProjectElection(args: {
  assignmentId: string;
  title: string;
  subtitle: string;
  voteType: ElectionVoteType;
  durationDays: number;
}) {
  const totalHours = args.durationDays * 24;
  return setChurchProjectElectionState(args.assignmentId, {
    assignmentId: args.assignmentId || "assignment",
    title: args.title || "Assignment Room",
    subtitle: args.subtitle || "assignment room",
    voteType: args.voteType,
    durationDays: args.durationDays,
    totalHours,
    hoursLeft: totalHours,
    draftCreated: true,
    sentToMc: false,
  });
}

export function sendChurchProjectElectionToMc(assignmentId: string) {
  return setChurchProjectElectionState(assignmentId, {
    sentToMc: true,
  });
}

export function openChurchProjectElectionAnnouncementMode(assignmentId: string) {
  return setChurchProjectElectionState(assignmentId, {
    announcementLive: true,
  });
}

export function reduceChurchProjectElectionHours(assignmentId: string, amount = 24) {
  return setChurchProjectElectionState(assignmentId, (prev) => ({
    hoursLeft: Math.max(0, prev.hoursLeft - amount),
  }));
}
