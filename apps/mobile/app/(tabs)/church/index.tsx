import { Redirect } from "expo-router";

/**
 * The Church tab opens Church Overview. The old church post feed (announcement cards with
 * likes, comments, follow and save) was removed; church posts show in the Home feed.
 */
export default function ChurchTabIndex() {
  return <Redirect href="/church/overview" />;
}
