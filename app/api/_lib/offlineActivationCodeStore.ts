import { readJsonFile, updateJsonFile } from "@/app/api/_lib/store/fs";

export type ActivationCodeStatus = "available" | "disabled" | "redeemed";
export type ActivationBatchStatus = "active" | "disabled";

export type ActivationCode = {
  id: string;
  code: string;
  batchId: string;
  countryCode: string;
  durationMonths: number;
  status: ActivationCodeStatus;
  createdAt: string;
  createdByUserId: string;
  redeemedAt?: string | null;
  redeemedByChurchId?: string | null;
  redeemedByUserId?: string | null;
};

export type ActivationCodeBatch = {
  batchId: string;
  countryCode: string;
  durationMonths: number;
  quantity: number;
  createdByUserId: string;
  createdAt: string;
  status: ActivationBatchStatus;
  codes: ActivationCode[];
};

export type OfflineActivationCodeStore = {
  batches: ActivationCodeBatch[];
};

const STORE_FILE = "offline_activation_codes.json";

export const ACTIVATION_COUNTRY_CODES = ["BDI", "CD", "TZ", "US"] as const;
export type ActivationCountryCode = (typeof ACTIVATION_COUNTRY_CODES)[number];

export const ACTIVATION_DURATION_MONTHS = [1, 3, 6, 12] as const;
export type ActivationDurationMonths = (typeof ACTIVATION_DURATION_MONTHS)[number];

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_BATCH_QUANTITY = 200;

function randomSegment(length = 4): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}

function newBatchId(): string {
  return `batch_${Date.now().toString(36)}_${randomSegment(6)}`;
}

function newCodeId(): string {
  return `actcode_${Date.now().toString(36)}_${randomSegment(8)}`;
}

export function formatActivationCode(countryCode: string, durationMonths: number): string {
  return `KR-${countryCode}-M${durationMonths}-${randomSegment()}-${randomSegment()}`;
}

export function isAllowedCountryCode(value: unknown): value is ActivationCountryCode {
  return ACTIVATION_COUNTRY_CODES.includes(String(value || "").trim().toUpperCase() as ActivationCountryCode);
}

export function isAllowedDurationMonths(value: unknown): value is ActivationDurationMonths {
  const n = Number(value);
  return ACTIVATION_DURATION_MONTHS.includes(n as ActivationDurationMonths);
}

async function readStore(): Promise<OfflineActivationCodeStore> {
  const rows = await readJsonFile<OfflineActivationCodeStore>(STORE_FILE, { batches: [] });
  return {
    batches: Array.isArray(rows?.batches) ? rows.batches : [],
  };
}

function collectExistingCodes(store: OfflineActivationCodeStore): Set<string> {
  const seen = new Set<string>();
  for (const batch of store.batches) {
    for (const code of batch.codes || []) {
      const token = String(code?.code || "").trim().toUpperCase();
      if (token) seen.add(token);
    }
  }
  return seen;
}

function generateUniqueCodes(
  existing: Set<string>,
  countryCode: ActivationCountryCode,
  durationMonths: ActivationDurationMonths,
  quantity: number
): string[] {
  const out: string[] = [];
  const local = new Set(existing);

  while (out.length < quantity) {
    const candidate = formatActivationCode(countryCode, durationMonths);
    const key = candidate.toUpperCase();
    if (local.has(key)) continue;
    local.add(key);
    out.push(candidate);
  }

  return out;
}

export type GenerateActivationBatchInput = {
  countryCode: ActivationCountryCode;
  durationMonths: ActivationDurationMonths;
  quantity: number;
  createdByUserId: string;
};

export type GenerateActivationBatchResult = {
  batch: ActivationCodeBatch;
  codes: ActivationCode[];
};

export async function generateActivationCodeBatch(
  input: GenerateActivationBatchInput
): Promise<GenerateActivationBatchResult> {
  const countryCode = String(input.countryCode || "").trim().toUpperCase() as ActivationCountryCode;
  const durationMonths = Number(input.durationMonths) as ActivationDurationMonths;
  const quantity = Math.floor(Number(input.quantity));
  const createdByUserId = String(input.createdByUserId || "").trim();

  if (!isAllowedCountryCode(countryCode)) {
    throw new Error("Invalid countryCode");
  }
  if (!isAllowedDurationMonths(durationMonths)) {
    throw new Error("Invalid durationMonths");
  }
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAX_BATCH_QUANTITY) {
    throw new Error(`Quantity must be between 1 and ${MAX_BATCH_QUANTITY}`);
  }
  if (!createdByUserId) {
    throw new Error("createdByUserId required");
  }

  const createdAt = new Date().toISOString();
  const batchId = newBatchId();

  let createdBatch: ActivationCodeBatch | null = null;

  await updateJsonFile<OfflineActivationCodeStore>(
    STORE_FILE,
    (current) => {
      const store: OfflineActivationCodeStore = {
        batches: Array.isArray(current?.batches) ? current.batches : [],
      };
      const existing = collectExistingCodes(store);
      const codeStrings = generateUniqueCodes(existing, countryCode, durationMonths, quantity);

      const codes: ActivationCode[] = codeStrings.map((code) => ({
        id: newCodeId(),
        code,
        batchId,
        countryCode,
        durationMonths,
        status: "available",
        createdAt,
        createdByUserId,
        redeemedAt: null,
        redeemedByChurchId: null,
        redeemedByUserId: null,
      }));

      const batch: ActivationCodeBatch = {
        batchId,
        countryCode,
        durationMonths,
        quantity,
        createdByUserId,
        createdAt,
        status: "active",
        codes,
      };

      createdBatch = batch;
      return {
        batches: [batch, ...store.batches],
      };
    },
    { batches: [] }
  );

  if (!createdBatch) {
    throw new Error("Failed to create batch");
  }

  return {
    batch: createdBatch,
    codes: createdBatch.codes,
  };
}

export type ActivationCodesListResult = {
  batches: ActivationCodeBatch[];
  codes: ActivationCode[];
  totals: {
    batches: number;
    codes: number;
    available: number;
    disabled: number;
    redeemed: number;
  };
};

export async function listActivationCodes(limit = 200): Promise<ActivationCodesListResult> {
  const store = await readStore();
  const batches = [...store.batches].sort(
    (a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || ""))
  );

  const codes = batches
    .flatMap((batch) => batch.codes || [])
    .sort((a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || "")))
    .slice(0, Math.max(1, Math.min(limit, 1000)));

  const allCodes = batches.flatMap((batch) => batch.codes || []);
  const totals = {
    batches: batches.length,
    codes: allCodes.length,
    available: allCodes.filter((c) => c.status === "available").length,
    disabled: allCodes.filter((c) => c.status === "disabled").length,
    redeemed: allCodes.filter((c) => c.status === "redeemed").length,
  };

  return { batches, codes, totals };
}
