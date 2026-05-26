import React from "react";
import FeedStorageScreen from "@/src/components/FeedStorageScreen";

export default function ChurchStorageScreen() {
  return (
    <FeedStorageScreen
      mode="church"
      title="Church Storage"
      subtitle="Church-owned posts from members remain here even if a member leaves."
    />
  );
}
