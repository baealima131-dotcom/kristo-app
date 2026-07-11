import type {
  MsgItem,
  ThreadMeta,
} from "@/src/lib/messagesStore";

export type AppointmentHubSection =
  | "needs_action"
  | "upcoming"
  | "negotiation"
  | "past"
  | "rejected";

export type AppointmentHubItem = {
  appointmentId: string;
  threadId: string;
  threadTitle: string;
  threadSub: string;
  status: string;
  requesterId: string;
  recipientId: string;
  requesterName: string;
  recipientName: string;
  otherName: string;
  otherAvatarUri: string;
  message: string;
  date: string;
  time: string;
  durationMin: number;
  location: string;
  address: string;
  createdAt: number;
  updatedAt: number;
  workflowSenderUserId: string;
  section: AppointmentHubSection;
  actionLabel: string;
  needsAction: boolean;
  startsAtMs: number;
};

type MessageSnapshot = {
  threads: Record<string, ThreadMeta>;
  messages: Record<string, MsgItem[]>;
};

const APPOINTMENT_KINDS = new Set([
  "appointment_request",
  "appointment_response",
  "appointment_time_proposed",
  "appointment_confirmed",
]);

function text(value: unknown) {
  return String(value || "").trim();
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? parsed
    : fallback;
}

function appointmentIdFromMessage(
  message: MsgItem
) {
  return text(
    (message.card as any)?.appointmentId
  );
}

function isAppointmentMessage(
  message: MsgItem
) {
  const kind = text(message.kind);

  if (APPOINTMENT_KINDS.has(kind)) {
    return !!appointmentIdFromMessage(
      message
    );
  }

  const cardType = text(
    (message.card as any)?.type
  );

  return (
    APPOINTMENT_KINDS.has(cardType) &&
    !!appointmentIdFromMessage(message)
  );
}

