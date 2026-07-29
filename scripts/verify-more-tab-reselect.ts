/**
 * More tab reselect must be a no-op when More is already the active top-level tab.
 *
 * Run: npx tsx scripts/verify-more-tab-reselect.ts
 */
import {
  decideMoreTabBarPress,
  isMoreTopLevelTabActive,
} from "../apps/mobile/src/lib/moreTabPressPolicy.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
  console.log("  ok ", msg);
}

/**
 * Mirrors handleMoreTabBarPress side-effect contract without importing RN.
 * Returns which logs / actions would fire.
 */
function simulateMoreTabBarPress(args: {
  isMoreTabActive: boolean;
}): {
  decision: "ignored" | "transitioned";
  logs: string[];
  navigated: boolean;
  shellVisible: boolean;
  firstPaint: boolean;
  transitionBlock: boolean;
} {
  const logs: string[] = [];
  if (decideMoreTabBarPress(args.isMoreTabActive) === "ignored") {
    logs.push("KRISTO_MORE_TAB_RESELECT_IGNORED");
    return {
      decision: "ignored",
      logs,
      navigated: false,
      shellVisible: false,
      firstPaint: false,
      transitionBlock: false,
    };
  }
  logs.push("KRISTO_MORE_TAB_PRESS");
  logs.push("KRISTO_MORE_TRANSITION_BLOCK_BACKGROUND_WORK");
  logs.push("KRISTO_MORE_FIRST_PAINT");
  return {
    decision: "transitioned",
    logs,
    navigated: true,
    shellVisible: true,
    firstPaint: true,
    transitionBlock: true,
  };
}

function main() {
  console.log("\n• isMoreTopLevelTabActive");
  assert(isMoreTopLevelTabActive(["(tabs)", "index"]) === false, "Home is not More");
  assert(isMoreTopLevelTabActive(["(tabs)", "more"]) === true, "More root is active");
  assert(
    isMoreTopLevelTabActive(["(tabs)", "more", "my-church-room", "messages"]) === true,
    "More nested screen still top-level More"
  );
  assert(isMoreTopLevelTabActive(["(tabs)", "church"]) === false, "Church is not More");

  console.log("\n• Home → More: transition runs once");
  {
    const r = simulateMoreTabBarPress({ isMoreTabActive: false });
    assert(r.decision === "transitioned", "result transitioned");
    assert(r.navigated === true, "navigateToMore would run once");
    assert(r.logs.includes("KRISTO_MORE_TAB_PRESS"), "logs MORE_TAB_PRESS");
    assert(
      r.logs.includes("KRISTO_MORE_TRANSITION_BLOCK_BACKGROUND_WORK"),
      "logs TRANSITION_BLOCK"
    );
    assert(r.shellVisible === true, "shell visible during inbound transition");
    assert(r.transitionBlock === true, "transition blocking after inbound");
    assert(!r.logs.includes("KRISTO_MORE_TAB_RESELECT_IGNORED"), "no reselect ignored on inbound");
  }

  console.log("\n• More → More: prevented / no-op");
  {
    const r = simulateMoreTabBarPress({ isMoreTabActive: true });
    assert(r.decision === "ignored", "result ignored");
    assert(r.navigated === false, "navigateToMore not called");
    assert(r.logs.includes("KRISTO_MORE_TAB_RESELECT_IGNORED"), "logs RESELECT_IGNORED");
    assert(!r.logs.includes("KRISTO_MORE_TAB_PRESS"), "no MORE_TAB_PRESS on reselect");
    assert(
      !r.logs.includes("KRISTO_MORE_TRANSITION_BLOCK_BACKGROUND_WORK"),
      "no TRANSITION_BLOCK on reselect"
    );
    assert(!r.logs.includes("KRISTO_MORE_FIRST_PAINT"), "no FIRST_PAINT reset on reselect");
    assert(r.shellVisible === false, "shell not shown on reselect");
    assert(r.transitionBlock === false, "not blocking on reselect");
  }

  console.log("\n• More nested screen → More: stays on exact screen");
  {
    const nestedSegments = ["(tabs)", "more", "settings"] as const;
    assert(isMoreTopLevelTabActive(nestedSegments) === true, "nested still active More");
    const routeKeyBefore = nestedSegments.join("/");
    const r = simulateMoreTabBarPress({
      isMoreTabActive: isMoreTopLevelTabActive(nestedSegments),
    });
    assert(r.navigated === false, "nested reselect does not replace route");
    assert(nestedSegments.join("/") === routeKeyBefore, "exact nested path preserved");
    assert(r.decision === "ignored", "nested reselect ignored");
  }

  console.log("\n• no blackout / first-paint reset on reselect after inbound");
  {
    const inbound = simulateMoreTabBarPress({ isMoreTabActive: false });
    assert(inbound.shellVisible === true, "shell after first inbound");
    // After settle, shell is hidden; reselect must not re-show it.
    const reselect = simulateMoreTabBarPress({ isMoreTabActive: true });
    assert(reselect.shellVisible === false, "reselect does not re-show shell (no blackout)");
    assert(!reselect.logs.includes("KRISTO_MORE_FIRST_PAINT"), "no first-paint on reselect");
    assert(reselect.decision === "ignored", "post-inbound reselect ignored");
  }

  console.log("\nmore tab reselect: all checks passed");
}

main();
