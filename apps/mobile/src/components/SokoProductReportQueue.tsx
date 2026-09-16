import React from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { resolveApiBase } from "@/src/lib/kristoEnv";
import { fetchSafetySupervisors } from "@/src/lib/safetyAdminApi";

type Report = {
  id: string;
  reportCode: string;
  status: string;
  priority: string;
  reason: string;
  createdAt: string;
  productTitle: string;
  productImage: string;
  reporter: { displayName?: string | null; kristoId?: string | null };
  seller: { displayName?: string | null; kristoId?: string | null };
};

type ActionId = "assign" | "dismiss" | "resolve" | "escalate" | "restrict_listing";

const ACTIONS: Record<string, ActionId[]> = {
  open: ["assign", "escalate", "dismiss", "resolve", "restrict_listing"],
  assigned: ["escalate", "dismiss", "resolve", "restrict_listing"],
  escalated: ["assign", "dismiss", "resolve", "restrict_listing"],
  dismissed: [],
  resolved: [],
};

const ACTION_LABEL: Record<ActionId, string> = {
  assign: "Assign",
  dismiss: "Dismiss",
  resolve: "Resolve",
  escalate: "Escalate",
  restrict_listing: "Restrict listing",
};

function actionsFor(status: string): ActionId[] {
  return ACTIONS[status] || ACTIONS.open;
}