function resolveStartsAtMs(
  card: Record<string, any>
) {
  const direct =
    numberValue(card.startMs) ||
    numberValue(card.startsAtMs) ||
    numberValue(card.startAtMs);

  if (direct > 0) return direct;

  const iso = text(
    card.startAt ||
      card.startsAt ||
      card.datetime ||
      card.dateTime
  );

  if (iso) {
    const parsed = Date.parse(iso);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  const date = text(card.date);
  const time = text(card.time);

  if (date && time) {
    const parsed = Date.parse(
      `${date} ${time}`
    );

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  if (date) {
    const parsed = Date.parse(date);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function statusOf(
  card: Record<string, any>
) {
  return (
    text(card.status).toLowerCase() ||
    "pending"
  );
}

function senderUserIdOf(
  message: MsgItem,
  card: Record<string, any>
) {
  return text(
    card.senderUserId ||
      message.senderUserId ||
      card.workflowSenderUserId
  );
}

function sectionFor(input: {
  status: string;
  currentUserId: string;
  requesterId: string;
  recipientId: string;
  workflowSenderUserId: string;
  startsAtMs: number;
  nowMs: number;
}) {
  const {
    status,
    currentUserId,
    requesterId,
    recipientId,
    workflowSenderUserId,
    startsAtMs,
    nowMs,
  } = input;

  const negotiationReceived =
    status === "reschedule_requested" &&
    !!workflowSenderUserId &&
    workflowSenderUserId !==
      currentUserId;

  const needsAction =
    (
      status === "pending" &&
      currentUserId === recipientId
    ) ||
    (
      (
        status ===
          "accepted_awaiting_time" ||
        status === "accepted"
      ) &&
      currentUserId === recipientId
    ) ||
    (
      status === "time_proposed" &&
      currentUserId === requesterId
    ) ||
    negotiationReceived;

  if (needsAction) {
    return {
      section:
        "needs_action" as const,
      needsAction: true,
    };
  }

  if (
    status === "rejected" ||
    status === "cancelled"
  ) {
    return {
      section: "rejected" as const,
      needsAction: false,
    };
  }

  if (
    status === "confirmed" &&
    startsAtMs > 0 &&
    startsAtMs < nowMs
  ) {
    return {
      section: "past" as const,
      needsAction: false,
    };
  }

  if (status === "confirmed") {
    return {
      section: "upcoming" as const,
      needsAction: false,
    };
  }

  return {
    section: "negotiation" as const,
    needsAction: false,
  };
}

function actionLabelFor(input: {
  status: string;
  currentUserId: string;
  requesterId: string;
  recipientId: string;
  workflowSenderUserId: string;
}) {
  const {
    status,
    currentUserId,
    requesterId,
    recipientId,
    workflowSenderUserId,
  } = input;

  if (
    status === "pending" &&
    currentUserId === recipientId
  ) {
    return "Respond";
  }

  if (
    (
      status ===
        "accepted_awaiting_time" ||
      status === "accepted"
    ) &&
    currentUserId === recipientId
  ) {
    return "Choose time";
  }

  if (
    status === "time_proposed" &&
    currentUserId === requesterId
  ) {
    return "Confirm or negotiate";
  }

  if (
    status === "reschedule_requested" &&
    workflowSenderUserId &&
    workflowSenderUserId !== currentUserId
  ) {
    return "Reply";
  }

  if (status === "confirmed") {
    return "View appointment";
  }

  if (
    status === "rejected" ||
    status === "cancelled"
  ) {
    return "View details";
  }

  return "Open conversation";
}

export function buildAppointmentHubItems(
  snapshot: MessageSnapshot,
  currentUserId: string,
  nowMs = Date.now()
): AppointmentHubItem[] {
  const userId = text(currentUserId);

  if (!userId) return [];

  const byAppointmentId = new Map<
    string,
    {
      threadId: string;
      thread: ThreadMeta;
      messages: MsgItem[];
    }
  >();

  for (
    const [threadId, messages]
    of Object.entries(
      snapshot.messages || {}
    )
  ) {
    const thread =
      snapshot.threads?.[threadId] || {
        id: threadId,
        title: "Conversation",
        sub: "",
      };

    for (const message of messages || []) {
      if (!isAppointmentMessage(message)) {
        continue;
      }

      const appointmentId =
        appointmentIdFromMessage(message);

      const card =
        (message.card || {}) as Record<
          string,
          any
        >;

      const requesterId = text(
        card.requesterId
      );

      const recipientId = text(
        card.recipientId
      );

      if (
        userId !== requesterId &&
        userId !== recipientId
      ) {
        continue;
      }

      const existing =
        byAppointmentId.get(
          appointmentId
        );

      if (existing) {
        existing.messages.push(message);
      } else {
        byAppointmentId.set(
          appointmentId,
          {
            threadId,
            thread,
            messages: [message],
          }
        );
      }
    }
  }

  const items: AppointmentHubItem[] = [];

  for (
    const [
      appointmentId,
      grouped,
    ] of byAppointmentId
  ) {
    const ordered = [
      ...grouped.messages,
    ].sort(
      (a, b) =>
        numberValue(a.createdAt) -
        numberValue(b.createdAt)
    );

    const first =
      ordered[0];

    const latest =
      ordered[ordered.length - 1];

    const merged: Record<string, any> = {};

    for (const message of ordered) {
      Object.assign(
        merged,
        message.card || {}
      );

      if (
        text(message.text) &&
        !text(merged.message)
      ) {
        merged.message =
          text(message.text);
      }
    }

    const requesterId = text(
      merged.requesterId
    );

    const recipientId = text(
      merged.recipientId
    );

    const requesterName =
      text(merged.requesterName) ||
      (
        requesterId === userId
          ? "You"
          : text(first.displayName)
      ) ||
      "Member";

    const recipientName =
      text(merged.recipientName) ||
      (
        recipientId === userId
          ? "You"
          : text(grouped.thread.title)
      ) ||
      "Member";

    const otherName =
      userId === requesterId
        ? recipientName
        : requesterName;

    const status =
      statusOf(merged);

    const workflowSenderUserId =
      senderUserIdOf(
        latest,
        (latest.card || {}) as Record<
          string,
          any
        >
      );

    const startsAtMs =
      resolveStartsAtMs(merged);

    const classification = sectionFor({
      status,
      currentUserId: userId,
      requesterId,
      recipientId,
      workflowSenderUserId,
      startsAtMs,
      nowMs,
    });

    items.push({
      appointmentId,
      threadId: grouped.threadId,
      threadTitle:
        text(grouped.thread.title) ||
        otherName,
      threadSub:
        text(grouped.thread.sub),
      status,
      requesterId,
      recipientId,
      requesterName,
      recipientName,
      otherName,
      otherAvatarUri: text(
        merged.recipientAvatarUri ||
          merged.requesterAvatarUri ||
          latest.avatarUri ||
          latest.senderAvatar ||
          first.avatarUri ||
          first.senderAvatar
      ),
      message: text(
        merged.originalMessage ||
          merged.message ||
          first.text
      ),
      date: text(merged.date),
      time: text(merged.time),
      durationMin: numberValue(
        merged.durationMin,
        30
      ),
      location: text(
        merged.locationLabel ||
          merged.location
      ),
      address: text(
        merged.address ||
          merged.locationAddress
      ),
      createdAt: numberValue(
        first.createdAt
      ),
      updatedAt: numberValue(
        latest.createdAt
      ),
      workflowSenderUserId,
      section: classification.section,
      needsAction:
        classification.needsAction,
      actionLabel: actionLabelFor({
        status,
        currentUserId: userId,
        requesterId,
        recipientId,
        workflowSenderUserId,
      }),
      startsAtMs,
    });
  }

  return items.sort((a, b) => {
    if (
      a.section === "needs_action" &&
      b.section !== "needs_action"
    ) {
      return -1;
    }

    if (
      b.section === "needs_action" &&
      a.section !== "needs_action"
    ) {
      return 1;
    }

    if (
      a.section === "upcoming" &&
      b.section === "upcoming"
    ) {
      const aTime =
        a.startsAtMs || Number.MAX_SAFE_INTEGER;

      const bTime =
        b.startsAtMs || Number.MAX_SAFE_INTEGER;

      return aTime - bTime;
    }

    return b.updatedAt - a.updatedAt;
  });
}

export function countAppointmentActions(
  snapshot: MessageSnapshot,
  currentUserId: string
) {
  return buildAppointmentHubItems(
    snapshot,
    currentUserId
  ).filter((item) => item.needsAction)
    .length;
}
