import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo, Animated, Easing, StyleSheet, View
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

type Props = {
  phase: string;
  audioLevel: number;
};

export default function MyWayOrb({ phase, audioLevel }: Props) {
  const listening = phase === "listening";
  const processing = phase === "processing";
  const preparing = phase === "starting" || phase === "stopping";
  const working = processing || preparing;

  const [reduceMotion, setReduceMotion] = useState(true);
  const strength = useRef(new Animated.Value(0)).current;
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(value => { if (alive) setReduceMotion(value); })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged", setReduceMotion
    );
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const animation = Animated.timing(strength, {
      toValue: listening ? audioLevel : 0,
      duration: reduceMotion ? 0 : 140,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [audioLevel, listening, reduceMotion, strength]);

  useEffect(() => {
    rotation.setValue(0);
    if (!working || reduceMotion) return;
    const animation = Animated.loop(Animated.timing(rotation, {
      toValue: 1,
      duration: 1800,
      easing: Easing.linear,
      useNativeDriver: true,
    }));
    animation.start();
    return () => animation.stop();
  }, [working, reduceMotion, rotation]);

  const accent = processing ? "#D5B8FF"
    : preparing ? "#FFE6A5" : "#B7FAFF";

  const label = listening ? "MY WAY inakusikiliza"
    : processing ? "MY WAY inachakata ombi"
    : preparing ? "MY WAY inaandaa mazungumzo"
    : "MY WAY iko tayari";

  const icon: React.ComponentProps<typeof Ionicons>["name"] =
    listening ? "mic" : processing ? "ellipsis-horizontal"
    : preparing ? "time-outline" : "mic-outline";

  return (
    <View accessible accessibilityLabel={label} style={s.stage}>
      <View style={s.shadow}/>
      <Animated.View pointerEvents="none" style={[
        s.halo,
        {
          backgroundColor: accent,
          opacity: strength.interpolate({
            inputRange: [0, 1], outputRange: [0.08, 0.27],
          }),
          transform: [{
            scale: reduceMotion ? 1 : strength.interpolate({
              inputRange: [0, 1], outputRange: [1, 1.12],
            }),
          }],
        },
      ]}/>
      <Animated.View pointerEvents="none" style={[
        s.outerRing,
        {
          borderColor: accent,
          opacity: listening ? 0.75 : 0.25,
          transform: [{
            scale: reduceMotion ? 1 : strength.interpolate({
              inputRange: [0, 1], outputRange: [1, 1.13],
            }),
          }],
        },
      ]}/>
      {working && (
        <Animated.View pointerEvents="none" style={[
          s.spinner,
          {
            borderTopColor: accent,
            borderRightColor: accent,
            transform: [{
              rotate: rotation.interpolate({
                inputRange: [0, 1], outputRange: ["0deg", "360deg"],
              }),
            }],
          },
        ]}/>
      )}
      <Animated.View pointerEvents="none" style={[
        s.sphere,
        {
          shadowColor: accent,
          transform: [{
            scale: reduceMotion ? 1 : strength.interpolate({
              inputRange: [0, 1], outputRange: [1, 1.08],
            }),
          }],
        },
      ]}>
        <LinearGradient
          colors={processing
            ? ["#FFFFFF", "#E7DBFF", "#AB89F0", "#6557CB"]
            : ["#FFFFFF", "#DCF9FF", "#8EE6FF", "#37ADEE"]}
          start={{x:0.2,y:0}}
          end={{x:0.85,y:1}}
          style={s.fill}
        >
          <LinearGradient
            colors={["#FFFFFF90", "#FFFFFF00"]}
            style={s.highlight}
          />
        </LinearGradient>
      </Animated.View>
      <View pointerEvents="none" style={[
        s.badge, {borderColor: accent}
      ]}>
        <Ionicons name={icon} size={19} color={accent}/>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  stage: {
    width:310, height:330, marginBottom:22,
    alignItems:"center", justifyContent:"center",
  },
  shadow: {
    position:"absolute", bottom:12, width:145, height:20,
    borderRadius:75, backgroundColor:"rgba(0,25,65,0.12)",
  },
  halo: {position:"absolute", width:286, height:286, borderRadius:143},
  outerRing: {
    position:"absolute", width:244, height:244,
    borderRadius:122, borderWidth:1.5,
  },
  spinner: {
    position:"absolute", width:266, height:266, borderRadius:133,
    borderWidth:3, borderColor:"transparent",
  },
  sphere: {
    width:202, height:202, borderRadius:101,
    shadowOpacity:0.95, shadowRadius:28,
    shadowOffset:{width:0,height:0},
  },
  fill: {flex:1, borderRadius:101, overflow:"hidden"},
  highlight: {
    position:"absolute", top:12, left:26, width:136, height:65,
    borderRadius:70, transform:[{rotate:"-25deg"}],
  },
  badge: {
    position:"absolute", bottom:23, width:36, height:36,
    borderRadius:18, borderWidth:1,
    backgroundColor:"#103C68",
    alignItems:"center", justifyContent:"center",
  },
});
