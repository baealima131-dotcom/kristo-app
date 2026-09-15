import { randomUUID } from "node:crypto";

import { getSokoNeonSql } from "./sokoNeon";
import {
  cleanSokoPolicyText,
  policyVersionsEqual,
  SOKO_CURRENT_POLICY_VERSIONS,
  type SokoPolicyVersions,
} from "@/app/api/_lib/sokoLegalPolicy";

export type SokoLegalConsentRecord = {
  id: string;
  userId: string;
  termsVersion: string;
  privacyVersion: string;
  marketplaceRulesVersion: string;
  safetyVersion: string;
  acceptedAt: string;
  appVersion: string;
  platform: string;
  locale: string;
};

type SchemaGate = {
  promise: Promise<void> | null;
};

function schemaGate(): SchemaGate {
  const globalState = globalThis as typeof globalThis & {
    __kristoSokoLegalConsentSchema?: SchemaGate;
  };
  if (!globalState.__kristoSokoLegalConsentSchema) {
    globalState.__kristoSokoLegalConsentSchema = { promise: null };
  }
  return globalState.__kristoSokoLegalConsentSchema;
}

function sqlClient() {
  return getSokoNeonSql();
}

function dateText(value: unknown) {
  if (!value) return "";
  try {
    return new Date(value as string | number | Date).toISOString();
  } catch {
    return String(value || "");
  }
}

function recordFromRow(row: Record<string, any>): SokoLegalConsentRecord {
  return {
    id: String(row.id || ""),
    userId: String(row.user_id || ""),
    termsVersion: String(row.terms_version || ""),
    privacyVersion: String(row.privacy_version || ""),
    marketplaceRulesVersion: String(row.marketplace_rules_version || ""),
    safetyVersion: String(row.safety_version || ""),
    acceptedAt: dateText(row.accepted_at),
    appVersion: String(row.app_version || ""),
    platform: String(row.platform || ""),
    locale: String(row.locale || ""),
  };
}

function versionsFromRecord(record: SokoLegalConsentRecord): SokoPolicyVersions {
  return {
    termsVersion: record.termsVersion,
    privacyVersion: record.privacyVersion,
    marketplaceRulesVersion: record.marketplaceRulesVersion,
    safetyVersion: record.safetyVersion,
  };
}

async function ensureSchema() {
  const gate = schemaGate();
  if (!gate.promise) {
    gate.promise = (async () => {
      const sql = sqlClient();
      await sql`
        CREATE TABLE IF NOT EXISTS soko_legal_consent (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          terms_version TEXT NOT NULL,
          privacy_version TEXT NOT NULL,
          marketplace_rules_version TEXT NOT NULL,
          safety_version TEXT NOT NULL,
          accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          app_version TEXT NOT NULL DEFAULT '',
          platform TEXT NOT NULL DEFAULT '',
          locale TEXT NOT NULL DEFAULT '',
          UNIQUE (
            user_id,
            terms_version,
            privacy_version,
            marketplace_rules_version,
            safety_version
          )
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS soko_legal_consent_user_idx
        ON soko_legal_consent (user_id, accepted_at DESC)
      `;
    })().catch((error) => {
      gate.promise = null;
      throw error;
    });
  }
  await gate.promise;
}

export async function dbLatestSokoLegalConsent(userId: string) {
  await ensureSchema();
  const id = cleanSokoPolicyText(userId, 180);
  if (!id) return null;
  const sql = sqlClient();
  const rows = (await sql`
    SELECT *
    FROM soko_legal_consent
    WHERE user_id=${id}
    ORDER BY accepted_at DESC
    LIMIT 1
  `) as Array<Record<string, any>>;
  return rows[0] ? recordFromRow(rows[0]) : null;
}

export async function dbAcceptSokoLegalConsent(input: {
  userId: string;
  appVersion: string;
  platform: string;
  locale: string;
}) {
  await ensureSchema();
  const userId = cleanSokoPolicyText(input.userId, 180);
  if (!userId) {
    throw new Error("A Kristo account is required to record SOKO consent.");
  }
  const versions = SOKO_CURRENT_POLICY_VERSIONS;
  const appVersion = cleanSokoPolicyText(input.appVersion, 24) || "0.0.0";
  const platform = cleanSokoPolicyText(input.platform, 16) || "unknown";
  const locale = cleanSokoPolicyText(input.locale, 16) || "en";
  const sql = sqlClient();
  const id = `sokolegal_${randomUUID()}`;
  const inserted = (await sql`
    INSERT INTO soko_legal_consent (
      id,
      user_id,
      terms_version,
      privacy_version,
      marketplace_rules_version,
      safety_version,
      app_version,
      platform,
      locale
    )
    VALUES (
      ${id},
      ${userId},
      ${versions.termsVersion},
      ${versions.privacyVersion},
      ${versions.marketplaceRulesVersion},
      ${versions.safetyVersion},
      ${appVersion},
      ${platform},
      ${locale}
    )
    ON CONFLICT (
      user_id,
      terms_version,
      privacy_version,
      marketplace_rules_version,
      safety_version
    )
    DO NOTHING
    RETURNING *
  `) as Array<Record<string, any>>;

  if (inserted[0]) {
    return {
      record: recordFromRow(inserted[0]),
      duplicate: false,
    };
  }

  const existing = (await sql`
    SELECT *
    FROM soko_legal_consent
    WHERE user_id=${userId}
      AND terms_version=${versions.termsVersion}
      AND privacy_version=${versions.privacyVersion}
      AND marketplace_rules_version=${versions.marketplaceRulesVersion}
      AND safety_version=${versions.safetyVersion}
    LIMIT 1
  `) as Array<Record<string, any>>;

  if (!existing[0]) {
    throw new Error("Could not record SOKO policy consent.");
  }

  return {
    record: recordFromRow(existing[0]),
    duplicate: true,
  };
}

export function sokoConsentMatchesCurrent(
  record?: SokoLegalConsentRecord | null
) {
  if (!record) return false;
  return policyVersionsEqual(
    versionsFromRecord(record),
    SOKO_CURRENT_POLICY_VERSIONS
  );
}

export function acceptedVersionsFromConsent(
  record?: SokoLegalConsentRecord | null
): SokoPolicyVersions | null {
  return record ? versionsFromRecord(record) : null;
}
