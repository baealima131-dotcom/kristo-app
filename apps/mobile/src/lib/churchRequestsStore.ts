import AsyncStorage from "@react-native-async-storage/async-storage";

export type JoinRequestStatus = "pending" | "approved" | "rejected";

export type ChurchJoinRequest = {
  id: string;
  requestId: string;
  churchId: string;
  userId: string;
  name?: string;
  displayName?: string;
  role?: string;
  status: JoinRequestStatus;
  createdAt: string;
};

const REQ_KEY = "kristo_church_join_requests_v1";
const MEMBERS_KEY = "kristo_church_members_v1";

function cleanId(v: string) {
  return String(v || "").trim().replace(/\s+/g, "").toUpperCase();
}

async function readArr(key: string): Promise<any[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeArr(key: string, arr: any[]) {
  await AsyncStorage.setItem(key, JSON.stringify(arr));
}

export async function createJoinRequest(req: Omit<ChurchJoinRequest, "requestId" | "status"> & Partial<ChurchJoinRequest>) {
  const list = await readArr(REQ_KEY);
  const requestId = req.requestId || req.id || `req-${Date.now()}`;
  const item: ChurchJoinRequest = {
    ...req,
    id: requestId,
    requestId,
    churchId: cleanId(req.churchId),
    userId: String(req.userId || ""),
    name: req.name || req.displayName || req.userId,
    displayName: req.displayName || req.name || req.userId,
    role: "pending",
    status: "pending",
    createdAt: req.createdAt || new Date().toISOString(),
  };

  const next = [
    item,
    ...list.filter((x) => !(cleanId(x.churchId) === item.churchId && String(x.userId) === item.userId && String(x.status) === "pending")),
  ];

  await writeArr(REQ_KEY, next);
  return item;
}

export async function getChurchJoinRequests(churchId: string) {
  const id = cleanId(churchId);
  const list = await readArr(REQ_KEY);
  return list.filter((x) => cleanId(x.churchId) === id && String(x.status || "pending") === "pending");
}

export async function getChurchMembers(churchId: string) {
  const id = cleanId(churchId);
  const list = await readArr(MEMBERS_KEY);
  return list.filter((x) => cleanId(x.churchId) === id);
}

export async function approveJoinRequest(requestId: string) {
  const list = await readArr(REQ_KEY);
  const req = list.find((x) => String(x.requestId || x.id) === String(requestId));
  if (!req) throw new Error("Request not found");

  const nextReqs = list.map((x) =>
    String(x.requestId || x.id) === String(requestId) ? { ...x, status: "approved", role: "approved" } : x
  );
  await writeArr(REQ_KEY, nextReqs);

  const members = await readArr(MEMBERS_KEY);
  const member = {
    id: `mem-${Date.now()}`,
    membershipId: `mem-${Date.now()}`,
    churchId: cleanId(req.churchId),
    userId: String(req.userId || ""),
    name: req.name || req.displayName || req.userId || "Member",
    displayName: req.displayName || req.name || req.userId || "Member",
    role: "Member",
    status: "active",
    createdAt: new Date().toISOString(),
  };

  await writeArr(MEMBERS_KEY, [member, ...members.filter((x) => !(cleanId(x.churchId) === member.churchId && String(x.userId) === member.userId))]);
  return member;
}

export async function rejectJoinRequest(requestId: string) {
  const list = await readArr(REQ_KEY);
  await writeArr(
    REQ_KEY,
    list.map((x) => String(x.requestId || x.id) === String(requestId) ? { ...x, status: "rejected", role: "rejected" } : x)
  );
}


export async function deactivateChurchMember(memberId: string) {
  const members = await readArr(MEMBERS_KEY)

  const next = members.map((x) => {
    const id = String(x.membershipId || x.id || "")
    if (id !== String(memberId)) return x

    return {
      ...x,
      status: "inactive",
      membershipStatus: "inactive",
      removedAt: new Date().toISOString(),
    }
  })

  await writeArr(MEMBERS_KEY, next)
}