export function SokoProductReportQueue() {
  const [reports, setReports] = React.useState<Report[]>([]);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [pending, setPending] = React.useState<{ report: Report; action: ActionId } | null>(null);
  const [note, setNote] = React.useState("");
  const [supervisorUserId, setSupervisorUserId] = React.useState("");
  const [supervisors, setSupervisors] = React.useState<Array<{ userId: string; fullName?: string; kristoId?: string }>>([]);
  const [acting, setActing] = React.useState(false);
  const [actionError, setActionError] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${resolveApiBase()}/api/soko/admin/product-reports`, {
        headers: getKristoHeaders(),
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Could not load product reports.");
      setReports(Array.isArray(data.reports) ? data.reports : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load product reports.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const openAction = async (report: Report, action: ActionId) => {
    setPending({ report, action });
    setNote("");
    setSupervisorUserId("");
    setActionError("");
    if (action !== "assign") return;
    try {
      const result = await fetchSafetySupervisors();
      setSupervisors(
        (result.supervisors || []).map((item: { userId?: string; fullName?: string; kristoId?: string }) => ({
          userId: String(item.userId || ""),
          fullName: item.fullName,
          kristoId: item.kristoId,
        })).filter((item: { userId: string }) => item.userId)
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not load supervisors.");
    }
  };

  const submit = async () => {
    if (!pending || acting || note.trim().length < 8) return;
    if (pending.action === "assign" && !supervisorUserId) return;
    setActing(true);
    setActionError("");
    try {
      const response = await fetch(
        `${resolveApiBase()}/api/soko/admin/product-reports/${encodeURIComponent(pending.report.id)}/action`,
        {
          method: "POST",
          headers: { ...getKristoHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            action: pending.action,
            note: note.trim(),
            supervisorUserId: pending.action === "assign" ? supervisorUserId : undefined,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Could not update the report.");
      setReports((current) =>
        current.map((item) =>
          item.id === data.reportId ? { ...item, status: String(data.status || item.status) } : item
        )
      );
      setPending(null);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not update the report.");
    } finally {
      setActing(false);
    }
  };

  if (loading && !reports.length) return <ActivityIndicator color="#F4D06F" />;
  if (error && !reports.length) return <Text style={{ color: "#FDA4AF", marginBottom: 12 }}>{error}</Text>;
  if (!reports.length) return <Text style={{ color: "rgba(255,255,255,0.6)", marginBottom: 12 }}>No SOKO product reports.</Text>;

  return (
    <View style={{ gap: 10, marginBottom: 16 }}>
      {reports.map((report) => (
        <View key={report.id} style={{ borderWidth: 1, borderColor: "rgba(244,208,111,0.28)", borderRadius: 14, padding: 12 }}>
          <ReportImage reportId={report.id} uri={report.productImage} />
          <Text style={{ color: "#F4D06F", fontWeight: "800" }}>{report.productTitle || "Listing"}</Text>
          <Text style={{ color: "#fff" }}>{report.reason}</Text>
          <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>
            Seller {report.seller.displayName || "—"} · {report.seller.kristoId || "—"}
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>
            Reporter {report.reporter.displayName || "—"} · {report.reporter.kristoId || "—"}
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.55)", fontSize: 11 }}>
            {report.priority} · {report.status} · {report.reportCode}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            {actionsFor(report.status).map((action) => (
              <Pressable
                key={action}
                onPress={() => void openAction(report, action)}
                style={{
                  borderWidth: 1,
                  borderColor: action === "restrict_listing" ? "#F43F5E" : "rgba(244,208,111,0.5)",
                  borderRadius: 8,
                  paddingHorizontal: 8,
                  paddingVertical: 6,
                }}
              >
                <Text style={{ color: action === "restrict_listing" ? "#FDA4AF" : "#F4D06F", fontSize: 12 }}>
                  {ACTION_LABEL[action]}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
      <Modal visible={Boolean(pending)} transparent animationType="slide" onRequestClose={() => setPending(null)}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" }}>
          <View style={{ backgroundColor: "#111", padding: 16, borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
            <Text style={{ color: "#F4D06F", fontWeight: "800", fontSize: 16 }}>
              {pending ? ACTION_LABEL[pending.action] : ""}
            </Text>
            <Text style={{ color: "#fff", marginTop: 6 }}>{pending?.report.productTitle || "Listing"}</Text>
            <Text style={{ color: "rgba(255,255,255,0.7)", marginTop: 4 }}>
              Seller {pending?.report.seller.displayName || "—"} · {pending?.report.seller.kristoId || "—"}
            </Text>
            {pending?.action === "restrict_listing" ? (
              <Text style={{ color: "#FDA4AF", marginTop: 10 }}>
                Restrict listing removes this product from SOKO. This does not cancel orders, payments, refunds, fulfillment, or Buyer Protection.
              </Text>
            ) : (
              <Text style={{ color: "rgba(255,255,255,0.7)", marginTop: 10 }}>
                This updates the product report only. It does not open Buyer Protection.
              </Text>
            )}
            {pending?.action === "assign" ? (
              <View style={{ marginTop: 10, gap: 6 }}>
                {supervisors.map((supervisor) => (
                  <Pressable key={supervisor.userId} onPress={() => setSupervisorUserId(supervisor.userId)}>
                    <Text style={{ color: supervisorUserId === supervisor.userId ? "#F4D06F" : "#fff" }}>
                      {supervisor.fullName || supervisor.kristoId || supervisor.userId}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Required note"
              placeholderTextColor="rgba(255,255,255,0.4)"
              style={{ color: "#fff", borderWidth: 1, borderColor: "#444", borderRadius: 8, padding: 10, marginTop: 12 }}
            />
            {actionError ? <Text style={{ color: "#FDA4AF", marginTop: 8 }}>{actionError}</Text> : null}
            <Pressable
              disabled={acting || note.trim().length < 8 || (pending?.action === "assign" && !supervisorUserId)}
              onPress={() => void submit()}
              style={{ marginTop: 12, backgroundColor: pending?.action === "restrict_listing" ? "#9F1239" : "#1b4332", borderRadius: 10, padding: 12 }}
            >
              <Text style={{ color: "#fff", fontWeight: "800", textAlign: "center" }}>
                {acting ? "Saving…" : "Confirm"}
              </Text>
            </Pressable>
            <Pressable onPress={() => setPending(null)} style={{ marginTop: 8, padding: 8 }}>
              <Text style={{ color: "#F4D06F", textAlign: "center" }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ReportImage({ reportId, uri }: { reportId: string; uri: string }) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    setFailed(false);
  }, [reportId, uri]);
  if (!uri || failed) {
    return (
      <View style={{ width: 56, height: 56, borderRadius: 8, marginBottom: 8, backgroundColor: "#1c1917", borderWidth: 1, borderColor: "rgba(244,208,111,0.4)", alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: "#F4D06F", fontSize: 10, fontWeight: "800" }}>SOKO</Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      onError={() => setFailed(true)}
      style={{ width: 56, height: 56, borderRadius: 8, marginBottom: 8 }}
    />
  );
}
