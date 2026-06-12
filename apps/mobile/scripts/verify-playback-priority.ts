import {
  notifyWatchScreenOpened,
  notifyWatchPlaybackActive,
  notifyWatchPlaybackPaused,
  notifyWatchScreenClosed,
  shouldDeferBackgroundMediaJobs,
} from "../src/lib/homeFeedWatchPlaybackPriority";

console.log("defer-before", shouldDeferBackgroundMediaJobs());
notifyWatchScreenOpened("post_a");
console.log("defer-open", shouldDeferBackgroundMediaJobs());
notifyWatchPlaybackActive("post_a");
console.log("defer-playing", shouldDeferBackgroundMediaJobs());
notifyWatchPlaybackPaused("post_a");
console.log("defer-paused-still-open", shouldDeferBackgroundMediaJobs());
notifyWatchScreenClosed();
console.log("defer-closed", shouldDeferBackgroundMediaJobs());
