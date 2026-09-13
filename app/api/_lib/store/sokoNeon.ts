import { neon } from "@neondatabase/serverless";

import { getDatabaseUrl } from "@/app/api/_lib/store/authDb";

type Sql = ReturnType<typeof neon>;

type SokoNeonGate = {
  client: Sql | null;
};

function gate(): SokoNeonGate {
  const globalState = globalThis as typeof globalThis & {
    __kristoSokoNeon?: SokoNeonGate;
  };
  if (!globalState.__kristoSokoNeon) {
    globalState.__kristoSokoNeon = { client: null };
  }
  return globalState.__kristoSokoNeon;
}

export function getSokoNeonSql() {
  const state = gate();
  if (!state.client) {
    const url = getDatabaseUrl();
    if (!url) throw new Error("Database unavailable.");
    state.client = neon(url);
  }
  return state.client;
}
