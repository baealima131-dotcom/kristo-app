import { useEffect } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";

export default function SharedPostDeepLinkScreen() {
  const params = useLocalSearchParams<{ id?: string }>();

  useEffect(() => {
    const postId = String(params.id || "").trim();

    const timer = setTimeout(() => {
      router.replace({
        pathname: "/(tabs)",
        params: postId ? { openPostId: postId } : {},
      });
    }, 350);

    return () => clearTimeout(timer);
  }, [params.id]);

  return <View style={{ flex: 1, backgroundColor: "#05070D" }} />;
}
