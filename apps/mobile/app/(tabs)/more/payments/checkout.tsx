import React from "react";
import { Redirect } from "expo-router";

export default function KristoFreeRedirect() {
  // Kristo App is free. Legacy subscription route redirects to Media.
  return <Redirect href={"/more/media" as any} />;
}
