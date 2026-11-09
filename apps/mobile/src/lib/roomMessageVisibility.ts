/**
 * Whether a message row from /api/church/room-messages belongs on the viewer's screen.
 * A church room only shows rows of the viewer's church. A direct message is stored under the
 * conversation's church, which is often not the viewer's own (people from different churches,
 * a pastor of another church); the server already limits the room to its two participants, so
 * every row is kept.
 */
export function isRoomMessageRowForViewer(args: {
  isPersonToPersonDm: boolean;
  rowChurchId: string;
  viewerChurchId: string;
}): boolean {
  if (args.isPersonToPersonDm) return true;
  const rowChurchId = String(args.rowChurchId || "").trim();
  const viewerChurchId = String(args.viewerChurchId || "").trim();
  return !rowChurchId || !viewerChurchId || rowChurchId === viewerChurchId;
}
