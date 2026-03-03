import React from "react";
import { Platform, View } from "react-native";

export default function PagerView(props: any) {
  if (Platform.OS === "web") {
    const { style, children } = props || {};
    return <View style={style}>{children}</View>;
  }

  const NativePagerView = require("react-native-pager-view").default;
  return <NativePagerView {...props} />;
}
