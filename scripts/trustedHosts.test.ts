import assert from "node:assert/strict";
import test from "node:test";
import { eligibleTrustedHostMembers, reconcileTrustedHostSlots, serializeTrustedHosts } from "../apps/mobile/src/lib/trustedHostMembers.ts";
import { canManageTrustedHosts } from "../app/api/_lib/mediaHostAuthority.ts";

const churchId = "CH7-TEST";
const member = (userId: string, status = "Active", role = "Member", memberChurchId = churchId) => ({
  userId, status, role, churchId: memberChurchId, name: userId,
});

test("active same-church member appears; pending, inactive, other-church and Pastor do not", () => {
  const response = { ok: true, data: [
    member("active"), member("pending", "Requested"), member("inactive", "Left"),
    member("other", "Active", "Member", "CH7-OTHER"), member("pastor", "Active", "Pastor"),
  ] };
  assert.deepEqual(eligibleTrustedHostMembers(response, churchId, []).map((m) => m.userId), ["active"]);
});

test("existing host is excluded", () => {
  assert.deepEqual(eligibleTrustedHostMembers({ ok: true, data: [member("host"), member("new")] }, churchId, ["HOST"])
    .map((m) => m.userId), ["new"]);
});

test("legacy active-member response without status or churchId remains eligible", () => {
  const legacyResponse = { ok: true, data: [
    { userId: "chance", role: "Member", name: "Chance Isabella" },
    { userId: "elie", roleLabel: "Member", name: "Elie Juma" },
    { userId: "pastor", role: "Pastor", name: "Prince Kabika" },
  ] };

  assert.deepEqual(
    eligibleTrustedHostMembers(legacyResponse, churchId, []).map((m) => m.userId),
    ["chance", "elie"],
  );
});

test("legacy member response keeps an existing host instead of clearing all slots", () => {
  const host = { userId: "chance", name: "Chance Isabella", role: "Member" };
  const result = reconcileTrustedHostSlots(
    [host, null, null],
    { ok: true, data: [{ userId: "chance", role: "Member", name: "Chance Isabella" }] },
    churchId,
  );

  assert.deepEqual(result.staleHosts, []);
  assert.equal(result.hosts[0], host);
});

test("explicit inactive status or different church is still rejected", () => {
  const response = { ok: true, data: [
    member("active", "Active", "Member", "ch7-test"),
    member("left", "Left"),
    member("other", "Active", "Member", "CH7-OTHER"),
  ] };

  assert.deepEqual(eligibleTrustedHostMembers(response, churchId, []).map((m) => m.userId), ["active"]);
});

test("Host 3 selection is included in the three-host save payload", () => {
  const hosts = ["one", "two", "three", "four"].map((userId) => ({ userId, name: userId, role: "Member" }));
  assert.deepEqual(serializeTrustedHosts(hosts).map((host) => host.userId), ["one", "two", "three"]);
});

test("failed member request is an error, while a successful empty list is an empty state", () => {
  assert.throws(() => eligibleTrustedHostMembers({ ok: false, error: "Unauthorized" }, churchId, []), /Unauthorized/);
  assert.throws(() => eligibleTrustedHostMembers(undefined, churchId, []), /Could not load/);
  assert.deepEqual(eligibleTrustedHostMembers({ ok: true, data: [] }, churchId, []), []);
});

test("only the church’s canonical Pastor or active church admin may modify hosts", () => {
  assert.equal(canManageTrustedHosts("pastor", "PASTOR"), true);
  assert.equal(canManageTrustedHosts("admin", "pastor", "Church_Admin"), true);
  assert.equal(canManageTrustedHosts("admin", "pastor"), false);
  assert.equal(canManageTrustedHosts("member", "pastor", "Member"), false);
  assert.equal(canManageTrustedHosts("", "pastor"), false);
});

test("inactive, nonmember, and other-church assigned hosts are identified and excluded from save", () => {
  const hosts = ["active", "left", "banned", "rejected", "requested", "missing", "other"].map((userId) => ({ userId, name: userId, role: "Member" }));
  const result = reconcileTrustedHostSlots(hosts, { ok: true, data: [
    member("active"), member("left", "Left"), member("banned", "Banned"),
    member("rejected", "Rejected"), member("requested", "Requested"),
    member("other", "Active", "Member", "CH7-OTHER"),
  ] }, churchId);
  assert.deepEqual(result.staleHosts.map((host) => host.name), ["left", "banned", "rejected", "requested", "missing", "other"]);
  assert.deepEqual(serializeTrustedHosts(result.hosts).map((host) => host.userId), ["active"]);
  assert.equal(result.hosts[0], hosts[0]);
});

test("an eligible replacement can fill the stale slot and be saved", () => {
  const hosts = ["one", "stale", "three"].map((userId) => ({ userId, name: userId, role: "Member" }));
  const response = { ok: true, data: [member("one"), member("replacement"), member("three")] };
  const reconciled = reconcileTrustedHostSlots(hosts, response, churchId);
  assert.deepEqual(reconciled.staleHosts.map((host) => host.userId), ["stale"]);
  reconciled.hosts[1] = { userId: "replacement", name: "replacement", role: "Member" };
  assert.deepEqual(serializeTrustedHosts(reconciled.hosts).map((host) => host.userId), ["one", "replacement", "three"]);
});

test("active existing hosts keep their assigned slots", () => {
  const hosts = ["one", "two"].map((userId) => ({ userId, name: userId, role: "Member" }));
  const result = reconcileTrustedHostSlots([hosts[0], hosts[1], null],
    { ok: true, data: [member("one"), member("two")] }, churchId);
  assert.deepEqual(result.staleHosts, []);
  assert.equal(result.hosts[0], hosts[0]);
  assert.equal(result.hosts[1], hosts[1]);
  assert.equal(result.hosts[2], null);
});

test("failed reconciliation cannot mark existing hosts stale or permit a save", () => {
  assert.throws(() => reconcileTrustedHostSlots([{ userId: "one", name: "one" }],
    { ok: false, error: "Unauthorized" }, churchId), /Unauthorized/);
});
