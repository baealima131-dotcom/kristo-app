import {
  Ionicons,
} from "@expo/vector-icons";

import * as ImagePicker
  from "expo-image-picker";

import {
  useFocusEffect,
} from "expo-router";

import React, {
  useCallback,
  useMemo,
  useState,
} from "react";

import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  SafeAreaView,
} from "react-native-safe-area-context";

import type {
  SokoWorkforceRecord,
} from "@/src/lib/sokoWorkforceApi";

import {
  fetchSokoSetupOperations,
  saveSokoSetupOperation,
  uploadSokoSetupImage,
  type SokoSetupOperation,
} from "@/src/lib/sokoProductOperationsApi";

const GOLD =
  "#FFD66B";

const GREEN =
  "#5DEBA5";

const BLUE =
  "#75C1FF";

type Props = {
  assignment:
    SokoWorkforceRecord;

  onBack:
    () => void;
};

type PhotoOption = {
  key: string;

  url: string;

  source:
    | "imported"
    | "mine";
};

function uniqueStrings(
  values: string[],
  limit = 100
) {
  return Array.from(
    new Set(
      values
        .map(
          (value) =>
            String(
              value || ""
            ).trim()
        )
        .filter(Boolean)
    )
  ).slice(
    0,
    limit
  );
}

function pairPhotos(
  keys: string[],
  urls: string[],
  source:
    | "imported"
    | "mine"
): PhotoOption[] {
  return keys
    .map(
      (
        key,
        index
      ) => ({
        key,

        url:
          String(
            urls[index] ||
              ""
          ).trim(),

        source,
      })
    )
    .filter(
      (item) =>
        item.key &&
        item.url
    );
}

