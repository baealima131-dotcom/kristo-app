"use client";

export type Step = {
  id: "s1" | "s2" | "s3" | "s4";
  title: string;
  desc: string;
  done: boolean;
};

const BASE_KEY = "courtship_steps_v1";

export function defaultSteps(): Step[] {
  return [
    { id: "s1", title: "1. Agreement", desc: "Mnakubaliana nia + mipaka + uaminifu.", done: false },
    {
      id: "s2",
      title: "2. Core Questions",
      desc: "Maswali ya msingi (imani, maono, maadili, fedha, familia).",
      done: false,
    },
    {
      id: "s3",
      title: "3. Counseling Prep",
      desc: "Tayari kwa ushauri wa wachungaji (mambo ya msingi yamekamilika).",
      done: false,
    },
    {
      id: "s4",
      title: "4. Pastor Approval",
      desc: "Pastor mmoja akisha-approve → Engagement Mode.",
      done: false, // always driven by pastor approval
    },
  ];
}

function key(matchId: string) {
  return `${BASE_KEY}:${matchId}`;
}

export function loadSteps(matchId: string): Step[] {
  if (typeof window === "undefined") return defaultSteps();
  try {
    const raw = localStorage.getItem(key(matchId));
    if (!raw) return defaultSteps();
    const parsed = JSON.parse(raw) as Step[];
    // fallback safety
    if (!Array.isArray(parsed) || parsed.length < 4) return defaultSteps();
    return parsed;
  } catch {
    return defaultSteps();
  }
}

export function saveSteps(matchId: string, steps: Step[]) {
  localStorage.setItem(key(matchId), JSON.stringify(steps));
}

export function resetSteps(matchId: string) {
  localStorage.setItem(key(matchId), JSON.stringify(defaultSteps()));
}
