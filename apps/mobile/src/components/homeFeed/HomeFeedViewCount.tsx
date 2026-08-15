import React, { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { formatActionCount } from "./homeFeedUtils";

type Props = {
  count: number;
};

export const HomeFeedViewCount = memo(
  function HomeFeedViewCount({ count }: Props) {
    return (
      <View
        pointerEvents="none"
        style={styles.wrap}
        accessibilityLabel={`${formatActionCount(count)} views`}
      >
        <View style={styles.planetWrap}>
          <View style={styles.outerGlow} />
          <View style={styles.ringBack} />

          <View style={styles.dustOne} />
          <View style={styles.dustTwo} />
          <View style={styles.dustThree} />
          <View style={styles.dustFour} />

          <View style={styles.planet}>
            <Ionicons
              name="people"
              size={22}
              color="#FF4968"
            />
          </View>

          <View style={styles.ringFront} />

          <View style={styles.countBadge}>
            <Text style={styles.count}>
              {formatActionCount(count)}
            </Text>
          </View>
        </View>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: "20%",
    height: 45,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  planetWrap: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  outerGlow: {
    position: "absolute",
    width: 39,
    height: 39,
    borderRadius: 20,
    backgroundColor: "rgba(255,54,91,0.16)",
    shadowColor: "#FF365B",
    shadowOpacity: 0.9,
    shadowRadius: 10,
    shadowOffset: {
      width: 0,
      height: 0,
    },
    elevation: 8,
  },
  ringBack: {
    position: "absolute",
    width: 52,
    height: 17,
    borderRadius: 26,
    borderWidth: 1.4,
    borderColor: "rgba(255,88,113,0.76)",
    backgroundColor: "transparent",
    transform: [
      {
        rotate: "-14deg",
      },
    ],
    shadowColor: "#FF4968",
    shadowOpacity: 0.65,
    shadowRadius: 4,
    shadowOffset: {
      width: 0,
      height: 0,
    },
    zIndex: 1,
  },
  ringFront: {
    position: "absolute",
    width: 52,
    height: 17,
    borderRadius: 26,
    borderBottomWidth: 1.8,
    borderBottomColor: "#FF5872",
    backgroundColor: "transparent",
    transform: [
      {
        rotate: "-14deg",
      },
    ],
    shadowColor: "#FF365B",
    shadowOpacity: 0.95,
    shadowRadius: 5,
    shadowOffset: {
      width: 0,
      height: 0,
    },
    zIndex: 5,
  },
  planet: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(19,8,15,0.96)",
    borderWidth: 1,
    borderColor: "rgba(255,83,108,0.74)",
    shadowColor: "#FF365B",
    shadowOpacity: 0.82,
    shadowRadius: 8,
    shadowOffset: {
      width: 0,
      height: 0,
    },
    elevation: 9,
    zIndex: 3,
  },
  countBadge: {
    position: "absolute",
    right: -7,
    bottom: -2,
    minWidth: 20,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFD76E",
    borderWidth: 1,
    borderColor: "#2B1016",
    shadowColor: "#FFD76E",
    shadowOpacity: 0.95,
    shadowRadius: 5,
    shadowOffset: {
      width: 0,
      height: 0,
    },
    elevation: 12,
    zIndex: 8,
  },
  count: {
    color: "#231016",
    fontSize: 11,
    lineHeight: 13,
    fontWeight: "900",
    letterSpacing: 0.05,
    textAlign: "center",
  },
  dustOne: {
    position: "absolute",
    left: -5,
    top: 14,
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#FF4968",
    shadowColor: "#FF4968",
    shadowOpacity: 1,
    shadowRadius: 4,
    zIndex: 4,
  },
  dustTwo: {
    position: "absolute",
    right: -6,
    bottom: 13,
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#FFD76E",
    shadowColor: "#FFD76E",
    shadowOpacity: 1,
    shadowRadius: 4,
    zIndex: 4,
  },
  dustThree: {
    position: "absolute",
    right: 1,
    top: 10,
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: "#FF8A9D",
    shadowColor: "#FF4968",
    shadowOpacity: 1,
    shadowRadius: 3,
    zIndex: 4,
  },
  dustFour: {
    position: "absolute",
    left: 2,
    bottom: 9,
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: "#FFD76E",
    shadowColor: "#FFD76E",
    shadowOpacity: 1,
    shadowRadius: 3,
    zIndex: 4,
  },
});
