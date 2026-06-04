import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import {
  clearSessionCookie,
  deleteChallengesForUser,
  deleteUserById,
  getUserById,
  readSession,
  updateUserPersist,
} from "@/app/api/auth/_lib/session";

export const runtime = "nodejs";

async function invalidateLogin(userId: string) {
  const revokedPassword = bcrypt.hashSync(
    `deleted:${userId}:${crypto.randomBytes(12).toString("hex")}`,
    10
  );
  await updateUserPersist(userId, {
    password: revokedPassword,
    email: "",
    phone: "",
  });
}

async function purgeUserAccount(userId: string) {
  const partialErrors: string[] = [];

  try {
    deleteChallengesForUser(userId);
  } catch (error: any) {
    const message = String(error?.message || error || "delete_challenges_failed");
    partialErrors.push(message);
    console.log("KRISTO_DELETE_ACCOUNT_ROLLBACK_FAILED", { userId, step: "challenges", error: message });
  }

  try {
    const user = await getUserById(userId);
    if (user) {
      try {
        await invalidateLogin(userId);
      } catch (error: any) {
        const message = String(error?.message || error || "invalidate_login_failed");
        partialErrors.push(message);
        console.log("KRISTO_DELETE_ACCOUNT_ROLLBACK_FAILED", { userId, step: "invalidate_login", error: message });
      }
    }
  } catch (error: any) {
    const message = String(error?.message || error || "load_user_failed");
    partialErrors.push(message);
    console.log("KRISTO_DELETE_ACCOUNT_ROLLBACK_FAILED", { userId, step: "get_user", error: message });
  }

  try {
    await deleteUserById(userId);
  } catch (error: any) {
    const message = String(error?.message || error || "delete_user_failed");
    partialErrors.push(message);
    console.log("KRISTO_DELETE_ACCOUNT_ROLLBACK_FAILED", { userId, step: "delete_user", error: message });
  }

  return partialErrors;
}

async function deleteAccount(req: Request) {
  const session = await readSession(req);
  const userId = String(session?.userId || "").trim();

  console.log("KRISTO_DELETE_ACCOUNT_API_START", { userId: userId || null });

  if (!userId) {
    console.log("KRISTO_DELETE_ACCOUNT_API_FAILED", { userId: null, reason: "missing_user_id" });
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const partialErrors = await purgeUserAccount(userId);

  let res = NextResponse.json({
    ok: true,
    ...(partialErrors.length ? { partialErrors } : {}),
  });
  res = clearSessionCookie(res);
  console.log("KRISTO_DELETE_ACCOUNT_API_SUCCESS", {
    userId,
    partialErrors: partialErrors.length ? partialErrors : null,
  });
  return res;
}

export async function POST(req: Request) {
  return deleteAccount(req);
}

export async function DELETE(req: Request) {
  return deleteAccount(req);
}
