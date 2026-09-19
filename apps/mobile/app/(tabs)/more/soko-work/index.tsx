import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  Ionicons,
} from "@expo/vector-icons";

import {
  useFocusEffect,
  useRouter,
} from "expo-router";

import {
  SafeAreaView,
} from "react-native-safe-area-context";

import {
  SokoLevel02Work,
} from "@/src/components/SokoLevel02Work";

import {
  fetchSokoWorkforceMe,
  peekSokoWorkforceMeForUser,
  type SokoWorkforceRecord,
} from "@/src/lib/sokoWorkforceApi";

import {
  useKristoSession,
} from "@/src/lib/KristoSessionProvider";

import {
  saveSokoSupplyOperation,
} from "@/src/lib/sokoProductOperationsApi";

import {
  buildAlibabaExternalSearchUrl,
  buildSupplierSearchUrl,
  fetchAlibabaProductPreview,
  fetchSokoSourcingTasks,
  fetchSokoSuppliers,
  isHttpsAlibabaUrl,
  type AlibabaProductPreview,
  type SokoSourcingTask,
  type SokoSupplier,
} from "@/src/lib/sokoSourcingSmartApi";

const GOLD = "#FFD66B";
const GREEN = "#5DEBA5";
const BLUE = "#75C1FF";

type ShortlistKind =
  | "saved"
  | "manual"
  | "alibaba_preview";

type ShortlistCandidate = {
  id: string;
  kind: ShortlistKind;
  name: string;
  contactOrUrl: string;
  productOrLink: string;
  unitPrice: string;
  moq: string;
  leadTime: string;
  country: string;
  sourceLabel: string;
};

function compareValue(
  value: string
) {
  const text =
    String(value || "").trim();

  return text || "Not provided";
}

