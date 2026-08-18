import React from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  useRouter,
} from "expo-router";
import {
  Ionicons,
} from "@expo/vector-icons";
import {
  LinearGradient,
} from "expo-linear-gradient";
import {
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import * as Location from "expo-location";
import MapView, {
  Marker,
  type MapPressEvent,
} from "react-native-maps";

import {
  getSessionSync,
} from "@/src/lib/kristoSession";
import {
  fetchMySokoSellerApplication,
  submitMySokoSellerApplication,
  type SokoSellerApplication,
} from "@/src/lib/sokoSellerAccessApi";

const BG = "#080D13";
const CARD = "#121B21";
const TEXT = "#F8FAF7";
const MUTED = "rgba(248,250,247,0.62)";
const LIME = "#DDF25B";
const GREEN = "#5DEBA5";
const PINK = "#FF8CC8";

const CATEGORIES = [
  "Fashion",
  "Electronics",
  "Home",
  "Beauty",
  "Food",
  "Services",
  "Other",
];

type SellerMapLocation = {
  latitude: number;
  longitude: number;
  label: string;
};

function compactLocationLabel(
  address: Location.LocationGeocodedAddress | null | undefined
) {
  if (!address) return "";

  const candidates = [
    address.city ||
      address.district ||
      address.subregion,
    address.region,
    address.country,
  ];

  const used = new Set<string>();
  const parts: string[] = [];

  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    const key = value.toLowerCase();

    if (!value || used.has(key)) continue;
    used.add(key);
    parts.push(value);
  }

  return parts.join(", ");
}

function statusCopy(
  application: SokoSellerApplication
) {
  if (application.status === "approved") {
    return application.commandCode
      ? "Your seller command code is ready. Use it in SOKO with this same Kristo account."
      : "Your application is approved. If your previous code expired, ask System Admin to generate another code.";
  }

  if (application.status === "rejected") {
    return application.adminNotes ||
      "Your request was not approved. Update the information and submit again.";
  }

  if (application.status === "revoked") {
    return application.adminNotes ||
      "Your SOKO seller approval was revoked. You may submit a new application for review.";
  }

  return "System Admin is reviewing your request. Pastor permission is not required in V1.";
}

function statusTitle(
  application: SokoSellerApplication
) {
  if (application.status === "approved") {
    return "You are approved to sell";
  }

  if (application.status === "rejected") {
    return "Application needs changes";
  }

  if (application.status === "revoked") {
    return "Seller access was removed";
  }

  return "Application under review";
}

function statusIcon(
  application: SokoSellerApplication
) {
  if (application.status === "approved") {
    return "checkmark-circle" as const;
  }

  if (
    application.status === "rejected" ||
    application.status === "revoked"
  ) {
    return "alert-circle" as const;
  }

  return "time" as const;
}

