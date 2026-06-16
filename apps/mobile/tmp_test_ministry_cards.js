const fs = require("fs");
const path = require("path");

const roomId = "test-ministry-live-room";
const now = Date.now();

const testCards = [
  {
    cardId: "test-slot-1",
    title: "Opening Prayer",
    subtitle: "Ministry Live • Members",
    roleKey: "opening",
    roleLabel: "Opening",
    slotLabel: "Slot 1",
    durationMin: 10,
    startTime: "7:00 PM",
    endTime: "7:10 PM",
    timeLabel: "7:00 PM - 7:10 PM",
    task: "Open the live with prayer",
    script: "Welcome everyone and pray",
    notes: ["Terminal test card"],
    musicItems: [],
    status: "open",
    likeCount: 0,
    commentCount: 0,
  },
  {
    cardId: "test-slot-2",
    title: "Main Teaching",
    subtitle: "Ministry Live • Members",
    roleKey: "main",
    roleLabel: "Main",
    slotLabel: "Slot 2",
    durationMin: 20,
    startTime: "7:10 PM",
    endTime: "7:30 PM",
    timeLabel: "7:10 PM - 7:30 PM",
    task: "Teach the main message",
    script: "Short teaching",
    notes: ["Terminal test card"],
    musicItems: [],
    status: "open",
    likeCount: 0,
    commentCount: 0,
  },
];

const file = path.join(process.cwd(), "tmp_terminal_schedule_result.json");

fs.writeFileSync(file, JSON.stringify({
  roomId,
  messageKind: "assignment_card",
  destination: "messagesStore.messages[test-ministry-live-room]",
  cards: testCards.map((card, index) => ({
    id: `cardmsg_${now}_${index}`,
    threadId: roomId,
    sender: "other",
    displayName: "Schedule System",
    createdAt: now + index,
    kind: "assignment_card",
    card,
  })),
}, null, 2));

console.log("✅ Terminal schedule generated");
console.log("✅ Destination room:", roomId);
console.log("✅ Cards:", testCards.length);
console.log("✅ Result file:", file);
