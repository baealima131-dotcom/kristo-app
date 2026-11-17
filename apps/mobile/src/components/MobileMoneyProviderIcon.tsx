import React from "react";
import {View,Text,Image,type ImageSourcePropType} from "react-native";
import {Ionicons} from "@expo/vector-icons";
const images:Record<string,ImageSourcePropType>={'M-Pesa': require('../../assets/mobile-money/mpesa.png'),'M-PESA': require('../../assets/mobile-money/mpesa.png'),'Airtel Money': require('../../assets/mobile-money/airtel.png'),'T-PESA': require('../../assets/mobile-money/tpesa.png'),'AzamPesa': require('../../assets/mobile-money/azam.png'),'Orange Money': require('../../assets/mobile-money/orange.png'),'MTN MoMo': require('../../assets/mobile-money/mtn.png'),};
const badges:Record<string,{text:string;color:string}>={"Mixx by Yas":{text:"Mixx",color:"#7DCBDB"},"HaloPesa":{text:"HP",color:"#EE7333"},"Lumicash":{text:"LC",color:"#2986C9"},"EcoCash":{text:"EC",color:"#BF2942"},"T-Kash":{text:"TK",color:"#399D91"}};
export function mobileMoneyProviderName(value?:string){const text=String(value||"").trim();return text.includes(" · ")?text.split(" · ").slice(1).join(" · ").trim()||"Mobile Money":text||"Mobile Money";}
export default function MobileMoneyProviderIcon({name,size=44}:{name:string;size?:number}) {
 const label=mobileMoneyProviderName(name);const key=label.toLowerCase().replace(/[^a-z0-9]/g,'');
 const aliases:Record<string,string>={mpesa:'M-Pesa',vodacommpesa:'M-Pesa',safaricommpesa:'M-Pesa',airtel:'Airtel Money',airtelmoney:'Airtel Money',tpesa:'T-PESA',azampesa:'AzamPesa',orangemoney:'Orange Money',mtn:'MTN MoMo',mtnmomo:'MTN MoMo',mixx:'Mixx by Yas',mixxbyyas:'Mixx by Yas',tigopesa:'Mixx by Yas',halopesa:'HaloPesa',lumicash:'Lumicash',ecocash:'EcoCash',tkash:'T-Kash'};
 const canonical=aliases[key]||label;const image=images[canonical],badge=badges[canonical];
 return <View accessible={false} style={{width:size,height:size,borderRadius:Math.round(size*.27),alignItems:"center",justifyContent:"center",backgroundColor:image?"#FFFFFF":badge?"#F4F7F4":"#EAF3ED",borderWidth:1,borderColor:"#DFE6DF",overflow:"hidden"}}>{image?<Image source={image} resizeMode="contain" style={{width:size*.88,height:size*.88}}/>:badge?<Text style={{color:badge.color,fontSize:size*(badge.text.length>2?.23:.3),fontWeight:"900"}}>{badge.text}</Text>:<Ionicons name="wallet-outline" size={size*.45} color="#176844"/>}</View>;
}
