import React from "react";
import { View, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

const gems = [
  {left:-35,top:0.08,size:110,turn:"-19deg",opacity:0.20},
  {left:0.76,top:0.02,size:96,turn:"16deg",opacity:0.22},
  {left:0.87,top:0.31,size:122,turn:"29deg",opacity:0.18},
  {left:-48,top:0.47,size:135,turn:"-12deg",opacity:0.17},
  {left:0.82,top:0.76,size:104,turn:"22deg",opacity:0.19},
  {left:0.09,top:0.87,size:64,turn:"-27deg",opacity:0.17},
] as const;
export default function MyWayDiamondBackground() {
  const [size,setSize]=React.useState({width:390,height:800});
  return <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={s.background}
    onLayout={e=>setSize(e.nativeEvent.layout)}>
    {gems.map((gem,i)=><View key={i} style={{position:"absolute",left:gem.left<0?gem.left:size.width*gem.left,top:size.height*gem.top,width:gem.size,height:gem.size*1.5,opacity:gem.opacity,transform:[{rotate:gem.turn}]}}>
      <View style={[s.crystal,{width:gem.size,height:gem.size,transform:[{rotate:"45deg"},{scaleX:0.64}]}]}>
        <LinearGradient colors={["#F1FCFF99","#79D9FF40","#072C6970"]} start={{x:0,y:0}} end={{x:1,y:1}} style={StyleSheet.absoluteFillObject}/>
        <LinearGradient colors={["#FFFFFFAA","#6ED4FF08"]} style={{position:"absolute",left:0,top:0,width:"50%",height:"100%"}}/>
        <LinearGradient colors={["#BDEEFF10","#FFFFFF70"]} start={{x:0,y:0}} end={{x:1,y:1}} style={{position:"absolute",right:0,bottom:0,width:"50%",height:"50%"}}/>
        <View style={s.vertical}/><View style={s.horizontal}/>
        <View style={s.diagonal}/>
      </View>
      <View style={{position:"absolute",left:gem.size/2-1,top:gem.size*0.07,width:1,height:14,backgroundColor:"#ECFBFF"}}/>
      <View style={{position:"absolute",left:gem.size/2-7,top:gem.size*0.07+6,width:13,height:1,backgroundColor:"#ECFBFF"}}/>
    </View>)}
    <LinearGradient colors={["#08275105","#041D4935","#020C2540"]} style={StyleSheet.absoluteFillObject}/>
  </View>;
}
const s=StyleSheet.create({
 background:{...StyleSheet.absoluteFillObject,overflow:"hidden"},
 crystal:{overflow:"hidden",borderWidth:0.7,borderColor:"#C6EFFF",backgroundColor:"#2979AE18",shadowColor:"#71D8FF",shadowOpacity:0.5,shadowRadius:20,shadowOffset:{width:0,height:0}},
 vertical:{position:"absolute",left:"50%",top:0,bottom:0,width:0.6,backgroundColor:"#DDF8FF99"},
 horizontal:{position:"absolute",top:"50%",left:0,right:0,height:0.6,backgroundColor:"#DDF8FF70"},
 diagonal:{position:"absolute",left:"50%",top:"-20%",width:0.6,height:"140%",backgroundColor:"#E4FAFF80",transform:[{rotate:"45deg"}]}
});
