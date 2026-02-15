export type ServiceDay = "Sun" | "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat";

export type ServiceBlock = {
  id: string;
  day: ServiceDay;
  start: string; // "09:00"
  end: string;   // "09:30"
  title: string; // "Worship"
  kind: "Ministry" | "Member" | "Pastor" | "Other";
  ministryId?: string;
  ministryName?: string;
  memberName?: string;
  notes?: string;
};

export const DAYS: ServiceDay[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const DEMO_BLOCKS: ServiceBlock[] = [
  { id: "b-1", day: "Sun", start: "08:00", end: "09:00", title: "Setup Team", kind: "Ministry", ministryName: "Facilities" },
  { id: "b-2", day: "Sun", start: "09:00", end: "09:30", title: "Worship", kind: "Ministry", ministryName: "Choir" },
  { id: "b-3", day: "Sun", start: "09:30", end: "09:40", title: "Scripture Reading", kind: "Member", memberName: "Sarah Lee" },
  { id: "b-4", day: "Sun", start: "09:40", end: "09:45", title: "Prayer", kind: "Member", memberName: "Mary Johnson" },
  { id: "b-5", day: "Sun", start: "09:45", end: "10:30", title: "Sermon", kind: "Pastor", memberName: "Pastor John" },

  { id: "b-6", day: "Wed", start: "18:00", end: "19:00", title: "Midweek Prayer", kind: "Other", notes: "Open to all" },
];

export function blocksForDay(day: ServiceDay) {
  return DEMO_BLOCKS
    .filter((b) => b.day === day)
    .slice()
    .sort((a, b) => a.start.localeCompare(b.start));
}

export function getBlock(blockId: string) {
  return DEMO_BLOCKS.find((b) => b.id === blockId) || null;
}

export function formatRange(start: string, end: string) {
  return `${start} - ${end}`;
}
