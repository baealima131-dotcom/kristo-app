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

function parseAppointmentLocalDateTime(
  rawDate: string,
  rawTime: string
) {
  const date = text(rawDate)
    .replace(
      /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+/i,
      ""
    )
    .trim();

  const time = text(rawTime).trim();

  if (!date) return 0;

  const monthNames: Record<string, number> = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11,
  };

  let year = 0;
  let month = -1;
  let day = 0;

  const namedDate = date.match(
    /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/
  );

  const isoDate = date.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})$/
  );

  const slashDate = date.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
  );

  if (namedDate) {
    month =
      monthNames[
        String(namedDate[1] || "")
          .toLowerCase()
      ] ?? -1;

    day = Number(namedDate[2]);
    year = Number(namedDate[3]);
  } else if (isoDate) {
    year = Number(isoDate[1]);
    month = Number(isoDate[2]) - 1;
    day = Number(isoDate[3]);
  } else if (slashDate) {
    month = Number(slashDate[1]) - 1;
    day = Number(slashDate[2]);
    year = Number(slashDate[3]);
  } else {
    return 0;
  }

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    year < 1970 ||
    month < 0 ||
    month > 11 ||
    day < 1 ||
    day > 31
  ) {
    return 0;
  }

  let hour = 0;
  let minute = 0;

  if (time) {
    const twelveHour = time.match(
      /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i
    );

    const twentyFourHour = time.match(
      /^(\d{1,2}):(\d{2})$/
    );

    if (twelveHour) {
      hour = Number(twelveHour[1]);
      minute = Number(twelveHour[2]);

      const period = String(
        twelveHour[3]
      ).toUpperCase();

      if (hour === 12) {
        hour = 0;
      }

      if (period === "PM") {
        hour += 12;
      }
    } else if (twentyFourHour) {
      hour = Number(twentyFourHour[1]);
      minute = Number(twentyFourHour[2]);
    }
  }

  const value = new Date(
    year,
    month,
    day,
    hour,
    minute,
    0,
    0
  ).getTime();

  return Number.isFinite(value) ? value : 0;
}

function resolveStartsAtMs(
  card: Record<string, any>
) {
  const direct =
    numberValue(card.startMs) ||
    numberValue(card.startsAtMs) ||
    numberValue(card.startAtMs);

  if (direct > 0) return direct;

  const date = text(card.date);
  const time = text(card.time);

  const localDateTime =
    parseAppointmentLocalDateTime(
      date,
      time
    );

  if (localDateTime > 0) {
    return localDateTime;
  }

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
    status === "cancelled" ||
    status === "deleted"
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
    status === "cancelled" ||
    status === "deleted"
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

    const terminalMessage = [
      ...ordered,
    ]
      .reverse()
      .find((message) => {
        const messageStatus =
          statusOf(
            (message.card || {}) as Record<
              string,
              any
            >
          );

        return (
          messageStatus === "cancelled" ||
          messageStatus === "rejected" ||
          messageStatus === "deleted"
        );
      });

    const statusSourceMessage =
      terminalMessage || latest;

    const status = terminalMessage
      ? statusOf(
          (terminalMessage.card || {}) as Record<
            string,
            any
          >
        )
      : statusOf(merged);

    const workflowSenderUserId =
      senderUserIdOf(
        statusSourceMessage,
        (
          statusSourceMessage.card || {}
        ) as Record<string, any>
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
      a.section === b.section &&
      (
        a.section === "upcoming" ||
        a.section === "negotiation" ||
        a.section === "needs_action"
      )
    ) {
      const aTime =
        a.startsAtMs > 0
          ? a.startsAtMs
          : Number.MAX_SAFE_INTEGER;

      const bTime =
        b.startsAtMs > 0
          ? b.startsAtMs
          : Number.MAX_SAFE_INTEGER;

      if (aTime !== bTime) {
        return aTime - bTime;
      }
    }

    if (
      a.section === "past" &&
      b.section === "past"
    ) {
      const aTime =
        a.startsAtMs || 0;

      const bTime =
        b.startsAtMs || 0;

      if (aTime !== bTime) {
        return bTime - aTime;
      }
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
