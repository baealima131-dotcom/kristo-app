/**
 * Conversation Settings membership label rules.
 * Run: node --experimental-strip-types --test scripts/verify-dm-membership-label.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDmMembershipLabel } from "../apps/mobile/src/lib/dmMembershipLabel.ts";

const root = join(import.meta.dirname, "..");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

describe("buildDmMembershipLabel", () => {
  it("same church + Pastor → Member of your church • Role: Pastor", () => {
    const label = buildDmMembershipLabel({
      sharesActiveChurch: true,
      viewerChurchId: "CH7-8ST0D5",
      peerChurchId: "CH7-8ST0D5",
      peerChurchRole: "Pastor",
    });
    assert.equal(
      label.renderedLabel,
      "Member of your church • Role: Pastor"
    );
    assert.equal(label.sameChurch, true);
  });

  it("different churches + Pastor → Pastor at another church", () => {
    const label = buildDmMembershipLabel({
      sharesActiveChurch: false,
      viewerChurchId: "CH7-8ST0D5",
      peerChurchId: "CH7-57M90Y",
      peerChurchRole: "Pastor",
    });
    assert.equal(label.renderedLabel, "Pastor at another church");
    assert.equal(label.sharesActiveChurch, false);
  });

  it("different churches + Member → Member of another church", () => {
    const label = buildDmMembershipLabel({
      sharesActiveChurch: false,
      viewerChurchId: "CH7-A",
      peerChurchId: "CH7-B",
      peerChurchRole: "Member",
    });
    assert.equal(label.renderedLabel, "Member of another church");
  });

  it("uses peer church name when available", () => {
    const label = buildDmMembershipLabel({
      sharesActiveChurch: false,
      viewerChurchId: "CH7-8ST0D5",
      peerChurchId: "CH7-57M90Y",
      peerChurchName: "Ensembles of Christians",
      peerChurchRole: "Pastor",
    });
    assert.equal(
      label.renderedLabel,
      "Pastor at Ensembles of Christians"
    );
  });

  it("missing peer church → Church membership unavailable", () => {
    const label = buildDmMembershipLabel({
      sharesActiveChurch: false,
      viewerChurchId: "CH7-8ST0D5",
      peerChurchId: "",
      peerChurchRole: "Pastor",
    });
    assert.equal(
      label.renderedLabel,
      "Church membership unavailable"
    );
  });

  it("accepted DM status must not imply same church via role alone", () => {
    const label = buildDmMembershipLabel({
      // Explicit false from backend even if IDs were somehow equal in storage.
      sharesActiveChurch: false,
      viewerChurchId: "CH7-8ST0D5",
      peerChurchId: "CH7-57M90Y",
      peerChurchRole: "Pastor",
    });
    assert.notEqual(
      label.renderedLabel.includes("Member of your church"),
      true
    );
    assert.equal(label.sharesActiveChurch, false);
  });

  it("never treats storage-church ID match as same church when sharesActiveChurch is false", () => {
    // Simulates the bug: thread storage church == peer church, but viewer differs.
    const label = buildDmMembershipLabel({
      sharesActiveChurch: false,
      viewerChurchId: "CH7-8ST0D5",
      peerChurchId: "CH7-57M90Y",
      peerChurchRole: "Pastor",
    });
    assert.equal(label.renderedLabel, "Pastor at another church");
  });

  it("ID equality only when sharesActiveChurch is unset", () => {
    const same = buildDmMembershipLabel({
      viewerChurchId: "CH7-SAME",
      peerChurchId: "CH7-SAME",
      peerChurchRole: "Member",
    });
    assert.equal(
      same.renderedLabel,
      "Member of your church • Role: Member"
    );

    const different = buildDmMembershipLabel({
      viewerChurchId: "CH7-A",
      peerChurchId: "CH7-B",
      peerChurchRole: "Pastor",
    });
    assert.equal(different.renderedLabel, "Pastor at another church");
  });
});

describe("DM settings membership wiring (source)", () => {
  it("backend exposes sharesActiveChurch fields and mobile avoids storage church as viewer", () => {
    const dmLib = read("app/api/_lib/directMessages.ts");
    const api = read("apps/mobile/src/lib/directMessagesApi.ts");
    const ui = read(
      "apps/mobile/app/(tabs)/more/my-church-room/messages/[id].tsx"
    );

    assert.ok(dmLib.includes("sharesActiveChurch"));
    assert.ok(dmLib.includes("viewerChurchId"));
    assert.ok(dmLib.includes("peerChurchId"));
    assert.ok(dmLib.includes("peerChurchRole"));
    assert.ok(api.includes("sharesActiveChurch"));
    assert.ok(ui.includes("KRISTO_DM_SETTINGS_MEMBERSHIP_LABEL"));
    assert.ok(ui.includes("buildDmMembershipLabel"));
    // Must not prefer DM thread/storage churchId as viewer membership church.
    assert.ok(
      !ui.includes(
        "const viewerChurchId = String(\n      churchId ||\n        getKristoHeaders()[\n          \"x-kristo-church-id\"\n        ] ||\n        \"\"\n    ).trim();"
      )
    );
    assert.ok(
      ui.includes('dmConversationSettings?.viewerChurchId') ||
        ui.includes("dmConversationSettings?.viewerChurchId")
    );
  });
});
