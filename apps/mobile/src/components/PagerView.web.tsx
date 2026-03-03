import React from "react";
import { View } from "react-native";

// Web fallback: just renders children inside a View (no paging).
export default function PagerViewWeb(props: any) {
  const { style, children } = props || {};
  return <View style={style}>{children}</View>;
}
