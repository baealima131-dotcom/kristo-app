"use client";

import type { ReactNode } from "react";
import { useMeChurch } from "./useMeChurch";

export default function RoleGate(props: {
  allow: string[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { loading, role, membershipStatus } = useMeChurch();

  if (loading) return null;

  const isActive = membershipStatus === "Active";
  const okRole = props.allow.includes(role);

  if (!isActive) {
    return props.fallback ?? (
      <div style={{ padding: 12, borderRadius: 10, border: "1px solid #442", background: "#221" }}>
        You must be an <b>Active</b> church member to access this.
      </div>
    );
  }

  if (!okRole) {
    return props.fallback ?? (
      <div style={{ padding: 12, borderRadius: 10, border: "1px solid #442", background: "#221" }}>
        <b>Forbidden (role)</b> — You are <b>{role}</b>. Required: {props.allow.join(", ")}.
      </div>
    );
  }

  return <>{props.children}</>;
}
