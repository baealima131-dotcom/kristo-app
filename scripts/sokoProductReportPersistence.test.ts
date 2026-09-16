import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { RATE_LIMITS, canTransitionReport } from "../app/api/_lib/sokoEngagementPolicy.ts";
import {
  claimOpenProductReport,
  consumeEngagementRateLimit,
  ensureProductReportOpenedEvent,
  readOpenProductReportSlot,
  syncSnapshotOpenFlag,
  type SqlTag,
} from "../app/api/_lib/sokoReportPersistence.ts";

function openDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE soko_product_report_snapshots (
      report_id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      reporter_user_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      reason_code TEXT,
      open INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX soko_product_report_open_uidx
      ON soko_product_report_snapshots (reporter_user_id, product_id, reason_code)
      WHERE open = 1;
    CREATE TABLE kristo_safety_reports (
      id TEXT PRIMARY KEY,
      report_code TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE kristo_safety_report_events (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor_user_id TEXT,
      actor_role TEXT,
      title TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX soko_product_report_opened_event_uidx
      ON kristo_safety_report_events (report_id)
      WHERE event_type = 'report_opened';
    CREATE TABLE soko_engagement_rate_buckets (
      bucket_key TEXT PRIMARY KEY,
      window_start TEXT NOT NULL,
      window_start_ms INTEGER,
      hits INTEGER NOT NULL
    );
  `);
  const sql: SqlTag = async (strings, ...values) => {
    let text = "";
    strings.forEach((part, index) => {
      text += part;
      if (index < values.length) text += "?";
    });
    text = text.replace(/::jsonb/g, "").replace(/\s+/g, " ").trim();
    if (/^select\b/i.test(text) || /returning\b/i.test(text)) {
      return db.prepare(text).all(...(values as never[]));
    }
    db.prepare(text).run(...(values as never[]));
    return [];
  };
  return { db, sql };
}

function counts(db: DatabaseSync) {
  const reports = db.prepare("SELECT COUNT(*) AS count FROM kristo_safety_reports").get() as { count: number };
  const snapshots = db.prepare("SELECT COUNT(*) AS count FROM soko_product_report_snapshots").get() as { count: number };
  const events = db.prepare("SELECT COUNT(*) AS count FROM kristo_safety_report_events WHERE event_type = 'report_opened'").get() as { count: number };
  return { reports: Number(reports.count), snapshots: Number(snapshots.count), events: Number(events.count) };
}

const claimInput = {
  productId: "product-1",
  reporterUserId: "user-1",
  reason: "Misleading description",
  reasonCode: "misleading_description",
  snapshot: { title: "Trusted title", sellerUserId: "seller-1" },
};

test("crash after snapshot claim resumes the same reserved report id", async () => {
  const { db, sql } = openDatabase();
  const first = await claimOpenProductReport(sql, { ...claimInput, reportId: "sokorpt_reserved" });
  assert.equal(first.created, true);
  const crashed = await readOpenProductReportSlot(sql, claimInput);
  assert.equal(crashed?.kind, "resume");
  if (crashed?.kind !== "resume") return;
  assert.equal(crashed.reportId, "sokorpt_reserved");
  db.prepare("INSERT INTO kristo_safety_reports (id, report_code, status) VALUES ('sokorpt_reserved', 'R-1', 'open')").run();
  await ensureProductReportOpenedEvent(sql, {
    reportId: "sokorpt_reserved",
    actorUserId: "user-1",
    details: "Misleading description",
  });
  const recovered = await readOpenProductReportSlot(sql, claimInput);
  assert.equal(recovered?.kind, "canonical");
  if (recovered?.kind === "canonical") assert.equal(recovered.report.id, "sokorpt_reserved");
  assert.deepEqual(counts(db), { reports: 1, snapshots: 1, events: 1 });
});

test("unique-index duplicate resumes an orphan claim instead of returning a missing report", async () => {
  const { db, sql } = openDatabase();
  await claimOpenProductReport(sql, { ...claimInput, reportId: "sokorpt_orphan" });
  const duplicate = await claimOpenProductReport(sql, { ...claimInput, reportId: "sokorpt_other" });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.reportId, "sokorpt_orphan");
  assert.equal(counts(db).snapshots, 1);
  db.prepare("INSERT INTO kristo_safety_reports (id, report_code, status) VALUES ('sokorpt_orphan', 'R-9', 'open')").run();
  const again = await claimOpenProductReport(sql, { ...claimInput, reportId: "sokorpt_third" });
  assert.equal(again.created, false);
  if (!again.created) {
    assert.equal(again.kind, "canonical");
    assert.equal(again.reportId, "sokorpt_orphan");
  }
});

test("20 concurrent duplicate opens create one report, snapshot, and opening event", async () => {
  const { db, sql } = openDatabase();
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      claimOpenProductReport(sql, { ...claimInput, reportId: `sokorpt_${index}` })
    )
  );
  const reserved = results.find((result) => result.created)?.reportId || results[0]?.reportId;
  assert.ok(reserved);
  assert.equal(results.filter((result) => result.created).length, 1);
  assert.ok(results.every((result) => result.reportId === reserved));
  db.prepare("INSERT INTO kristo_safety_reports (id, report_code, status) VALUES (?, 'R-20', 'open')").run(reserved);
  await Promise.all(
    results.map(() =>
      ensureProductReportOpenedEvent(sql, {
        reportId: String(reserved),
        actorUserId: "user-1",
        details: "opened",
      })
    )
  );
  assert.deepEqual(counts(db), { reports: 1, snapshots: 1, events: 1 });
});

test("terminal reports release the open slot; assigned and escalated keep it", async () => {
  const { db, sql } = openDatabase();
  await claimOpenProductReport(sql, { ...claimInput, reportId: "sokorpt_live" });
  db.prepare("INSERT INTO kristo_safety_reports (id, report_code, status) VALUES ('sokorpt_live', 'R-2', 'assigned')").run();
  assert.equal(await syncSnapshotOpenFlag(sql, "sokorpt_live", "assigned"), false);
  assert.equal(await syncSnapshotOpenFlag(sql, "sokorpt_live", "escalated"), false);
  const blocked = await readOpenProductReportSlot(sql, claimInput);
  assert.equal(blocked?.kind, "canonical");
  const second = await claimOpenProductReport(sql, { ...claimInput, reportId: "sokorpt_new" });
  assert.equal(second.created, false);
  assert.equal(second.reportId, "sokorpt_live");

  db.prepare("UPDATE kristo_safety_reports SET status = 'resolved' WHERE id = 'sokorpt_live'").run();
  assert.equal(await syncSnapshotOpenFlag(sql, "sokorpt_live", "resolved"), true);
  const released = await readOpenProductReportSlot(sql, claimInput);
  assert.equal(released, null);
  const later = await claimOpenProductReport(sql, { ...claimInput, reportId: "sokorpt_later" });
  assert.equal(later.created, true);
  assert.equal(later.reportId, "sokorpt_later");
});

test("failed transition does not change the open flag", async () => {
  const { db, sql } = openDatabase();
  await claimOpenProductReport(sql, { ...claimInput, reportId: "sokorpt_open" });
  db.prepare("INSERT INTO kristo_safety_reports (id, report_code, status) VALUES ('sokorpt_open', 'R-3', 'assigned')").run();
  assert.equal(canTransitionReport("assigned", "open"), false);
  assert.equal(await syncSnapshotOpenFlag(sql, "sokorpt_open", "assigned"), false);
  const row = db.prepare("SELECT open FROM soko_product_report_snapshots WHERE report_id = 'sokorpt_open'").get() as { open: number };
  assert.equal(Number(row.open), 1);
});

test("concurrent rate-limit upserts enforce the ceiling and a denial writes nothing else", async () => {
  const { sql } = openDatabase();
  const now = 1_700_000_000_000;
  const calls = await Promise.all(
    Array.from({ length: 20 }, () =>
      consumeEngagementRateLimit(sql, "report:user:user-1", RATE_LIMITS.reportUserHour.limit, RATE_LIMITS.reportUserHour.windowMs, now)
    )
  );
  assert.equal(calls.filter((result) => result.allowed).length, RATE_LIMITS.reportUserHour.limit);
  assert.equal(calls.filter((result) => !result.allowed).length, 20 - RATE_LIMITS.reportUserHour.limit);
  const expired = await consumeEngagementRateLimit(
    sql,
    "report:user:user-1",
    RATE_LIMITS.reportUserHour.limit,
    RATE_LIMITS.reportUserHour.windowMs,
    now + RATE_LIMITS.reportUserHour.windowMs + 1
  );
  assert.equal(expired.allowed, true);
  assert.equal(expired.hits, 1);
  const denied = await consumeEngagementRateLimit(sql, "like:burst:user-1", 1, 10_000, now);
  assert.equal(denied.allowed, true);
  const blocked = await consumeEngagementRateLimit(sql, "like:burst:user-1", 1, 10_000, now);
  assert.equal(blocked.allowed, false);
});
