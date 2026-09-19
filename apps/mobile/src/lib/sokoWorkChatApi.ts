import {
  buildKristoRequestHeaders,
} from "@/src/lib/kristoHeaders";

const API_BASE = String(
  process.env.EXPO_PUBLIC_API_BASE ||
    "https://kristo-app.vercel.app"
)
  .trim()
  .replace(/\/+$/, "");

export type SokoWorkChatMessage = {
  id: string;

  sellerUserId: string;
  workerUserId: string;

  senderUserId: string;

  senderRole:
    | "seller_owner"
    | "supply_worker";

  text: string;

  taskId: string;

  createdAt: string;

  mine: boolean;
};

async function readJson(
  response: Response
) {
  const text =
    await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(
      text
    );
  } catch {
    throw new Error(
      `Server returned an invalid response (${response.status}).`
    );
  }
}

export async function
fetchSokoWorkChatMessages(
  input: {
    sellerUserId: string;
    workerUserId?: string;
  }
): Promise<{
  messages:
    SokoWorkChatMessage[];
}> {
  const params =
    new URLSearchParams();

  params.set(
    "sellerUserId",
    input.sellerUserId
  );

  if (
    input.workerUserId
  ) {
    params.set(
      "workerUserId",
      input.workerUserId
    );
  }

  const path =
    `/api/soko/work/chat?${params.toString()}`;

  const response =
    await fetch(
      `${API_BASE}${path}`,
      {
        headers:
          buildKristoRequestHeaders(
            path,
            undefined,
            undefined,
            "sokoWorkChatApi"
          ),
      }
    );

  const data =
    await readJson(
      response
    );

  if (
    !response.ok ||
    data?.ok === false
  ) {
    throw new Error(
      String(
        data?.error ||
          "Could not load work chat."
      )
    );
  }

  return {
    messages:
      Array.isArray(
        data?.messages
      )
        ? data.messages
        : [],
  };
}

export async function
sendSokoWorkChatMessage(
  input: {
    sellerUserId: string;

    workerUserId?: string;

    text: string;

    taskId?: string;
  }
): Promise<SokoWorkChatMessage> {
  const path =
    "/api/soko/work/chat";

  const response =
    await fetch(
      `${API_BASE}${path}`,
      {
        method: "POST",

        headers:
          buildKristoRequestHeaders(
            path,
            undefined,
            {
              "content-type":
                "application/json",
            },
            "sokoWorkChatApi"
          ),

        body:
          JSON.stringify(
            input
          ),
      }
    );

  const data =
    await readJson(
      response
    );

  if (
    !response.ok ||
    data?.ok === false ||
    !data?.message
  ) {
    throw new Error(
      String(
        data?.error ||
          "Could not send work message."
      )
    );
  }

  return data.message as
    SokoWorkChatMessage;
}
