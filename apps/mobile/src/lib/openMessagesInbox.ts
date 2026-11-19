/**
 * Opens the Messages inbox in the Profile tab without stacking another copy of it.
 *
 * `pop: true` (React Navigation 7 nested navigation): when the inbox is already in the
 * Profile -> Messages stack, navigation returns to that same screen (same instance, its
 * state and cache kept) and closes any chat opened above it; when it is not there yet, it is
 * added once. A plain push added a new inbox every time, leaving stale copies underneath.
 */
type Navigator = { navigate: (name: string, params?: object) => void };

export function openMessagesInbox(navigation: Navigator) {
  navigation.navigate("profile", {
    screen: "messages",
    pop: true,
    params: { screen: "index", pop: true },
  });
}