export function
SokoLevel02Work({
  assignment,
  onBack,
}: Props) {
  const [
    items,
    setItems,
  ] =
    useState<
      SokoSetupOperation[]
    >([]);

  const [
    selected,
    setSelected,
  ] =
    useState<
      SokoSetupOperation |
      null
    >(null);

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    busy,
    setBusy,
  ] =
    useState(false);

  const [
    uploading,
    setUploading,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState("");

  const [
    listingTitle,
    setListingTitle,
  ] =
    useState("");

  const [
    model,
    setModel,
  ] =
    useState("");

  const [
    sku,
    setSku,
  ] =
    useState("");

  const [
    colors,
    setColors,
  ] =
    useState("");

  const [
    sizes,
    setSizes,
  ] =
    useState("");

  const [
    description,
    setDescription,
  ] =
    useState("");

  const [
    setupNotes,
    setSetupNotes,
  ] =
    useState("");

  const [
    addedImageKeys,
    setAddedImageKeys,
  ] =
    useState<
      string[]
    >([]);

  const [
    addedImages,
    setAddedImages,
  ] =
    useState<
      string[]
    >([]);

  const [
    finalPhotoKeys,
    setFinalPhotoKeys,
  ] =
    useState<
      string[]
    >([]);

  const [
    mainImageKey,
    setMainImageKey,
  ] =
    useState("");

  const load =
    useCallback(
      async () => {
        setError("");

        try {
          const result =
            await fetchSokoSetupOperations(
              assignment
                .sellerUserId
            );

          setItems(
            result.items ||
              []
          );
        } catch (
          e: any
        ) {
          setError(
            String(
              e?.message ||
                "Could not load Level 02."
            )
          );
        } finally {
          setLoading(
            false
          );
        }
      },
      [
        assignment
          .sellerUserId,
      ]
    );

  useFocusEffect(
    useCallback(
      () => {
        setLoading(
          true
        );

        void load();
      },
      [load]
    )
  );

  const inbox =
    useMemo(
      () =>
        items.filter(
          (item) =>
            item.currentStage ===
              "setup" &&
            item.setupStatus !==
              "sent"
        ),
      [items]
    );

  const sent =
    useMemo(
      () =>
        items.filter(
          (item) =>
            item.setupStatus ===
              "sent" ||
            item.currentStage ===
              "costing"
        ),
      [items]
    );

  const importedPhotos =
    useMemo(
      () =>
        selected
          ? pairPhotos(
              selected.imported
                ?.imageKeys ||
                [],
              selected.imported
                ?.images ||
                [],
              "imported"
            )
          : [],
      [selected]
    );

  const myPhotos =
    useMemo(
      () =>
        pairPhotos(
          addedImageKeys,
          addedImages,
          "mine"
        ),
      [
        addedImageKeys,
        addedImages,
      ]
    );

  const allPhotos =
    useMemo(
      () => [
        ...importedPhotos,
        ...myPhotos,
      ],
      [
        importedPhotos,
        myPhotos,
      ]
    );

  const photoUrlByKey =
    useMemo(
      () => {
        const map =
          new Map<
            string,
            string
          >();

        for (
          const photo of
          allPhotos
        ) {
          map.set(
            photo.key,
            photo.url
          );
        }

        if (selected) {
          selected.photoKeys
            .forEach(
              (
                key,
                index
              ) => {
                const url =
                  selected
                    .finalImages[
                    index
                  ];

                if (
                  key &&
                  url &&
                  !map.has(
                    key
                  )
                ) {
                  map.set(
                    key,
                    url
                  );
                }
              }
            );
        }

        return map;
      },
      [
        allPhotos,
        selected,
      ]
    );

  const selectedSet =
    useMemo(
      () =>
        new Set(
          finalPhotoKeys
        ),
      [finalPhotoKeys]
    );

  function openItem(
    item:
      SokoSetupOperation
  ) {
    setSelected(
      item
    );

    setListingTitle(
      item.listingTitle ||
      item.imported
        ?.title ||
      item.productName
    );

    setModel(
      item.model ||
        ""
    );

    setSku(
      item.sku ||
      item.imported
        ?.sku ||
      item.supplierCode ||
      ""
    );

    const variants =
      item.imported
        ?.variants ||
      [];

    const colorVariant =
      variants.find(
        (variant) =>
          String(
            variant.name ||
              ""
          )
            .toLowerCase()
            .includes(
              "color"
            )
      );

    const sizeVariant =
      variants.find(
        (variant) =>
          String(
            variant.name ||
              ""
          )
            .toLowerCase()
            .includes(
              "size"
            )
      );

    setColors(
      item.colors ||
      (
        colorVariant
          ?.values ||
        []
      ).join(", ")
    );

    setSizes(
      item.sizes ||
      (
        sizeVariant
          ?.values ||
        []
      ).join(", ")
    );

    setDescription(
      item.description ||
      item.imported
        ?.description ||
      ""
    );

    setSetupNotes(
      item.setupNotes ||
        ""
    );

    setAddedImageKeys(
      item.addedImageKeys ||
        []
    );

    setAddedImages(
      item.addedImages ||
        []
    );

    const final =
      uniqueStrings(
        item.photoKeys ||
          [],
        8
      );

    setFinalPhotoKeys(
      final
    );

    setMainImageKey(
      item.mainImageKey &&
      final.includes(
        item.mainImageKey
      )
        ? item.mainImageKey
        : (
            final[0] ||
            ""
          )
    );
  }

  function closeItem() {
    setSelected(
      null
    );

    setListingTitle("");
    setModel("");
    setSku("");
    setColors("");
    setSizes("");
    setDescription("");
    setSetupNotes("");

    setAddedImageKeys(
      []
    );

    setAddedImages(
      []
    );

    setFinalPhotoKeys(
      []
    );

    setMainImageKey(
      ""
    );
  }

  function toggleFinal(
    key: string
  ) {
    if (
      selectedSet.has(
        key
      )
    ) {
      const next =
        finalPhotoKeys.filter(
          (value) =>
            value !== key
        );

      setFinalPhotoKeys(
        next
      );

      if (
        mainImageKey ===
          key
      ) {
        setMainImageKey(
          next[0] ||
            ""
        );
      }

      return;
    }

    if (
      finalPhotoKeys
        .length >= 8
    ) {
      Alert.alert(
        "Maximum 8 photos",
        "Remove one final photo before selecting another."
      );

      return;
    }

    const next = [
      ...finalPhotoKeys,
      key,
    ];

    setFinalPhotoKeys(
      next
    );

    if (
      !mainImageKey
    ) {
      setMainImageKey(
        key
      );
    }
  }

  async function addMyPhotos() {
    if (!selected) {
      return;
    }

    const remaining =
      20 -
      addedImageKeys.length;

    if (
      remaining <= 0
    ) {
      Alert.alert(
        "Photo library full",
        "Level 02 can keep up to 20 uploaded photos for this product."
      );

      return;
    }

    try {
      const permission =
        await ImagePicker
          .requestMediaLibraryPermissionsAsync();

      if (
        !permission.granted
      ) {
        Alert.alert(
          "Photo permission needed",
          "Allow Kristo App to access product photos."
        );

        return;
      }

      const result =
        await ImagePicker
          .launchImageLibraryAsync({
            allowsMultipleSelection:
              true,

            selectionLimit:
              Math.min(
                8,
                remaining
              ),

            quality:
              0.88,
          });

      if (
        result.canceled
      ) {
        return;
      }

      setUploading(
        true
      );

      const newKeys:
        string[] = [];

      const newUrls:
        string[] = [];

      for (
        const asset of
        result.assets
      ) {
        const uploaded =
          await uploadSokoSetupImage({
            sellerUserId:
              assignment
                .sellerUserId,

            uri:
              asset.uri,
          });

        newKeys.push(
          uploaded.key
        );

        newUrls.push(
          uploaded.url
        );
      }

      setAddedImageKeys(
        (current) =>
          uniqueStrings(
            [
              ...current,
              ...newKeys,
            ],
            20
          )
      );

      setAddedImages(
        (current) =>
          [
            ...current,
            ...newUrls,
          ]
      );

      Alert.alert(
        "Photos added",
        `${newKeys.length} photo${newKeys.length === 1 ? "" : "s"} saved to SOKO. Tap any photo to include it in the final 1–8.`
      );
    } catch (
      e: any
    ) {
      Alert.alert(
        "Could not add photos",
        String(
          e?.message ||
            e
        )
      );
    } finally {
      setUploading(
        false
      );
    }
  }

  async function save(
    mode:
      | "working"
      | "sent"
  ) {
    if (!selected) {
      return;
    }

    const title =
      listingTitle.trim();

    const copy =
      description.trim();

    if (
      title.length < 3
    ) {
      Alert.alert(
        "Product title required",
        "Add the final product title."
      );

      return;
    }

    if (
      mode === "sent" &&
      copy.length < 10
    ) {
      Alert.alert(
        "Description required",
        "Write a clear product description."
      );

      return;
    }

    if (
      mode === "sent" &&
      (
        finalPhotoKeys
          .length < 1 ||
        finalPhotoKeys
          .length > 8
      )
    ) {
      Alert.alert(
        "Choose final photos",
        "Select between 1 and 8 product photos."
      );

      return;
    }

    const main =
      mainImageKey &&
      finalPhotoKeys.includes(
        mainImageKey
      )
        ? mainImageKey
        : (
            finalPhotoKeys[0] ||
            ""
          );

    const orderedKeys =
      main
        ? [
            main,
            ...finalPhotoKeys
              .filter(
                (key) =>
                  key !== main
              ),
          ]
        : [];

    try {
      setBusy(
        true
      );

      const saved =
        await saveSokoSetupOperation({
          sellerUserId:
            assignment
              .sellerUserId,

          operationId:
            selected.id,

          listingTitle:
            title,

          model:
            model.trim(),

          sku:
            sku.trim(),

          colors:
            colors.trim(),

          sizes:
            sizes.trim(),

          description:
            copy,

          setupNotes:
            setupNotes.trim(),

          addedImageKeys:
            uniqueStrings(
              addedImageKeys,
              20
            ),

          photoKeys:
            orderedKeys,

          mainImageKey:
            main,

          mode,
        });

      if (
        mode ===
          "sent"
      ) {
        Alert.alert(
          "Sent to Level 03",
          `${title} is ready for Cost & Pricing.`
        );

        closeItem();

        await load();

        return;
      }

      setSelected(
        saved
      );

      setFinalPhotoKeys(
        saved.photoKeys ||
          orderedKeys
      );

      setMainImageKey(
        saved.mainImageKey ||
          main
      );

      Alert.alert(
        "Draft saved",
        "Product remains in Level 02."
      );

      await load();
    } catch (
      e: any
    ) {
      Alert.alert(
        "Could not save Level 02",
        String(
          e?.message ||
            e
        )
      );
    } finally {
      setBusy(
        false
      );
    }
  }

  if (loading) {
    return (
      <SafeAreaView
        style={s.screen}
      >
        <View
          style={s.center}
        >
          <ActivityIndicator
            color={BLUE}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={s.screen}
    >
      <View
        style={s.header}
      >
        <Pressable
          onPress={
            selected
              ? closeItem
              : onBack
          }
          style={s.back}
        >
          <Ionicons
            name="chevron-back"
            size={26}
            color="#FFFFFF"
          />
        </Pressable>

        <View
          style={{
            flex: 1,
          }}
        >
          <Text
            style={s.title}
          >
            Product Setup
          </Text>

          <Text
            style={s.subtitle}
          >
            LEVEL 02 · SOKO WORK
          </Text>
        </View>

        <View
          style={s.levelBadge}
        >
          <Text
            style={s.levelText}
          >
            02
          </Text>
        </View>
      </View>

      {error ? (
        <View
          style={s.center}
        >
          <Text
            style={s.error}
          >
            {error}
          </Text>

          <Pressable
            onPress={() =>
              void load()
            }
            style={
              s.secondaryButton
            }
          >
            <Text
              style={
                s.secondaryText
              }
            >
              Retry
            </Text>
          </Pressable>
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
          <View
            style={s.storeCard}
          >
            <Ionicons
              name="storefront-outline"
              size={23}
              color={GREEN}
            />

            <View
              style={{
                flex: 1,
                marginLeft: 11,
              }}
            >
              <Text
                style={s.storeName}
              >
                {assignment
                  .storeName ||
                  "SOKO STORE"}
              </Text>

              <Text
                style={s.storeMeta}
              >
                Product Setup •{" "}
                {assignment
                  .sellerDisplayName}
              </Text>
            </View>

            <View
              style={s.activeBadge}
            >
              <Text
                style={s.activeText}
              >
                ACTIVE
              </Text>
            </View>
          </View>

          {!selected ? (
            <>
              <View
                style={s.stats}
              >
                <View
                  style={s.stat}
                >
                  <Text
                    style={s.statNumber}
                  >
                    {inbox.length}
                  </Text>

                  <Text
                    style={s.statLabel}
                  >
                    TO SET UP
                  </Text>
                </View>

                <View
                  style={s.stat}
                >
                  <Text
                    style={s.statNumber}
                  >
                    {sent.length}
                  </Text>

                  <Text
                    style={s.statLabel}
                  >
                    SENT TO 03
                  </Text>
                </View>
              </View>

              <Text
                style={
                  s.sectionLabel
                }
              >
                PRODUCT SETUP QUEUE
              </Text>

              {inbox.length ===
              0 ? (
                <View
                  style={s.empty}
                >
                  <Ionicons
                    name="checkmark-done-outline"
                    size={33}
                    color={GREEN}
                  />

                  <Text
                    style={s.emptyTitle}
                  >
                    You're caught up
                  </Text>

                  <Text
                    style={s.emptyCopy}
                  >
                    Products sent from
                    Level 01 will appear
                    here.
                  </Text>
                </View>
              ) : (
                inbox.map(
                  (item) => (
                    <Pressable
                      key={item.id}
                      onPress={() =>
                        openItem(
                          item
                        )
                      }
                      style={
                        s.taskCard
                      }
                    >
                      <View
                        style={
                          s.taskTop
                        }
                      >
                        <View
                          style={
                            s.taskIcon
                          }
                        >
                          <Ionicons
                            name="images-outline"
                            size={20}
                            color={BLUE}
                          />
                        </View>

                        <View
                          style={{
                            flex: 1,
                          }}
                        >
                          <Text
                            style={
                              s.taskMeta
                            }
                          >
                            {item
                              .supplierName ||
                              "SUPPLIER"}
                          </Text>

                          <Text
                            style={
                              s.taskName
                            }
                            numberOfLines={
                              2
                            }
                          >
                            {item
                              .imported
                              ?.title ||
                              item.productName}
                          </Text>
                        </View>

                        <Ionicons
                          name="chevron-forward"
                          size={20}
                          color="rgba(255,255,255,0.30)"
                        />
                      </View>

                      <View
                        style={
                          s.taskFacts
                        }
                      >
                        <Text
                          style={s.fact}
                        >
                          Qty{" "}
                          {item.quantity}
                        </Text>

                        <Text
                          style={s.fact}
                        >
                          Imported{" "}
                          {item
                            .imported
                            ?.imageKeys
                            .length ||
                            0}{" "}
                          photos
                        </Text>

                        <Text
                          style={s.fact}
                        >
                          {item
                            .setupStatus ===
                          "working"
                            ? "DRAFT"
                            : "NEW"}
                        </Text>
                      </View>
                    </Pressable>
                  )
                )
              )}
            </>
          ) : (
            <>
              <View
                style={s.hero}
              >
                <Text
                  style={s.heroMeta}
                >
                  {selected
                    .supplierName ||
                    "PRODUCT SETUP"}
                </Text>

                <Text
                  style={s.heroTitle}
                >
                  {selected
                    .imported
                    ?.title ||
                    selected
                      .productName}
                </Text>

                <View
                  style={
                    s.heroFacts
                  }
                >
                  <Text
                    style={s.heroFact}
                  >
                    Qty{" "}
                    {selected.quantity}
                  </Text>

                  <Text
                    style={s.heroFact}
                  >
                    Cost{" "}
                    {selected.unitCost >
                    0
                      ? `$${selected.unitCost.toFixed(
                          2
                        )}`
                      : "Open"}
                  </Text>

                  <Text
                    style={s.heroFact}
                  >
                    SKU{" "}
                    {selected
                      .imported
                      ?.sku ||
                      selected
                        .supplierCode ||
                      "—"}
                  </Text>
                </View>
              </View>

              <Text
                style={
                  s.sectionLabel
                }
              >
                PRODUCT DETAILS
              </Text>

              <View
                style={s.formCard}
              >
                <Text
                  style={s.label}
                >
                  LISTING TITLE
                </Text>

                <TextInput
                  value={
                    listingTitle
                  }
                  onChangeText={
                    setListingTitle
                  }
                  placeholder="Product title"
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  style={s.input}
                />

                <View
                  style={s.row}
                >
                  <View
                    style={s.half}
                  >
                    <Text
                      style={s.label}
                    >
                      MODEL
                    </Text>

                    <TextInput
                      value={model}
                      onChangeText={
                        setModel
                      }
                      placeholder="Model"
                      placeholderTextColor="rgba(255,255,255,0.28)"
                      style={s.input}
                    />
                  </View>

                  <View
                    style={s.half}
                  >
                    <Text
                      style={s.label}
                    >
                      SKU
                    </Text>

                    <TextInput
                      value={sku}
                      onChangeText={
                        setSku
                      }
                      placeholder="SKU"
                      placeholderTextColor="rgba(255,255,255,0.28)"
                      style={s.input}
                    />
                  </View>
                </View>

                <Text
                  style={s.label}
                >
                  COLORS
                </Text>

                <TextInput
                  value={colors}
                  onChangeText={
                    setColors
                  }
                  placeholder="Black, blue, red..."
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  style={s.input}
                />

                <Text
                  style={s.label}
                >
                  SIZES / VARIANTS
                </Text>

                <TextInput
                  value={sizes}
                  onChangeText={
                    setSizes
                  }
                  placeholder="S, M, L or variants..."
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  style={s.input}
                />

                <Text
                  style={s.label}
                >
                  DESCRIPTION
                </Text>

                <TextInput
                  value={
                    description
                  }
                  onChangeText={
                    setDescription
                  }
                  placeholder="Clear customer-facing description..."
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  multiline
                  textAlignVertical="top"
                  style={[
                    s.input,
                    s.description,
                  ]}
                />
              </View>

              <Text
                style={
                  s.sectionLabel
                }
              >
                IMPORTED PHOTOS
              </Text>

              <View
                style={s.photoSection}
              >
                <Text
                  style={s.photoHelp}
                >
                  Photos saved by
                  Level 01. Tap any
                  photo to add or
                  remove it from the
                  final selection.
                </Text>

                {importedPhotos
                  .length === 0 ? (
                  <View
                    style={
                      s.photoEmpty
                    }
                  >
                    <Text
                      style={
                        s.photoEmptyText
                      }
                    >
                      No imported photos
                      saved for this
                      product.
                    </Text>
                  </View>
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={
                      false
                    }
                    contentContainerStyle={
                      s.photoRow
                    }
                  >
                    {importedPhotos.map(
                      (photo) => {
                        const active =
                          selectedSet.has(
                            photo.key
                          );

                        return (
                          <Pressable
                            key={
                              photo.key
                            }
                            onPress={() =>
                              toggleFinal(
                                photo.key
                              )
                            }
                            style={[
                              s.photoCard,
                              active &&
                                s.photoCardSelected,
                            ]}
                          >
                            <Image
                              source={{
                                uri:
                                  photo.url,
                              }}
                              style={
                                s.photo
                              }
                              resizeMode="cover"
                            />

                            <View
                              style={[
                                s.photoCheck,
                                active &&
                                  s.photoCheckActive,
                              ]}
                            >
                              <Ionicons
                                name={
                                  active
                                    ? "checkmark"
                                    : "add"
                                }
                                size={15}
                                color={
                                  active
                                    ? "#07110D"
                                    : "#FFFFFF"
                                }
                              />
                            </View>
                          </Pressable>
                        );
                      }
                    )}
                  </ScrollView>
                )}
              </View>

              <View
                style={
                  s.sectionHeadingRow
                }
              >
                <Text
                  style={[
                    s.sectionLabel,
                    {
                      marginTop: 0,
                      flex: 1,
                    },
                  ]}
                >
                  MY PHOTOS
                </Text>

                <Pressable
                  disabled={
                    uploading
                  }
                  onPress={() =>
                    void addMyPhotos()
                  }
                  style={s.addButton}
                >
                  {uploading ? (
                    <ActivityIndicator
                      size="small"
                      color={BLUE}
                    />
                  ) : (
                    <>
                      <Ionicons
                        name="add-circle-outline"
                        size={17}
                        color={BLUE}
                      />

                      <Text
                        style={
                          s.addButtonText
                        }
                      >
                        ADD MY PHOTOS
                      </Text>
                    </>
                  )}
                </Pressable>
              </View>

              <View
                style={s.photoSection}
              >
                <Text
                  style={s.photoHelp}
                >
                  Add your own product
                  photos from this
                  phone. They are saved
                  to the store's SOKO
                  storage.
                </Text>

                {myPhotos.length ===
                0 ? (
                  <View
                    style={
                      s.photoEmpty
                    }
                  >
                    <Text
                      style={
                        s.photoEmptyText
                      }
                    >
                      No Level 02 photos
                      added yet.
                    </Text>
                  </View>
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={
                      false
                    }
                    contentContainerStyle={
                      s.photoRow
                    }
                  >
                    {myPhotos.map(
                      (photo) => {
                        const active =
                          selectedSet.has(
                            photo.key
                          );

                        return (
                          <Pressable
                            key={
                              photo.key
                            }
                            onPress={() =>
                              toggleFinal(
                                photo.key
                              )
                            }
                            style={[
                              s.photoCard,
                              active &&
                                s.photoCardSelected,
                            ]}
                          >
                            <Image
                              source={{
                                uri:
                                  photo.url,
                              }}
                              style={
                                s.photo
                              }
                              resizeMode="cover"
                            />

                            <View
                              style={[
                                s.photoCheck,
                                active &&
                                  s.photoCheckActive,
                              ]}
                            >
                              <Ionicons
                                name={
                                  active
                                    ? "checkmark"
                                    : "add"
                                }
                                size={15}
                                color={
                                  active
                                    ? "#07110D"
                                    : "#FFFFFF"
                                }
                              />
                            </View>
                          </Pressable>
                        );
                      }
                    )}
                  </ScrollView>
                )}
              </View>

              <Text
                style={
                  s.sectionLabel
                }
              >
                FINAL SELECTION ·{" "}
                {finalPhotoKeys.length}/8
              </Text>

              <View
                style={s.finalCard}
              >
                <Text
                  style={s.photoHelp}
                >
                  These are the photos
                  that move forward with
                  the product. Tap a
                  selected photo to make
                  it the MAIN PHOTO.
                </Text>

                {finalPhotoKeys
                  .length === 0 ? (
                  <View
                    style={
                      s.photoEmpty
                    }
                  >
                    <Text
                      style={
                        s.photoEmptyText
                      }
                    >
                      Choose 1–8 photos
                      above.
                    </Text>
                  </View>
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={
                      false
                    }
                    contentContainerStyle={
                      s.photoRow
                    }
                  >
                    {finalPhotoKeys.map(
                      (
                        key,
                        index
                      ) => {
                        const url =
                          photoUrlByKey
                            .get(
                              key
                            ) || "";

                        const main =
                          key ===
                          mainImageKey;

                        return (
                          <View
                            key={key}
                            style={[
                              s.finalPhotoCard,
                              main &&
                                s.mainPhotoCard,
                            ]}
                          >
                            <Pressable
                              onPress={() =>
                                setMainImageKey(
                                  key
                                )
                              }
                            >
                              <Image
                                source={{
                                  uri:
                                    url,
                                }}
                                style={
                                  s.finalPhoto
                                }
                                resizeMode="cover"
                              />

                              <View
                                style={
                                  s.numberBadge
                                }
                              >
                                <Text
                                  style={
                                    s.numberText
                                  }
                                >
                                  {index +
                                    1}
                                </Text>
                              </View>

                              {main ? (
                                <View
                                  style={
                                    s.mainBadge
                                  }
                                >
                                  <Ionicons
                                    name="star"
                                    size={12}
                                    color="#171105"
                                  />

                                  <Text
                                    style={
                                      s.mainText
                                    }
                                  >
                                    MAIN
                                  </Text>
                                </View>
                              ) : null}
                            </Pressable>

                            <Pressable
                              onPress={() =>
                                toggleFinal(
                                  key
                                )
                              }
                              style={
                                s.removeButton
                              }
                            >
                              <Ionicons
                                name="close"
                                size={15}
                                color="#FF8993"
                              />

                              <Text
                                style={
                                  s.removeText
                                }
                              >
                                Remove
                              </Text>
                            </Pressable>
                          </View>
                        );
                      }
                    )}
                  </ScrollView>
                )}
              </View>

              <Text
                style={
                  s.sectionLabel
                }
              >
                SETUP NOTES
              </Text>

              <TextInput
                value={setupNotes}
                onChangeText={
                  setSetupNotes
                }
                placeholder="Anything Level 03 should know..."
                placeholderTextColor="rgba(255,255,255,0.28)"
                multiline
                textAlignVertical="top"
                style={[
                  s.input,
                  s.notes,
                ]}
              />

              <View
                style={s.actions}
              >
                <Pressable
                  disabled={
                    busy ||
                    uploading
                  }
                  onPress={() =>
                    void save(
                      "working"
                    )
                  }
                  style={
                    s.secondaryButton
                  }
                >
                  <Ionicons
                    name="save-outline"
                    size={17}
                    color={BLUE}
                  />

                  <Text
                    style={
                      s.secondaryText
                    }
                  >
                    Save Draft
                  </Text>
                </Pressable>

                <Pressable
                  disabled={
                    busy ||
                    uploading
                  }
                  onPress={() =>
                    void save(
                      "sent"
                    )
                  }
                  style={
                    s.sendButton
                  }
                >
                  {busy ? (
                    <ActivityIndicator
                      color="#171105"
                    />
                  ) : (
                    <>
                      <Text
                        style={
                          s.sendText
                        }
                      >
                        SEND LEVEL 03
                      </Text>

                      <Ionicons
                        name="arrow-forward"
                        size={18}
                        color="#171105"
                      />
                    </>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s =
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor:
        "#080D17",
    },

    center: {
      flex: 1,
      alignItems:
        "center",
      justifyContent:
        "center",
      padding: 30,
    },

    header: {
      minHeight: 74,
      paddingHorizontal:
        16,
      flexDirection:
        "row",
      alignItems:
        "center",
      borderBottomWidth:
        1,
      borderBottomColor:
        "rgba(255,255,255,0.07)",
    },

    back: {
      width: 48,
      height: 48,
      borderRadius: 19,
      alignItems:
        "center",
      justifyContent:
        "center",
      marginRight: 12,
      backgroundColor:
        "rgba(255,255,255,0.06)",
    },

    title: {
      color: "#FFFFFF",
      fontSize: 23,
      fontWeight:
        "900",
    },

    subtitle: {
      color:
        "rgba(255,255,255,0.43)",
      fontSize: 9,
      letterSpacing:
        1.7,
      marginTop: 3,
    },

    levelBadge: {
      width: 46,
      height: 46,
      borderRadius: 17,
      alignItems:
        "center",
      justifyContent:
        "center",
      borderWidth: 1,
      borderColor:
        "rgba(117,193,255,0.32)",
      backgroundColor:
        "rgba(117,193,255,0.08)",
    },

    levelText: {
      color: BLUE,
      fontSize: 15,
      fontWeight:
        "900",
    },

    content: {
      padding: 16,
      paddingBottom:
        120,
    },

    storeCard: {
      flexDirection:
        "row",
      alignItems:
        "center",
      padding: 15,
      borderRadius: 21,
      backgroundColor:
        "rgba(93,235,165,0.04)",
      borderWidth: 1,
      borderColor:
        "rgba(93,235,165,0.16)",
    },

    storeName: {
      color: "#FFFFFF",
      fontSize: 15,
      fontWeight:
        "900",
    },

    storeMeta: {
      marginTop: 3,
      color:
        "rgba(255,255,255,0.42)",
      fontSize: 10,
    },

    activeBadge: {
      borderRadius: 999,
      paddingHorizontal:
        10,
      paddingVertical: 6,
      backgroundColor:
        "rgba(93,235,165,0.11)",
    },

    activeText: {
      color: GREEN,
      fontSize: 8,
      fontWeight:
        "900",
      letterSpacing:
        1,
    },

    stats: {
      flexDirection:
        "row",
      gap: 10,
      marginTop: 14,
    },

    stat: {
      flex: 1,
      padding: 17,
      borderRadius: 19,
      backgroundColor:
        "rgba(255,255,255,0.035)",
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.07)",
    },

    statNumber: {
      color: "#FFFFFF",
      fontSize: 24,
      fontWeight:
        "900",
    },

    statLabel: {
      color:
        "rgba(255,255,255,0.40)",
      fontSize: 8,
      marginTop: 4,
      fontWeight:
        "800",
      letterSpacing:
        1,
    },

    sectionLabel: {
      color:
        "rgba(255,255,255,0.43)",
      fontSize: 9,
      fontWeight:
        "900",
      letterSpacing:
        1.5,
      marginTop: 22,
      marginBottom: 9,
    },

    sectionHeadingRow: {
      marginTop: 22,
      marginBottom: 9,
      flexDirection:
        "row",
      alignItems:
        "center",
      gap: 10,
    },

    taskCard: {
      marginBottom: 10,
      padding: 16,
      borderRadius: 21,
      borderWidth: 1,
      borderColor:
        "rgba(117,193,255,0.13)",
      backgroundColor:
        "rgba(117,193,255,0.035)",
    },

    taskTop: {
      flexDirection:
        "row",
      alignItems:
        "center",
      gap: 11,
    },

    taskIcon: {
      width: 42,
      height: 42,
      borderRadius: 15,
      alignItems:
        "center",
      justifyContent:
        "center",
      backgroundColor:
        "rgba(117,193,255,0.08)",
    },

    taskMeta: {
      color: BLUE,
      fontSize: 8,
      fontWeight:
        "900",
      letterSpacing:
        1.1,
    },

    taskName: {
      color: "#FFFFFF",
      fontSize: 15,
      lineHeight: 20,
      fontWeight:
        "800",
      marginTop: 3,
    },

    taskFacts: {
      flexDirection:
        "row",
      flexWrap: "wrap",
      gap: 7,
      marginTop: 12,
    },

    fact: {
      color:
        "rgba(255,255,255,0.55)",
      fontSize: 9,
      paddingHorizontal:
        9,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor:
        "rgba(255,255,255,0.05)",
    },

    empty: {
      padding: 30,
      borderRadius: 22,
      alignItems:
        "center",
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.07)",
      backgroundColor:
        "rgba(255,255,255,0.025)",
    },

    emptyTitle: {
      color: "#FFFFFF",
      fontSize: 16,
      fontWeight:
        "900",
      marginTop: 11,
    },

    emptyCopy: {
      color:
        "rgba(255,255,255,0.43)",
      textAlign:
        "center",
      lineHeight: 18,
      marginTop: 7,
    },

    hero: {
      padding: 18,
      borderRadius: 23,
      borderWidth: 1,
      borderColor:
        "rgba(117,193,255,0.18)",
      backgroundColor:
        "rgba(117,193,255,0.045)",
    },

    heroMeta: {
      color: BLUE,
      fontSize: 8,
      fontWeight:
        "900",
      letterSpacing:
        1.3,
    },

    heroTitle: {
      color: "#FFFFFF",
      fontSize: 19,
      lineHeight: 25,
      fontWeight:
        "900",
      marginTop: 7,
    },

    heroFacts: {
      marginTop: 13,
      flexDirection:
        "row",
      flexWrap: "wrap",
      gap: 7,
    },

    heroFact: {
      color:
        "rgba(255,255,255,0.58)",
      fontSize: 9,
      paddingHorizontal:
        9,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor:
        "rgba(255,255,255,0.055)",
    },

    formCard: {
      padding: 15,
      borderRadius: 21,
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.07)",
      backgroundColor:
        "rgba(255,255,255,0.025)",
    },

    label: {
      color:
        "rgba(255,255,255,0.40)",
      fontSize: 8,
      fontWeight:
        "900",
      letterSpacing:
        1.2,
      marginBottom: 6,
      marginTop: 12,
    },

    input: {
      minHeight: 48,
      color: "#FFFFFF",
      borderRadius: 14,
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.09)",
      backgroundColor:
        "rgba(255,255,255,0.035)",
      paddingHorizontal:
        13,
      fontSize: 13,
    },

    row: {
      flexDirection:
        "row",
      gap: 9,
    },

    half: {
      flex: 1,
    },

    description: {
      minHeight: 125,
      paddingTop: 13,
    },

    notes: {
      minHeight: 100,
      paddingTop: 13,
    },

    photoSection: {
      padding: 13,
      borderRadius: 20,
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.07)",
      backgroundColor:
        "rgba(255,255,255,0.025)",
    },

    photoHelp: {
      color:
        "rgba(255,255,255,0.45)",
      fontSize: 10,
      lineHeight: 16,
    },

    photoRow: {
      gap: 9,
      paddingTop: 12,
      paddingBottom: 2,
    },

    photoCard: {
      width: 105,
      height: 105,
      borderRadius: 17,
      overflow:
        "hidden",
      borderWidth: 2,
      borderColor:
        "rgba(255,255,255,0.08)",
    },

    photoCardSelected: {
      borderColor:
        GREEN,
    },

    photo: {
      width: "100%",
      height: "100%",
    },

    photoCheck: {
      position:
        "absolute",
      right: 7,
      top: 7,
      width: 25,
      height: 25,
      borderRadius: 999,
      alignItems:
        "center",
      justifyContent:
        "center",
      backgroundColor:
        "rgba(5,10,18,0.78)",
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.25)",
    },

    photoCheckActive: {
      backgroundColor:
        GREEN,
      borderColor:
        GREEN,
    },

    photoEmpty: {
      minHeight: 76,
      marginTop: 10,
      alignItems:
        "center",
      justifyContent:
        "center",
      borderRadius: 14,
      backgroundColor:
        "rgba(255,255,255,0.025)",
    },

    photoEmptyText: {
      color:
        "rgba(255,255,255,0.34)",
      fontSize: 10,
    },

    addButton: {
      minHeight: 38,
      paddingHorizontal:
        11,
      borderRadius: 12,
      flexDirection:
        "row",
      alignItems:
        "center",
      justifyContent:
        "center",
      gap: 6,
      borderWidth: 1,
      borderColor:
        "rgba(117,193,255,0.22)",
      backgroundColor:
        "rgba(117,193,255,0.07)",
    },

    addButtonText: {
      color: BLUE,
      fontSize: 8,
      fontWeight:
        "900",
      letterSpacing:
        0.7,
    },

    finalCard: {
      padding: 13,
      borderRadius: 20,
      borderWidth: 1,
      borderColor:
        "rgba(255,214,107,0.16)",
      backgroundColor:
        "rgba(255,214,107,0.025)",
    },

    finalPhotoCard: {
      width: 112,
      borderRadius: 18,
      overflow:
        "hidden",
      borderWidth: 2,
      borderColor:
        "rgba(255,255,255,0.08)",
      backgroundColor:
        "rgba(255,255,255,0.03)",
    },

    mainPhotoCard: {
      borderColor:
        GOLD,
    },

    finalPhoto: {
      width: "100%",
      height: 105,
    },

    numberBadge: {
      position:
        "absolute",
      left: 7,
      top: 7,
      minWidth: 24,
      height: 24,
      paddingHorizontal: 6,
      borderRadius: 999,
      alignItems:
        "center",
      justifyContent:
        "center",
      backgroundColor:
        "rgba(5,10,18,0.76)",
    },

    numberText: {
      color: "#FFFFFF",
      fontSize: 9,
      fontWeight:
        "900",
    },

    mainBadge: {
      position:
        "absolute",
      left: 7,
      bottom: 7,
      flexDirection:
        "row",
      alignItems:
        "center",
      gap: 4,
      paddingHorizontal:
        7,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor:
        GOLD,
    },

    mainText: {
      color: "#171105",
      fontSize: 7,
      fontWeight:
        "900",
      letterSpacing:
        0.6,
    },

    removeButton: {
      minHeight: 34,
      flexDirection:
        "row",
      alignItems:
        "center",
      justifyContent:
        "center",
      gap: 4,
    },

    removeText: {
      color:
        "#FF8993",
      fontSize: 8,
      fontWeight:
        "800",
    },

    actions: {
      flexDirection:
        "row",
      gap: 10,
      marginTop: 20,
    },

    secondaryButton: {
      minHeight: 52,
      paddingHorizontal:
        16,
      borderRadius: 16,
      flexDirection:
        "row",
      alignItems:
        "center",
      justifyContent:
        "center",
      gap: 7,
      borderWidth: 1,
      borderColor:
        "rgba(117,193,255,0.24)",
      backgroundColor:
        "rgba(117,193,255,0.06)",
    },

    secondaryText: {
      color: BLUE,
      fontSize: 10,
      fontWeight:
        "900",
    },

    sendButton: {
      flex: 1,
      minHeight: 52,
      paddingHorizontal:
        16,
      borderRadius: 16,
      flexDirection:
        "row",
      alignItems:
        "center",
      justifyContent:
        "center",
      gap: 7,
      backgroundColor:
        GOLD,
    },

    sendText: {
      color: "#171105",
      fontSize: 10,
      fontWeight:
        "900",
      letterSpacing:
        0.6,
    },

    error: {
      color: "#FF8993",
      textAlign:
        "center",
      lineHeight: 19,
      marginBottom: 16,
    },
  });
