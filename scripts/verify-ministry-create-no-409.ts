/**
 * Verify create-ministry membership plan never re-POSTs the auto-seeded Pastor,
 * and duplicate membership responses are treated as success (no 409).
 *
 * Run: npx tsx scripts/verify-ministry-create-no-409.ts
 */
import {
  isMinistryMemberPostSuccess,
  planAdditionalMinistryMemberPosts,
} from "../apps/mobile/src/lib/createMinistryMembersPlan.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
  console.log("  ok ", msg);
}

function main() {
  const pastor = "u_pastor";
  const extraLeader = "u_leader2";
  const extraMember = "u_member3";

  console.log("\n• pastor-only create → no ministry-members POSTs");
  {
    const plan = planAdditionalMinistryMemberPosts({
      pickedLeaderIds: [pastor],
      pickedMemberIds: [pastor],
      autoPastorUserId: pastor,
      seededCreatorUserId: pastor,
    });
    assert(plan.leadersToPost.length === 0, "no leaders to POST when only auto pastor");
    assert(plan.membersToPost.length === 0, "no members to POST when only auto pastor");
    assert(plan.skippedUserIds.includes(pastor), "pastor skipped");
    assert(plan.displayLeaderIds.includes(pastor), "pastor still counted for display");
  }

  console.log("\n• additional leaders/members only");
  {
    const plan = planAdditionalMinistryMemberPosts({
      pickedLeaderIds: [pastor, extraLeader],
      pickedMemberIds: [pastor, extraMember],
      autoPastorUserId: pastor,
      seededCreatorUserId: pastor,
    });
    assert(
      JSON.stringify(plan.leadersToPost) === JSON.stringify([extraLeader]),
      "only extra leader posted"
    );
    assert(
      JSON.stringify(plan.membersToPost) === JSON.stringify([extraMember]),
      "only extra member posted"
    );
    assert(!plan.leadersToPost.includes(pastor), "auto pastor never in leadersToPost");
    assert(!plan.membersToPost.includes(pastor), "auto pastor never in membersToPost");
  }

  console.log("\n• Church_Admin creator + locked pastor → skip both seeded ids");
  {
    const admin = "u_admin";
    const plan = planAdditionalMinistryMemberPosts({
      pickedLeaderIds: [pastor, extraLeader],
      pickedMemberIds: [extraMember],
      autoPastorUserId: pastor,
      seededCreatorUserId: admin,
    });
    assert(!plan.leadersToPost.includes(pastor), "do not POST autoPastorUserId");
    assert(!plan.leadersToPost.includes(admin), "do not POST seeded creator");
    assert(plan.leadersToPost.includes(extraLeader), "manual leader still posted");
    assert(plan.membersToPost.includes(extraMember), "manual member still posted");
  }

  console.log("\n• simulated create → membership POST sequence has no 409");
  {
    const seeded = new Set<string>([pastor]); // ministries route auto-add
    const plan = planAdditionalMinistryMemberPosts({
      pickedLeaderIds: [pastor, extraLeader],
      pickedMemberIds: [pastor, extraMember],
      autoPastorUserId: pastor,
      seededCreatorUserId: pastor,
    });

    type Simulated = { status: number; ok: boolean; alreadyExists?: boolean; error?: string };
    const postResults: Simulated[] = [];

    const simulatePost = (userId: string): Simulated => {
      if (seeded.has(userId)) {
        // Old behavior would 409; new API returns 200 alreadyExists.
        return { status: 200, ok: true, alreadyExists: true };
      }
      seeded.add(userId);
      return { status: 201, ok: true };
    };

    for (const uid of plan.leadersToPost) postResults.push(simulatePost(uid));
    for (const uid of plan.membersToPost) postResults.push(simulatePost(uid));

    assert(postResults.every((r) => r.status !== 409), "no 409 in post sequence");
    assert(
      postResults.every((r) => isMinistryMemberPostSuccess(r)),
      "every POST treated as success"
    );
    assert(seeded.has(pastor), "creating Pastor remains a member (backend seed)");
    assert(seeded.has(extraLeader) && seeded.has(extraMember), "manual adds applied");
  }

  console.log("\n• idempotent alreadyExists response is success");
  {
    assert(
      isMinistryMemberPostSuccess({ ok: true, alreadyExists: true, status: 200 }),
      "alreadyExists:true counts as success"
    );
    assert(!isMinistryMemberPostSuccess({ ok: false, status: 409 }), "409 still failure");
  }

  console.log("\nministry create no-409: all checks passed");
}

main();
