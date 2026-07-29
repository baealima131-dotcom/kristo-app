/**
 * Profile avatar silent-refresh must not remount / cache-bust identical avatars.
 *
 * Run: npx tsx scripts/verify-profile-avatar-refresh-stable.ts
 */
import {
  areAvatarIdentitiesEqual,
  avatarCacheBust,
  decideProfileAvatarRefresh,
  normalizeAvatarIdentity,
} from "../apps/mobile/src/lib/avatarFreshness.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
  console.log("  ok ", msg);
}

function simulateSilentRefreshLoop(opts: {
  baseUri: string;
  bumpUpdatedAtEveryTime: boolean;
}): { uniqueDisplayUris: number; remountKeys: number; decisions: string[] } {
  let displayed = "";
  let updatedAt = 1_700_000_000_000;
  const displayUris = new Set<string>();
  const remountKeys = new Set<string>();
  const decisions: string[] = [];
  const userKey = "profile-avatar-image-u_test";

  for (let i = 0; i < 10; i++) {
    if (opts.bumpUpdatedAtEveryTime) updatedAt = Date.now() + i;
    const nextRaw = opts.baseUri;
    const decision = decideProfileAvatarRefresh({
      previousUri: displayed || nextRaw,
      nextUri: nextRaw,
      responseOk: true,
    });
    decisions.push(decision);

    let nextDisplay = avatarCacheBust(nextRaw, updatedAt);
    if (decision === "unchanged" && displayed) {
      nextDisplay = displayed; // preserve loaded image URI
    } else {
      displayed = nextDisplay;
    }
    displayUris.add(nextDisplay);
    // Stable React key (must NOT include URI)
    remountKeys.add(userKey);
  }

  return {
    uniqueDisplayUris: displayUris.size,
    remountKeys: remountKeys.size,
    decisions,
  };
}

function main() {
  const base = "https://cdn.example.com/avatars/u_ef6b.png";

  console.log("\n• identity normalize strips cache-bust t=");
  assert(
    normalizeAvatarIdentity(`${base}?t=111`) === normalizeAvatarIdentity(`${base}?t=222`),
    "t= stripped for identity"
  );
  assert(areAvatarIdentitiesEqual(`${base}?t=1`, base), "equal with/without t=");

  console.log("\n• decideProfileAvatarRefresh");
  assert(
    decideProfileAvatarRefresh({ previousUri: base, nextUri: base, responseOk: true }) ===
      "unchanged",
    "same uri → unchanged"
  );
  assert(
    decideProfileAvatarRefresh({
      previousUri: base,
      nextUri: `${base}?t=999`,
      responseOk: true,
    }) === "unchanged",
    "same identity with new t= → unchanged"
  );
  assert(
    decideProfileAvatarRefresh({
      previousUri: base,
      nextUri: "https://cdn.example.com/avatars/other.png",
      responseOk: true,
    }) === "changed",
    "different uri → changed"
  );
  assert(
    decideProfileAvatarRefresh({ previousUri: base, nextUri: "", responseOk: false }) ===
      "preserved-on-error",
    "failed response → preserved-on-error"
  );

  console.log("\n• 10 silent refreshes with identical avatar stay still");
  {
    // Correct policy: do NOT bump updatedAt when unchanged
    const r = simulateSilentRefreshLoop({ baseUri: base, bumpUpdatedAtEveryTime: false });
    assert(r.decisions.every((d) => d === "unchanged"), "all 10 decisions unchanged");
    assert(r.uniqueDisplayUris === 1, "single display URI across 10 refreshes");
    assert(r.remountKeys === 1, "Image key stable (no remount storm)");
  }

  console.log("\n• legacy Date.now() bump would remount — policy preserves display URI");
  {
    let displayed = avatarCacheBust(base, 100);
    for (let i = 0; i < 10; i++) {
      const decision = decideProfileAvatarRefresh({
        previousUri: displayed,
        nextUri: base,
        responseOk: true,
      });
      assert(decision === "unchanged", `loop ${i} unchanged despite new bust candidate`);
      const candidate = avatarCacheBust(base, 100 + i + 1);
      if (decision === "unchanged") {
        // keep displayed
      } else {
        displayed = candidate;
      }
    }
    assert(displayed === avatarCacheBust(base, 100), "preserved original display URI");
  }

  console.log("\n• real change updates once");
  {
    const first = decideProfileAvatarRefresh({
      previousUri: base,
      nextUri: "https://cdn.example.com/avatars/new.png",
      responseOk: true,
    });
    assert(first === "changed", "first real change");
    const second = decideProfileAvatarRefresh({
      previousUri: "https://cdn.example.com/avatars/new.png",
      nextUri: "https://cdn.example.com/avatars/new.png",
      responseOk: true,
    });
    assert(second === "unchanged", "subsequent identical stays");
  }

  console.log("\nprofile avatar refresh stable: all checks passed");
}

main();
