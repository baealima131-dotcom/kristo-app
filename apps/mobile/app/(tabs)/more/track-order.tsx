import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { recognizeText } from "@infinitered/react-native-mlkit-text-recognition";

import { sokoCheckoutJson } from "@/src/lib/sokoCheckoutApi";

const STATUS_LABELS: Record<string, string> = {
  awaiting_delivery_quote: "Waiting for delivery quote",
  delivery_quote_ready: "Delivery quote ready",
  awaiting_payment: "Waiting for payment",
  payment_submitted: "Payment under review",
  payment_rejected: "Payment needs attention",
  payment_approved: "Payment approved",
  preparing_shipment: "Preparing shipment",
  shipped: "In transit",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const STEPS = [
  { key: "payment_approved", label: "Payment approved" },
  { key: "preparing_shipment", label: "Preparing shipment" },
  { key: "shipped", label: "In transit" },
  { key: "delivered", label: "Delivered" },
];

const STATUS_RANK: Record<string, number> = {
  awaiting_delivery_quote: 0,
  delivery_quote_ready: 0,
  awaiting_payment: 0,
  payment_submitted: 0,
  payment_rejected: 0,
  payment_approved: 1,
  preparing_shipment: 2,
  shipped: 3,
  delivered: 4,
};

function text(value: unknown) {
  return String(value || "").trim();
}

function shippingOf(order: any) {
  return order?.product?.shipping || order?.shipping || {};
}

function totalsOf(order: any) {
  return order?.product?.totals || {};
}

function trackingNumberOf(order: any) {
  const shipping = shippingOf(order);

  return text(
    order?.trackingNumber ||
      shipping?.trackingNumber ||
      shipping?.tracking_number
  ).replace(/\s+/g, "");
}

function trackingCarrier(
  trackingNumber: string,
  carrierHint = ""
) {
  const number = text(trackingNumber)
    .replace(/[\s-]+/g, "")
    .toUpperCase();

  const hint = text(carrierHint).toLowerCase();

  if (hint.includes("usps")) return "USPS";
  if (hint.includes("ups")) return "UPS";
  if (hint.includes("fedex")) return "FedEx";
  if (hint.includes("dhl")) return "DHL";

  if (/^1Z[A-Z0-9]{16}$/.test(number)) return "UPS";
  if (/^(94|92|93|95)[0-9]{18,20}$/.test(number)) {
    return "USPS";
  }
  if (/^[0-9]{20,22}$/.test(number)) return "USPS";
  if (/^[0-9]{12}$/.test(number)) return "FedEx";
  if (/^[0-9]{15}$/.test(number)) return "FedEx";
  if (/^[0-9]{10}$/.test(number)) return "DHL";

  return "Universal carrier";
}

function trackingUrl(order: any) {
  const shipping = shippingOf(order);

  const providedUrl = text(
    shipping.trackingUrl ||
      shipping.tracking_url_provider ||
      shipping.tracking_url ||
      order?.trackingUrl
  );

  if (/^https?:\/\//i.test(providedUrl)) {
    return providedUrl;
  }

  const trackingNumber = trackingNumberOf(order);

  if (!trackingNumber) return "";

  const carrier = trackingCarrier(
    trackingNumber,
    text(
      shipping?.carrier ||
        shipping?.provider ||
        shipping?.serviceProvider
    )
  );

  const encoded = encodeURIComponent(trackingNumber);

  if (carrier === "USPS") {
    return (
      "https://tools.usps.com/go/TrackConfirmAction" +
      "?tLabels=" +
      encoded
    );
  }

  if (carrier === "UPS") {
    return (
      "https://www.ups.com/track" +
      "?loc=en_US&tracknum=" +
      encoded
    );
  }

  if (carrier === "FedEx") {
    return (
      "https://www.fedex.com/fedextrack/" +
      "?trknbr=" +
      encoded
    );
  }

  if (carrier === "DHL") {
    return (
      "https://www.dhl.com/us-en/home/tracking.html" +
      "?tracking-id=" +
      encoded
    );
  }

  return "https://t.17track.net/en#nums=" + encoded;
}

function formatMoney(order: any) {
  const totals = totalsOf(order);
  const amount = Number(
    totals.finalTotal ||
      order?.finalTotal ||
      order?.total ||
      order?.product?.price ||
      0
  );

  const currency = text(
    totals.currency ||
      order?.product?.currency ||
      order?.currency ||
      "USD"
  ).toUpperCase();

  return (
    currency +
    " " +
    amount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function shortOrderId(order: any) {
  const id = text(order?.id || order?.orderId)
    .replace(/^order-/i, "")
    .toUpperCase();

  return id ? id.slice(-12) : "PENDING";
}

export default function TrackOrderScreen() {
  const router = useRouter();

  const [orders, setOrders] = useState<any[]>([]);

  const [paymentOrder, setPaymentOrder] =
    useState<any>(null);

  const [paymentProofOpen, setPaymentProofOpen] =
    useState(false);

  const [paymentProofUri, setPaymentProofUri] =
    useState("");

  const [paymentReference, setPaymentReference] =
    useState("");

  const [paymentMessage, setPaymentMessage] =
    useState("");

  const [paymentSubmitting, setPaymentSubmitting] =
    useState(false);

  const [paymentScanning, setPaymentScanning] =
    useState(false);

  const [paymentScanValid, setPaymentScanValid] =
    useState<boolean | null>(null);

  const [paymentScanMessage, setPaymentScanMessage] =
    useState("");

  const [paymentDetectedProvider, setPaymentDetectedProvider] =
    useState("");

  const [paymentDetectedAmount, setPaymentDetectedAmount] =
    useState("");

  const [paymentDetectedStatus, setPaymentDetectedStatus] =
    useState("");

  const [paymentDetectedReference, setPaymentDetectedReference] =
    useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const loadOrders = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError("");

    try {
      const data = await sokoCheckoutJson("/api/soko/orders?mode=buying", {
        method: "GET",
      });

      setOrders(
        Array.isArray(data?.orders) ? data.orders : []
      );
    } catch (loadError) {
      setError(
        text((loadError as Error)?.message) ||
          "Orders could not be loaded."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadOrders();
    }, [loadOrders])
  );

  const openTracking = async (order: any) => {
    const url = trackingUrl(order);

    if (!url) {
      Alert.alert(
        "Tracking unavailable",
        "The seller has not added a tracking number yet."
      );
      return;
    }

    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(
        "Could not open tracking",
        "Please copy the tracking number and check it on the carrier website."
      );
    }
  };

  const cancelOrder = (order: any) => {
    const orderId = text(order?.id || order?.orderId);
    const status = text(order?.status);
    const action =
      status === "delivery_quote_ready"
        ? "reject_delivery_quote"
        : "cancel";

    Alert.alert(
      "Cancel order",
      "Are you sure you want to cancel this order?",
      [
        { text: "Keep order", style: "cancel" },
        {
          text: "Cancel order",
          style: "destructive",
          onPress: async () => {
            setBusyId(orderId);
            try {
              await sokoCheckoutJson("/api/soko/orders", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  orderId,
                  action,
                }),
              });

              await loadOrders(true);

              Alert.alert(
                "Order cancelled",
                "This order has been cancelled."
              );
            } catch (cancelError) {
              Alert.alert(
                "Unable to cancel order",
                text((cancelError as Error)?.message) ||
                  "Please try again."
              );
            } finally {
              setBusyId("");
            }
          },
        },
      ]
    );
  };

  const openPaymentProof = (order: any) => {
    setPaymentOrder(order);
    setPaymentProofUri("");
    setPaymentReference("");
    setPaymentMessage("");

    setPaymentScanning(false);
    setPaymentScanValid(null);
    setPaymentScanMessage("");
    setPaymentDetectedProvider("");
    setPaymentDetectedAmount("");
    setPaymentDetectedStatus("");
    setPaymentDetectedReference("");

    setPaymentProofOpen(true);
  };

  const scanPaymentReceipt = async (
    uri: string,
    currentOrder: any
  ) => {
    setPaymentScanning(true);
    setPaymentScanValid(null);
    setPaymentScanMessage(
      "Scanning payment receipt…"
    );
    setPaymentDetectedProvider("");
    setPaymentDetectedAmount("");
    setPaymentDetectedStatus("");
    setPaymentDetectedReference("");

    try {
      const result = await recognizeText(uri);

      const rawText = String(
        result?.text || ""
      ).trim();

      if (!rawText) {
        setPaymentScanValid(false);
        setPaymentScanMessage(
          "No readable payment information was found. Choose a clearer payment receipt screenshot."
        );
        return;
      }

      const flatText = rawText
        .replace(/\r/g, "\n")
        .replace(/\s+/g, " ")
        .trim();

      const lower = flatText.toLowerCase();

      // ----------------------------------------------------
      // Provider detection
      // ----------------------------------------------------

      const isCashApp =
        lower.includes("cash app") ||
        lower.includes("cashapp") ||
        lower.includes("cashtag") ||
        lower.includes("$cashtag");

      if (isCashApp) {
        setPaymentDetectedProvider(
          "Cash App"
        );
      }

      // ----------------------------------------------------
      // Detect clearly wrong screenshots
      // ----------------------------------------------------

      const wrongScreenSignals = [
        "seller orders",
        "create shipping label",
        "shipping label",
        "label creation failed",
        "ups account",
        "tracking number",
        "prepare package",
        "seller tools"
      ];

      const wrongSignal =
        wrongScreenSignals.some(value =>
          lower.includes(value)
        );

      const paymentSignals = [
        "payment",
        "paid",
        "sent",
        "completed",
        "transaction",
        "receipt",
        "confirmation",
        "cash app",
        "cashtag"
      ];

      const looksLikePayment =
        paymentSignals.some(value =>
          lower.includes(value)
        );

      if (
        wrongSignal &&
        !isCashApp
      ) {
        setPaymentScanValid(false);
        setPaymentScanMessage(
          "This image does not appear to be a payment receipt. Please choose the Cash App payment confirmation screenshot."
        );
        return;
      }

      if (!looksLikePayment) {
        setPaymentScanValid(false);
        setPaymentScanMessage(
          "Payment receipt not detected. Please choose the screenshot that confirms your payment."
        );
        return;
      }

      // ----------------------------------------------------
      // Payment status detection
      // ----------------------------------------------------

      let detectedStatus = "";

      if (
        /\b(completed|complete|paid|payment sent|sent successfully|successful|success)\b/i.test(
          flatText
        )
      ) {
        detectedStatus = "Completed";
      } else if (
        /\b(pending|processing)\b/i.test(
          flatText
        )
      ) {
        detectedStatus = "Pending";
      } else if (
        /\b(failed|declined|cancelled|canceled)\b/i.test(
          flatText
        )
      ) {
        detectedStatus = "Failed";
      }

      if (detectedStatus) {
        setPaymentDetectedStatus(
          detectedStatus
        );
      }

      // ----------------------------------------------------
      // Amount detection
      // ----------------------------------------------------

      const expectedTotal = Number(
        totalsOf(currentOrder)?.finalTotal ||
          currentOrder?.product?.price ||
          0
      );

      const amountCandidates: number[] = [];

      const amountRegexes = [
        /\$\s*([0-9]{1,7}(?:,[0-9]{3})*(?:\.[0-9]{2}))/g,
        /\bUSD\s*([0-9]{1,7}(?:,[0-9]{3})*(?:\.[0-9]{2}))/gi,
        /\b([0-9]{1,7}(?:,[0-9]{3})*(?:\.[0-9]{2}))\s*USD\b/gi
      ];

      for (const regex of amountRegexes) {
        for (
          const match of flatText.matchAll(regex)
        ) {
          const value = Number(
            String(match[1] || "")
              .replace(/,/g, "")
          );

          if (
            Number.isFinite(value) &&
            value > 0
          ) {
            amountCandidates.push(value);
          }
        }
      }

      let detectedAmount = 0;

      if (
        Number.isFinite(expectedTotal) &&
        expectedTotal > 0
      ) {
        detectedAmount =
          amountCandidates.find(
            value =>
              Math.abs(
                value - expectedTotal
              ) < 0.01
          ) ||
          amountCandidates[0] ||
          0;
      } else {
        detectedAmount =
          amountCandidates[0] || 0;
      }

      if (detectedAmount > 0) {
        setPaymentDetectedAmount(
          "USD " +
            detectedAmount.toLocaleString(
              "en-US",
              {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              }
            )
        );
      }

      // ----------------------------------------------------
      // Transaction / reference detection
      // ----------------------------------------------------

      const referencePatterns = [
        /transaction\s*(?:id|number|no\.?|#|reference|ref)?\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-]{5,50})/i,

        /confirmation\s*(?:number|no\.?|code|id|#)?\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-]{5,50})/i,

        /reference\s*(?:number|no\.?|id|#)?\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-]{5,50})/i,

        /receipt\s*(?:number|no\.?|id|#)?\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-]{5,50})/i,

        /payment\s*(?:id|number|no\.?|#)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-]{5,50})/i
      ];

      let detectedReference = "";

      for (const pattern of referencePatterns) {
        const match =
          flatText.match(pattern);

        if (match?.[1]) {
          const candidate =
            String(match[1])
              .trim()
              .replace(
                /[.,;:]+$/,
                ""
              );

          if (
            candidate.length >= 6 &&
            !/^(payment|receipt|cashapp)$/i.test(
              candidate
            )
          ) {
            detectedReference =
              candidate;
            break;
          }
        }
      }

      if (detectedReference) {
        setPaymentDetectedReference(
          detectedReference
        );

        setPaymentReference(
          detectedReference
        );
      }

      // ----------------------------------------------------
      // Amount validation
      // ----------------------------------------------------

      const amountMismatch =
        Number.isFinite(expectedTotal) &&
        expectedTotal > 0 &&
        detectedAmount > 0 &&
        Math.abs(
          detectedAmount - expectedTotal
        ) >= 0.01;

      if (amountMismatch) {
        setPaymentScanValid(false);

        setPaymentScanMessage(
          "Receipt detected, but the amount appears different from this order total. Review the screenshot and amount carefully."
        );

        return;
      }

      // ----------------------------------------------------
      // Failed / pending receipts should warn buyer
      // ----------------------------------------------------

      if (detectedStatus === "Failed") {
        setPaymentScanValid(false);

        setPaymentScanMessage(
          "This screenshot appears to show a failed or cancelled payment. Please upload the completed payment receipt."
        );

        return;
      }

      if (detectedStatus === "Pending") {
        setPaymentScanValid(false);

        setPaymentScanMessage(
          "This payment appears to still be pending. Wait until Cash App confirms it, then upload the completed receipt."
        );

        return;
      }

      // ----------------------------------------------------
      // Successful result
      // ----------------------------------------------------

      setPaymentScanValid(true);

      if (detectedReference) {
        setPaymentScanMessage(
          "Payment receipt detected. Transaction reference was filled automatically."
        );
      } else {
        setPaymentScanMessage(
          "Payment receipt detected. We could not confidently find the transaction number, so please enter it manually."
        );
      }
    } catch (error) {
      console.log(
        "PAYMENT_OCR_SCAN_FAILED",
        error
      );

      setPaymentScanValid(null);

      setPaymentScanMessage(
        "Automatic receipt scan was unavailable. You can still enter the transaction reference manually."
      );
    } finally {
      setPaymentScanning(false);
    }
  };

  const pickPaymentProof = async () => {
    const permission =
      await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        "Photos permission required",
        "Allow photo access so you can select your payment screenshot."
      );
      return;
    }

    const result =
      await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.9,
      });

    if (result.canceled || !result.assets?.[0]?.uri) {
      return;
    }

    const selectedUri =
      result.assets[0].uri;

    setPaymentProofUri(
      selectedUri
    );

    await scanPaymentReceipt(
      selectedUri,
      paymentOrder
    );
  };

  const submitTrackPaymentProof = async () => {
    const orderId = text(paymentOrder?.id);

    if (!orderId) {
      Alert.alert("Payment", "Order was not found.");
      return;
    }

    if (!paymentProofUri) {
      Alert.alert(
        "Screenshot required",
        "Choose your payment screenshot first."
      );
      return;
    }

    if (paymentReference.trim().length < 3) {
      Alert.alert(
        "Transaction reference required",
        "Enter your Cash App confirmation or transaction reference."
      );
      return;
    }

    if (paymentSubmitting) return;

    setPaymentSubmitting(true);

    try {
      const extension =
        (paymentProofUri.split(".").pop() || "jpg")
          .toLowerCase();

      const mime =
        extension === "png"
          ? "image/png"
          : extension === "webp"
            ? "image/webp"
            : "image/jpeg";

      const form = new FormData();

      form.append(
        "file",
        {
          uri: paymentProofUri,
          name: "payment-proof." + extension,
          type: mime,
        } as any
      );

      await sokoCheckoutJson(
        `/api/soko/orders/${encodeURIComponent(orderId)}/payment-proof`,
        {
          method: "POST",
          body: form,
        }
      );

      await sokoCheckoutJson("/api/soko/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          action: "submit_payment",
          note: paymentMessage.trim(),
          transactionReference: paymentReference.trim(),
          paymentDate: new Date().toISOString(),
        }),
      });

      setPaymentProofOpen(false);
      setPaymentOrder(null);
      setPaymentProofUri("");
      setPaymentReference("");
      setPaymentMessage("");

      await loadOrders();

      Alert.alert(
        "Payment proof submitted",
        "The seller will verify that the money reached their account before shipment begins."
      );
    } catch (error) {
      Alert.alert(
        "Payment proof",
        error instanceof Error
          ? error.message
          : "Payment proof could not be submitted."
      );
    } finally {
      setPaymentSubmitting(false);
    }
  };

  const continuePayment = async (order: any) => {
    const payment =
      order?.product?.payment &&
      typeof order.product.payment === "object"
        ? order.product.payment
        : {};

    const totals = totalsOf(order);

    const cashTag = text(
      payment?.cashTag ||
        order?.product?.paymentOptions?.cashTag
    )
      .replace(/^\$/, "");

    const amount = Number(
      totals?.finalTotal ||
        order?.product?.price ||
        0
    );

    const currency = text(
      totals?.currency ||
        order?.product?.currency ||
        "USD"
    ).toUpperCase();

    if (!cashTag) {
      Alert.alert(
        "Payment unavailable",
        "Seller Cash App information is missing."
      );
      return;
    }

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      Alert.alert(
        "Payment unavailable",
        "Confirmed order total is missing."
      );
      return;
    }

    if (currency !== "USD") {
      Alert.alert(
        "Payment unavailable",
        "Cash App currently supports USD orders only."
      );
      return;
    }

    const url =
      "https://cash.app/$" +
      encodeURIComponent(cashTag) +
      "/" +
      amount.toFixed(2);

    const supported =
      await Linking.canOpenURL(url);

    if (!supported) {
      Alert.alert(
        "Cash App",
        "Cash App could not be opened."
      );
      return;
    }

    await Linking.openURL(url);
  };

  const reportPaymentProblem = (order: any) => {
    Alert.prompt(
      "Report Payment Problem",
      "Describe what happened. Example: I paid but cannot find my receipt, or the seller says the payment was not received.",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Send Report",
          onPress: async (value?: string) => {
            const note = text(value);

            if (note.length < 3) {
              Alert.alert(
                "Report",
                "Please describe the payment problem."
              );
              return;
            }

            const orderId = text(order?.id);

            if (!orderId) return;

            setBusyId(orderId);

            try {
              await sokoCheckoutJson("/api/soko/orders", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  orderId,
                  action: "report_payment_issue",
                  note,
                }),
              });

              await loadOrders();

              Alert.alert(
                "Report sent",
                "Your payment problem has been attached to this order for the seller to review."
              );
            } catch (error) {
              Alert.alert(
                "Report failed",
                error instanceof Error
                  ? error.message
                  : "Please try again."
              );
            } finally {
              setBusyId("");
            }
          },
        },
      ],
      "plain-text"
    );
  };

  const removeFromTrack = (order: any) => {
    const orderId = text(order?.id || order?.orderId);

    Alert.alert(
      "Remove from Track Order",
      "This will hide the order from your Track Order list. The transaction record will remain available to SOKO.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setBusyId(orderId);
            try {
              await sokoCheckoutJson("/api/soko/orders", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  orderId,
                  action: "hide_from_buyer",
                }),
              });

              await loadOrders(true);
            } catch (removeError) {
              Alert.alert(
                "Unable to remove order",
                text((removeError as Error)?.message) ||
                  "Please try again."
              );
            } finally {
              setBusyId("");
            }
          },
        },
      ]
    );
  };

  const confirmDelivery = (order: any) => {
    const orderId = text(order?.id || order?.orderId);

    Alert.alert(
      "Confirm delivery",
      "Confirm only after you have received and inspected this order.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Yes, I received it",
          onPress: async () => {
            setBusyId(orderId);

            try {
              await sokoCheckoutJson("/api/soko/orders", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  orderId,
                  action: "mark_delivered",
                }),
              });

              await loadOrders(true);

              Alert.alert(
                "Delivery confirmed",
                "This order is now marked as delivered."
              );
            } catch (confirmError) {
              Alert.alert(
                "Unable to confirm delivery",
                text(
                  (confirmError as Error)?.message
                ) || "Please try again."
              );
            } finally {
              setBusyId("");
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons
            name="chevron-back"
            size={25}
            color="#FFFFFF"
          />
        </Pressable>

        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>
            SOKO DELIVERY
          </Text>
          <Text style={styles.heading}>Track Order</Text>
          <Text style={styles.subheading}>
            Follow every purchase from payment to delivery.
          </Text>
        </View>

        <View style={styles.headerIcon}>
          <Ionicons
            name="navigate"
            size={25}
            color="#DDF25B"
          />
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator
            size="large"
            color="#167A52"
          />
          <Text style={styles.centerTitle}>
            Loading your orders
          </Text>
          <Text style={styles.centerCopy}>
            Checking the latest delivery updates…
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void loadOrders(true)}
              tintColor="#167A52"
            />
          }
        >
          {!!error && (
            <View style={styles.errorCard}>
              <Ionicons
                name="alert-circle"
                size={24}
                color="#A33B3B"
              />
              <View style={styles.flex}>
                <Text style={styles.errorTitle}>
                  Orders unavailable
                </Text>
                <Text style={styles.errorCopy}>
                  {error}
                </Text>
              </View>
            </View>
          )}

          {!error && orders.length === 0 && (
            <View style={styles.emptyCard}>
              <View style={styles.emptyIcon}>
                <Ionicons
                  name="cube-outline"
                  size={36}
                  color="#167A52"
                />
              </View>
              <Text style={styles.emptyTitle}>
                No orders to track
              </Text>
              <Text style={styles.emptyCopy}>
                Purchases made through SOKO will appear here.
              </Text>
            </View>
          )}

          {orders.map((order) => {
            const orderId = text(
              order?.id || order?.orderId
            );

            const status = text(order?.status);
            const rank = STATUS_RANK[status] || 0;
            const shipping = shippingOf(order);

            const trackingNumber =
              trackingNumberOf(order);

            const carrier =
              trackingNumber
                ? trackingCarrier(
                    trackingNumber,
                    text(
                      shipping?.carrier ||
                        shipping?.provider ||
                        shipping?.serviceProvider
                    )
                  )
                : "";

            const productTitle = text(
              order?.product?.title ||
                order?.product?.name ||
                "SOKO order"
            );

            const sellerName = text(
              order?.product?.seller?.name ||
                order?.seller?.name ||
                order?.sellerName
            );

            const isDelivered = status === "delivered";
            const isCancelled = status === "cancelled";
            const canConfirm = status === "shipped";
            const canRemove =
              status === "delivered" ||
              status === "cancelled";
            const canCancel =
              status === "delivery_quote_ready" ||
              status === "awaiting_payment" ||
              status === "payment_rejected";

            const canRecoverPayment =
              status === "awaiting_payment" ||
              status === "payment_rejected";

            const canReportPayment =
              status === "awaiting_payment" ||
              status === "payment_submitted" ||
              status === "payment_rejected";

            return (
              <View key={orderId} style={styles.orderCard}>
                <View style={styles.orderTop}>
                  <View style={styles.packageIcon}>
                    <Ionicons
                      name={
                        isDelivered
                          ? "checkmark-circle"
                          : "cube"
                      }
                      size={27}
                      color={
                        isDelivered
                          ? "#167A52"
                          : "#DDF25B"
                      }
                    />
                  </View>

                  <View style={styles.flex}>
                    <Text style={styles.orderLabel}>
                      ORDER {shortOrderId(order)}
                    </Text>
                    <Text style={styles.productTitle}>
                      {productTitle}
                    </Text>
                    {!!sellerName && (
                      <Text style={styles.seller}>
                        Seller: {sellerName}
                      </Text>
                    )}
                  </View>

                  <View
                    style={[
                      styles.statusPill,
                      isCancelled &&
                        styles.cancelledPill,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusText,
                        isCancelled &&
                          styles.cancelledText,
                      ]}
                    >
                      {STATUS_LABELS[status] ||
                        status ||
                        "Processing"}
                    </Text>
                  </View>
                </View>

                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>
                    ORDER TOTAL
                  </Text>
                  <Text style={styles.totalValue}>
                    {formatMoney(order)}
                  </Text>
                </View>

                {!isCancelled && (
                  <View style={styles.timeline}>
                    {STEPS.map((step, index) => {
                      const complete =
                        rank >= index + 1;

                      return (
                        <View
                          key={step.key}
                          style={styles.stepRow}
                        >
                          <View style={styles.stepRail}>
                            <View
                              style={[
                                styles.stepDot,
                                complete &&
                                  styles.stepDotComplete,
                              ]}
                            >
                              {complete && (
                                <Ionicons
                                  name="checkmark"
                                  size={13}
                                  color="#FFFFFF"
                                />
                              )}
                            </View>

                            {index <
                              STEPS.length - 1 && (
                              <View
                                style={[
                                  styles.stepLine,
                                  rank > index + 1 &&
                                    styles
                                      .stepLineComplete,
                                ]}
                              />
                            )}
                          </View>

                          <Text
                            style={[
                              styles.stepLabel,
                              complete &&
                                styles
                                  .stepLabelComplete,
                            ]}
                          >
                            {step.label}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                )}

                {!!trackingNumber && (
                  <View style={styles.trackingBox}>
                    <View style={styles.trackingHeader}>
                      <Ionicons
                        name="location"
                        size={19}
                        color="#167A52"
                      />
                      <Text style={styles.trackingLabel}>
                        TRACKING NUMBER
                      </Text>
                    </View>

                    <Text
                      selectable
                      style={styles.trackingNumber}
                    >
                      {trackingNumber}
                    </Text>

                    {!!carrier && (
                      <Text style={styles.carrier}>
                        Carrier: {carrier}
                      </Text>
                    )}

                    <Pressable
                      onPress={() =>
                        void openTracking(order)
                      }
                      style={styles.trackButton}
                    >
                      <Ionicons
                        name="navigate-outline"
                        size={20}
                        color="#FFFFFF"
                      />
                      <Text style={styles.trackButtonText}>
                        Track Package
                      </Text>
                      <Ionicons
                        name="arrow-forward"
                        size={20}
                        color="#FFFFFF"
                      />
                    </Pressable>
                  </View>
                )}

                {!trackingNumber &&
                  !isCancelled &&
                  !isDelivered && (
                  <View style={styles.pendingBox}>
                    <Ionicons
                      name="time-outline"
                      size={20}
                      color="#846914"
                    />
                    <Text style={styles.pendingText}>
                      Tracking will appear after the seller
                      creates the shipping label.
                    </Text>
                  </View>
                )}

                {canRecoverPayment && (
                  <View
                    style={{
                      marginTop: 16,
                      borderRadius: 18,
                      borderWidth: 1,
                      borderColor: "#CFE2D6",
                      backgroundColor: "#F4FAF6",
                      padding: 14,
                    }}
                  >
                    <Text
                      style={{
                        color: "#145D3E",
                        fontSize: 15,
                        fontWeight: "900",
                      }}
                    >
                      Already paid?
                    </Text>

                    <Text
                      style={{
                        color: "#68756D",
                        fontSize: 11,
                        lineHeight: 17,
                        fontWeight: "700",
                        marginTop: 4,
                      }}
                    >
                      If you already sent the money, upload your payment screenshot so the seller can verify it.
                    </Text>

                    <Pressable
                      onPress={() =>
                        openPaymentProof(order)
                      }
                      style={{
                        minHeight: 52,
                        borderRadius: 15,
                        backgroundColor: "#176844",
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "center",
                        marginTop: 12,
                        paddingHorizontal: 14,
                      }}
                    >
                      <Ionicons
                        name="cloud-upload-outline"
                        size={20}
                        color="#FFFFFF"
                      />
                      <Text
                        style={{
                          color: "#FFFFFF",
                          fontSize: 14,
                          fontWeight: "900",
                          marginLeft: 8,
                        }}
                      >
                        {status === "payment_rejected"
                          ? "Submit New Payment Proof"
                          : "I Already Paid — Submit Proof"}
                      </Text>
                    </Pressable>

                    {status === "awaiting_payment" && (
                      <Pressable
                        onPress={() =>
                          void continuePayment(order)
                        }
                        style={{
                          minHeight: 50,
                          borderRadius: 15,
                          borderWidth: 1.5,
                          borderColor: "#176844",
                          backgroundColor: "#FFFFFF",
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "center",
                          marginTop: 9,
                          paddingHorizontal: 14,
                        }}
                      >
                        <Ionicons
                          name="logo-usd"
                          size={19}
                          color="#176844"
                        />
                        <Text
                          style={{
                            color: "#176844",
                            fontSize: 14,
                            fontWeight: "900",
                            marginLeft: 8,
                          }}
                        >
                          Continue Payment
                        </Text>
                      </Pressable>
                    )}
                  </View>
                )}

                {canReportPayment && (
                  <Pressable
                    disabled={busyId === orderId}
                    onPress={() =>
                      reportPaymentProblem(order)
                    }
                    style={{
                      minHeight: 50,
                      borderRadius: 15,
                      borderWidth: 1.5,
                      borderColor: "#D8B65C",
                      backgroundColor: "#FFF9E8",
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      marginTop: 10,
                      paddingHorizontal: 14,
                    }}
                  >
                    <Ionicons
                      name="help-circle-outline"
                      size={20}
                      color="#80610C"
                    />
                    <Text
                      style={{
                        color: "#80610C",
                        fontSize: 13,
                        fontWeight: "900",
                        marginLeft: 7,
                      }}
                    >
                      Report Payment Problem
                    </Text>
                  </Pressable>
                )}

                {canCancel && (
                  <Pressable
                    disabled={busyId === orderId}
                    onPress={() => cancelOrder(order)}
                    style={styles.cancelOrderButton}
                  >
                    {busyId === orderId ? (
                      <ActivityIndicator color="#A53333" />
                    ) : (
                      <Ionicons
                        name="close-circle-outline"
                        size={21}
                        color="#A53333"
                      />
                    )}
                    <Text style={styles.cancelOrderText}>
                      Cancel Order
                    </Text>
                  </Pressable>
                )}

                {canConfirm && (
                  <Pressable
                    disabled={busyId === orderId}
                    onPress={() =>
                      confirmDelivery(order)
                    }
                    style={styles.confirmButton}
                  >
                    {busyId === orderId ? (
                      <ActivityIndicator
                        color="#0D5136"
                      />
                    ) : (
                      <Ionicons
                        name="checkmark-circle-outline"
                        size={21}
                        color="#0D5136"
                      />
                    )}

                    <Text style={styles.confirmText}>
                      Confirm Delivery
                    </Text>
                  </Pressable>
                )}

                {canRemove && (
                  <Pressable
                    disabled={busyId === orderId}
                    onPress={() => removeFromTrack(order)}
                    style={styles.removeTrackButton}
                  >
                    {busyId === orderId ? (
                      <ActivityIndicator color="#6B7280" />
                    ) : (
                      <Ionicons
                        name="eye-off-outline"
                        size={21}
                        color="#6B7280"
                      />
                    )}
                    <Text style={styles.removeTrackText}>
                      Remove from Track
                    </Text>
                  </Pressable>
                )}

                {isDelivered && (
                  <View style={styles.deliveredBox}>
                    <Ionicons
                      name="shield-checkmark"
                      size={22}
                      color="#167A52"
                    />
                    <View style={styles.flex}>
                      <Text style={styles.deliveredTitle}>
                        Delivery completed
                      </Text>
                      <Text style={styles.deliveredCopy}>
                        This order has been confirmed as
                        delivered.
                      </Text>
                    </View>
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
      <Modal
        visible={paymentProofOpen}
        transparent
        animationType="slide"
        onRequestClose={() =>
          !paymentSubmitting &&
          setPaymentProofOpen(false)
        }
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,.50)",
            justifyContent: "flex-end",
          }}
        >
          <SafeAreaView
            style={{
              maxHeight: "92%",
              backgroundColor: "#F6F9F6",
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
            }}
          >
            <View
              style={{
                paddingHorizontal: 18,
                paddingTop: 16,
                paddingBottom: 14,
                borderBottomWidth:
                  StyleSheet.hairlineWidth,
                borderBottomColor: "#D6E0D9",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: "#17804F",
                    fontSize: 9,
                    fontWeight: "900",
                    letterSpacing: 1.2,
                  }}
                >
                  SOKO PAYMENT
                </Text>

                <Text
                  style={{
                    color: "#122019",
                    fontSize: 22,
                    fontWeight: "900",
                    marginTop: 2,
                  }}
                >
                  Submit payment proof
                </Text>
              </View>

              <Pressable
                disabled={paymentSubmitting}
                onPress={() =>
                  setPaymentProofOpen(false)
                }
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: "#E4EBE6",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons
                  name="close"
                  size={22}
                  color="#405047"
                />
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                padding: 16,
                paddingBottom: 36,
              }}
            >
              <View
                style={{
                  borderRadius: 16,
                  backgroundColor: "#EAF5EE",
                  padding: 13,
                  marginBottom: 13,
                }}
              >
                <Text
                  style={{
                    color: "#176844",
                    fontSize: 13,
                    fontWeight: "900",
                  }}
                >
                  Order total: {formatMoney(paymentOrder)}
                </Text>

                <Text
                  style={{
                    color: "#567064",
                    fontSize: 10,
                    lineHeight: 15,
                    fontWeight: "700",
                    marginTop: 4,
                  }}
                >
                  Upload the receipt for this exact order. The seller must still verify that the money reached their account.
                </Text>
              </View>

              <Text
                style={{
                  color: "#334139",
                  fontSize: 12,
                  fontWeight: "900",
                  marginBottom: 7,
                }}
              >
                Payment screenshot
              </Text>

              <Pressable
                onPress={() =>
                  void pickPaymentProof()
                }
                style={{
                  minHeight: 135,
                  borderRadius: 15,
                  borderWidth: 1.5,
                  borderStyle: "dashed",
                  borderColor: "#8DC5A5",
                  backgroundColor: "#F3FBF6",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  marginBottom: 14,
                }}
              >
                {paymentProofUri ? (
                  <Image
                    source={{
                      uri: paymentProofUri,
                    }}
                    style={{
                      width: "100%",
                      height: 180,
                      resizeMode: "contain",
                    }}
                  />
                ) : (
                  <>
                    <Ionicons
                      name="image-outline"
                      size={30}
                      color="#176844"
                    />
                    <Text
                      style={{
                        color: "#176844",
                        fontSize: 14,
                        fontWeight: "900",
                        marginTop: 6,
                      }}
                    >
                      Choose screenshot
                    </Text>
                  </>
                )}
              </Pressable>

              {(paymentScanning ||
                !!paymentScanMessage) && (
                <View
                  style={{
                    borderRadius: 14,
                    padding: 12,
                    marginBottom: 14,
                    borderWidth: 1,
                    borderColor:
                      paymentScanValid === false
                        ? "#E6B7B7"
                        : paymentScanValid === true
                          ? "#B6DDC6"
                          : "#D5DFD8",
                    backgroundColor:
                      paymentScanValid === false
                        ? "#FFF2F2"
                        : paymentScanValid === true
                          ? "#EBF8F0"
                          : "#F4F7F5",
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "flex-start",
                    }}
                  >
                    {paymentScanning ? (
                      <ActivityIndicator
                        color="#176844"
                        style={{
                          marginTop: 1,
                        }}
                      />
                    ) : (
                      <Ionicons
                        name={
                          paymentScanValid === false
                            ? "warning-outline"
                            : paymentScanValid === true
                              ? "sparkles-outline"
                              : "scan-outline"
                        }
                        size={21}
                        color={
                          paymentScanValid === false
                            ? "#A53333"
                            : "#176844"
                        }
                      />
                    )}

                    <View
                      style={{
                        flex: 1,
                        marginLeft: 9,
                      }}
                    >
                      <Text
                        style={{
                          color:
                            paymentScanValid === false
                              ? "#8C3030"
                              : "#315A45",
                          fontSize: 12,
                          lineHeight: 18,
                          fontWeight: "800",
                        }}
                      >
                        {paymentScanning
                          ? "Scanning payment receipt…"
                          : paymentScanMessage}
                      </Text>

                      {!paymentScanning &&
                        !!paymentDetectedProvider && (
                          <Text
                            style={{
                              color: "#49665A",
                              fontSize: 11,
                              fontWeight: "800",
                              marginTop: 7,
                            }}
                          >
                            Provider:{" "}
                            {paymentDetectedProvider}
                          </Text>
                        )}

                      {!paymentScanning &&
                        !!paymentDetectedAmount && (
                          <Text
                            style={{
                              color: "#49665A",
                              fontSize: 11,
                              fontWeight: "800",
                              marginTop: 3,
                            }}
                          >
                            Amount detected:{" "}
                            {paymentDetectedAmount}
                          </Text>
                        )}

                      {!paymentScanning &&
                        !!paymentDetectedStatus && (
                          <Text
                            style={{
                              color: "#49665A",
                              fontSize: 11,
                              fontWeight: "800",
                              marginTop: 3,
                            }}
                          >
                            Payment status:{" "}
                            {paymentDetectedStatus}
                          </Text>
                        )}

                      {!paymentScanning &&
                        !!paymentDetectedReference && (
                          <Text
                            style={{
                              color: "#176844",
                              fontSize: 11,
                              fontWeight: "900",
                              marginTop: 3,
                            }}
                          >
                            Transaction:{" "}
                            {paymentDetectedReference}
                          </Text>
                        )}
                    </View>
                  </View>
                </View>
              )}

              <Text
                style={{
                  color: "#334139",
                  fontSize: 12,
                  fontWeight: "900",
                  marginBottom: 6,
                }}
              >
                Transaction reference
              </Text>

              <TextInput
                value={paymentReference}
                onChangeText={setPaymentReference}
                placeholder="Example: Cash App confirmation number"
                placeholderTextColor="#929A95"
                maxLength={120}
                style={{
                  minHeight: 49,
                  borderWidth: 1,
                  borderColor: "#CFDCD3",
                  backgroundColor: "#FFFFFF",
                  borderRadius: 13,
                  paddingHorizontal: 13,
                  color: "#17221B",
                  fontSize: 14,
                  marginBottom: 14,
                }}
              />

              <Text
                style={{
                  color: "#334139",
                  fontSize: 12,
                  fontWeight: "900",
                  marginBottom: 6,
                }}
              >
                Message to seller (optional)
              </Text>

              <TextInput
                value={paymentMessage}
                onChangeText={setPaymentMessage}
                placeholder="Example: I paid earlier but forgot to upload the receipt."
                placeholderTextColor="#929A95"
                multiline
                maxLength={500}
                style={{
                  minHeight: 88,
                  borderWidth: 1,
                  borderColor: "#CFDCD3",
                  backgroundColor: "#FFFFFF",
                  borderRadius: 13,
                  paddingHorizontal: 13,
                  paddingTop: 12,
                  color: "#17221B",
                  fontSize: 14,
                  textAlignVertical: "top",
                  marginBottom: 14,
                }}
              />

              <View
                style={{
                  borderRadius: 12,
                  backgroundColor: "#FFF7E8",
                  padding: 11,
                  marginBottom: 14,
                }}
              >
                <Text
                  style={{
                    color: "#7B6641",
                    fontSize: 11,
                    lineHeight: 16,
                    fontWeight: "700",
                  }}
                >
                  A screenshot is not final payment approval. The seller must verify the funds before shipping.
                </Text>
              </View>

              <Pressable
                disabled={
                  paymentSubmitting ||
                  !paymentProofUri ||
                  paymentReference.trim().length < 3
                }
                onPress={() =>
                  void submitTrackPaymentProof()
                }
                style={{
                  minHeight: 54,
                  borderRadius: 15,
                  backgroundColor: "#176844",
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity:
                    paymentSubmitting ||
                    !paymentProofUri ||
                    paymentReference.trim().length < 3
                      ? 0.5
                      : 1,
                }}
              >
                {paymentSubmitting ? (
                  <ActivityIndicator
                    color="#FFFFFF"
                  />
                ) : (
                  <Ionicons
                    name="shield-checkmark"
                    size={20}
                    color="#FFFFFF"
                  />
                )}

                <Text
                  style={{
                    color: "#FFFFFF",
                    fontSize: 15,
                    fontWeight: "900",
                    marginLeft: 8,
                  }}
                >
                  {paymentSubmitting
                    ? "Submitting…"
                    : "Submit Payment Proof"}
                </Text>
              </Pressable>
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#F3F7F4",
  },
  flex: {
    flex: 1,
  },
  header: {
    backgroundColor: "#0A5037",
    paddingHorizontal: 20,
    paddingTop: 15,
    paddingBottom: 25,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderBottomLeftRadius: 31,
    borderBottomRightRadius: 31,
  },
  backButton: {
    width: 49,
    height: 49,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.13)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  headerCopy: {
    flex: 1,
  },
  eyebrow: {
    color: "#DDF25B",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2,
  },
  heading: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "900",
    marginTop: 4,
  },
  subheading: {
    color: "#BCD8CA",
    fontSize: 11,
    lineHeight: 17,
    marginTop: 3,
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(221,242,91,0.12)",
  },
  content: {
    padding: 17,
    paddingBottom: 50,
    gap: 15,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 30,
  },
  centerTitle: {
    color: "#15251D",
    fontSize: 18,
    fontWeight: "900",
    marginTop: 16,
  },
  centerCopy: {
    color: "#738078",
    fontSize: 12,
    marginTop: 6,
  },
  errorCard: {
    backgroundColor: "#FCEEEE",
    borderColor: "#E9BBBB",
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    flexDirection: "row",
    gap: 12,
  },
  errorTitle: {
    color: "#8E3030",
    fontSize: 15,
    fontWeight: "900",
  },
  errorCopy: {
    color: "#A15A5A",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  emptyCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 25,
    padding: 35,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#D9E7DE",
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 25,
    backgroundColor: "#EAF6EF",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    color: "#13251C",
    fontSize: 21,
    fontWeight: "900",
    marginTop: 18,
  },
  emptyCopy: {
    color: "#738078",
    fontSize: 12,
    lineHeight: 19,
    textAlign: "center",
    marginTop: 7,
  },
  orderCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 25,
    padding: 17,
    borderWidth: 1,
    borderColor: "#D9E7DE",
    shadowColor: "#0B402D",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 9 },
    elevation: 3,
  },
  orderTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
  },
  packageIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: "#0A5037",
    alignItems: "center",
    justifyContent: "center",
  },
  orderLabel: {
    color: "#87938C",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.3,
  },
  productTitle: {
    color: "#15251D",
    fontSize: 16,
    fontWeight: "900",
    marginTop: 4,
  },
  seller: {
    color: "#78847D",
    fontSize: 11,
    marginTop: 4,
  },
  statusPill: {
    maxWidth: 105,
    backgroundColor: "#E8F5ED",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  statusText: {
    color: "#167A52",
    fontSize: 9,
    fontWeight: "900",
    textAlign: "center",
  },
  cancelledPill: {
    backgroundColor: "#FCECEC",
  },
  cancelledText: {
    color: "#A33B3B",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#E7EEE9",
    borderBottomWidth: 1,
    borderBottomColor: "#E7EEE9",
    paddingVertical: 13,
    marginTop: 16,
  },
  totalLabel: {
    color: "#839087",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.3,
  },
  totalValue: {
    color: "#0B7049",
    fontSize: 17,
    fontWeight: "900",
  },
  timeline: {
    paddingTop: 17,
    paddingBottom: 4,
  },
  stepRow: {
    minHeight: 43,
    flexDirection: "row",
  },
  stepRail: {
    width: 27,
    alignItems: "center",
  },
  stepDot: {
    width: 21,
    height: 21,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#CAD5CE",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  stepDotComplete: {
    borderColor: "#167A52",
    backgroundColor: "#167A52",
  },
  stepLine: {
    width: 2,
    flex: 1,
    backgroundColor: "#DFE7E2",
  },
  stepLineComplete: {
    backgroundColor: "#167A52",
  },
  stepLabel: {
    color: "#8A958E",
    fontSize: 12,
    fontWeight: "700",
    paddingTop: 3,
    paddingLeft: 9,
  },
  stepLabelComplete: {
    color: "#203A2D",
    fontWeight: "900",
  },
  trackingBox: {
    borderRadius: 19,
    backgroundColor: "#EEF8F2",
    borderWidth: 1,
    borderColor: "#CDE6D6",
    padding: 15,
    marginTop: 12,
  },
  trackingHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  trackingLabel: {
    color: "#648071",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  trackingNumber: {
    color: "#0A5037",
    fontSize: 17,
    fontWeight: "900",
    marginTop: 9,
  },
  carrier: {
    color: "#6B7B72",
    fontSize: 11,
    marginTop: 5,
  },
  trackButton: {
    minHeight: 51,
    borderRadius: 15,
    backgroundColor: "#087A47",
    marginTop: 13,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  trackButtonText: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
  },
  pendingBox: {
    borderRadius: 16,
    padding: 13,
    marginTop: 13,
    backgroundColor: "#FFF8E7",
    borderWidth: 1,
    borderColor: "#EAD79C",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  pendingText: {
    flex: 1,
    color: "#745E1B",
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "700",
  },
  confirmButton: {
    minHeight: 52,
    borderRadius: 16,
    marginTop: 13,
    backgroundColor: "#DDF25B",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  confirmText: {
    color: "#0D5136",
    fontSize: 14,
    fontWeight: "900",
  },
  cancelOrderButton: {
    marginTop: 16,
    minHeight: 58,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#D98C8C",
    backgroundColor: "#FFF5F5",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 18,
  },
  cancelOrderText: {
    color: "#A53333",
    fontSize: 17,
    fontWeight: "800",
  },

  removeTrackButton: {
    marginTop: 14,
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    backgroundColor: "#F9FAFB",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    paddingHorizontal: 18,
  },
  removeTrackText: {
    color: "#4B5563",
    fontSize: 16,
    fontWeight: "800",
  },

  deliveredBox: {
    borderRadius: 16,
    backgroundColor: "#EAF7EF",
    padding: 14,
    marginTop: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  deliveredTitle: {
    color: "#126C48",
    fontSize: 13,
    fontWeight: "900",
  },
  deliveredCopy: {
    color: "#678074",
    fontSize: 10,
    marginTop: 3,
  },
});
