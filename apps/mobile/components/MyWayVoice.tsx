import React from "react";
import {
  Pressable,
  StyleSheet, Text, View
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import BibleScreen from "../app/(tabs)/more/bible";
import { useMyWayConversation } from "./useMyWayConversation";
import MyWayOrb from "./MyWayOrb";

export default function MyWayVoice() {
  const {
    active, busy, recording, phase, message, shownBible, toggle, audioLevel
  } = useMyWayConversation();

  return <View style={s.box}>

    {shownBible ? (
      <View style={{
        width:"100%", minHeight:330, borderRadius:22,
        overflow:"hidden", marginBottom:22
      }}>
        <BibleScreen/>
      </View>
    ) : (
    <MyWayOrb phase={phase} audioLevel={audioLevel}/>
    )}

    {active && <Text style={s.copy}>
      {recording ? "Ninakusikiliza…" :
        phase === "processing" ? "Ninachakata…" : "Ninaandaa microphone…"}
    </Text>}

    <View style={s.controls}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={active ? "Kata mazungumzo" : "Anza mazungumzo na MY WAY"}
        disabled={!active && busy}
        onPress={toggle}
        style={[s.mic, !active && busy && {opacity: 0.45}]}
      >
        <LinearGradient
          colors={active
            ? ["#FF8585", "#E53935", "#A81020"]
            : ["#FFF2BE", "#EAC365", "#BC842B"]}
          start={{x:0.15,y:0}}
          end={{x:0.85,y:1}}
          style={{
            width:72, height:72, borderRadius:36,
            alignItems:"center", justifyContent:"center",
            borderWidth:1,
            borderColor:active ? "#FFBABA" : "#FFF0B5"
          }}
        >
          <Ionicons
            name="call"
            size={30}
            color={active ? "#FFFFFF" : "#50340E"}
            style={{transform:[{rotate:active ? "135deg" : "0deg"}]}}
          />
        </LinearGradient>
      </Pressable>
    </View>

    {!!message && <Text accessibilityRole="alert" style={s.notice}>{message}</Text>}
  </View>;
}
const s=StyleSheet.create({
 cross:{position:"absolute",left:65,top:49,width:72,height:105,shadowColor:"#FFFFFF",shadowOpacity:0.95,shadowRadius:17,shadowOffset:{width:0,height:0}},
 crossVertical:{position:"absolute",top:0,left:31,width:10,height:105,borderRadius:3,backgroundColor:"#F4FDFF"},
 crossHorizontal:{position:"absolute",top:28,left:0,width:72,height:10,borderRadius:3,backgroundColor:"#F4FDFF"},
 verse:{alignItems:"center",paddingHorizontal:12,maxWidth:330,marginBottom:4},
 verseText:{color:"#E2F6FF",fontSize:18,lineHeight:27,fontWeight:"700",textAlign:"center"},
 verseReference:{color:"#9ACCF1",fontSize:10,fontWeight:"800",letterSpacing:2,marginTop:10},
 box:{flex:1,alignItems:"center",justifyContent:"center",paddingHorizontal:20,paddingTop:16,paddingBottom:136},
 orbit:{width:310,height:330,alignItems:"center",justifyContent:"center",marginBottom:22},
 floating:{width:310,height:310,alignItems:"center",justifyContent:"center"},
 glowField:{position:"absolute",width:310,height:310,alignItems:"center",justifyContent:"center"},
 shine:{position:"absolute",top:-40,left:40,width:95,height:300},
 orb:{width:202,height:202,borderRadius:101,overflow:"hidden",borderWidth:0},
 sheen:{position:"absolute",width:180,height:140,top:-28,left:-24,borderRadius:90,transform:[{rotate:"-30deg"}]},
 title:{color:"#EFFAFF",fontSize:26,fontWeight:"900",letterSpacing:0.3,textAlign:"center"},copy:{color:"#A6D2FF",fontSize:13,fontWeight:"700",marginTop:10,textAlign:"center"},
 controls:{flexDirection:"row",gap:24,alignItems:"center",justifyContent:"center",marginTop:28},mic:{width:72,height:72,borderRadius:36,backgroundColor:"#EAC365",alignItems:"center",justifyContent:"center",shadowColor:"#A66D13",shadowOpacity:0.45,shadowRadius:16,shadowOffset:{width:0,height:6},elevation:7},small:{width:48,height:48,borderRadius:24,backgroundColor:"#0C3870",alignItems:"center",justifyContent:"center"},
 notice:{color:"#AFCBE9",fontSize:12,lineHeight:18,textAlign:"center",marginTop:16,maxWidth:310},note:{color:"#729AC7",fontSize:11,textAlign:"center",marginTop:20}
});
