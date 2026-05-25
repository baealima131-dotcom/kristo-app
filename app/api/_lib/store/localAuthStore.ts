import fs from "fs";
import path from "path";
import type { UserRecord } from "@/app/api/_lib/store/authDb";

export type { UserRecord as UserLite };

const LOCAL_USERS_FILE = path.join(process.cwd(), "data", "users.json");

function readLocalUsers(): UserRecord[] {
  try {
    if (!fs.existsSync(LOCAL_USERS_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(LOCAL_USERS_FILE, "utf8"));
    return Array.isArray(data) ? (data as UserRecord[]) : [];
  } catch {
    return [];
  }
}

function writeLocalUsers(users: UserRecord[]) {
  fs.mkdirSync(path.dirname(LOCAL_USERS_FILE), { recursive: true });
  fs.writeFileSync(LOCAL_USERS_FILE, JSON.stringify(users, null, 2));
}

export function normEmailLocal(s: string) {
  return String(s || "").trim().toLowerCase();
}

export function normPhoneLocal(s: string) {
  return String(s || "").trim();
}

export async function localCountUsers(): Promise<number> {
  return readLocalUsers().length;
}

export async function localEmailTaken(email: string): Promise<boolean> {
  const key = normEmailLocal(email);
  return readLocalUsers().some((u) => normEmailLocal(u.email || "") === key);
}

export async function localPhoneTaken(phone: string): Promise<boolean> {
  const key = normPhoneLocal(phone);
  return readLocalUsers().some((u) => normPhoneLocal(u.phone || "") === key);
}

export async function localCreateUser(user: UserRecord): Promise<UserRecord> {
  const store = readLocalUsers();
  store.push(user);
  writeLocalUsers(store);
  return user;
}

export async function localGetUserById(userId: string): Promise<UserRecord | null> {
  return readLocalUsers().find((u) => u.id === userId) || null;
}

export async function localFindUserByEmail(email: string): Promise<UserRecord | null> {
  const key = normEmailLocal(email);
  return readLocalUsers().find((u) => normEmailLocal(u.email || "") === key) || null;
}

export async function localFindUserByPhone(rawPhone: string): Promise<UserRecord | null> {
  const key = normPhoneLocal(rawPhone);
  const digits = key.replace(/\D/g, "");
  const candidates = Array.from(
    new Set([
      key,
      digits,
      digits.length === 10 ? `1${digits}` : digits,
      digits.length === 10 ? `+1 ${digits}` : key,
    ])
  ).filter(Boolean);

  const store = readLocalUsers();
  for (const candidate of candidates) {
    const found = store.find((u) => normPhoneLocal(u.phone || "") === normPhoneLocal(candidate));
    if (found) return found;
  }
  return null;
}

export async function localUpdateUser(userId: string, patch: Partial<UserRecord>): Promise<UserRecord | null> {
  const store = readLocalUsers();
  const idx = store.findIndex((u) => u.id === userId);
  if (idx < 0) return null;
  store[idx] = { ...store[idx], ...patch, id: userId };
  writeLocalUsers(store);
  return store[idx];
}

export async function localDeleteUser(userId: string): Promise<void> {
  writeLocalUsers(readLocalUsers().filter((u) => u.id !== userId));
}
