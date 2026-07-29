/**
 * More tab press policy:
 * - other tab → More: enter with transition
 * - More root → More: no-op
 * - nested More → More root: replace without transition/blackout
 *
 * Run: npx tsx scripts/verify-more-tab-reselect.ts
 */
import {
  decideMoreTabBarPress,
  isMoreNestedRoute,
  isMoreRootRoute,
  isMoreTopLevelTabActive,
} from "../apps/mobile/src/lib/moreTabPressPolicy.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
  console.log("  ok ", msg);
}

/**
 * Mirrors handleMoreTabBarPress side-effect contract without importing RN.
 */
function simulateMoreTabBarPress(segments: readonly string[]): {
  decision: "enter-more" | "stay-more-root" | "return-more-root";
  logs: string[];
  navigated: boolean;
  shellVisible: boolean;
  firstPaint: boolean;
  transitionBlock: boolean;
} {
  const decision = decideMoreTabBarPress(segments);
  const logs: string[] = [];

  if (decision === "stay-more-root") {
    logs.push("KRISTO_MORE_TAB_RESELECT_IGNORED");
    return {
      decision,
      logs,
      navigated: false,
      shellVisible: false,
      firstPaint: false,
      transitionBlock: false,
    };
  }

  if (decision === "return-more-root") {
    logs.push("KRISTO_MORE_TAB_RESELECT_RETURN_ROOT");
    return {
      decision,
      logs,
      navigated: true,
      shellVisible: false,
      firstPaint: false,
      transitionBlock: false,
    };
  }

  logs.push("KRISTO_MORE_TAB_PRESS");
  logs.push("KRISTO_MORE_TRANSITION_BLOCK_BACKGROUND_WORK");
  logs.push("KRISTO_MORE_FIRST_PAINT");
  return {
    decision,
    logs,
    navigated: true,
    shellVisible: true,
    firstPaint: true,
    transitionBlock: true,
  };
}

function main() {
  console.log("\n• route classifiers");
  assert(isMoreTopLevelTabActive(["(tabs)", "index"]) === false, "Home is not More");
  assert(isMoreTopLevelTabActive(["(tabs)", "more"]) === true, "More root top-level active");
  assert(isMoreRootRoute(["(tabs)", "more"]) === true, "More hub is root");
  assert(isMoreRootRoute(["(tabs)", "more", "index"]) === true, "More/index is root");
  assert(isMoreNestedRoute(["(tabs)", "more"]) === false, "More hub is not nested");
  assert(isMoreNestedRoute(["(tabs)", "more", "media"]) === true, "/more/media is nested");
  assert(
    isMoreNestedRoute(["(tabs)", "more", "ministries", "min_1"]) === true,
    "ministry screen under More is nested"
  );
  assert(
    isMoreNestedRoute(["(tabs)", "more", "my-church-room", "ministry"]) === true,
    "ministry-room under More is nested"
  );
  assert(isMoreTopLevelTabActive(["(tabs)", "church"]) === false, "Church is not More");

  console.log("\n• Home → More: transition runs once");
  {
    const r = simulateMoreTabBarPress(["(tabs)", "index"]);
    assert(r.decision === "enter-more", "decision enter-more");
    assert(r.navigated === true, "navigateToMore runs");
    assert(r.logs.includes("KRISTO_MORE_TAB_PRESS"), "logs MORE_TAB_PRESS");
    assert(
      r.logs.includes("KRISTO_MORE_TRANSITION_BLOCK_BACKGROUND_WORK"),
      "logs TRANSITION_BLOCK"
    );
    assert(r.shellVisible === true, "shell visible during inbound transition");
    assert(r.transitionBlock === true, "transition blocking after inbound");
    assert(!r.logs.includes("KRISTO_MORE_TAB_RESELECT_IGNORED"), "no IGNORED on inbound");
    assert(!r.logs.includes("KRISTO_MORE_TAB_RESELECT_RETURN_ROOT"), "no RETURN_ROOT on inbound");
  }

  console.log("\n• More root → More: ignored / no-op");
  {
    const r = simulateMoreTabBarPress(["(tabs)", "more"]);
    assert(r.decision === "stay-more-root", "decision stay-more-root");
    assert(r.navigated === false, "navigateToMore not called");
    assert(r.logs.includes("KRISTO_MORE_TAB_RESELECT_IGNORED"), "logs RESELECT_IGNORED");
    assert(!r.logs.includes("KRISTO_MORE_TAB_PRESS"), "no MORE_TAB_PRESS");
    assert(
      !r.logs.includes("KRISTO_MORE_TRANSITION_BLOCK_BACKGROUND_WORK"),
      "no TRANSITION_BLOCK"
    );
    assert(r.shellVisible === false, "no shell / blackout");
  }

  console.log("\n• /more/media → More: returns to More root");
  {
    const r = simulateMoreTabBarPress(["(tabs)", "more", "media"]);
    assert(r.decision === "return-more-root", "decision return-more-root");
    assert(r.navigated === true, "replace to More root");
    assert(r.logs.includes("KRISTO_MORE_TAB_RESELECT_RETURN_ROOT"), "logs RETURN_ROOT");
    assert(!r.logs.includes("KRISTO_MORE_TAB_RESELECT_IGNORED"), "not IGNORED");
    assert(!r.logs.includes("KRISTO_MORE_TAB_PRESS"), "no MORE_TAB_PRESS");
    assert(
      !r.logs.includes("KRISTO_MORE_TRANSITION_BLOCK_BACKGROUND_WORK"),
      "no TRANSITION_BLOCK on nested return"
    );
    assert(r.shellVisible === false, "no blackout on nested return");
    assert(r.transitionBlock === false, "not blocking on nested return");
  }

  console.log("\n• Ministry screen via More → More: returns to More root");
  {
    const ministry = ["(tabs)", "more", "ministries", "min_1785292033644_0086023f223b78"] as const;
    const r = simulateMoreTabBarPress(ministry);
    assert(r.decision === "return-more-root", "ministry nested → return-more-root");
    assert(r.navigated === true, "ministry nested navigates to root");
    assert(r.logs.includes("KRISTO_MORE_TAB_RESELECT_RETURN_ROOT"), "logs RETURN_ROOT");
    assert(
      !r.logs.includes("KRISTO_MORE_TRANSITION_BLOCK_BACKGROUND_WORK"),
      "no TRANSITION_BLOCK for ministry return"
    );
  }

  console.log("\n• no blackout after inbound then root reselect");
  {
    const inbound = simulateMoreTabBarPress(["(tabs)", "index"]);
    assert(inbound.shellVisible === true, "shell after first inbound");
    const reselect = simulateMoreTabBarPress(["(tabs)", "more"]);
    assert(reselect.shellVisible === false, "root reselect does not re-show shell");
    assert(reselect.decision === "stay-more-root", "post-inbound root reselect stays");
  }

  console.log("\nmore tab reselect: all checks passed");
}

main();
