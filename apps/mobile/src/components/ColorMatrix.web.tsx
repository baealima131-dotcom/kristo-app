import React from "react";

// Web fallback: no-op wrapper (renders children as-is).
export function ColorMatrix(props: any) {
  return <>{props?.children}</>;
}
