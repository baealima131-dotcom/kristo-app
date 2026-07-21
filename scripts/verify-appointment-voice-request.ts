/**
 * Verify appointment voice request regression is fixed.
 * Run: npx tsx scripts/verify-appointment-voice-request.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

function read(rel: string) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** Mirror of POST /api/church/room-messages appointment_request gate (post-fix). */
function validateAppointmentRequest(input: {
  userId: string;
  card: Record<string, unknown> | null;
  text?: string;
}): { ok: true } | { ok: false; error: string; status: number } {
  const kind = "appointment_request";
  void kind;
  const card = input.card;
  const text = String(input.text || "").trim();
  const appointmentMessage = String(
    (card as any)?.message || text || ""
  ).trim();

  if (!card || String((card as any)?.type || "") !== "appointment_request") {
    return { ok: false, error: "Invalid appointment request payload.", status: 400 };
  }

  const hasVoiceNotes =
    Array.isArray((card as any)?.voiceNotes) &&
    (card as any).voiceNotes.length > 0;

  if (!appointmentMessage && !hasVoiceNotes) {
    return {
      ok: false,
      error: "Write a message before sending the appointment request.",
      status: 400,
    };
  }

  if (appointmentMessage.length > 500) {
    return {
      ok: false,
      error: "Appointment request messages cannot exceed 500 characters.",
      status: 400,
    };
  }

  if (String((card as any)?.requesterId || "").trim() !== String(input.userId || "").trim()) {
    return { ok: false, error: "Invalid appointment requester.", status: 403 };
  }

  return { ok: true };
}

function main() {
  const route = read("app/api/church/room-messages/route.ts");
  const appointmentUi = read(
    "apps/mobile/app/(tabs)/more/my-church-room/messages/appointment/[roomId].tsx"
  );
  const dmThread = read(
    "apps/mobile/app/(tabs)/more/my-church-room/messages/[id].tsx"
  );

  assert.equal(
    route.includes("Voice appointment requests are not enabled yet."),
    false,
    "backend must not reject voice appointment requests with placeholder error"
  );
  assert.match(
    route,
    /hasVoiceNotes/,
    "backend must accept voiceNotes as a valid appointment payload"
  );
  assert.match(
    appointmentUi,
    /voiceNotes:\s*uploadedVoiceNotes/,
    "appointment composer must send card.voiceNotes"
  );
  assert.match(
    appointmentUi,
    /kind:\s*"appointment_request"/,
    "appointment composer must POST kind appointment_request"
  );
  assert.match(
    appointmentUi,
    /uploadVoiceNotes/,
    "appointment composer must upload voice notes before send"
  );

  // DM voice path must remain independent (attachments, not appointment card voiceNotes gate).
  assert.equal(
    dmThread.includes("Voice appointment requests are not enabled yet."),
    false,
    "DM thread must not contain appointment voice placeholder"
  );

  const userId = "u_member_1";

  const textOnly = validateAppointmentRequest({
    userId,
    text: "Please meet me this week",
    card: {
      type: "appointment_request",
      requesterId: userId,
      recipientId: "u_pastor",
      message: "Please meet me this week",
      voiceNotes: [],
    },
  });
  assert.deepEqual(textOnly, { ok: true });

  const voiceOnly = validateAppointmentRequest({
    userId,
    text: "",
    card: {
      type: "appointment_request",
      requesterId: userId,
      recipientId: "u_pastor",
      message: "",
      voiceNotes: [
        {
          id: "vn1",
          uri: "https://cdn.example/voice1.m4a",
          durationSec: 3,
          mime: "audio/mp4",
        },
      ],
    },
  });
  assert.deepEqual(voiceOnly, { ok: true });

  const textPlusVoice = validateAppointmentRequest({
    userId,
    text: "See voice note",
    card: {
      type: "appointment_request",
      requesterId: userId,
      recipientId: "u_pastor",
      message: "See voice note",
      voiceNotes: [
        {
          id: "vn1",
          uri: "https://cdn.example/voice1.m4a",
          durationSec: 3,
          mime: "audio/mp4",
        },
        {
          id: "vn2",
          uri: "https://cdn.example/voice2.m4a",
          durationSec: 5,
          mime: "audio/mp4",
        },
      ],
    },
  });
  assert.deepEqual(textPlusVoice, { ok: true });

  const empty = validateAppointmentRequest({
    userId,
    text: "",
    card: {
      type: "appointment_request",
      requesterId: userId,
      recipientId: "u_pastor",
      message: "",
      voiceNotes: [],
    },
  });
  assert.equal(empty.ok, false);

  // Playback wiring still present on thread + composer.
  assert.match(
    dmThread,
    /appointment\.voiceNotes|voiceNotes/,
    "DM/appointment thread must still render appointment.voiceNotes for playback"
  );
  assert.match(
    appointmentUi,
    /voiceNotes\[index\]/,
    "composer must keep voice playback preview before send"
  );

  console.log("verify-appointment-voice-request: all checks passed");
}

main();