export default function SokoSellerApplicationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = getSessionSync() as any;

  const [loading, setLoading] =
    React.useState(true);
  const [saving, setSaving] =
    React.useState(false);
  const [error, setError] =
    React.useState("");
  const [application, setApplication] =
    React.useState<SokoSellerApplication | null>(null);
  const [businessName, setBusinessName] =
    React.useState("");
  const [category, setCategory] =
    React.useState("Fashion");
  const [location, setLocation] =
    React.useState("");
  const [locationPickerVisible, setLocationPickerVisible] =
    React.useState(false);
  const [locating, setLocating] =
    React.useState(false);
  const [locationPermissionDenied, setLocationPermissionDenied] =
    React.useState(false);
  const [locationError, setLocationError] =
    React.useState("");
  const [mapLocation, setMapLocation] =
    React.useState<SellerMapLocation | null>(null);
  const [reason, setReason] =
    React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const result =
        await fetchMySokoSellerApplication();
      setApplication(result);

      if (result) {
        setBusinessName(result.businessName);
        setCategory(result.category);
        setLocation(result.location);
        setReason(result.reason);
      }
    } catch (nextError: any) {
      setError(
        String(
          nextError?.message ||
            "Could not load seller application."
        )
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const resolveMapLocation = React.useCallback(
    async (
      latitude: number,
      longitude: number
    ) => {
      const addresses =
        await Location.reverseGeocodeAsync({
          latitude,
          longitude,
        });

      const label =
        compactLocationLabel(addresses[0]);

      if (!label) {
        throw new Error(
          "We found your position but could not identify its city and country. Move the pin slightly and try again."
        );
      }

      setMapLocation({
        latitude,
        longitude,
        label,
      });
    },
    []
  );

  const detectCurrentLocation = React.useCallback(
    async () => {
      if (locating) return;

      setLocating(true);
      setLocationError("");
      setLocationPermissionDenied(false);

      try {
        const permission =
          await Location.requestForegroundPermissionsAsync();

        if (
          permission.status !==
          Location.PermissionStatus.GRANTED
        ) {
          setLocationPermissionDenied(true);
          setLocationError(
            "Location permission is required to detect your selling city and country."
          );
          return;
        }

        const current =
          await Location.getCurrentPositionAsync({
            accuracy:
              Location.Accuracy.Balanced,
          });

        await resolveMapLocation(
          current.coords.latitude,
          current.coords.longitude
        );
      } catch (nextError: any) {
        setLocationError(
          String(
            nextError?.message ||
              "We could not detect your location. Check Location Services and try again."
          )
        );
      } finally {
        setLocating(false);
      }
    }, [
      locating,
      resolveMapLocation,
    ]
  );

  const openLocationPicker = React.useCallback(() => {
    setLocationPickerVisible(true);
    setLocationError("");

    if (!mapLocation) {
      setTimeout(() => {
        void detectCurrentLocation();
      }, 250);
    }
  }, [
    detectCurrentLocation,
    mapLocation,
  ]);

  const moveLocationPin = React.useCallback(
    async (
      latitude: number,
      longitude: number
    ) => {
      setLocating(true);
      setLocationError("");

      try {
        await resolveMapLocation(
          latitude,
          longitude
        );
      } catch (nextError: any) {
        setLocationError(
          String(
            nextError?.message ||
              "Could not identify that map location."
          )
        );
      } finally {
        setLocating(false);
      }
    }, [resolveMapLocation]
  );

  const handleMapPress = React.useCallback(
    (event: MapPressEvent) => {
      const coordinate =
        event.nativeEvent.coordinate;

      void moveLocationPin(
        coordinate.latitude,
        coordinate.longitude
      );
    },
    [moveLocationPin]
  );

  const confirmMapLocation = React.useCallback(() => {
    if (!mapLocation) return;
    setLocation(mapLocation.label);
    setLocationPickerVisible(false);
  }, [mapLocation]);

  const canSubmit =
    businessName.trim().length >= 2 &&
    category.trim().length > 0 &&
    location.trim().length >= 2 &&
    reason.trim().length >= 10;

  const submit = React.useCallback(async () => {
    if (!canSubmit || saving) return;

    setSaving(true);
    setError("");

    try {
      const result =
        await submitMySokoSellerApplication({
          businessName:
            businessName.trim(),
          category,
          location:
            location.trim(),
          reason:
            reason.trim(),
        });

      setApplication(result);
      Alert.alert(
        "Application submitted",
        "System Admin will review your request. Pastor approval is not required for SOKO V1."
      );
    } catch (nextError: any) {
      setError(
        String(
          nextError?.message ||
            "Could not submit seller application."
        )
      );
    } finally {
      setSaving(false);
    }
  }, [
    businessName,
    canSubmit,
    category,
    location,
    reason,
    saving,
  ]);

  const locked =
    application?.status === "pending" ||
    application?.status === "approved";

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={["#173225", "#101622", BG]}
        style={StyleSheet.absoluteFillObject}
      />

      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 10 },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          style={styles.back}
        >
          <Ionicons
            name="chevron-back"
            size={25}
            color={TEXT}
          />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>
            Sell on SOKO
          </Text>
          <Text style={styles.headerSub}>
            Kristo verified seller access
          </Text>
        </View>

        <View style={styles.headerIcon}>
          <Ionicons
            name="storefront-outline"
            size={24}
            color={LIME}
          />
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator
            size="large"
            color={LIME}
          />
          <Text style={styles.centerText}>
            Loading seller access…
          </Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.content,
            {
              paddingBottom:
                insets.bottom + 40,
            },
          ]}
        >
          <LinearGradient
            colors={["#173D31", "#101F1A"]}
            style={styles.identityCard}
          >
            <View style={styles.identityIcon}>
              <Ionicons
                name="shield-checkmark"
                size={27}
                color={LIME}
              />
            </View>

            <View style={{ flex: 1 }}>
              <View style={styles.identityLabelRow}>
                <Text style={styles.identityLabel}>
                  YOUR KRISTO ACCOUNT
                </Text>
                <View style={styles.verifiedPill}>
                  <Ionicons
                    name="checkmark"
                    size={11}
                    color={GREEN}
                  />
                  <Text style={styles.verifiedPillText}>
                    VERIFIED
                  </Text>
                </View>
              </View>
              <Text style={styles.identityName}>
                {String(
                  session?.displayName ||
                    session?.name ||
                    "Kristo Member"
                )}
              </Text>
              <Text style={styles.identityId}>
                {String(
                  session?.kristoId ||
                    "Kristo ID verified by server"
                ).toUpperCase()}
              </Text>
              <Text style={styles.identityHelp}>
                Your application and seller access will be linked to this account.
              </Text>
            </View>
          </LinearGradient>

          {!application ? (
            <View style={styles.processCard}>
              <Text style={styles.processEyebrow}>
                HOW SELLER ACCESS WORKS
              </Text>

              <View style={styles.processStep}>
                <View style={styles.processNumber}>
                  <Text style={styles.processNumberText}>1</Text>
                </View>
                <View style={styles.processBody}>
                  <Text style={styles.processTitle}>
                    Send your application
                  </Text>
                  <Text style={styles.processText}>
                    Tell us what you plan to sell and where your business operates.
                  </Text>
                </View>
              </View>

              <View style={styles.processLine} />

              <View style={styles.processStep}>
                <View style={styles.processNumber}>
                  <Text style={styles.processNumberText}>2</Text>
                </View>
                <View style={styles.processBody}>
                  <Text style={styles.processTitle}>
                    System Admin reviews it
                  </Text>
                  <Text style={styles.processText}>
                    No Pastor permission is required for SOKO V1. System Admin reviews the application directly.
                  </Text>
                </View>
              </View>

              <View style={styles.processLine} />

              <View style={styles.processStep}>
                <View style={styles.processNumber}>
                  <Text style={styles.processNumberText}>3</Text>
                </View>
                <View style={styles.processBody}>
                  <Text style={styles.processTitle}>
                    Activate your SOKO account
                  </Text>
                  <Text style={styles.processText}>
                    If approved, use your one-time command code in SOKO with this same Kristo account.
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          {application ? (
            <View
              style={[
                styles.statusCard,
                application.status === "approved" &&
                  styles.statusApproved,
              ]}
            >
              <View style={styles.statusHero}>
                <View style={styles.statusIcon}>
                  <Ionicons
                    name={statusIcon(application)}
                    size={27}
                    color={
                      application.status === "approved"
                        ? GREEN
                        : LIME
                    }
                  />
                </View>

                <View style={styles.statusHeroBody}>
                  <Text style={styles.statusEyebrow}>
                    SELLER APPLICATION
                  </Text>
                  <Text style={styles.statusTitle}>
                    {statusTitle(application)}
                  </Text>
                </View>

                <View style={styles.statusBadge}>
                  <Text style={styles.statusBadgeText}>
                    {application.status.toUpperCase()}
                  </Text>
                </View>
              </View>

              <Text style={styles.statusText}>
                {statusCopy(application)}
              </Text>

              {application.commandCode ? (
                <View style={styles.codeBox}>
                  <Text style={styles.codeLabel}>
                    YOUR ONE-TIME COMMAND CODE
                  </Text>
                  <Text
                    selectable
                    style={styles.codeValue}
                  >
                    {application.commandCode}
                  </Text>
                  <Text style={styles.codeHelp}>
                    Enter this in SOKO while signed into the same Kristo account. It expires in 7 days and stops working after use.
                  </Text>
                  <View style={styles.codeNextStep}>
                    <View style={styles.codeNextIcon}>
                      <Text style={styles.codeNextIconText}>1</Text>
                    </View>
                    <Text style={styles.codeNextText}>
                      Open SOKO and sign in with {String(session?.kristoId || "this Kristo ID").toUpperCase()}.
                    </Text>
                  </View>
                  <View style={styles.codeNextStep}>
                    <View style={styles.codeNextIcon}>
                      <Text style={styles.codeNextIconText}>2</Text>
                    </View>
                    <Text style={styles.codeNextText}>
                      Choose Seller Access and enter the command code above.
                    </Text>
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}

          {!locked ? (
            <>
              <Text style={styles.sectionLabel}>
                APPLY TO BECOME A SELLER
              </Text>

              <Text style={styles.sectionIntro}>
                Complete all fields below. Use accurate information so System Admin can review your request.
              </Text>

              <View style={styles.formCard}>
                <Text style={styles.inputLabel}>
                  Business or shop name
                </Text>
                <Text style={styles.inputHelp}>
                  This is the name buyers will see in SOKO.
                </Text>
                <TextInput
                  value={businessName}
                  onChangeText={setBusinessName}
                  placeholder="Example: Fariji Fashion"
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  style={styles.input}
                />

                <Text style={styles.inputLabel}>
                  Main product category
                </Text>
                <Text style={styles.inputHelp}>
                  Select the closest match for what you sell most.
                </Text>
                <View style={styles.categoryWrap}>
                  {CATEGORIES.map((item) => {
                    const active =
                      category === item;
                    return (
                      <Pressable
                        key={item}
                        onPress={() =>
                          setCategory(item)
                        }
                        style={[
                          styles.category,
                          active &&
                            styles.categoryActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.categoryText,
                            active &&
                              styles.categoryTextActive,
                          ]}
                        >
                          {item}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={styles.inputLabel}>
                  Selling location
                </Text>
                <Text style={styles.inputHelp}>
                  Use the map to confirm the city and country where you will serve buyers.
                </Text>
                <Pressable
                  onPress={openLocationPicker}
                  accessibilityRole="button"
                  accessibilityLabel="Choose selling location on map"
                  style={({ pressed }) => [
                    styles.locationButton,
                    Boolean(location) &&
                      styles.locationButtonSelected,
                    pressed && { opacity: 0.76 },
                  ]}
                >
                  <View style={styles.locationButtonIcon}>
                    <Ionicons
                      name={
                        location
                          ? "location"
                          : "map-outline"
                      }
                      size={21}
                      color={location ? GREEN : LIME}
                    />
                  </View>

                  <View style={styles.locationButtonBody}>
                    <Text
                      style={
                        location
                          ? styles.locationValue
                          : styles.locationPlaceholder
                      }
                    >
                      {location || "Choose selling location"}
                    </Text>
                    <Text style={styles.locationButtonHint}>
                      {location
                        ? "Tap to change this location"
                        : "Allow location access, then confirm the map pin"}
                    </Text>
                  </View>

                  <Ionicons
                    name="chevron-forward"
                    size={19}
                    color={MUTED}
                  />
                </Pressable>

                <Text style={styles.inputLabel}>
                  Tell us about your business
                </Text>
                <Text style={styles.inputHelp}>
                  Describe your products, their condition or quality, and how you will serve buyers.
                </Text>
                <TextInput
                  value={reason}
                  onChangeText={setReason}
                  placeholder="Describe your products and how you will serve buyers…"
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  multiline
                  maxLength={1500}
                  style={[
                    styles.input,
                    styles.reasonInput,
                  ]}
                />
                <Text style={styles.characterCount}>
                  {reason.length}/1500
                </Text>
              </View>

              {error ? (
                <Text style={styles.error}>
                  {error}
                </Text>
              ) : null}

              <Pressable
                disabled={!canSubmit || saving}
                onPress={submit}
                style={[
                  styles.submit,
                  (!canSubmit || saving) &&
                    styles.submitDisabled,
                ]}
              >
                {saving ? (
                  <ActivityIndicator
                    color="#132014"
                  />
                ) : (
                  <>
                    <Text style={styles.submitText}>
                      Send seller application
                    </Text>
                    <Ionicons
                      name="arrow-forward"
                      size={19}
                      color="#132014"
                    />
                  </>
                )}
              </Pressable>

              <View style={styles.submitHelpRow}>
                <Ionicons
                  name={canSubmit ? "shield-checkmark-outline" : "information-circle-outline"}
                  size={16}
                  color={canSubmit ? GREEN : MUTED}
                />
                <Text style={styles.submitHelpText}>
                  {canSubmit
                    ? "Ready to send. System Admin will review your application."
                    : "Complete the business name, location and business description to continue."}
                </Text>
              </View>
            </>
          ) : null}

          {error && locked ? (
            <Text style={styles.error}>
              {error}
            </Text>
          ) : null}

          {application ? (
            <Pressable
              onPress={() => void load()}
              style={styles.refresh}
            >
              <Ionicons
                name="refresh-outline"
                size={18}
                color={GREEN}
              />
              <Text style={styles.refreshText}>
                Check for a status update
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}

      <Modal
        visible={locationPickerVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() =>
          setLocationPickerVisible(false)
        }
      >
        <View style={styles.locationModal}>
          <LinearGradient
            colors={["#173225", "#101622", BG]}
            style={StyleSheet.absoluteFillObject}
          />

          <View
            style={[
              styles.locationModalHeader,
              { paddingTop: insets.top + 8 },
            ]}
          >
            <Pressable
              onPress={() =>
                setLocationPickerVisible(false)
              }
              style={styles.locationModalClose}
            >
              <Ionicons
                name="close"
                size={22}
                color={TEXT}
              />
            </Pressable>

            <View style={{ flex: 1 }}>
              <Text style={styles.locationModalTitle}>
                Choose selling location
              </Text>
              <Text style={styles.locationModalSub}>
                Confirm your city and country
              </Text>
            </View>

            <Pressable
              disabled={locating}
              onPress={() =>
                void detectCurrentLocation()
              }
              style={styles.currentLocationButton}
            >
              <Ionicons
                name="navigate"
                size={19}
                color={LIME}
              />
            </Pressable>
          </View>

          <View style={styles.mapStage}>
            {mapLocation ? (
              <MapView
                key={`${mapLocation.latitude.toFixed(4)}:${mapLocation.longitude.toFixed(4)}`}
                style={StyleSheet.absoluteFillObject}
                initialRegion={{
                  latitude: mapLocation.latitude,
                  longitude: mapLocation.longitude,
                  latitudeDelta: 0.075,
                  longitudeDelta: 0.075,
                }}
                showsUserLocation
                showsMyLocationButton={false}
                onPress={handleMapPress}
              >
                <Marker
                  coordinate={{
                    latitude: mapLocation.latitude,
                    longitude: mapLocation.longitude,
                  }}
                  draggable
                  title="Selling area"
                  description={mapLocation.label}
                  onDragEnd={(event) => {
                    const coordinate =
                      event.nativeEvent.coordinate;
                    void moveLocationPin(
                      coordinate.latitude,
                      coordinate.longitude
                    );
                  }}
                />
              </MapView>
            ) : (
              <View style={styles.mapEmpty}>
                {locating ? (
                  <ActivityIndicator
                    size="large"
                    color={LIME}
                  />
                ) : (
                  <View style={styles.mapEmptyIcon}>
                    <Ionicons
                      name="location-outline"
                      size={30}
                      color={LIME}
                    />
                  </View>
                )}

                <Text style={styles.mapEmptyTitle}>
                  {locating
                    ? "Finding your location…"
                    : "Location is not available"}
                </Text>
                <Text style={styles.mapEmptyText}>
                  Allow location access so Kristo can identify your selling city and country.
                </Text>

                {!locating ? (
                  <Pressable
                    onPress={() =>
                      void detectCurrentLocation()
                    }
                    style={styles.mapRetry}
                  >
                    <Ionicons
                      name="navigate-outline"
                      size={17}
                      color="#132014"
                    />
                    <Text style={styles.mapRetryText}>
                      Use my current location
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            )}

            {locating && mapLocation ? (
              <View style={styles.mapLoadingPill}>
                <ActivityIndicator
                  size="small"
                  color={LIME}
                />
                <Text style={styles.mapLoadingText}>
                  Identifying this area…
                </Text>
              </View>
            ) : null}
          </View>

          <View
            style={[
              styles.locationConfirmCard,
              { paddingBottom: insets.bottom + 16 },
            ]}
          >
            {locationError ? (
              <View style={styles.locationErrorCard}>
                <Ionicons
                  name="alert-circle-outline"
                  size={20}
                  color={PINK}
                />
                <Text style={styles.locationErrorText}>
                  {locationError}
                </Text>
              </View>
            ) : null}

            {locationPermissionDenied ? (
              <Pressable
                onPress={() => void Linking.openSettings()}
                style={styles.settingsButton}
              >
                <Ionicons
                  name="settings-outline"
                  size={17}
                  color={GREEN}
                />
                <Text style={styles.settingsButtonText}>
                  Open iPhone Settings
                </Text>
              </Pressable>
            ) : null}

            <View style={styles.detectedLocationRow}>
              <View style={styles.detectedLocationIcon}>
                <Ionicons
                  name="location"
                  size={21}
                  color={GREEN}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.detectedLocationLabel}>
                  SELECTED SELLING AREA
                </Text>
                <Text style={styles.detectedLocationValue}>
                  {mapLocation?.label ||
                    "Move or select the map pin"}
                </Text>
              </View>
            </View>

            <View style={styles.locationPrivacyRow}>
              <Ionicons
                name="shield-checkmark-outline"
                size={16}
                color={GREEN}
              />
              <Text style={styles.locationPrivacyText}>
                Only the city, region and country are added to your application—not your precise coordinates.
              </Text>
            </View>

            <Pressable
              disabled={!mapLocation || locating}
              onPress={confirmMapLocation}
              style={[
                styles.confirmLocationButton,
                (!mapLocation || locating) &&
                  styles.submitDisabled,
              ]}
            >
              <Text style={styles.confirmLocationText}>
                Use this selling location
              </Text>
              <Ionicons
                name="checkmark-circle"
                size={20}
                color="#132014"
              />
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: {
    paddingHorizontal: 18,
    paddingBottom: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  back: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  headerTitle: { color: TEXT, fontSize: 27, fontWeight: "900" },
  headerSub: { color: MUTED, fontSize: 13, fontWeight: "700", marginTop: 2 },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 17,
    backgroundColor: "rgba(221,242,91,0.10)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(221,242,91,0.28)",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  centerText: { color: MUTED, fontSize: 14, fontWeight: "700" },
  content: { padding: 18, gap: 16 },
  identityCard: {
    borderRadius: 24,
    padding: 19,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderWidth: 1,
    borderColor: "rgba(93,235,165,0.25)",
  },
  identityIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(221,242,91,0.10)",
  },
  identityLabelRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  identityLabel: { color: GREEN, fontSize: 10, letterSpacing: 1.4, fontWeight: "900" },
  verifiedPill: { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: "rgba(93,235,165,0.10)" },
  verifiedPillText: { color: GREEN, fontSize: 8, letterSpacing: 0.8, fontWeight: "900" },
  identityName: { color: TEXT, fontSize: 18, fontWeight: "900", marginTop: 4 },
  identityId: { color: MUTED, fontSize: 13, fontWeight: "700", marginTop: 2 },
  identityHelp: { color: "rgba(248,250,247,0.52)", fontSize: 11, lineHeight: 16, marginTop: 7 },
  processCard: { borderRadius: 22, padding: 18, backgroundColor: "rgba(18,27,33,0.92)", borderWidth: 1, borderColor: "rgba(221,242,91,0.16)" },
  processEyebrow: { color: LIME, fontSize: 10, letterSpacing: 1.5, fontWeight: "900", marginBottom: 16 },
  processStep: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  processNumber: { width: 29, height: 29, borderRadius: 10, backgroundColor: "rgba(221,242,91,0.12)", borderWidth: 1, borderColor: "rgba(221,242,91,0.28)", alignItems: "center", justifyContent: "center" },
  processNumberText: { color: LIME, fontSize: 12, fontWeight: "900" },
  processBody: { flex: 1 },
  processTitle: { color: TEXT, fontSize: 13, fontWeight: "900" },
  processText: { color: MUTED, fontSize: 12, lineHeight: 18, marginTop: 3 },
  processLine: { width: 1, height: 13, marginLeft: 14, marginVertical: 3, backgroundColor: "rgba(221,242,91,0.20)" },
  statusCard: { padding: 19, borderRadius: 22, backgroundColor: CARD, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  statusApproved: { borderColor: "rgba(93,235,165,0.30)", backgroundColor: "rgba(20,54,43,0.82)" },
  statusHero: { flexDirection: "row", alignItems: "center", gap: 11 },
  statusIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(221,242,91,0.10)" },
  statusHeroBody: { flex: 1 },
  statusEyebrow: { color: MUTED, fontSize: 10, letterSpacing: 1.3, fontWeight: "900" },
  statusTitle: { color: TEXT, fontSize: 16, fontWeight: "900", marginTop: 3 },
  statusBadge: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, backgroundColor: "rgba(221,242,91,0.12)" },
  statusBadgeText: { color: LIME, fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
  statusText: { color: "rgba(255,255,255,0.75)", fontSize: 14, lineHeight: 22, marginTop: 14, fontWeight: "600" },
  codeBox: { marginTop: 17, borderRadius: 18, padding: 16, backgroundColor: "rgba(0,0,0,0.24)", borderWidth: 1, borderColor: "rgba(221,242,91,0.30)" },
  codeLabel: { color: MUTED, fontSize: 9, letterSpacing: 1.2, fontWeight: "900" },
  codeValue: { color: LIME, fontSize: 25, fontWeight: "900", letterSpacing: 1.5, marginTop: 8 },
  codeHelp: { color: MUTED, fontSize: 12, lineHeight: 18, marginTop: 9 },
  codeNextStep: { flexDirection: "row", alignItems: "flex-start", gap: 9, marginTop: 12 },
  codeNextIcon: { width: 21, height: 21, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(93,235,165,0.13)" },
  codeNextIconText: { color: GREEN, fontSize: 10, fontWeight: "900" },
  codeNextText: { flex: 1, color: "rgba(248,250,247,0.70)", fontSize: 11, lineHeight: 17 },
  sectionLabel: { color: LIME, fontSize: 12, letterSpacing: 1.7, fontWeight: "900", marginTop: 5 },
  sectionIntro: { color: MUTED, fontSize: 12, lineHeight: 19, marginTop: -8 },
  formCard: { borderRadius: 22, padding: 18, backgroundColor: CARD, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  inputLabel: { color: "rgba(255,255,255,0.88)", fontSize: 13, fontWeight: "900", marginBottom: 3, marginTop: 6 },
  inputHelp: { color: "rgba(248,250,247,0.48)", fontSize: 11, lineHeight: 16, marginBottom: 9 },
  input: { color: TEXT, minHeight: 51, borderRadius: 15, paddingHorizontal: 14, backgroundColor: "rgba(255,255,255,0.055)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", marginBottom: 14, fontSize: 14 },
  locationButton: { minHeight: 69, borderRadius: 16, paddingHorizontal: 13, marginBottom: 14, flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: "rgba(255,255,255,0.055)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  locationButtonSelected: { backgroundColor: "rgba(93,235,165,0.07)", borderColor: "rgba(93,235,165,0.25)" },
  locationButtonIcon: { width: 39, height: 39, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(221,242,91,0.09)" },
  locationButtonBody: { flex: 1 },
  locationPlaceholder: { color: "rgba(248,250,247,0.52)", fontSize: 14, fontWeight: "800" },
  locationValue: { color: TEXT, fontSize: 14, lineHeight: 19, fontWeight: "900" },
  locationButtonHint: { color: "rgba(248,250,247,0.40)", fontSize: 10, lineHeight: 15, marginTop: 3 },
  reasonInput: { minHeight: 125, paddingTop: 14, paddingBottom: 28, textAlignVertical: "top", marginBottom: 0 },
  characterCount: { color: "rgba(248,250,247,0.38)", fontSize: 10, fontWeight: "700", textAlign: "right", marginTop: 7 },
  categoryWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  category: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.09)" },
  categoryActive: { backgroundColor: "rgba(221,242,91,0.13)", borderColor: "rgba(221,242,91,0.38)" },
  categoryText: { color: MUTED, fontSize: 12, fontWeight: "800" },
  categoryTextActive: { color: LIME },
  error: { color: PINK, fontSize: 13, lineHeight: 19, fontWeight: "700" },
  submit: { minHeight: 56, borderRadius: 18, backgroundColor: LIME, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  submitDisabled: { opacity: 0.38 },
  submitText: { color: "#132014", fontSize: 15, fontWeight: "900" },
  submitHelpRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "center", gap: 7, paddingHorizontal: 8, marginTop: -6 },
  submitHelpText: { flex: 1, color: MUTED, fontSize: 11, lineHeight: 17, textAlign: "center" },
  refresh: { minHeight: 48, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: "rgba(93,235,165,0.18)" },
  refreshText: { color: GREEN, fontSize: 13, fontWeight: "800" },
  locationModal: { flex: 1, backgroundColor: BG },
  locationModalHeader: { paddingHorizontal: 16, paddingBottom: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  locationModalClose: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  locationModalTitle: { color: TEXT, fontSize: 18, fontWeight: "900" },
  locationModalSub: { color: MUTED, fontSize: 11, fontWeight: "700", marginTop: 2 },
  currentLocationButton: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(221,242,91,0.10)", borderWidth: 1, borderColor: "rgba(221,242,91,0.25)" },
  mapStage: { flex: 1, minHeight: 280, overflow: "hidden", backgroundColor: "#172127", borderTopWidth: 1, borderBottomWidth: 1, borderColor: "rgba(255,255,255,0.09)" },
  mapEmpty: { flex: 1, padding: 30, alignItems: "center", justifyContent: "center" },
  mapEmptyIcon: { width: 58, height: 58, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(221,242,91,0.10)" },
  mapEmptyTitle: { color: TEXT, fontSize: 17, fontWeight: "900", marginTop: 15 },
  mapEmptyText: { color: MUTED, fontSize: 12, lineHeight: 19, textAlign: "center", maxWidth: 300, marginTop: 7 },
  mapRetry: { minHeight: 45, borderRadius: 14, paddingHorizontal: 17, marginTop: 17, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: LIME },
  mapRetryText: { color: "#132014", fontSize: 12, fontWeight: "900" },
  mapLoadingPill: { position: "absolute", top: 14, alignSelf: "center", borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(8,13,19,0.88)" },
  mapLoadingText: { color: TEXT, fontSize: 11, fontWeight: "800" },
  locationConfirmCard: { paddingHorizontal: 17, paddingTop: 15, gap: 12, backgroundColor: "rgba(8,13,19,0.98)" },
  locationErrorCard: { borderRadius: 14, padding: 12, flexDirection: "row", alignItems: "flex-start", gap: 9, backgroundColor: "rgba(255,140,200,0.08)", borderWidth: 1, borderColor: "rgba(255,140,200,0.18)" },
  locationErrorText: { flex: 1, color: "rgba(255,205,230,0.88)", fontSize: 11, lineHeight: 17, fontWeight: "700" },
  settingsButton: { minHeight: 42, borderRadius: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderWidth: 1, borderColor: "rgba(93,235,165,0.20)" },
  settingsButtonText: { color: GREEN, fontSize: 12, fontWeight: "900" },
  detectedLocationRow: { flexDirection: "row", alignItems: "center", gap: 11 },
  detectedLocationIcon: { width: 43, height: 43, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(93,235,165,0.10)" },
  detectedLocationLabel: { color: MUTED, fontSize: 9, letterSpacing: 1.1, fontWeight: "900" },
  detectedLocationValue: { color: TEXT, fontSize: 15, lineHeight: 20, fontWeight: "900", marginTop: 3 },
  locationPrivacyRow: { flexDirection: "row", alignItems: "flex-start", gap: 7 },
  locationPrivacyText: { flex: 1, color: MUTED, fontSize: 10, lineHeight: 16 },
  confirmLocationButton: { minHeight: 53, borderRadius: 17, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: LIME },
  confirmLocationText: { color: "#132014", fontSize: 14, fontWeight: "900" },
});
