import {
  apiGet,
  apiPost,
} from "@/src/lib/kristoApi";
import {
  getKristoHeaders,
} from "@/src/lib/kristoHeaders";

export const SAFETY_SUPERVISOR_INVITE_KIND =
  "safety_supervisor" as const;

export type SafetySupervisorProfileInvite = {
  id: string;
  invitationId: string;
  kind:
    typeof SAFETY_SUPERVISOR_INVITE_KIND;
  title: string;
  message: string;
  referenceChurchLabel: string;
  churchId: string;
  status: "pending";
  createdAt: string;
};

export function isSafetySupervisorProfileInvite(
  value: unknown
): value is SafetySupervisorProfileInvite {
  return (
    String(
      (value as any)?.kind || ""
    ) ===
    SAFETY_SUPERVISOR_INVITE_KIND
  );
}

export async function loadSafetySupervisorProfileInvites():
  Promise<SafetySupervisorProfileInvite[]> {
  const path =
    "/api/safety/invitations";

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
          "Could not load Safety invitations."
      )
    );
  }

  const invitations =
    Array.isArray(
      response.invitations
    )
      ? response.invitations
      : [];

  return invitations
    .filter(
      (row: any) =>
        [
          "Safety_Supervisor",
          "Safety_Agent",
        ].includes(
          String(row?.role || "")
        ) &&
        String(row?.status || "") ===
          "pending"
    )
    .map((row: any) => {
      const role =
        String(row?.role || "");

      const isSafetyAgent =
        role === "Safety_Agent";

      return {
      id: String(row.id || ""),
      invitationId: String(
        row.id || ""
      ),
      kind:
        SAFETY_SUPERVISOR_INVITE_KIND,
      title:
        isSafetyAgent
          ? "Safety Agent invitation"
          : "Safety Supervisor invitation",
      message:
        isSafetyAgent
          ? "You were invited to become a Safety Agent. Accept to receive assigned reports and investigation access."
          : "You were invited to help review reports and protect the Kristo community.",
      referenceChurchLabel:
        `Church ID: ${String(
          row.churchId || ""
        )}`,
      churchId: String(
        row.churchId || ""
      ),
      status: "pending" as const,
      createdAt: String(
        row.createdAt || ""
      ),
      };
    });
}

export async function respondSafetySupervisorProfileInvite(
  input: {
    invitationId: string;
    action:
      | "accept"
      | "decline";
  }
) {
  const path =
    "/api/safety/invitations/respond";

  const response: any =
    await apiPost(
      path,
      {
        invitationId:
          input.invitationId,
        action: input.action,
      },
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
          "Could not respond to Safety invitation."
      )
    );
  }

  return response;
}
