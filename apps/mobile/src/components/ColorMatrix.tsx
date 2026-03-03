import React from "react";
import { Platform } from "react-native";

export function ColorMatrix(props: any) {
  if (Platform.OS === "web") {
    return <>{props?.children}</>;
  }

  const Native = require("react-native-color-matrix-image-filters").ColorMatrix;
  return <Native {...props} />;
}
