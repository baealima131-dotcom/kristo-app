"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import RolesClient from "./RolesClient";

export default function RolesEmbedClient() {
  const sp = useSearchParams();
  const embed = sp.get("embed") === "1";

  useEffect(() => {
    if (!embed) return;

    const cssId = "kristo-embed-css";
    if (document.getElementById(cssId)) return;

    document.documentElement.setAttribute("data-kristo-embed", "1");

    const style = document.createElement("style");
    style.id = cssId;

    // Aggressive hide: sidebar / nav / top bars from dashboard layout
    style.innerHTML = `
      html[data-kristo-embed="1"] body { overflow-x: hidden !important; }
      html[data-kristo-embed="1"] aside,
      html[data-kristo-embed="1"] nav,
      html[data-kristo-embed="1"] header,
      html[data-kristo-embed="1"] [role="navigation"],
      html[data-kristo-embed="1"] [data-sidebar],
      html[data-kristo-embed="1"] .sidebar,
      html[data-kristo-embed="1"] .Sidebar,
      html[data-kristo-embed="1"] .TopNav,
      html[data-kristo-embed="1"] .topbar,
      html[data-kristo-embed="1"] .top-nav {
        display: none !important;
      }

      /* if layout uses left padding/margin for sidebar */
      html[data-kristo-embed="1"] main,
      html[data-kristo-embed="1"] [data-main],
      html[data-kristo-embed="1"] .main {
        margin-left: 0 !important;
        padding-left: 0 !important;
        width: 100% !important;
        max-width: 100% !important;
      }

      /* reduce outer wrappers spacing */
      html[data-kristo-embed="1"] .wrap,
      html[data-kristo-embed="1"] .container {
        max-width: 100% !important;
      }
    `;

    document.head.appendChild(style);
  }, [embed]);

  return <RolesClient />;
}
