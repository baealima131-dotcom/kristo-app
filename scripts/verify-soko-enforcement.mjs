import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(
    path.join(root, relativePath),
    "utf8"
  );
}

const route = read(
  "app/api/safety/supervisor/reports/[reportId]/route.ts"
);

const store = read(
  "app/api/_lib/store/sokoSafetyDb.ts"
);

const sharedStore = read(
  "app/api/_lib/store/safetyReportDb.ts"
);

const mobile = read(
  "apps/mobile/app/(tabs)/more/safety-supervisor/reports/[reportId].tsx"
);

test(
  "SOKO decisions use the isolated adapter",
  () => {
    assert.match(
      route,
      /dbIssueSokoSafetyDecision/
    );
    assert.match(
      route,
      /boundary:\s*"soko"/
    );
    assert.match(
      sharedStore,
      /SOKO_ENFORCEMENT_ADAPTER_REQUIRED/
    );
  }
);

test(
  "all requested marketplace actions exist",
  () => {
    for (const action of [
      "contact_seller",
      "warn_seller",
      "remove_product",
      "pause_seller",
      "suspend_seller",
      "ban_seller",
    ]) {
      assert.match(
        store,
        new RegExp(action)
      );
      assert.match(
        mobile,
        new RegExp(action)
      );
    }
  }
);

test(
  "contact keeps the case open for a seller response",
  () => {
    assert.match(
      store,
      /decisionType === "contact_seller"[\s\S]*?"in_review"/
    );
    assert.match(
      store,
      /seller_response/
    );
    assert.match(
      store,
      /soko_seller_responded/
    );
  }
);

test(
  "seller ban is supervisor-only and Kristo-safe",
  () => {
    assert.match(
      store,
      /actorRole === "agent"[\s\S]*?decisionType === "ban_seller"/
    );
    assert.match(
      mobile,
      /The Kristo account remains separate/
    );
    assert.doesNotMatch(
      store,
      /kristo_safety_account_enforcements/
    );
  }
);

test(
  "marketplace visibility reads SOKO enforcement status",
  () => {
    assert.match(
      store,
      /hiddenProductIds/
    );
    assert.match(
      store,
      /sellerStatus/
    );
  }
);
