import { getKristoHeaders } from "@/src/lib/kristoHeaders";

const base = process.env.EXPO_PUBLIC_API_BASE;

function getHeaders() {
  return {
    ...getKristoHeaders(),
    "Content-Type": "application/json",
    accept: "application/json",
  };
}

export async function getMinistryMessages(ministryId: string) {
  const r = await fetch(`${base}/api/church/ministry-chat?ministryId=${ministryId}`, {
    headers: getHeaders(),
  });
  const j = await r.json();
  return j?.data || [];
}

export async function sendMinistryMessage(ministryId: string, text: string) {
  const r = await fetch(`${base}/api/church/ministry-chat`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      ministryId,
      text,
    }),
  });
  const j = await r.json();
  return j?.data;
}
