import {
  apiGet,
  apiPost,
} from "@/src/lib/kristoApi";
import {
  getKristoHeaders,
} from "@/src/lib/kristoHeaders";

export type SafetySupervisorSummary = {
  userId: string;
  kristoId?: string;
  churchId: string;
  fullName?: string;
  invitationStatus?:
    | "pending"
    | "accepted";
  invitationId?: string | null;
};

export async function inviteSafetySupervisor(
  input: {
    kristoId: string;
    churchId: string;
  }
) {
  const path =
    "/api/safety/supervisors/add";

  const response: any =
    await apiPost(
      path,
      input,
      {
        headers:
          getKristoHeaders() as any,
      }
    );

  if (
    !response ||
    response.ok === false
  ) {
    throw new Error(
      String(
        response?.error ||
          "Could not invite Safety Supervisor."
      )
    );
  }

  return response as {
    ok: true;
    outcome:
      | "invited"
      | "alreadyPending"
      | "alreadySupervisor";
    supervisor:
      SafetySupervisorSummary;
  };
}

export async function fetchSafetySupervisors() {
  const path =
    "/api/safety/supervisors";

  const response: any =
    await apiGet(path, {
      headers:
        getKristoHeaders() as any,
    });

  if (
    !response ||
    response.ok === false
  ) {
    throw new Error(
      String(
        response?.error ||
          "Could not load Safety Supervisors."
      )
    );
  }

  return Array.isArray(
    response.supervisors
  )
    ? response.supervisors
    : [];
}
