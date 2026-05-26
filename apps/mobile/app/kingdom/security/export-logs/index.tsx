import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, Alert, ScrollView } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import { getSecurityLogs, type AuditLogEntry } from "@/src/lib/kingdomSecurityStore";

const BG = "#0B0F17";
const CARD = "rgba(255,255,255,0.05)";
const BORDER = "rgba(255,255,255,0.10)";
const GOLD = "#D9B35F";
const SOFT = "rgba(255,255,255,0.72)";

type ExportOption = {
  id: "pdf" | "csv" | "json";
  title: string;
  desc: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const OPTIONS: ExportOption[] = [
  {
    id: "pdf",
    title: "Export as PDF",
    desc: "Create printable report for review and sharing.",
    icon: "document-text-outline",
  },
  {
    id: "csv",
    title: "Export as CSV",
    desc: "Download flat data for spreadsheet and analysis.",
    icon: "grid-outline",
  },
  {
    id: "json",
    title: "Export as JSON",
    desc: "Export structured raw data for system sync.",
    icon: "code-slash-outline",
  },
];

function escapeCsv(value: unknown) {
  const text =
    value == null
      ? ""
      : typeof value === "string"
      ? value
      : Object.entries(value).map(([k,v]) => `${k}: ${v}`).join("\\n");

  const safe = String(text).replace(/"/g, '""');
  return /[",\n]/.test(safe) ? `"${safe}"` : safe;
}

function buildCsv(logs: AuditLogEntry[]) {
  const headers = [
    "id",
    "churchId",
    "action",
    "actorUserId",
    "actorRole",
    "actorName",
    "targetId",
    "targetType",
    "message",
    "ip",
    "userAgent",
    "createdAt",
    "meta",
  ];

  const rows = logs.map((item) =>
    [
      item.id,
      item.churchId,
      item.action,
      item.actorUserId,
      item.actorRole ?? "",
      item.actorName ?? "",
      item.targetId ?? "",
      item.targetType ?? "",
      item.message ?? "",
      item.ip ?? "",
      item.userAgent ?? "",
      item.createdAt,
      item.meta ?? "",
    ]
      .map(escapeCsv)
      .join(",")
  );

  return [headers.join(","), ...rows].join("\\n");
}

function htmlEscape(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildPdfHtml(logs: AuditLogEntry[]) {
  const exportedAt = new Date().toISOString();

  const rows = logs
    .map((item, index) => {
      const actor = [item.actorName || item.actorUserId, item.actorRole]
        .filter(Boolean)
        .join(" • ");

      const target = [item.targetType, item.targetId]
        .filter(Boolean)
        .join(" • ");

      const meta = item.meta
        ? htmlEscape(
            Object.entries(item.meta)
              .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
              .join("\n")
          )
        : "";

      return `
        <div class="log-card">
          <div class="card-head">
            <div class="badge">${index + 1}</div>
            <div class="head-copy">
              <div class="message">${htmlEscape(item.message || item.action)}</div>
              <div class="sub">${htmlEscape(actor || "Unknown actor")}</div>
            </div>
          </div>

          <div class="meta-grid">
            <div class="meta-item"><span class="label">Action</span><span class="value">${htmlEscape(item.action)}</span></div>
            <div class="meta-item"><span class="label">Time</span><span class="value">${htmlEscape(item.createdAt)}</span></div>
            <div class="meta-item"><span class="label">Target</span><span class="value">${htmlEscape(target || "-")}</span></div>
            <div class="meta-item"><span class="label">IP</span><span class="value">${htmlEscape(item.ip || "-")}</span></div>
          </div>

          ${
            meta
              ? `
              <div class="meta-block">
                <div class="meta-title">Meta</div>
                <pre>${meta}</pre>
              </div>
            `
              : ""
          }
        </div>
      `;
    })
    .join("");

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          * {
            box-sizing: border-box;
          }

          @page {
            size: A4;
            margin: 18px;
          }

          body {
            font-family: Arial, sans-serif;
            background: #FFFFFF;
            color: #111827;
            margin: 0;
            padding: 0;
          }

          .page {
            width: 100%;
          }

          .header {
            text-align: center;
            margin-bottom: 14px;
            padding: 0 0 12px 0;
            border-bottom: 2px solid #E5E7EB;
          }

          .title {
            font-size: 26px;
            font-weight: 900;
            color: #C89B3C;
            letter-spacing: 0.3px;
            margin: 0 0 4px 0;
          }

          .subhead {
            font-size: 11px;
            color: #6B7280;
            margin: 0;
          }

          .summary {
            margin: 0 0 12px 0;
            padding: 12px 14px;
            border: 1px solid #E5E7EB;
            border-radius: 12px;
            background: #FAFAFA;
          }

          .summary-line {
            font-size: 12px;
            color: #374151;
            margin: 3px 0;
          }

          .summary-line .label {
            display: inline-block;
            min-width: 88px;
          }

          .cards {
            width: 100%;
          }

          .log-card {
            border: 1px solid #E5E7EB;
            border-radius: 14px;
            background: #FFFFFF;
            padding: 13px 14px;
            margin-bottom: 10px;
            page-break-inside: avoid;
            break-inside: avoid;
          }

          .card-head {
            display: table;
            width: 100%;
            margin-bottom: 8px;
          }

          .badge {
            display: table-cell;
            width: 30px;
            text-align: left;
            vertical-align: top;
            font-size: 12px;
            font-weight: 900;
            color: #C89B3C;
          }

          .head-copy {
            display: table-cell;
            vertical-align: top;
          }

          .message {
            font-size: 16px;
            font-weight: 800;
            line-height: 1.3;
            color: #111827;
            margin: 0 0 3px 0;
          }

          .sub {
            font-size: 11px;
            line-height: 1.35;
            color: #6B7280;
            margin: 0;
          }

          .meta-grid {
            width: 100%;
            margin-top: 6px;
            border-top: 1px solid #F0F2F5;
            padding-top: 8px;
          }

          .meta-item {
            display: inline-block;
            vertical-align: top;
            width: 49%;
            margin: 0 0 6px 0;
            font-size: 11px;
            line-height: 1.35;
            color: #374151;
          }

          .meta-item .label {
            display: block;
            color: #C89B3C;
            font-weight: 800;
            margin-bottom: 1px;
          }

          .meta-item .value {
            display: block;
            color: #374151;
            word-break: break-word;
          }

          .meta-block {
            margin-top: 8px;
            padding: 10px;
            background: #F8FAFC;
            border: 1px solid #E5E7EB;
            border-radius: 10px;
          }

          .meta-title {
            color: #C89B3C;
            font-size: 12px;
            font-weight: 800;
            margin-bottom: 6px;
          }

          pre {
            white-space: pre-wrap;
            word-break: break-word;
            font-size: 10.5px;
            line-height: 1.45;
            color: #374151;
            background: #FFFFFF;
            border: 1px solid #E5E7EB;
            padding: 8px 9px;
            border-radius: 8px;
            margin: 0;
          }

          .empty {
            border: 1px solid #E5E7EB;
            border-radius: 14px;
            background: #FFFFFF;
            padding: 18px;
            font-size: 15px;
            font-weight: 700;
            color: #111827;
          }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="header">
            <div class="title">KRISTO SECURITY AUDIT REPORT</div>
            <div class="subhead">Security Logs Export</div>
          </div>

          <div class="summary">
            <div class="summary-line"><span class="label">Exported at</span> ${htmlEscape(exportedAt)}</div>
            <div class="summary-line"><span class="label">Total logs</span> ${logs.length}</div>
          </div>

          <div class="cards">
            ${rows || `<div class="empty">No logs found.</div>`}
          </div>
        </div>
      </body>
    </html>
  `;
}

export default function ExportLogsScreen() {
  const router = useRouter();
  const [exportingId, setExportingId] = useState<string | null>(null);

  async function handleExport(type: "pdf" | "csv" | "json") {
    if (exportingId) return;

    try {
      setExportingId(type);
      const logs = await getSecurityLogs({ limit: 200 });
      const exportedAt = new Date().toISOString();
      const safeStamp = exportedAt.replace(/[:.]/g, "-");
      const canShare = await Sharing.isAvailableAsync();

      if (type === "json") {
        const payload = {
          ok: true,
          format: "json",
          exportedAt,
          count: logs.length,
          data: logs,
        };

        const json = JSON.stringify(payload, null, 2);
        const uri = `${FileSystem.cacheDirectory}security-logs-${safeStamp}.json`;

        await FileSystem.writeAsStringAsync(uri, json, {
          encoding: FileSystem.EncodingType.UTF8,
        });

        if (canShare) {
          await Sharing.shareAsync(uri, {
            mimeType: "application/json",
            dialogTitle: "Share Security Logs JSON",
            UTI: "public.json",
          });
        } else {
          Alert.alert(
            "JSON export ready",
            `Logs ${logs.length} zimeandaliwa hapa:\n${uri}`
          );
        }
        return;
      }

      if (type === "csv") {
        const csv = buildCsv(logs);
        const uri = `${FileSystem.cacheDirectory}security-logs-${safeStamp}.csv`;

        await FileSystem.writeAsStringAsync(uri, csv, {
          encoding: FileSystem.EncodingType.UTF8,
        });

        if (canShare) {
          await Sharing.shareAsync(uri, {
            mimeType: "text/csv",
            dialogTitle: "Share Security Logs CSV",
            UTI: "public.comma-separated-values-text",
          });
        } else {
          Alert.alert(
            "CSV export ready",
            `Rows ${logs.length} zimeandaliwa hapa:\n${uri}`
          );
        }
        return;
      }

      if (type === "pdf") {
        const html = buildPdfHtml(logs);
        const result = await Print.printToFileAsync({
          html,
          base64: false,
        });

        if (canShare) {
          await Sharing.shareAsync(result.uri, {
            mimeType: "application/pdf",
            dialogTitle: "Share Security Logs PDF",
            UTI: "com.adobe.pdf",
          });
        } else {
          Alert.alert(
            "PDF export ready",
            `PDF imeandaliwa hapa:\n${result.uri}`
          );
        }
        return;
      }
    } catch (e: any) {
      Alert.alert(
        "Export failed",
        String(e?.message || "Imeshindikana kuandaa export.")
      );
    } finally {
      setExportingId(null);
    }
  }

  return (
    <View style={s.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={s.headerWrap}>
          <Pressable onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="chevron-back" size={20} color="white" />
          </Pressable>

          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>
              Export Logs
            </Text>
            <Text style={s.subtitle}>Generate reports for security activity.</Text>
          </View>
        </View>

        <View style={s.sectionCard}>
          <Text style={s.sectionTitle}>Export Options</Text>
          <Text style={s.sectionSub}>Choose format ya kutoa security logs zako.</Text>

          <View style={s.optionsWrap}>
            {OPTIONS.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => handleExport(item.id)}
                disabled={exportingId === item.id}
                style={({ pressed }) => [
                  s.optionCard,
                  exportingId === item.id ? s.optionCardDisabled : null,
                  pressed ? ({ opacity: 0.96, transform: [{ scale: 0.992 }] } as const) : null,
                ]}
              >
                <View style={s.optionTop}>
                  <View style={s.iconWrap}>
                    <Ionicons name={item.icon} size={22} color="rgba(230,220,255,0.95)" />
                  </View>

                  <View style={s.badge}>
                    <Text style={s.badgeText}>{item.id.toUpperCase()}</Text>
                  </View>
                </View>

                <Text style={s.optionTitle}>{item.title}</Text>
                <Text style={s.optionDesc}>{item.desc}</Text>

                <View style={s.optionFooter}>
                  <Text style={s.optionFooterText}>
                    {exportingId === item.id ? "Preparing..." : "Start export"}
                  </Text>
                  <Ionicons
                    name={exportingId === item.id ? "time-outline" : "arrow-forward"}
                    size={16}
                    color={GOLD}
                  />
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
    paddingTop: 54,
  },

  headerWrap: {
    paddingHorizontal: 16,
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },

  backBtn: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.03)",
  },

  title: {
    color: "white",
    fontSize: 28,
    fontWeight: "900",
    marginBottom: 4,
  },

  subtitle: {
    color: SOFT,
    fontSize: 13,
    fontWeight: "800",
  },

  sectionCard: {
    marginHorizontal: 16,
    borderRadius: 28,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.035)",
  },

  sectionTitle: {
    color: GOLD,
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 8,
  },

  sectionSub: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 16,
  },

  optionsWrap: {
    gap: 14,
  },

  optionCard: {
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.16)",
    backgroundColor: CARD,
  },

  optionCardDisabled: {
    opacity: 0.72,
  },

  optionTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },

  iconWrap: {
    width: 62,
    height: 62,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#3A2D5F",
    borderWidth: 1,
    borderColor: "rgba(111,76,255,0.85)",
  },

  badge: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
    backgroundColor: "rgba(217,179,95,0.08)",
  },

  badgeText: {
    color: GOLD,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
  },

  optionTitle: {
    color: "white",
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 8,
  },

  optionDesc: {
    color: SOFT,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700",
    marginBottom: 16,
  },

  optionFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    paddingTop: 12,
  },

  optionFooterText: {
    color: GOLD,
    fontSize: 13,
    fontWeight: "900",
  },
});