function isHttpsUrl(
  raw: string
) {
  try {
    const url = new URL(
      String(raw || "").trim()
    );

    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function formatKnownPrice(
  min: number,
  max: number,
  currency: string
) {
  const hasMin =
    Number.isFinite(min) && min > 0;
  const hasMax =
    Number.isFinite(max) && max > 0;
  const code =
    String(currency || "").trim();
  const suffix =
    code ? ` ${code}` : "";

  if (hasMin && hasMax && min !== max) {
    return `$${min.toFixed(2)} – $${max.toFixed(2)}${suffix}`;
  }

  if (hasMin) {
    return `$${min.toFixed(2)}${suffix}`;
  }

  if (hasMax) {
    return `$${max.toFixed(2)}${suffix}`;
  }

  return "";
}

function candidateFromSaved(
  supplier: SokoSupplier
): ShortlistCandidate {
  return {
    id: `saved:${supplier.id}`,
    kind: "saved",
    name: supplier.name,
    contactOrUrl:
      String(
        supplier.contact ||
          supplier.websiteUrl ||
          ""
      ).trim(),
    productOrLink:
      String(
        supplier.websiteUrl ||
          supplier.contact ||
          ""
      ).trim(),
    unitPrice: "",
    moq:
      supplier.moq > 0
        ? String(supplier.moq)
        : "",
    leadTime:
      String(
        supplier.leadTime || ""
      ).trim(),
    country:
      String(
        supplier.country || ""
      ).trim(),
    sourceLabel: "Saved supplier",
  };
}

function candidateFromPreview(
  preview: AlibabaProductPreview
): ShortlistCandidate {
  const name =
    preview.supplierName ||
    preview.title ||
    "Alibaba product";

  return {
    id: `alibaba:${preview.productUrl}`,
    kind: "alibaba_preview",
    name,
    contactOrUrl: preview.productUrl,
    productOrLink:
      preview.title ||
      preview.productUrl,
    unitPrice: formatKnownPrice(
      preview.priceMin,
      preview.priceMax,
      preview.currency
    ),
    moq:
      preview.moq > 0
        ? String(preview.moq)
        : "",
    leadTime: "",
    country: "",
    sourceLabel:
      "Alibaba product link",
  };
}

function logSokoWork(
  event: string,
  extra?: Record<string, unknown>
) {
  if (typeof __DEV__ === "undefined" || !__DEV__) {
    return;
  }

  console.log(event, extra || {});
}

function pickAcceptedAssignment(
  workforce: {
    assignments?: SokoWorkforceRecord[];
  } | null
): SokoWorkforceRecord | null {
  const accepted = (workforce?.assignments || []).filter(
    (row) => row.status === "accepted"
  );

  return (
    accepted.find((row) => row.stage === "setup") ||
    accepted.find((row) => row.stage === "supply") ||
    accepted[0] ||
    null
  );
}

function readCachedAcceptedAssignment(
  userId: string
): SokoWorkforceRecord | null {
  return pickAcceptedAssignment(
    peekSokoWorkforceMeForUser(userId)
  );
}

export default function SokoWorkDashboard() {
  const router =
    useRouter();

  const { session } =
    useKristoSession();

  const userId =
    String(
      session?.userId ||
        ""
    ).trim();

  const [
    assignment,
    setAssignment,
  ] =
    useState<SokoWorkforceRecord | null>(
      () =>
        readCachedAcceptedAssignment(
          userId
        )
    );

  const [
    tasks,
    setTasks,
  ] = useState<
    SokoSourcingTask[]
  >([]);

  const [
    suppliers,
    setSuppliers,
  ] = useState<
    SokoSupplier[]
  >([]);

  const [
    selectedTask,
    setSelectedTask,
  ] =
    useState<SokoSourcingTask | null>(
      null
    );

  const [
    selectedSupplier,
    setSelectedSupplier,
  ] =
    useState<SokoSupplier | null>(
      null
    );

  const [
    loading,
    setLoading,
  ] = useState(
    () =>
      !readCachedAcceptedAssignment(
        userId
      )
  );

  const [
    tasksLoading,
    setTasksLoading,
  ] = useState(
    () => {
      const cached =
        readCachedAcceptedAssignment(
          userId
        );

      return (
        cached?.stage ===
        "supply"
      );
    }
  );

  const [
    tasksError,
    setTasksError,
  ] = useState("");

  const [
    busy,
    setBusy,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState("");

  const [
    supplierCode,
    setSupplierCode,
  ] = useState("");

  const [
    manualSupplierName,
    setManualSupplierName,
  ] = useState("");

  const [
    manualSupplierContact,
    setManualSupplierContact,
  ] = useState("");

  const [
    quantity,
    setQuantity,
  ] = useState("");

  const [
    unitCost,
    setUnitCost,
  ] = useState("");

  const [
    notes,
    setNotes,
  ] = useState("");

  const [
    suppliersLoading,
    setSuppliersLoading,
  ] = useState(false);

  const [
    suppliersError,
    setSuppliersError,
  ] = useState("");

  const [
    shortlist,
    setShortlist,
  ] = useState<
    ShortlistCandidate[]
  >([]);

  const [
    recommendedId,
    setRecommendedId,
  ] = useState("");

  const [
    alibabaUrl,
    setAlibabaUrl,
  ] = useState("");

  const [
    preview,
    setPreview,
  ] = useState<AlibabaProductPreview | null>(
    null
  );

  const [
    previewLoading,
    setPreviewLoading,
  ] = useState(false);

  const [
    previewError,
    setPreviewError,
  ] = useState("");

  const [
    previewImageFailed,
    setPreviewImageFailed,
  ] = useState(false);

  const [
    manualOpen,
    setManualOpen,
  ] = useState(false);

  const [
    dashboardFilter,
    setDashboardFilter,
  ] = useState<
    "active" |
    "waiting" |
    "completed"
  >("active");

  const openTasks =
    useMemo(
      () =>
        tasks.filter(
          (task) =>
            task.currentStage ===
              "supply" &&
            (
              task.supplyStatus ===
                "working" ||
              task.supplyStatus ===
                "returned"
            )
        ),
      [tasks]
    );

  const sentTasks =
    useMemo(
      () =>
        tasks.filter(
          (task) =>
            task.currentStage !==
              "supply" ||
            task.supplyStatus ===
              "sent"
        ),
      [tasks]
    );

  const waitingTasks =
    useMemo(
      () =>
        openTasks.filter(
          (task) =>
            task.purchaseStatus ===
              "recommendation_submitted" ||
            task.purchaseStatus ===
              "approved"
        ),
      [openTasks]
    );

  const activeTasks =
    useMemo(
      () =>
        openTasks.filter(
          (task) =>
            task.purchaseStatus !==
              "recommendation_submitted" &&
            task.purchaseStatus !==
              "approved"
        ),
      [openTasks]
    );

  const completedTasks =
    sentTasks;

  const dashboardTasks =
    dashboardFilter ===
      "waiting"
      ? waitingTasks

      : dashboardFilter ===
        "completed"
        ? completedTasks

        : activeTasks;

  const continueTask =
    activeTasks[0] ||
    waitingTasks[0] ||
    null;

  const listTasks =
    useMemo(() => {
      if (!continueTask) {
        return dashboardTasks;
      }

      return dashboardTasks.filter(
        (task) =>
          task.id !==
          continueTask.id
      );
    }, [
      continueTask,
      dashboardTasks,
    ]);

  const shellPaintedRef =
    useRef(false);

  const usableLoggedRef =
    useRef(false);

  const requestGenRef =
    useRef(0);

  const suppliersGenRef =
    useRef(0);

  const previewGenRef =
    useRef(0);

  const previewInflightRef =
    useRef("");

  const tasksRef =
    useRef<SokoSourcingTask[]>(
      []
    );

  tasksRef.current = tasks;

  const denyAccess = useCallback(() => {
    requestGenRef.current += 1;
    setAssignment(null);
    setTasks([]);
    setSuppliers([]);
    setSelectedTask(null);
    setSelectedSupplier(null);
    setShortlist([]);
    setRecommendedId("");
    setPreview(null);
    setTasksError("");
    setSuppliersError("");
    setSuppliersLoading(false);
    setTasksLoading(false);
    setLoading(false);
  }, []);

  const loadTasks = useCallback(
    async (
      sellerUserId: string,
      gen?: number
    ) => {
      const sellerId =
        String(
          sellerUserId || ""
        ).trim();

      const startedGen =
        gen ??
        requestGenRef.current;

      if (!sellerId) {
        setTasks([]);
        setTasksLoading(false);
        return;
      }

      setTasksError("");

      if (
        tasksRef.current.length ===
        0
      ) {
        setTasksLoading(true);
      }

      const startedAt =
        Date.now();

      logSokoWork(
        "KRISTO_SOKO_WORK_TASKS_REQUEST_START",
        {
          sellerUserId: sellerId,
        }
      );

      try {
        const result =
          await fetchSokoSourcingTasks(
            sellerId
          );

        if (
          startedGen !==
          requestGenRef.current
        ) {
          return;
        }

        logSokoWork(
          "KRISTO_SOKO_WORK_TASKS_RESPONSE",
          {
            sellerUserId: sellerId,
            ms:
              Date.now() -
              startedAt,
            status: 200,
            taskCount: (
              result.tasks ||
              []
            ).length,
          }
        );

        setTasks(
          result.tasks || []
        );
      } catch (e: any) {
        if (
          startedGen !==
          requestGenRef.current
        ) {
          return;
        }

        logSokoWork(
          "KRISTO_SOKO_WORK_TASKS_ERROR",
          {
            sellerUserId: sellerId,
            ms:
              Date.now() -
              startedAt,
            error: String(
              e?.message || e
            ),
          }
        );

        setTasksError(
          String(
            e?.message ||
              "Could not load sourcing tasks."
          )
        );
      } finally {
        if (
          startedGen ===
          requestGenRef.current
        ) {
          setTasksLoading(false);
        }
      }
    },
    []
  );

  const load =
    useCallback(async () => {
      const currentUserId =
        String(
          session?.userId ||
            ""
        ).trim();

      const cached =
        readCachedAcceptedAssignment(
          currentUserId
        );

      const gen =
        requestGenRef.current;

      if (cached) {
        setAssignment(cached);
        setLoading(false);

        if (
          cached.stage ===
          "supply"
        ) {
          void loadTasks(
            cached.sellerUserId,
            gen
          );
        }
      } else if (!currentUserId) {
        denyAccess();
        setError(
          "Sign in with your Kristo account first."
        );
        return;
      } else {
        setLoading(true);
      }

      setError("");

      try {
        const workforce =
          await fetchSokoWorkforceMe({
            userId: currentUserId,
            source: "soko-work",
          });

        if (
          String(
            session?.userId ||
              ""
          ).trim() !==
          currentUserId
        ) {
          return;
        }

        if (
          gen !==
          requestGenRef.current
        ) {
          return;
        }

        const active =
          pickAcceptedAssignment(
            workforce
          );

        if (!active) {
          denyAccess();
          return;
        }

        setAssignment(active);
        setLoading(false);

        if (
          active.stage !==
          "supply"
        ) {
          setTasks([]);
          setSelectedTask(null);
          setTasksLoading(false);
          setTasksError("");
          return;
        }

        const alreadyStarted =
          cached?.stage ===
            "supply" &&
          cached.sellerUserId ===
            active.sellerUserId;

        if (!alreadyStarted) {
          await loadTasks(
            active.sellerUserId,
            requestGenRef.current
          );
        }
      } catch (e: any) {
        if (
          String(
            session?.userId ||
              ""
          ).trim() !==
          currentUserId
        ) {
          return;
        }

        if (
          gen !==
          requestGenRef.current
        ) {
          return;
        }

        const stillCached =
          readCachedAcceptedAssignment(
            currentUserId
          );

        if (stillCached) {
          setAssignment(
            stillCached
          );
          setLoading(false);
        } else {
          setError(
            String(
              e?.message ||
                "Could not load SOKO work."
            )
          );
          setLoading(false);
        }
      }
    }, [
      denyAccess,
      loadTasks,
      session?.userId,
    ]);

  useEffect(() => {
    logSokoWork(
      "KRISTO_SOKO_WORK_ROUTE_MOUNT",
      {
        userId: userId || null,
        hasCachedAssignment:
          Boolean(
            readCachedAcceptedAssignment(
              userId
            )
          ),
      }
    );
  }, [userId]);

  useEffect(() => {
    if (loading || !assignment) {
      return;
    }

    if (!shellPaintedRef.current) {
      shellPaintedRef.current = true;
      logSokoWork(
        "KRISTO_SOKO_WORK_SHELL_PAINT",
        {
          userId: userId || null,
          stage: assignment.stage,
          assignmentId: assignment.id,
        }
      );
    }

    if (!usableLoggedRef.current) {
      usableLoggedRef.current = true;
      logSokoWork(
        "KRISTO_SOKO_WORK_DASHBOARD_USABLE",
        {
          userId: userId || null,
          stage: assignment.stage,
          tasksLoading,
          taskCount: tasks.length,
        }
      );
    }
  }, [
    loading,
    assignment,
    tasksLoading,
    tasks.length,
    userId,
  ]);

  useFocusEffect(
    useCallback(() => {
      const currentUserId =
        String(
          session?.userId ||
            ""
        ).trim();

      const cached =
        readCachedAcceptedAssignment(
          currentUserId
        );

      if (cached) {
        setAssignment(cached);
        setLoading(false);
      }

      void load();
    }, [load, session?.userId])
  );

  function taskWorkflowLabel(
    task: SokoSourcingTask
  ) {
    if (
      task.currentStage !==
        "supply" ||
      task.supplyStatus ===
        "sent"
    ) {
      return "Completed";
    }

    if (
      task.purchaseStatus ===
      "recommendation_submitted"
    ) {
      return "Waiting for owner";
    }

    if (
      task.purchaseStatus ===
      "approved"
    ) {
      return "Waiting for purchase";
    }

    if (
      task.purchaseStatus ===
        "purchased" &&
      !task.workerPurchaseVerifiedAt
    ) {
      return "Ready to verify";
    }

    if (
      task.purchaseStatus ===
        "purchased" &&
      task.workerPurchaseVerifiedAt
    ) {
      return "Ready for Level 02";
    }

    return "Finding supplier";
  }

  function openWorkspaceTool(
    tool:
      | "chat"
      | "plans"
      | "documents"
      | "suppliers"
      | "products"
      | "history"
  ) {
    if (
      tool ===
      "history"
    ) {
      setDashboardFilter(
        "completed"
      );

      return;
    }

    if (
      tool ===
      "chat"
    ) {
      if (!assignment) {
        Alert.alert(
          "Chat unavailable",
          "Your active SOKO work assignment could not be found."
        );

        return;
      }

      router.push(
        {
          pathname:
            "/(tabs)/more/soko-work/chat",

          params: {
            sellerUserId:
              assignment
                .sellerUserId,

            sellerName:
              assignment
                .sellerDisplayName ||
              "Store Owner",

            storeName:
              assignment
                .storeName ||
              "SOKO Store",
          },
        } as any
      );

      return;
    }

    const titles = {
      plans:
        "Work Plans",

      documents:
        "Work Documents",

      suppliers:
        "Supplier Library",

      products:
        "Saved Products",
    };

    const messages = {
      plans:
        "Work plans, checklists and deadlines will be saved here.",

      documents:
        "Images, PDFs, receipts, quotes and other work files will be saved here.",

      suppliers:
        "Your reusable supplier library will be connected here.",

      products:
        "Products you research and save for later will appear here.",
    };

    Alert.alert(
      titles[tool],
      messages[tool]
    );
  }

  const loadSavedSuppliers =
    useCallback(
      async (
        sellerUserId: string,
        task: SokoSourcingTask
      ) => {
        const sellerId =
          String(
            sellerUserId || ""
          ).trim();

        if (!sellerId) {
          return;
        }

        const gen =
          ++suppliersGenRef.current;

        setSuppliersLoading(true);
        setSuppliersError("");

        try {
          const result =
            await fetchSokoSuppliers({
              sellerUserId:
                sellerId,
            });

          if (
            gen !==
            suppliersGenRef.current
          ) {
            return;
          }

          const next =
            result.suppliers || [];

          setSuppliers(next);

          if (task.supplierName) {
            const old =
              next.find(
                (row) =>
                  row.name ===
                  task.supplierName
              );

            if (old) {
              setSelectedSupplier(
                old
              );
            }
          }
        } catch (e: any) {
          if (
            gen !==
            suppliersGenRef.current
          ) {
            return;
          }

          setSuppliers([]);
          setSuppliersError(
            String(
              e?.message ||
                "Could not load saved suppliers."
            )
          );
        } finally {
          if (
            gen ===
            suppliersGenRef.current
          ) {
            setSuppliersLoading(
              false
            );
          }
        }
      },
      []
    );

  function resetTaskWorkspace(
    task: SokoSourcingTask
  ) {
    setSelectedSupplier(null);
    setShortlist([]);
    setRecommendedId("");
    setAlibabaUrl("");
    setPreview(null);
    setPreviewError("");
    setPreviewLoading(false);
    setPreviewImageFailed(false);
    previewInflightRef.current = "";
    setManualOpen(false);
    setSuppliersError("");
    setManualSupplierName(
      task.supplierName || ""
    );
    setManualSupplierContact(
      task.supplierContact || ""
    );
    setSupplierCode(
      task.supplierCode || ""
    );
    setQuantity(
      String(
        task.quantity ||
          task.targetQuantity ||
          ""
      )
    );
    setUnitCost(
      task.unitCost > 0
        ? String(task.unitCost)
        : ""
    );
    setNotes(
      task.sourcingNotes || ""
    );
  }

  function openTask(
    task: SokoSourcingTask
  ) {
    if (!assignment) {
      return;
    }

    setSelectedTask(task);
    resetTaskWorkspace(task);
    void loadSavedSuppliers(
      assignment.sellerUserId,
      task
    );
  }

  function addToShortlist(
    candidate: ShortlistCandidate
  ) {
    if (
      !candidate.name.trim() ||
      !candidate.contactOrUrl.trim()
    ) {
      Alert.alert(
        "Missing supplier details",
        "A supplier name and a contact or product URL are required."
      );
      return false;
    }

    const existing =
      shortlist.find(
        (row) =>
          row.id === candidate.id
      );

    if (existing) {
      setRecommendedId(
        candidate.id
      );
      return true;
    }

    if (shortlist.length >= 3) {
      Alert.alert(
        "Shortlist is full",
        "Compare up to 3 candidates. Remove one first."
      );
      return false;
    }

    setShortlist(
      (current) => [
        ...current,
        candidate,
      ]
    );
    setRecommendedId(candidate.id);
    return true;
  }

  function removeFromShortlist(
    id: string
  ) {
    setShortlist(
      (current) =>
        current.filter(
          (row) => row.id !== id
        )
    );

    if (recommendedId === id) {
      setRecommendedId("");
    }
  }

  async function openLink(
    url: string
  ) {
    const href =
      String(url || "").trim();

    if (!href) {
      Alert.alert(
        "No link",
        "This supplier does not have a website or contact link yet."
      );
      return;
    }

    if (
      /^https?:\/\//i.test(href) &&
      !isHttpsUrl(href)
    ) {
      Alert.alert(
        "Insecure link",
        "Only HTTPS links can be opened."
      );
      return;
    }

    if (!isHttpsUrl(href)) {
      Alert.alert(
        "Contact",
        href
      );
      return;
    }

    try {
      await Linking.openURL(href);
    } catch {
      Alert.alert(
        "Could not open link",
        href
      );
    }
  }

  async function openAlibabaSearch(
    task: SokoSourcingTask
  ) {
    const url =
      buildAlibabaExternalSearchUrl({
        productName:
          task.productName,
        category: task.category,
        quantity:
          task.targetQuantity,
      });

    if (!isHttpsAlibabaUrl(url)) {
      Alert.alert(
        "Could not open Alibaba",
        "The search URL is not a valid HTTPS Alibaba link."
      );
      return;
    }

    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(
        "Could not open Alibaba",
        url
      );
    }
  }

  async function loadAlibabaPreview() {
    const url =
      String(alibabaUrl || "").trim();

    if (!isHttpsAlibabaUrl(url)) {
      setPreview(null);
      setPreviewError(
        "Paste an HTTPS alibaba.com product link."
      );
      return;
    }

    if (
      previewInflightRef.current ===
        url &&
      previewLoading
    ) {
      return;
    }

    const gen =
      ++previewGenRef.current;

    previewInflightRef.current = url;
    setPreviewLoading(true);
    setPreviewError("");
    setPreviewImageFailed(false);

    try {
      const result =
        await fetchAlibabaProductPreview(
          url
        );

      if (
        gen !==
        previewGenRef.current
      ) {
        return;
      }

      if (!result.found) {
        setPreview(result);
        setPreviewError(
          "No product details were found for this link."
        );
        return;
      }

      setPreview(result);
    } catch (e: any) {
      if (
        gen !==
        previewGenRef.current
      ) {
        return;
      }

      setPreview(null);
      setPreviewError(
        String(
          e?.message ||
            "Could not preview this Alibaba product link."
        )
      );
    } finally {
      if (
        gen ===
        previewGenRef.current
      ) {
        setPreviewLoading(false);

        if (
          previewInflightRef.current ===
          url
        ) {
          previewInflightRef.current =
            "";
        }
      }
    }
  }

  function availabilityUrl(
    supplier: SokoSupplier,
    task: SokoSourcingTask
  ) {
    const template =
      String(
        supplier.availabilityUrlTemplate ||
          ""
      ).trim();

    if (!template) return "";

    return template.replace(
      /\{query\}/gi,
      encodeURIComponent(
        task.productName
      )
    );
  }

  async function save(
    requestedMode:
      | "working"
      | "sent"
  ) {
    if (
      !assignment ||
      !selectedTask
    ) {
      return;
    }

    let mode:
      | "working"
      | "recommendation"
      | "verify_purchase"
      | "sent" =
        requestedMode;

    if (
      requestedMode ===
      "sent"
    ) {
      if (
        selectedTask.purchaseMode ===
          "to_be_purchased" &&
        selectedTask.purchaseStatus ===
          "not_purchased"
      ) {
        mode =
          "recommendation";
      }

      else if (
        selectedTask.purchaseStatus ===
        "recommendation_submitted"
      ) {
        Alert.alert(
          "Waiting for owner",
          "Your purchase recommendation has been submitted. The owner must approve it first."
        );

        return;
      }

      else if (
        selectedTask.purchaseStatus ===
        "approved"
      ) {
        Alert.alert(
          "Purchase approved",
          "The owner approved the recommendation. Wait until the purchase is completed and marked Purchased."
        );

        return;
      }

      else if (
        selectedTask.purchaseStatus ===
          "purchased" &&
        !selectedTask
          .workerPurchaseVerifiedAt
      ) {
        mode =
          "verify_purchase";
      }

      else {
        mode =
          "sent";
      }
    }

    const alreadyPurchased =
      selectedTask.purchaseMode ===
      "already_purchased";

    const recommended =
      shortlist.find(
        (row) =>
          row.id === recommendedId
      ) || null;

    const supplierName =
      alreadyPurchased
        ? (
            selectedTask
              .purchaseSupplierName ||
            selectedTask
              .supplierName ||
            ""
          ).trim()

        : (
            recommended?.name ||
            selectedSupplier
              ?.name ||
            manualSupplierName ||
            selectedTask
              .supplierName ||
            ""
          ).trim();

    const supplierContact =
      alreadyPurchased
        ? ""
        : (
            recommended?.contactOrUrl ||
            selectedSupplier
              ?.contact ||
            selectedSupplier
              ?.websiteUrl ||
            manualSupplierContact ||
            ""
          ).trim();

    if (
      mode === "recommendation" &&
      !alreadyPurchased
    ) {
      if (!recommended) {
        Alert.alert(
          "Mark a recommendation",
          "Shortlist a candidate and mark one as Recommended."
        );
        return;
      }

      if (!supplierName) {
        Alert.alert(
          "Supplier name required"
        );
        return;
      }

      if (!supplierContact) {
        Alert.alert(
          "Contact or product URL required",
          "Add a website, contact, or Alibaba product link."
        );
        return;
      }

      if (
        /^https?:\/\//i.test(
          supplierContact
        ) &&
        !isHttpsUrl(supplierContact)
      ) {
        Alert.alert(
          "Use an HTTPS link",
          "Supplier URLs must use HTTPS."
        );
        return;
      }

      if (!notes.trim()) {
        Alert.alert(
          "Notes required",
          "Explain why this supplier is recommended, including quoted price, MOQ, lead time, and risks when known."
        );
        return;
      }
    }

    if (
      mode === "working" &&
      !alreadyPurchased &&
      !selectedSupplier &&
      !manualSupplierName.trim() &&
      !recommended
    ) {
      Alert.alert(
        "Choose supplier",
        "Select a saved supplier, preview an Alibaba link, or enter a supplier manually."
      );

      return;
    }

    if (
      (
        mode ===
          "verify_purchase" ||
        mode ===
          "sent"
      ) &&
      !supplierName
    ) {
      Alert.alert(
        "Purchase supplier missing",
        "The purchase record does not include a supplier."
      );

      return;
    }

    const qty =
      Number(
        quantity
      );

    const typedCostText =
      String(unitCost || "").trim();

    const typedCost =
      Number(typedCostText);

    const fallbackCost =
      selectedTask
        .actualUnitCost > 0
        ? selectedTask
            .actualUnitCost

        : selectedTask
            .unitCost;

    const cost =
      typedCostText &&
      Number.isFinite(typedCost) &&
      typedCost >= 0
        ? typedCost
        : mode === "recommendation"
          ? 0
          : fallbackCost;

    if (
      (
        mode ===
          "recommendation" ||
        mode ===
          "sent"
      ) &&
      (
        !Number.isFinite(qty) ||
        qty <= 0
      )
    ) {
      Alert.alert(
        "Confirmed quantity required"
      );

      return;
    }

    if (
      mode ===
        "recommendation" &&
      typedCostText &&
      (
        !Number.isFinite(typedCost) ||
        typedCost < 0
      )
    ) {
      Alert.alert(
        "Unit cost must be a valid number when entered."
      );

      return;
    }

    if (
      (
        mode ===
          "verify_purchase" ||
        mode ===
          "sent"
      ) &&
      selectedTask
        .purchaseStatus !==
        "purchased"
    ) {
      Alert.alert(
        "Purchase not complete",
        "The owner must complete the purchase first."
      );

      return;
    }

    try {
      setBusy(true);

      await saveSokoSupplyOperation({
        sellerUserId:
          assignment.sellerUserId,

        operationId:
          selectedTask.id,

        supplierName,

        supplierContact,

        productName:
          selectedTask.productName,

        supplierCode:
          supplierCode.trim(),

        quantity:
          Number.isFinite(qty) &&
          qty > 0
            ? qty
            : selectedTask
                .targetQuantity,

        unitCost:
          Number.isFinite(cost)
            ? cost
            : 0,

        notes:
          notes.trim(),

        mode,
      });

      if (
        mode ===
        "recommendation"
      ) {
        Alert.alert(
          "Recommendation sent to owner",
          "Waiting for owner approval. You cannot purchase or pay from this workspace."
        );
      }

      else if (
        mode ===
        "verify_purchase"
      ) {
        Alert.alert(
          "Purchase verified",
          "Level 01 verification is complete. Press Send Level 02 when ready."
        );
      }

      else if (
        mode ===
        "sent"
      ) {
        Alert.alert(
          "Sent to Level 02",
          `${selectedTask.productName} is ready for Product Setup.`
        );

        setSelectedTask(
          null
        );

        setSelectedSupplier(
          null
        );
      }

      else {
        Alert.alert(
          "Work saved"
        );
      }

      const refreshed =
        await fetchSokoSourcingTasks(
          assignment.sellerUserId
        );

      const nextTasks =
        refreshed.tasks || [];

      setTasks(
        nextTasks
      );

      if (
        mode !==
        "sent"
      ) {
        const nextTask =
          nextTasks.find(
            (task) =>
              task.id ===
              selectedTask.id
          );

        if (nextTask) {
          setSelectedTask(
            nextTask
          );
        }
      }

    } catch (e: any) {
      Alert.alert(
        "Could not save work",

        String(
          e?.message ||
            e
        )
      );

    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={s.screen}>
        <View style={s.center}>
          <ActivityIndicator
            color={GOLD}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (
    assignment?.stage ===
      "setup"
  ) {
    return (
      <SokoLevel02Work
        assignment={
          assignment
        }
        onBack={() =>
          router.back()
        }
      />
    );
  }

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Pressable
          onPress={() =>
            selectedTask
              ? setSelectedTask(null)
              : router.back()
          }
          hitSlop={8}
          style={s.back}
        >
          <Ionicons
            name="chevron-back"
            size={22}
            color="#FFFFFF"
          />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={s.title}>
            SOKO WORK
          </Text>

          <Text style={s.subtitle}>
            Level 01 · Smart Sourcing
          </Text>
        </View>

        <View style={s.headerIcon}>
          <Ionicons
            name="search-outline"
            size={18}
            color="rgba(255,214,107,0.82)"
          />
        </View>
      </View>

      {error ? (
        <View style={s.center}>
          <Text style={s.error}>
            {error}
          </Text>
        </View>
      ) : !assignment ? (
        <View style={s.center}>
          <Ionicons
            name="briefcase-outline"
            size={35}
            color={GOLD}
          />

          <Text style={s.emptyTitle}>
            No Level 01 assignment
          </Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={
            false
          }
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={
            s.content
          }
        >
          <View style={s.storeCard}>
            <View style={s.storeIconWrap}>
              <Ionicons
                name="storefront-outline"
                size={16}
                color={GOLD}
              />
            </View>

            <View
              style={{
                flex: 1,
                marginLeft: 10,
                minWidth: 0,
              }}
            >
              <Text
                style={s.storeName}
                numberOfLines={1}
              >
                {assignment.storeName ||
                  "SOKO STORE"}
              </Text>

              <Text
                style={s.storeMeta}
                numberOfLines={1}
              >
                {assignment.sellerDisplayName ||
                  "Store owner"}
              </Text>
            </View>

            <View style={s.activeBadge}>
              <Text style={s.activeText}>
                Active
              </Text>
            </View>
          </View>

          {!selectedTask ? (
            <>
              <View style={s.statsStrip}>
                <Pressable
                  onPress={() =>
                    setDashboardFilter(
                      "active"
                    )
                  }
                  style={[
                    s.statsCell,
                    dashboardFilter ===
                      "active" &&
                      s.statsCellActive,
                  ]}
                >
                  <Text
                    style={[
                      s.statsNumber,
                      dashboardFilter ===
                        "active" &&
                        s.statsNumberActive,
                    ]}
                  >
                    {activeTasks.length}
                  </Text>
                  <Text
                    style={[
                      s.statsLabel,
                      dashboardFilter ===
                        "active" &&
                        s.statsLabelActive,
                    ]}
                  >
                    Active
                  </Text>
                </Pressable>

                <View style={s.statsDivider} />

                <Pressable
                  onPress={() =>
                    setDashboardFilter(
                      "waiting"
                    )
                  }
                  style={[
                    s.statsCell,
                    dashboardFilter ===
                      "waiting" &&
                      s.statsCellActive,
                  ]}
                >
                  <Text style={s.statsNumber}>
                    {waitingTasks.length}
                  </Text>
                  <Text style={s.statsLabel}>
                    Waiting
                  </Text>
                </Pressable>

                <View style={s.statsDivider} />

                <Pressable
                  onPress={() =>
                    setDashboardFilter(
                      "completed"
                    )
                  }
                  style={[
                    s.statsCell,
                    dashboardFilter ===
                      "completed" &&
                      s.statsCellActive,
                  ]}
                >
                  <Text style={s.statsNumber}>
                    {completedTasks.length}
                  </Text>
                  <Text style={s.statsLabel}>
                    Done
                  </Text>
                </Pressable>
              </View>

              {continueTask ? (
                <View style={s.heroCard}>
                  <Text style={s.heroKicker}>
                    Current assignment
                  </Text>

                  <Text
                    style={s.heroCategory}
                    numberOfLines={1}
                  >
                    {continueTask.category ||
                      "Sourcing"}
                  </Text>

                  <Text
                    style={s.heroTitle}
                    numberOfLines={2}
                  >
                    {continueTask.productName}
                  </Text>

                  <Text
                    style={s.heroStatus}
                    numberOfLines={1}
                  >
                    {taskWorkflowLabel(
                      continueTask
                    )}
                  </Text>

                  <View style={s.heroMetaRow}>
                    <Text style={s.heroMeta}>
                      Qty {continueTask.targetQuantity}
                    </Text>
                    <Text style={s.heroMetaDot}>
                      ·
                    </Text>
                    <Text style={s.heroMeta}>
                      {continueTask.targetUnitCost >
                      0
                        ? `$${continueTask.targetUnitCost.toFixed(
                            2
                          )}`
                        : "Open target"}
                    </Text>
                    <Text style={s.heroMetaDot}>
                      ·
                    </Text>
                    <Text
                      style={[
                        s.heroMeta,
                        continueTask.priority ===
                          "urgent" && {
                          color: "#FF8993",
                        },
                      ]}
                    >
                      {continueTask.priority}
                    </Text>
                  </View>

                  <Pressable
                    onPress={() =>
                      void openTask(
                        continueTask
                      )
                    }
                    style={s.heroButton}
                  >
                    <Text style={s.heroButtonText}>
                      Continue
                    </Text>
                    <Ionicons
                      name="arrow-forward"
                      size={16}
                      color="#211C10"
                    />
                  </Pressable>
                </View>
              ) : null}

              <Text style={s.sectionLabel}>
                Tasks
              </Text>

              <View style={s.segment}>
                <Pressable
                  onPress={() =>
                    setDashboardFilter(
                      "active"
                    )
                  }
                  style={[
                    s.segmentItem,
                    dashboardFilter ===
                      "active" &&
                      s.segmentItemActive,
                  ]}
                >
                  <Text
                    style={[
                      s.segmentText,
                      dashboardFilter ===
                        "active" &&
                        s.segmentTextActive,
                    ]}
                  >
                    Active
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() =>
                    setDashboardFilter(
                      "waiting"
                    )
                  }
                  style={[
                    s.segmentItem,
                    dashboardFilter ===
                      "waiting" &&
                      s.segmentItemActive,
                  ]}
                >
                  <Text
                    style={[
                      s.segmentText,
                      dashboardFilter ===
                        "waiting" &&
                        s.segmentTextActive,
                    ]}
                  >
                    Waiting
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() =>
                    setDashboardFilter(
                      "completed"
                    )
                  }
                  style={[
                    s.segmentItem,
                    dashboardFilter ===
                      "completed" &&
                      s.segmentItemActive,
                  ]}
                >
                  <Text
                    style={[
                      s.segmentText,
                      dashboardFilter ===
                        "completed" &&
                        s.segmentTextActive,
                    ]}
                  >
                    Completed
                  </Text>
                </Pressable>
              </View>

              {tasksLoading &&
              tasks.length ===
                0 ? (
                <View style={s.taskSkeletonBlock}>
                  <View style={s.heroSkeleton} />
                  <View style={s.taskSkeletonCard} />
                  <View style={s.taskSkeletonCard} />
                </View>
              ) : tasksError &&
                tasks.length ===
                  0 ? (
                <View style={s.empty}>
                  <Ionicons
                    name="warning-outline"
                    size={22}
                    color="#FF8993"
                  />

                  <Text style={s.emptyTitle}>
                    Could not load tasks
                  </Text>

                  <Text style={s.emptyCopy}>
                    {tasksError}
                  </Text>
                </View>
              ) : listTasks.length ===
              0 ? (
                <View style={s.emptyQuiet}>
                  <Text style={[s.emptyTitle, s.emptyQuietTitle]}>
                    {continueTask &&
                    dashboardFilter !==
                      "completed"
                      ? dashboardFilter ===
                        "waiting"
                        ? "No other waiting tasks"
                        : "No additional active tasks"

                      : dashboardFilter ===
                        "waiting"
                        ? "Nothing waiting"

                        : dashboardFilter ===
                          "completed"
                          ? "No completed work yet"

                          : "You're caught up"}
                  </Text>

                  <Text style={[s.emptyCopy, s.emptyQuietCopy]}>
                    {continueTask &&
                    dashboardFilter !==
                      "completed"
                      ? "The current assignment is shown above."

                      : dashboardFilter ===
                        "waiting"
                        ? "Tasks waiting for owner approval or purchase will appear here."

                        : dashboardFilter ===
                          "completed"
                          ? "Tasks sent to the next level will stay in your work history."

                          : "New tasks assigned by the store owner will appear here."}
                  </Text>
                </View>
              ) : (
                listTasks.map(
                  (task) => (
                    <Pressable
                      key={task.id}
                      disabled={
                        dashboardFilter ===
                        "completed"
                      }
                      onPress={() => {
                        if (
                          dashboardFilter !==
                          "completed"
                        ) {
                          void openTask(
                            task
                          );
                        }
                      }}
                      style={s.taskRow}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text
                          style={s.taskRowCategory}
                          numberOfLines={1}
                        >
                          {task.category ||
                            "Sourcing"}
                        </Text>

                        <Text
                          style={s.taskRowName}
                          numberOfLines={1}
                        >
                          {task.productName}
                        </Text>

                        <Text
                          style={s.taskRowMeta}
                          numberOfLines={1}
                        >
                          {taskWorkflowLabel(
                            task
                          )}
                          {"  ·  "}
                          Qty {task.targetQuantity}
                          {"  ·  "}
                          {task.targetUnitCost >
                          0
                            ? `$${task.targetUnitCost.toFixed(
                                2
                              )}`
                            : "Open"}
                        </Text>
                      </View>

                      {dashboardFilter !==
                      "completed" ? (
                        <Ionicons
                          name="chevron-forward"
                          size={18}
                          color="rgba(255,255,255,0.28)"
                        />
                      ) : null}
                    </Pressable>
                  )
                )
              )}

              <Text style={s.sectionLabel}>
                Workspace
              </Text>

              <View style={s.toolList}>
                <Pressable
                  onPress={() =>
                    openWorkspaceTool(
                      "chat"
                    )
                  }
                  style={s.toolRow}
                >
                  <View style={s.toolIcon}>
                    <Ionicons
                      name="chatbubble-ellipses-outline"
                      size={18}
                      color={BLUE}
                    />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.toolTitle}>
                      Chat with Owner
                    </Text>
                    <Text
                      style={s.toolCopy}
                      numberOfLines={1}
                    >
                      Store and task messages
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color="rgba(255,255,255,0.24)"
                  />
                </Pressable>

                <Pressable
                  onPress={() =>
                    openWorkspaceTool(
                      "plans"
                    )
                  }
                  style={s.toolRow}
                >
                  <View style={s.toolIcon}>
                    <Ionicons
                      name="calendar-outline"
                      size={18}
                      color={GOLD}
                    />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.toolTitle}>
                      Work Plans
                    </Text>
                    <Text
                      style={s.toolCopy}
                      numberOfLines={1}
                    >
                      Plans, checklist, deadlines
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color="rgba(255,255,255,0.24)"
                  />
                </Pressable>

                <Pressable
                  onPress={() =>
                    openWorkspaceTool(
                      "documents"
                    )
                  }
                  style={s.toolRowQuiet}
                >
                  <View style={s.toolIconQuiet}>
                    <Ionicons
                      name="folder-open-outline"
                      size={16}
                      color="rgba(255,255,255,0.55)"
                    />
                  </View>
                  <Text style={s.toolTitleQuiet}>
                    Documents
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color="rgba(255,255,255,0.18)"
                  />
                </Pressable>

                <Pressable
                  onPress={() =>
                    openWorkspaceTool(
                      "suppliers"
                    )
                  }
                  style={s.toolRowQuiet}
                >
                  <View style={s.toolIconQuiet}>
                    <Ionicons
                      name="business-outline"
                      size={16}
                      color="rgba(255,255,255,0.55)"
                    />
                  </View>
                  <Text style={s.toolTitleQuiet}>
                    Suppliers
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color="rgba(255,255,255,0.18)"
                  />
                </Pressable>

                <Pressable
                  onPress={() =>
                    openWorkspaceTool(
                      "products"
                    )
                  }
                  style={s.toolRowQuiet}
                >
                  <View style={s.toolIconQuiet}>
                    <Ionicons
                      name="bookmark-outline"
                      size={16}
                      color="rgba(255,255,255,0.55)"
                    />
                  </View>
                  <Text style={s.toolTitleQuiet}>
                    Saved Products
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color="rgba(255,255,255,0.18)"
                  />
                </Pressable>

                <Pressable
                  onPress={() =>
                    openWorkspaceTool(
                      "history"
                    )
                  }
                  style={s.toolRowQuiet}
                >
                  <View style={s.toolIconQuiet}>
                    <Ionicons
                      name="time-outline"
                      size={16}
                      color="rgba(255,255,255,0.55)"
                    />
                  </View>
                  <Text style={s.toolTitleQuiet}>
                    Work History
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color="rgba(255,255,255,0.18)"
                  />
                </Pressable>
              </View>

            </>
          ) : (
            <>
              <View style={s.taskHero}>
                <Text style={s.category}>
                  {selectedTask.category}
                </Text>

                <Text style={s.taskHeroTitle}>
                  {selectedTask.productName}
                </Text>

                <View style={s.heroFacts}>
                  <View style={s.heroFact}>
                    <Text style={s.heroLabel}>
                      TARGET QTY
                    </Text>

                    <Text style={s.heroValue}>
                      {selectedTask.targetQuantity}
                    </Text>
                  </View>

                  <View style={s.heroFact}>
                    <Text style={s.heroLabel}>
                      TARGET COST
                    </Text>

                    <Text style={s.heroValue}>
                      {selectedTask.targetUnitCost >
                      0
                        ? `$${selectedTask.targetUnitCost.toFixed(
                            2
                          )}`
                        : "OPEN"}
                    </Text>
                  </View>

                  <View style={s.heroFact}>
                    <Text style={s.heroLabel}>
                      PRIORITY
                    </Text>

                    <Text style={s.heroValue}>
                      {selectedTask.priority.toUpperCase()}
                    </Text>
                  </View>
                </View>

                {selectedTask.taskNotes ? (
                  <Text style={s.taskBrief}>
                    {selectedTask.taskNotes}
                  </Text>
                ) : null}
              </View>

              <View
                style={{
                  marginBottom: 14,
                  padding: 12,
                  borderRadius: 16,

                  borderWidth: 1,

                  borderColor:
                    selectedTask.purchaseStatus ===
                    "purchased"
                      ? "rgba(93,235,165,0.20)"
                      : "rgba(255,214,107,0.16)",

                  backgroundColor:
                    "rgba(255,255,255,0.025)",
                }}
              >
                <Text
                  style={{
                    color:
                      "rgba(255,255,255,0.42)",
                    fontSize: 8,
                    fontWeight: "900",
                    letterSpacing: 1.1,
                  }}
                >
                  PURCHASE WORKFLOW
                </Text>

                <Text
                  style={{
                    color: "#FFFFFF",
                    fontSize: 13,
                    fontWeight: "900",
                    marginTop: 5,
                  }}
                >
                  {selectedTask.purchaseMode ===
                  "already_purchased"
                    ? "Already purchased"
                    : selectedTask.purchaseStatus ===
                      "not_purchased"
                      ? "Find supplier & recommend"

                      : selectedTask.purchaseStatus ===
                        "recommendation_submitted"
                        ? "Waiting for owner approval"

                        : selectedTask.purchaseStatus ===
                          "approved"
                          ? "Owner approved · waiting for purchase"

                          : selectedTask
                              .workerPurchaseVerifiedAt
                            ? "Purchase verified"

                            : "Purchase completed · verify it"}
                </Text>

                {selectedTask.purchaseSupplierName ? (
                  <Text
                    style={{
                      color:
                        "rgba(255,255,255,0.60)",
                      fontSize: 9,
                      lineHeight: 14,
                      marginTop: 6,
                    }}
                  >
                    Supplier:{" "}
                    {selectedTask.purchaseSupplierName}
                  </Text>
                ) : null}

                {selectedTask.actualUnitCost > 0 ? (
                  <Text
                    style={{
                      color:
                        "rgba(255,255,255,0.60)",
                      fontSize: 9,
                      lineHeight: 14,
                    }}
                  >
                    Actual unit cost: $
                    {selectedTask.actualUnitCost.toFixed(
                      2
                    )}
                  </Text>
                ) : null}

                {selectedTask.totalPaid > 0 ? (
                  <Text
                    style={{
                      color:
                        "rgba(255,255,255,0.60)",
                      fontSize: 9,
                      lineHeight: 14,
                    }}
                  >
                    Total paid: $
                    {selectedTask.totalPaid.toFixed(
                      2
                    )}
                  </Text>
                ) : null}

                {selectedTask.purchaseOrderReference ? (
                  <Text
                    style={{
                      color:
                        "rgba(255,255,255,0.60)",
                      fontSize: 9,
                      lineHeight: 14,
                    }}
                  >
                    Order / reference:{" "}
                    {selectedTask.purchaseOrderReference}
                  </Text>
                ) : null}

                {selectedTask.purchaseTrackingNumber ? (
                  <Text
                    style={{
                      color:
                        "rgba(255,255,255,0.60)",
                      fontSize: 9,
                      lineHeight: 14,
                    }}
                  >
                    Tracking:{" "}
                    {selectedTask.purchaseTrackingNumber}
                  </Text>
                ) : null}
              </View>

              <Text style={s.sectionLabel}>
                SUPPLIERS FOR{" "}
                {selectedTask.category.toUpperCase()}
              </Text>

              {suppliers.length === 0 ? (
                selectedTask.purchaseMode ===
                  "to_be_purchased" &&
                selectedTask.purchaseStatus ===
                  "not_purchased" ? (
                  <View style={s.formCard}>
                    <View
                      style={{
                        alignItems: "center",
                        marginBottom: 15,
                      }}
                    >
                      <Ionicons
                        name="search-outline"
                        size={29}
                        color={BLUE}
                      />

                      <Text
                        style={[
                          s.emptyTitle,
                          {
                            marginTop: 8,
                          },
                        ]}
                      >
                        Find a supplier
                      </Text>

                      <Text
                        style={[
                          s.emptyCopy,
                          {
                            textAlign: "center",
                          },
                        ]}
                      >
                        No supplier is saved yet.
                        Search the web or enter
                        the supplier you found.
                      </Text>
                    </View>

                    <Pressable
                      onPress={() =>
                        void openLink(
                          `https://www.google.com/search?q=${encodeURIComponent(
                            `${selectedTask.productName} wholesale supplier`
                          )}`
                        )
                      }
                      style={{
                        minHeight: 44,
                        borderRadius: 14,
                        alignItems: "center",
                        justifyContent: "center",
                        flexDirection: "row",
                        marginBottom: 16,

                        backgroundColor:
                          "rgba(117,193,255,0.08)",

                        borderWidth: 1,
                        borderColor:
                          "rgba(117,193,255,0.22)",
                      }}
                    >
                      <Ionicons
                        name="globe-outline"
                        size={17}
                        color={BLUE}
                      />

                      <Text
                        style={{
                          marginLeft: 7,
                          color: BLUE,
                          fontSize: 10,
                          fontWeight: "900",
                        }}
                      >
                        SEARCH WEB
                      </Text>
                    </Pressable>

                    <Text style={s.fieldLabel}>
                      SUPPLIER NAME
                    </Text>

                    <TextInput
                      value={manualSupplierName}
                      onChangeText={
                        setManualSupplierName
                      }
                      placeholder="Example: Alibaba supplier"
                      placeholderTextColor="rgba(255,255,255,0.28)"
                      style={s.input}
                    />

                    <Text style={s.fieldLabel}>
                      SUPPLIER LINK / CONTACT
                    </Text>

                    <TextInput
                      value={manualSupplierContact}
                      onChangeText={
                        setManualSupplierContact
                      }
                      autoCapitalize="none"
                      placeholder="Product link, website, email or phone"
                      placeholderTextColor="rgba(255,255,255,0.28)"
                      style={s.input}
                    />

                    <Text style={s.fieldLabel}>
                      PRODUCT CODE / SKU
                    </Text>

                    <TextInput
                      value={supplierCode}
                      onChangeText={
                        setSupplierCode
                      }
                      placeholder="Supplier reference"
                      placeholderTextColor="rgba(255,255,255,0.28)"
                      style={s.input}
                    />

                    <View style={s.row}>
                      <View style={s.half}>
                        <Text style={s.fieldLabel}>
                          CONFIRMED QTY
                        </Text>

                        <TextInput
                          value={quantity}
                          onChangeText={
                            setQuantity
                          }
                          keyboardType="number-pad"
                          placeholder="Quantity"
                          placeholderTextColor="rgba(255,255,255,0.28)"
                          style={s.input}
                        />
                      </View>

                      <View
                        style={[
                          s.half,
                          {
                            marginLeft: 8,
                          },
                        ]}
                      >
                        <Text style={s.fieldLabel}>
                          UNIT COST
                        </Text>

                        <TextInput
                          value={unitCost}
                          onChangeText={
                            setUnitCost
                          }
                          keyboardType="decimal-pad"
                          placeholder="0.00"
                          placeholderTextColor="rgba(255,255,255,0.28)"
                          style={s.input}
                        />
                      </View>
                    </View>

                    <Text style={s.fieldLabel}>
                      NOTES
                    </Text>

                    <TextInput
                      value={notes}
                      onChangeText={
                        setNotes
                      }
                      multiline
                      textAlignVertical="top"
                      placeholder="MOQ, stock, shipping, delivery time..."
                      placeholderTextColor="rgba(255,255,255,0.28)"
                      style={[
                        s.input,
                        s.notesInput,
                      ]}
                    />

                    <View style={s.actions}>
                      <Pressable
                        disabled={busy}
                        onPress={() =>
                          void save(
                            "working"
                          )
                        }
                        style={s.saveButton}
                      >
                        <Ionicons
                          name="save-outline"
                          size={17}
                          color={GOLD}
                        />

                        <Text style={s.saveText}>
                          Save
                        </Text>
                      </Pressable>

                      <Pressable
                        disabled={busy}
                        onPress={() =>
                          void save(
                            "sent"
                          )
                        }
                        style={s.sendButton}
                      >
                        {busy ? (
                          <ActivityIndicator
                            color="#211C10"
                          />
                        ) : (
                          <>
                            <Text style={s.sendText}>
                              Submit recommendation
                            </Text>

                            <Ionicons
                              name="arrow-forward"
                              size={17}
                              color="#211C10"
                            />
                          </>
                        )}
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <View style={s.empty}>
                    <Ionicons
                      name="hourglass-outline"
                      size={30}
                      color={GREEN}
                    />

                    <Text style={s.emptyTitle}>
                      Purchase workflow
                    </Text>

                    <Text style={s.emptyCopy}>
                      Continue with the purchase
                      action below.
                    </Text>
                  </View>
                )
              ) : (
                suppliers.map(
                  (supplier) => {
                    const selected =
                      selectedSupplier?.id ===
                      supplier.id;

                    const searchUrl =
                      buildSupplierSearchUrl(
                        supplier,
                        selectedTask.productName
                      );

                    const stockUrl =
                      availabilityUrl(
                        supplier,
                        selectedTask
                      );

                    return (
                      <View
                        key={supplier.id}
                        style={[
                          s.supplierCard,
                          selected &&
                            s.supplierSelected,
                        ]}
                      >
                        <View
                          style={
                            s.supplierTop
                          }
                        >
                          <View
                            style={
                              s.supplierIcon
                            }
                          >
                            <Ionicons
                              name="business-outline"
                              size={20}
                              color={
                                selected
                                  ? GOLD
                                  : BLUE
                              }
                            />
                          </View>

                          <View
                            style={{
                              flex: 1,
                            }}
                          >
                            <Text
                              style={
                                s.supplierName
                              }
                            >
                              {supplier.name}
                            </Text>

                            <Text
                              style={
                                s.supplierMeta
                              }
                            >
                              {[
                                supplier.country,
                                supplier.moq
                                  ? `MOQ ${supplier.moq}`
                                  : "",
                                supplier.leadTime
                                  ? `Lead ${supplier.leadTime}`
                                  : "",
                              ]
                                .filter(Boolean)
                                .join(" • ")}
                            </Text>
                          </View>
                        </View>

                        <View
                          style={
                            s.supplierActions
                          }
                        >
                          {searchUrl ? (
                            <Pressable
                              onPress={() =>
                                void openLink(
                                  searchUrl
                                )
                              }
                              style={s.linkButton}
                            >
                              <Ionicons
                                name="search-outline"
                                size={16}
                                color={BLUE}
                              />

                              <Text
                                style={
                                  s.linkText
                                }
                              >
                                Search product
                              </Text>
                            </Pressable>
                          ) : null}

                          {stockUrl ? (
                            <Pressable
                              onPress={() =>
                                void openLink(
                                  stockUrl
                                )
                              }
                              style={s.linkButton}
                            >
                              <Ionicons
                                name="pulse-outline"
                                size={16}
                                color={GREEN}
                              />

                              <Text
                                style={
                                  s.linkText
                                }
                              >
                                Check availability
                              </Text>
                            </Pressable>
                          ) : null}

                          <Pressable
                            onPress={() =>
                              setSelectedSupplier(
                                supplier
                              )
                            }
                            style={[
                              s.selectButton,
                              selected &&
                                s.selectButtonActive,
                            ]}
                          >
                            <Ionicons
                              name={
                                selected
                                  ? "checkmark-circle"
                                  : "add-circle-outline"
                              }
                              size={16}
                              color={
                                selected
                                  ? "#211C10"
                                  : GOLD
                              }
                            />

                            <Text
                              style={[
                                s.selectText,
                                selected && {
                                  color:
                                    "#211C10",
                                },
                              ]}
                            >
                              {selected
                                ? "Selected"
                                : "Use supplier"}
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    );
                  }
                )
              )}

              {!selectedSupplier &&
              selectedTask.purchaseStatus !==
                "not_purchased" ? (
                <View style={s.formCard}>
                  <Text style={s.sectionLabel}>
                    PURCHASE ACTION
                  </Text>

                  <Text
                    style={{
                      color:
                        "rgba(255,255,255,0.62)",
                      fontSize: 10,
                      lineHeight: 16,
                      marginBottom: 12,
                    }}
                  >
                    {selectedTask.purchaseStatus ===
                    "recommendation_submitted"
                      ? "Recommendation sent. Waiting for the owner to approve."

                      : selectedTask.purchaseStatus ===
                        "approved"
                        ? "Owner approved. Waiting for the owner to complete the purchase."

                        : selectedTask.workerPurchaseVerifiedAt
                          ? "Purchase verified. Send this product to Level 02."

                          : "The purchase is complete. Verify it before sending to Level 02."}
                  </Text>

                  <Pressable
                    disabled={
                      busy ||
                      selectedTask.purchaseStatus ===
                        "recommendation_submitted" ||
                      selectedTask.purchaseStatus ===
                        "approved"
                    }
                    onPress={() =>
                      void save(
                        "sent"
                      )
                    }
                    style={[
                      s.sendButton,
                      {
                        minHeight: 46,

                        opacity:
                          selectedTask.purchaseStatus ===
                            "recommendation_submitted" ||
                          selectedTask.purchaseStatus ===
                            "approved"
                            ? 0.45
                            : 1,
                      },
                    ]}
                  >
                    {busy ? (
                      <ActivityIndicator
                        color="#211C10"
                      />
                    ) : (
                      <>
                        <Text style={s.sendText}>
                          {selectedTask.purchaseStatus ===
                          "recommendation_submitted"
                            ? "Waiting for owner"

                            : selectedTask.purchaseStatus ===
                              "approved"
                              ? "Waiting for purchase"

                              : !selectedTask
                                  .workerPurchaseVerifiedAt
                                ? "Verify purchase"

                                : "Send Level 02"}
                        </Text>

                        <Ionicons
                          name="arrow-forward"
                          size={17}
                          color="#211C10"
                        />
                      </>
                    )}
                  </Pressable>
                </View>
              ) : null}

              {selectedSupplier ? (
                <>
                  <Text style={s.sectionLabel}>
                    CONFIRM RESULT
                  </Text>

                  <View style={s.formCard}>
                    <View style={s.selectedBanner}>
                      <Ionicons
                        name="checkmark-circle"
                        size={21}
                        color={GREEN}
                      />

                      <View
                        style={{
                          marginLeft: 9,
                        }}
                      >
                        <Text
                          style={
                            s.selectedName
                          }
                        >
                          {selectedSupplier.name}
                        </Text>

                        <Text
                          style={
                            s.selectedSub
                          }
                        >
                          Selected supplier
                        </Text>
                      </View>
                    </View>

                    <Text style={s.fieldLabel}>
                      PRODUCT CODE / SKU
                    </Text>

                    <TextInput
                      value={supplierCode}
                      onChangeText={
                        setSupplierCode
                      }
                      placeholder="Supplier reference"
                      placeholderTextColor="rgba(255,255,255,0.28)"
                      style={s.input}
                    />

                    <View style={s.row}>
                      <View style={s.half}>
                        <Text style={s.fieldLabel}>
                          CONFIRMED QTY
                        </Text>

                        <TextInput
                          value={quantity}
                          onChangeText={
                            setQuantity
                          }
                          keyboardType="number-pad"
                          placeholderTextColor="rgba(255,255,255,0.28)"
                          style={s.input}
                        />
                      </View>

                      <View style={s.half}>
                        <Text style={s.fieldLabel}>
                          COST / UNIT
                        </Text>

                        <TextInput
                          value={unitCost}
                          onChangeText={
                            setUnitCost
                          }
                          keyboardType="decimal-pad"
                          placeholder="$0.00"
                          placeholderTextColor="rgba(255,255,255,0.28)"
                          style={s.input}
                        />
                      </View>
                    </View>

                    <Text style={s.fieldLabel}>
                      SOURCING NOTES
                    </Text>

                    <TextInput
                      value={notes}
                      onChangeText={
                        setNotes
                      }
                      placeholder="Stock, MOQ, shipping, delivery notes..."
                      placeholderTextColor="rgba(255,255,255,0.28)"
                      multiline
                      textAlignVertical="top"
                      style={[
                        s.input,
                        s.notesInput,
                      ]}
                    />

                    <View style={s.actions}>
                      <Pressable
                        disabled={busy}
                        onPress={() =>
                          void save(
                            "working"
                          )
                        }
                        style={s.saveButton}
                      >
                        <Ionicons
                          name="save-outline"
                          size={17}
                          color={GOLD}
                        />

                        <Text
                          style={
                            s.saveText
                          }
                        >
                          Save
                        </Text>
                      </Pressable>

                      <Pressable
                        disabled={busy}
                        onPress={() =>
                          void save(
                            "sent"
                          )
                        }
                        style={s.sendButton}
                      >
                        {busy ? (
                          <ActivityIndicator
                            color="#211C10"
                          />
                        ) : (
                          <>
                            <Text
                              style={
                                s.sendText
                              }
                            >
                              {selectedTask.purchaseMode ===
                                "to_be_purchased" &&
                              selectedTask.purchaseStatus ===
                                "not_purchased"
                                ? "Submit recommendation"

                                : selectedTask.purchaseStatus ===
                                  "recommendation_submitted"
                                  ? "Waiting for owner"

                                  : selectedTask.purchaseStatus ===
                                    "approved"
                                    ? "Waiting for purchase"

                                    : selectedTask.purchaseStatus ===
                                        "purchased" &&
                                      !selectedTask
                                        .workerPurchaseVerifiedAt
                                      ? "Verify purchase"

                                      : "Send Level 02"}
                            </Text>

                            <Ionicons
                              name="arrow-forward"
                              size={17}
                              color="#211C10"
                            />
                          </>
                        )}
                      </Pressable>
                    </View>
                  </View>
                </>
              ) : null}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#070B14",
  },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 30,
  },

  header: {
    minHeight: 58,
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
  },

  back: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
    backgroundColor:
      "rgba(255,255,255,0.05)",
  },

  title: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0.4,
  },

  subtitle: {
    color:
      "rgba(255,214,107,0.72)",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },

  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },

  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 108,
  },

  storeCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor:
      "rgba(255,255,255,0.03)",
    marginBottom: 12,
  },

  storeIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(255,214,107,0.08)",
  },

  storeName: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },

  storeMeta: {
    color:
      "rgba(255,255,255,0.46)",
    fontSize: 12,
    marginTop: 1,
  },

  activeBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 99,
    backgroundColor:
      "rgba(93,235,165,0.12)",
  },

  activeText: {
    color: GREEN,
    fontSize: 11,
    fontWeight: "700",
  },

  statsStrip: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    backgroundColor:
      "rgba(16, 22, 34, 0.92)",
    paddingVertical: 8,
    marginBottom: 14,
  },

  statsCell: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },

  statsCellActive: {
    borderRadius: 12,
    backgroundColor:
      "rgba(255,214,107,0.08)",
    marginHorizontal: 4,
  },

  statsDivider: {
    width: 1,
    height: 22,
    backgroundColor:
      "rgba(255,255,255,0.08)",
  },

  statsNumber: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },

  statsNumberActive: {
    color: GOLD,
  },

  statsLabel: {
    color:
      "rgba(255,255,255,0.42)",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 1,
  },

  statsLabelActive: {
    color:
      "rgba(255,214,107,0.86)",
  },

  sectionLabel: {
    color:
      "rgba(255,255,255,0.48)",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 18,
    marginBottom: 8,
  },

  heroCard: {
    padding: 16,
    borderRadius: 20,
    backgroundColor: "#101623",
    borderWidth: 1,
    borderColor:
      "rgba(255,214,107,0.22)",
  },

  heroKicker: {
    color:
      "rgba(255,214,107,0.78)",
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 8,
  },

  heroCategory: {
    color:
      "rgba(255,255,255,0.48)",
    fontSize: 12,
    fontWeight: "600",
  },

  heroTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 28,
    marginTop: 3,
  },

  heroStatus: {
    color:
      "rgba(255,255,255,0.58)",
    fontSize: 13,
    fontWeight: "600",
    marginTop: 6,
  },

  heroMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    marginTop: 10,
    marginBottom: 14,
  },

  heroMeta: {
    color:
      "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontWeight: "600",
  },

  heroMetaDot: {
    color:
      "rgba(255,255,255,0.22)",
    marginHorizontal: 6,
    fontSize: 12,
  },

  heroButton: {
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: GOLD,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },

  heroButtonText: {
    color: "#211C10",
    fontSize: 15,
    fontWeight: "800",
  },

  segment: {
    flexDirection: "row",
    backgroundColor:
      "rgba(255,255,255,0.04)",
    borderRadius: 14,
    padding: 3,
    marginBottom: 10,
  },

  segmentItem: {
    flex: 1,
    minHeight: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },

  segmentItemActive: {
    backgroundColor:
      "rgba(255,214,107,0.14)",
  },

  segmentText: {
    color:
      "rgba(255,255,255,0.46)",
    fontSize: 12,
    fontWeight: "700",
  },

  segmentTextActive: {
    color: GOLD,
  },

  taskRow: {
    minHeight: 64,
    paddingVertical: 12,
    paddingHorizontal: 4,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor:
      "rgba(255,255,255,0.06)",
  },

  taskRowCategory: {
    color:
      "rgba(255,255,255,0.42)",
    fontSize: 11,
    fontWeight: "600",
  },

  taskRowName: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
    marginTop: 2,
  },

  taskRowMeta: {
    color:
      "rgba(255,255,255,0.42)",
    fontSize: 12,
    marginTop: 3,
  },

  toolList: {
    marginBottom: 8,
  },

  toolRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 4,
  },

  toolIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    backgroundColor:
      "rgba(255,255,255,0.05)",
  },

  toolTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },

  toolCopy: {
    color:
      "rgba(255,255,255,0.42)",
    fontSize: 12,
    marginTop: 1,
  },

  toolRowQuiet: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 4,
  },

  toolIconQuiet: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },

  toolTitleQuiet: {
    flex: 1,
    color:
      "rgba(255,255,255,0.72)",
    fontSize: 14,
    fontWeight: "600",
  },

  emptyQuiet: {
    paddingVertical: 16,
    paddingHorizontal: 4,
  },

  emptyQuietTitle: {
    textAlign: "left",
    marginTop: 0,
    fontSize: 15,
    fontWeight: "700",
  },

  emptyQuietCopy: {
    textAlign: "left",
    fontSize: 13,
    lineHeight: 18,
  },

  heroSkeleton: {
    height: 168,
    borderRadius: 20,
    backgroundColor:
      "rgba(255,255,255,0.06)",
    marginBottom: 10,
  },

  statActive: {
    borderColor:
      "rgba(255,214,107,0.34)",

    backgroundColor:
      "rgba(255,214,107,0.07)",
  },

  continueCard: {
    minHeight: 94,
    padding: 14,
    borderRadius: 21,

    flexDirection: "row",
    alignItems: "center",

    backgroundColor:
      "#101923",

    borderWidth: 1,
    borderColor:
      "rgba(255,214,107,0.20)",
  },

  continueIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,

    alignItems: "center",
    justifyContent: "center",

    marginRight: 11,

    backgroundColor:
      "rgba(255,214,107,0.07)",
  },

  continueCategory: {
    color: GOLD,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.8,
  },

  continueTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
    marginTop: 3,
  },

  continueStatus: {
    color:
      "rgba(255,255,255,0.48)",

    fontSize: 9,
    fontWeight: "700",
    marginTop: 5,
  },

  continueButton: {
    minHeight: 38,
    paddingHorizontal: 11,
    borderRadius: 13,

    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",

    backgroundColor: GOLD,
  },

  continueButtonText: {
    color: "#211C10",
    fontSize: 8,
    fontWeight: "900",
    marginRight: 4,
  },

  workFilterRow: {
    flexDirection: "row",
    gap: 7,
    marginBottom: 10,
  },

  workFilter: {
    flex: 1,
    minHeight: 39,
    borderRadius: 13,

    alignItems: "center",
    justifyContent: "center",

    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.08)",

    backgroundColor:
      "rgba(255,255,255,0.025)",
  },

  workFilterActive: {
    borderColor:
      "rgba(255,214,107,0.28)",

    backgroundColor:
      "rgba(255,214,107,0.08)",
  },

  workFilterText: {
    color:
      "rgba(255,255,255,0.42)",

    fontSize: 8,
    fontWeight: "900",
  },

  workFilterTextActive: {
    color: GOLD,
  },

  dashboardTaskStatus: {
    color:
      "rgba(255,255,255,0.42)",

    fontSize: 8,
    fontWeight: "800",
    marginTop: 5,
  },

  workspaceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    marginBottom: 12,
  },

  workspaceCard: {
    flexGrow: 1,
    flexBasis: "47%",
    minHeight: 128,
    padding: 14,

    borderRadius: 20,

    backgroundColor:
      "#101923",

    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.08)",
  },

  workspaceIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,

    alignItems: "center",
    justifyContent: "center",

    marginBottom: 11,

    backgroundColor:
      "rgba(255,255,255,0.035)",
  },

  workspaceTitle: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
  },

  workspaceCopy: {
    color:
      "rgba(255,255,255,0.38)",

    fontSize: 8,
    lineHeight: 13,
    marginTop: 5,
  },

  taskCard: {
    padding: 15,
    borderRadius: 21,
    backgroundColor: "#101923",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.08)",
    marginBottom: 9,
  },

  taskTop: {
    flexDirection: "row",
    alignItems: "center",
  },

  taskIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(255,214,107,0.07)",
    marginRight: 10,
  },

  taskCategory: {
    color: GOLD,
    fontSize: 8,
    fontWeight: "900",
  },

  taskName: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
    marginTop: 3,
  },

  taskFacts: {
    flexDirection: "row",
    gap: 16,
    marginTop: 12,
  },

  fact: {
    color:
      "rgba(255,255,255,0.50)",
    fontSize: 9,
    fontWeight: "800",
  },

  taskNotes: {
    color:
      "rgba(255,255,255,0.40)",
    fontSize: 10,
    lineHeight: 16,
    marginTop: 10,
  },

  taskHero: {
    padding: 17,
    borderRadius: 23,
    backgroundColor: "#211C10",
    borderWidth: 1,
    borderColor:
      "rgba(255,214,107,0.23)",
  },

  category: {
    color: GOLD,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.2,
  },

  taskHeroTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
    marginTop: 7,
  },

  heroFacts: {
    flexDirection: "row",
    gap: 7,
    marginTop: 14,
  },

  heroFact: {
    flex: 1,
    padding: 10,
    borderRadius: 14,
    backgroundColor:
      "rgba(255,255,255,0.04)",
  },

  heroLabel: {
    color:
      "rgba(255,255,255,0.34)",
    fontSize: 7,
    fontWeight: "900",
  },

  heroValue: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
    marginTop: 4,
  },

  taskBrief: {
    color:
      "rgba(255,255,255,0.50)",
    fontSize: 11,
    lineHeight: 17,
    marginTop: 12,
  },

  supplierCard: {
    padding: 14,
    borderRadius: 20,
    backgroundColor: "#101923",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.08)",
    marginBottom: 8,
  },

  supplierSelected: {
    borderColor:
      "rgba(255,214,107,0.42)",
  },

  supplierTop: {
    flexDirection: "row",
    alignItems: "center",
  },

  supplierIcon: {
    width: 43,
    height: 43,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
    backgroundColor:
      "rgba(117,193,255,0.06)",
  },

  supplierName: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
  },

  supplierMeta: {
    color:
      "rgba(255,255,255,0.40)",
    fontSize: 9,
    marginTop: 4,
  },

  supplierActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    marginTop: 12,
  },

  linkButton: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor:
      "rgba(255,255,255,0.04)",
  },

  linkText: {
    color: "#DCE4EC",
    fontSize: 9,
    fontWeight: "800",
    marginLeft: 5,
  },

  selectButton: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor:
      "rgba(255,214,107,0.24)",
  },

  selectButtonActive: {
    backgroundColor: GOLD,
  },

  selectText: {
    color: GOLD,
    fontSize: 9,
    fontWeight: "900",
    marginLeft: 5,
  },

  formCard: {
    padding: 16,
    borderRadius: 22,
    backgroundColor: "#101923",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.08)",
  },

  selectedBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 11,
    borderRadius: 15,
    backgroundColor:
      "rgba(93,235,165,0.06)",
    marginBottom: 8,
  },

  selectedName: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
  },

  selectedSub: {
    color: GREEN,
    fontSize: 8,
    marginTop: 2,
  },

  fieldLabel: {
    color:
      "rgba(255,255,255,0.39)",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.1,
    marginTop: 9,
    marginBottom: 6,
  },

  input: {
    minHeight: 48,
    borderRadius: 15,
    color: "#FFFFFF",
    paddingHorizontal: 13,
    backgroundColor:
      "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.08)",
    marginBottom: 7,
  },

  notesInput: {
    minHeight: 88,
    paddingTop: 12,
  },

  row: {
    flexDirection: "row",
    gap: 8,
  },

  half: {
    flex: 1,
  },

  actions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 14,
  },

  saveButton: {
    flex: 0.8,
    minHeight: 52,
    borderRadius: 17,
    borderWidth: 1,
    borderColor:
      "rgba(255,214,107,0.25)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },

  saveText: {
    color: GOLD,
    fontWeight: "900",
    marginLeft: 6,
  },

  sendButton: {
    flex: 1.4,
    minHeight: 52,
    borderRadius: 17,
    backgroundColor: GOLD,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },

  sendText: {
    color: "#211C10",
    fontWeight: "900",
    marginRight: 6,
  },

  empty: {
    padding: 24,
    borderRadius: 21,
    alignItems: "center",
    backgroundColor: "#101923",
  },

  emptyTitle: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
    marginTop: 9,
    textAlign: "center",
  },

  emptyCopy: {
    color:
      "rgba(255,255,255,0.42)",
    fontSize: 10,
    lineHeight: 16,
    textAlign: "center",
    marginTop: 6,
  },

  taskSkeletonBlock: {
    alignItems: "stretch",
    paddingVertical: 8,
    gap: 10,
  },

  taskSkeletonText: {
    color:
      "rgba(255,255,255,0.48)",
    fontSize: 12,
    fontWeight: "700",
  },

  taskSkeletonCard: {
    width: "100%",
    height: 74,
    borderRadius: 18,
    backgroundColor:
      "rgba(255,255,255,0.06)",
  },

  error: {
    color: "#FF999F",
    textAlign: "center",
  },
});
