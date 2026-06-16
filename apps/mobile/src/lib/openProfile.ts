import { router } from "expo-router";

export function openProfile(user: {
  id?: string;
  name?: string;
  username?: string;
  avatar?: string;
  churchId?: string;
}) {
  router.push({
    pathname: "/poster-profile" as any,
    params: {
      userId: user?.id || "",
      name: user?.name || "",
      username: user?.username || "",
      avatar: user?.avatar || "",
      churchId: user?.churchId || "",
    },
  });
}
