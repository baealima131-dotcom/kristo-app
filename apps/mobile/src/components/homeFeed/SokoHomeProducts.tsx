import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import { ActivityIndicator, Alert, AppState, Image, Linking, Modal, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useStripe } from "@stripe/stripe-react-native";
import { getSessionSync, loadSession } from "@/src/lib/kristoSession";
import { sokoCheckoutJson } from "@/src/lib/sokoCheckoutApi";
import SokoBuyerSellerChat from "@/src/components/homeFeed/SokoBuyerSellerChat";
import { recognizeText } from "@infinitered/react-native-mlkit-text-recognition";
import {
  STRIPE_URL_SCHEME,
  expoStripeModeMatchesLivemode,
  isExpoStripePublishableConfigured,
  stripeCardCheckoutConfigMessage,
} from "@/src/lib/payments/stripeConfig";

export type SokoHomeProduct={id:string;title:string;price:number;currency:string;quantity?:number;stockTotal?:number;stockAvailable?:number;soldOut?:boolean;image:string;photos:string[];description:string;location:string;condition:string;paymentOptions?:{methods?:("cash"|"cash_app"|"mobile_money")[];cashTag?:string;mobileNetwork?:string;mobileNumber?:string;recipientName?:string;stripeCardAvailable?:boolean};fulfillmentOptions?:{type?:"pickup"|"local_delivery"|"parcel"|"freight";flatFee?:number;estimatedDays?:number};seller:{id?:string;kristoId?:string;name:string;verified?:boolean;church?:string;avatarUrl?:string;shopName?:string;shopCategory?:string;shopLocation?:string;churchId?:string;churchName?:string;churchAvatarUrl?:string};_homeFeedKind?:"soko-product";sokoProductId?:string};
const SAVE_KEY="@kristo/soko-home-saved-v1";
const PRODUCT_CACHE_KEY="@kristo/soko-home-products-v1";

const DELIVERY_DETAILS_KEY=
  "@kristo/soko-delivery-details-v1";
const base=String(process.env.EXPO_PUBLIC_API_BASE||"https://kristo-app.vercel.app").trim().replace(/\/+$/,"");
const absolute=(value:string)=>value.startsWith("/")?base+value:value;
function SokoProductPhoto({uri,style,resizeMode="cover"}:{uri?:string;style?:any;resizeMode?:"cover"|"contain"}){
  const src=String(uri||"").trim();
  const [failed,setFailed]=useState(false);
  useEffect(()=>{setFailed(false);},[src]);
  if(!src||failed){
    return (
      <View style={[styles.photoPlaceholder,style]}>
        <Ionicons name="image-outline" size={36} color="#90A098"/>
        <Text style={styles.photoPlaceholderText}>Photo unavailable</Text>
      </View>
    );
  }
  return <Image source={{uri:src}} style={style} resizeMode={resizeMode} onError={()=>setFailed(true)}/>;
}
const formatMoneyAmount=(currency:string,amount:unknown)=>{
  const value=typeof amount==="string"?Number(String(amount).trim()):Number(amount);
  if(!Number.isFinite(value))return "—";
  const code=String(currency||"").trim();
  const formatted=value.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
  return code?code+" "+formatted:formatted;
};
const money=(p:SokoHomeProduct)=>formatMoneyAmount(p.currency,p.price);
const deliveryMoney=(currency:string,amount:unknown,fallbackCurrency:string)=>formatMoneyAmount(currency||fallbackCurrency,amount);
const conciseDeliveryEstimate=(rate:any)=>{
  const days=Number(rate?.estimatedDays);
  if(Number.isFinite(days)&&days>0)return days===1?"1 business day":days+" business days";
  return String(rate?.durationTerms||"").trim();
};
const pickCheapestDeliveryRate=(rates:any[])=>{
  const priced=rates.filter(item=>Number.isFinite(Number(item?.amount))&&Number(item.amount)>=0);
  if(!priced.length)return rates[0]||null;
  return priced.reduce((best,item)=>Number(item.amount)<Number(best.amount)?item:best);
};
const moneyCents=(value:unknown)=>Math.round(Number(value)*100);
const checkoutClientKey=(productId:string,rateId:string,postalCode:string,attemptId:string,paymentMethod?:string)=>{
  const product=String(productId||"").replace(/[^A-Za-z0-9_-]/g,"").slice(0,40);
  const rate=String(rateId||"").replace(/[^A-Za-z0-9_-]/g,"").slice(0,40);
  const zip=String(postalCode||"").replace(/[^A-Za-z0-9_-]/g,"").slice(0,12);
  const attempt=String(attemptId||"").replace(/[^A-Za-z0-9_-]/g,"").slice(0,16);
  const prefix=paymentMethod==="stripe_card"?"stripecard-":"cashapp-";
  return (prefix+product+"-"+rate+"-"+zip+"-"+attempt).slice(0,120);
};
const newCheckoutAttemptId=()=>("a"+Math.random().toString(36).slice(2,10)+Math.random().toString(36).slice(2,6)).replace(/[^A-Za-z0-9]/g,"").slice(0,16);
const isSafeCashAppLaunchUrl=(raw:string)=>{
  try{
    const url=new URL(String(raw||"").trim());
    if(url.protocol!=="https:")return false;
    if(url.username||url.password)return false;
    const host=url.hostname.toLowerCase();
    return host==="cash.app"||host.endsWith(".cash.app");
  }catch{
    return false;
  }
};
const isCashAppCashtagPrefillPath=(raw:string)=>{
  try{
    const url=new URL(String(raw||"").trim());
    return /^\/\$[A-Za-z0-9]+\/\d+(?:\.\d+)?$/.test(url.pathname);
  }catch{
    return false;
  }
};
const checkoutPaymentErrorCopy=(message:string,code?:string)=>{
  const blob=((code||"")+" "+message).toLowerCase();
  if(blob.includes("sold")||blob.includes("unavailable")||blob.includes("stock")){
    return "This product is no longer available.";
  }
  if(
    blob.includes("cash app tag is unavailable")||
    blob.includes("seller_not_connected")||
    blob.includes("not set up")||
    blob.includes("payment_account_mismatch")||
    blob.includes("payment account")
  ){
    return "Seller Cash App is not set up yet. Payment cannot start.";
  }
  if(
    blob.includes("rate could not be verified")||
    blob.includes("invalid rate")||
    blob.includes("choose a verified")||
    blob.includes("expired")
  ){
    return "The selected shipping quote expired. Recalculate delivery, then continue.";
  }
  if(blob.includes("price")&&blob.includes("chang")){
    return "The product price changed. Review the updated amount before continuing.";
  }
  if(blob.includes("did not respond")||blob.includes("network")||blob.includes("failed to fetch")||blob.includes("abort")){
    return "Network error. Your address and shipping selection were kept. Try again.";
  }
  if(
    blob.includes("not available yet")||
    blob.includes("partner_not_active")||
    blob.includes("could not be prepared")||
    blob.includes("authorization url")||
    blob.includes("session")
  ){
    return "Cash App checkout is not available yet.";
  }
  if(blob.includes("card checkout is not configured")||blob.includes("test/live")||blob.includes("stripe")&&blob.includes("configured")){
    return "Card checkout is not configured yet.";
  }
  if(blob.includes("only available for this seller")||blob.includes("stripe_seller_not_allowed")){
    return "Card checkout is only available for this seller.";
  }
  return message||"Payment could not start.";
};
const orderLooksPaid=(status:string)=>{
  return ["payment_approved","preparing_shipment","shipped","delivered"].includes(String(status||""));
};
const orderLooksFailed=(status:string)=>{
  return ["cancelled","payment_rejected"].includes(String(status||""));
};

export function isSokoHomeProductRow(value:any):value is SokoHomeProduct{return value?._homeFeedKind==="soko-product";}
export function distributeSokoProducts(rows:any[],products:SokoHomeProduct[]){
  if(!products.length)return rows;
  if(!rows.length)return products.map(product=>({...product,id:"soko:"+product.id,sokoProductId:product.id,_homeFeedKind:"soko-product" as const}));
  const output:any[]=[];let productIndex=0;
  for(let index=0;index<rows.length;index+=1){
    output.push(rows[index]);
    if((index===1||(index>1&&(index-1)%5===0))&&productIndex<products.length){const product=products[productIndex++];output.push({...product,id:"soko:"+product.id,sokoProductId:product.id,_homeFeedKind:"soko-product" as const});}
  }
  return output;
}

export default function SokoHomeProducts({focused,onProductsChange}:{focused:boolean;onProductsChange:(products:SokoHomeProduct[])=>void}){
  useEffect(()=>{
    if(!focused)return;

    let alive=true;
    let running=false;
    let controller:AbortController|null=null;

    const normalize=(rows:SokoHomeProduct[])=>rows.map(
      (product:SokoHomeProduct)=>({
        ...product,
        image:absolute(String(product.image||"")),
        photos:Array.isArray(product.photos)
          ? product.photos
              .map(value=>absolute(String(value||"")))
              .filter(Boolean)
          : []
      })
    );

    async function hydrateCache(){
      try{
        const stored=await AsyncStorage.getItem(PRODUCT_CACHE_KEY);
        if(!alive||!stored)return;

        const parsed=JSON.parse(stored);
        if(!Array.isArray(parsed)||!parsed.length)return;

        onProductsChange(normalize(parsed));
      }catch{
        // A damaged cache must never remove visible SOKO products.
      }
    }

    async function load(){
      if(
        !alive||
        running||
        AppState.currentState!=="active"
      )return;

      running=true;
      controller=new AbortController();

      const requestTimer=setTimeout(
        ()=>controller?.abort(),
        15000
      );

      try{
        const response=await fetch(
          base+"/api/soko/products",
          {
            signal:controller.signal
          }
        );

        const data=await response.json();

        if(
          !response.ok||
          !data?.ok||
          !Array.isArray(data.products)
        ){
          throw new Error("SOKO products unavailable");
        }

        if(!alive)return;

        const normalized=normalize(data.products);

        /*
         * Only a successful authoritative response can replace
         * the currently visible SOKO listings.
         */
        onProductsChange(normalized);

        await AsyncStorage.setItem(
          PRODUCT_CACHE_KEY,
          JSON.stringify(normalized)
        ).catch(()=>{});
      }catch{
        /*
         * Keep the last successful products on screen during
         * timeout, offline mode, tab transitions or server errors.
         */
      }finally{
        clearTimeout(requestTimer);
        running=false;
      }
    }

    void hydrateCache().finally(()=>{
      if(alive)void load();
    });

    /*
     * Inventory visibility is time-sensitive. Refresh quickly
     * so sold-out listings disappear across buyer devices.
     */
    const refreshTimer=setInterval(
      ()=>{void load();},
      4000
    );

    const subscription=AppState.addEventListener(
      "change",
      state=>{
        if(state==="active"){
          void load();
        }else{
          controller?.abort();
        }
      }
    );

    return()=>{
      alive=false;
      clearInterval(refreshTimer);
      subscription.remove();
      controller?.abort();
    };
  },[focused,onProductsChange]);

  return null;
}

export function SokoHomeProductCard({product,height}:{product:SokoHomeProduct;height?:number}){
  const router=useRouter();const {initPaymentSheet,presentPaymentSheet}=useStripe();const {width}=useWindowDimensions();const insets=useSafeAreaInsets();const cardWidth=Math.max(280,width-10);const imageHeight=Math.min(300,Math.round(cardWidth*0.54));const detailHeroHeight=Math.min(390,Math.max(320,Math.round(width*0.86)));
  const [selected,setSelected]=useState(false),[saved,setSaved]=useState(false),[contacting,setContacting]=useState(false),[paymentOpen,setPaymentOpen]=useState(false),[paymentBusy,setPaymentBusy]=useState(false),[order,setOrder]=useState<any>(null),[proofImages,setProofImages]=useState<Array<{uri:string;mimeType:string;fileName:string}>>([]),[reference,setReference]=useState(""),[buyerNote,setBuyerNote]=useState(""),[paymentSent,setPaymentSent]=useState(false),[storeOpen,setStoreOpen]=useState(false),[storeLoading,setStoreLoading]=useState(false),[storeProducts,setStoreProducts]=useState<SokoHomeProduct[]>([]),[storeError,setStoreError]=useState(""),[checkoutOpen,setCheckoutOpen]=useState(false),[delivery,setDelivery]=useState({fullName:"",phone:"",country:"United States",state:"",city:"",streetAddress:"",postalCode:"",instructions:""}),[deliveryRates,setDeliveryRates]=useState<any[]>([]),[selectedDelivery,setSelectedDelivery]=useState<any>(null),[deliveryMode,setDeliveryMode]=useState(""),[deliveryReason,setDeliveryReason]=useState(""),[deliveryLoading,setDeliveryLoading]=useState(false),[deliveryError,setDeliveryError]=useState(""),[deliveryNotice,setDeliveryNotice]=useState(""),[buyerOrdersOpen,setBuyerOrdersOpen]=useState(false),[buyerOrdersLoading,setBuyerOrdersLoading]=useState(false),[buyerOrdersBusy,setBuyerOrdersBusy]=useState(""),[buyerOrders,setBuyerOrders]=useState<any[]>([]),[buyerOrdersError,setBuyerOrdersError]=useState("");const [receiptScan,setReceiptScan]=useState<{recipient:string;cashTag:string;amounts:string[];status:string;dateTime:string;fees:string;scannedCount:number;}>({recipient:"",cashTag:"",amounts:[],status:"",dateTime:"",fees:"",scannedCount:0});;const [cashConfirmation,setCashConfirmation]=useState<null|{
    sellerName:string;
    cashTag:string;
    amountText:string;
    orderReference:string;
    url:string;
  }>(null);const realId=String(product.sokoProductId||product.id).replace(/^soko:/,"");const initial=product.seller.name.trim().charAt(0).toUpperCase()||"S";const sellerAvatarUri=String(product.seller.avatarUrl||"").trim();const paymentMethods=Array.isArray(product.paymentOptions?.methods)?product.paymentOptions!.methods!:[];const stripeCardAvailable=product.paymentOptions?.stripeCardAvailable===true;const stockAvailable=Number.isFinite(Number(product.stockAvailable))?Math.max(0,Number(product.stockAvailable)):1;const soldOut=product.soldOut===true||stockAvailable<=0;
  const [avatarFailed,setAvatarFailed]=useState(false);
  const [galleryPage,setGalleryPage]=useState(0);
  const [descriptionOpen,setDescriptionOpen]=useState(false);
  const [sellerInfoOpen,setSellerInfoOpen]=useState(false);
  const [checkoutPaymentError,setCheckoutPaymentError]=useState("");
  const [checkoutPaymentNotice,setCheckoutPaymentNotice]=useState("");
  const [checkoutPaymentPhase,setCheckoutPaymentPhase]=useState<"idle"|"preparing"|"awaiting"|"confirming"|"paid"|"failed">("idle");
  const [checkoutBusyStage,setCheckoutBusyStage]=useState<""|"verifying_delivery"|"creating_order"|"opening_card">("");
  const [confirmedTotals,setConfirmedTotals]=useState<null|{itemPrice:number;deliveryPrice:number;finalTotal:number;currency:string}>(null);
  const [checkoutPaymentMethod,setCheckoutPaymentMethod]=useState<"stripe_card"|"cash_app">("cash_app");
  const [sokoChatOpen,setSokoChatOpen]=useState(false);
  const checkoutOpenRef=useRef(false);
  const refreshCheckoutPaymentStatusRef=useRef<()=>Promise<void>>(async()=>{});
  const beginCheckoutCashAppPaymentRef=useRef<()=>Promise<void>>(async()=>{});
  const beginCheckoutStripeCardPaymentRef=useRef<()=>Promise<void>>(async()=>{});
  const checkoutAttemptIdRef=useRef(newCheckoutAttemptId());
  const checkoutPollTicksRef=useRef(0);
  useEffect(()=>{setAvatarFailed(false);},[sellerAvatarUri]);
  useEffect(()=>{
    if(!selected)return;
    setGalleryPage(0);
    setDescriptionOpen(false);
    setSellerInfoOpen(false);
  },[selected,realId]);
  useEffect(()=>{AsyncStorage.getItem(SAVE_KEY).then(value=>{const parsed=value?JSON.parse(value):[];setSaved(Array.isArray(parsed)&&parsed.includes(realId));}).catch(()=>setSaved(false));},[realId]);
  useEffect(()=>{checkoutOpenRef.current=checkoutOpen;},[checkoutOpen]);
  useEffect(()=>{
    setCheckoutPaymentError("");
    setCheckoutPaymentNotice("");
    setCheckoutPaymentPhase("idle");
    setConfirmedTotals(null);
  },[selectedDelivery?.id]);
  useEffect(()=>{
    if(!checkoutOpen||(checkoutPaymentPhase!=="awaiting"&&checkoutPaymentPhase!=="confirming")){
      checkoutPollTicksRef.current=0;
      return;
    }
    const maxTicks=30;
    const tick=()=>{
      if(checkoutPollTicksRef.current>=maxTicks)return;
      checkoutPollTicksRef.current+=1;
      void refreshCheckoutPaymentStatusRef.current();
    };
    tick();
    const interval=setInterval(()=>{
      if(checkoutPollTicksRef.current>=maxTicks){
        clearInterval(interval);
        return;
      }
      tick();
    },8000);
    const sub=AppState.addEventListener("change",(state)=>{
      if(state==="active"&&checkoutPollTicksRef.current<maxTicks)tick();
    });
    return ()=>{
      clearInterval(interval);
      sub.remove();
    };
  },[checkoutOpen,checkoutPaymentPhase,order?.id]);
  const toggleSaved=async()=>{const value=await AsyncStorage.getItem(SAVE_KEY).catch(()=>null);const parsed=value?JSON.parse(value):[];const ids:string[]=Array.isArray(parsed)?parsed.filter(item=>typeof item==="string"):[];const next=ids.includes(realId)?ids.filter(id=>id!==realId):[realId,...ids];setSaved(next.includes(realId));await AsyncStorage.setItem(SAVE_KEY,JSON.stringify(next)).catch(()=>{});};
  const share=async()=>{await Share.share({message:product.title+" · "+money(product)+" · "+product.location+" — SOKO on Kristo App"}).catch(()=>{});};
  const openSokoProductConversation=()=>{
    if(!String(realId||"").trim()){
      Alert.alert("Contact Seller","This listing is not available for messaging yet.");
      return;
    }
    setCheckoutOpen(false);
    setSokoChatOpen(true);
  };
  const contactSeller=async()=>{
    openSokoProductConversation();
  };
  const viewSellerProfile=()=>{
    const userId=String(product.seller.id||"").trim();
    if(!userId){
      Alert.alert("Seller Profile","Seller profile bado haijapatikana.");
      return;
    }
    setSelected(false);
    router.push({
      pathname:"/member-more-about/[userId]",
      params:{userId}
    } as any);
  };
  const viewSellerChurch=()=>{
    const churchId=String(product.seller.churchId||"").trim();
    if(!churchId){
      Alert.alert("Seller Church","Seller hajaonyesha kanisa lake kwenye public profile.");
      return;
    }
    setSelected(false);
    router.push({
      pathname:"/church-profile/[churchId]",
      params:{
        churchId,
        churchName:String(product.seller.churchName||"Church")
      }
    } as any);
  };
  const apiJson=async(path:string,init:RequestInit)=>sokoCheckoutJson(path,init);
  const visitSellerStore=async()=>{
    const sellerId=String(product.seller.id||"").trim();
    if(!sellerId){
      Alert.alert("Seller Store","Seller store haijapatikana.");
      return;
    }
    setSelected(false);
    setStoreLoading(true);
    setStoreError("");
    setStoreProducts([]);
    await new Promise(resolve=>setTimeout(resolve,320));
    setStoreOpen(true);
    try{
      const collected:SokoHomeProduct[]=[];
      let before="";
      for(let page=0;page<10;page+=1){
        const query=
          "?sellerId="+encodeURIComponent(sellerId)+
          (before?"&before="+encodeURIComponent(before):"");
        const data=await apiJson("/api/soko/products"+query,{method:"GET"});
        const rows=Array.isArray(data?.products)?data.products:[];
        for(const item of rows){
          if(
            String(item?.seller?.id||"").trim()===sellerId &&
            !collected.some(existing=>existing.id===item.id)
          ){
            collected.push(item);
          }
        }
        before=String(data?.nextCursor||"").trim();
        if(!before)break;
      }
      setStoreProducts(collected);
    }catch(error){
      setStoreError(
        String(
          (error as Error)?.message||
          error||
          "Seller store haikuweza kufunguka."
        )
      );
    }finally{
      setStoreLoading(false);
    }
  };
  const openSecureCheckout=(preferredMethod?: "stripe_card"|"cash_app")=>{
    if(soldOut){
      Alert.alert(
        "Sold out",
        "This product is no longer available."
      );
      return;
    }

    setSelected(false);
    setOrder(null);
    setPaymentSent(false);
    setProofImages([]);
    setReceiptScan({
      recipient:"",
      cashTag:"",
      amounts:[],
      status:"",
      dateTime:"",
      fees:"",
      scannedCount:0
    });
    setReference("");
    setBuyerNote("");
    setDeliveryRates([]);
    setSelectedDelivery(null);
    setDeliveryMode("");
    setDeliveryReason("");
    setDeliveryError("");
    setDeliveryNotice("");
    setCheckoutPaymentError("");
    setCheckoutPaymentNotice("");
    setCheckoutPaymentPhase("idle");
    setConfirmedTotals(null);
    checkoutAttemptIdRef.current=newCheckoutAttemptId();
    const cardOffered=product.paymentOptions?.stripeCardAvailable===true;
    setCheckoutPaymentMethod(
      preferredMethod==="cash_app"
        ?"cash_app"
        :preferredMethod==="stripe_card"||cardOffered
          ?"stripe_card"
          :paymentMethods.includes("cash_app")
            ?"cash_app"
            :"stripe_card"
    );
    setCheckoutOpen(true);

    void (async()=>{
      try{
        const session=await loadSession();
        const userId=String(
          (session||getSessionSync())?.userId||""
        ).trim();

        if(!userId)return;

        const stored=await AsyncStorage.getItem(
          DELIVERY_DETAILS_KEY+":"+userId
        );

        if(!stored)return;

        const parsed=JSON.parse(stored);

        if(
          !parsed||
          typeof parsed!=="object"||
          Array.isArray(parsed)
        )return;

        setDelivery(current=>({
          ...current,
          fullName:String(
            parsed.fullName||current.fullName
          ).slice(0,120),
          phone:String(
            parsed.phone||current.phone
          ).slice(0,30),
          country:String(
            parsed.country||current.country
          ).slice(0,80),
          state:String(
            parsed.state||current.state
          ).slice(0,100),
          city:String(
            parsed.city||current.city
          ).slice(0,100),
          streetAddress:String(
            parsed.streetAddress||
            current.streetAddress
          ).slice(0,240),
          postalCode:String(
            parsed.postalCode||
            current.postalCode
          ).slice(0,30),
          instructions:String(
            parsed.instructions||""
          ).slice(0,500)
        }));
      }catch{
        // Saved details must never block checkout.
      }
    })();
  };

  useEffect(()=>{
    setDeliveryRates([]);
    setSelectedDelivery(null);
    setDeliveryMode("");
    setDeliveryReason("");
    setDeliveryError("");
    setDeliveryNotice("");
  },[
    delivery.country,
    delivery.state,
    delivery.city,
    delivery.streetAddress,
    delivery.postalCode
  ]);

  const loadDeliveryRates=async()=>{
    setDeliveryLoading(true);
    setDeliveryError("");
    setCheckoutBusyStage("verifying_delivery");
    try{
      const data=await apiJson(
        "/api/soko/delivery/rates",
        {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            productId:realId,
            address:{
              fullName:delivery.fullName.trim(),
              phone:delivery.phone.trim(),
              country:delivery.country.trim(),
              state:delivery.state.trim(),
              city:delivery.city.trim(),
              streetAddress:delivery.streetAddress.trim(),
              postalCode:delivery.postalCode.trim()
            }
          })
        }
      );

      const shipmentId=String(data.shipmentId||"").trim();
      const rates=(Array.isArray(data.rates)?data.rates:[])
        .filter((item:any)=>item&&String(item.id||"").trim())
        .map((item:any)=>({
          ...item,
          shipmentId:String(item.shipmentId||shipmentId||"").trim()
        }));

      setDeliveryMode(String(data.mode||""));
      setDeliveryReason(String(data.reason||""));

      if(data.mode==="quote_required"){
        setDeliveryRates([]);
        setSelectedDelivery(null);
        const quotePaymentMethod=
          product.paymentOptions?.stripeCardAvailable===true
            ?"stripe_card"
            :paymentMethods.includes("cash_app")
            ?"cash_app"
            :paymentMethods.includes("mobile_money")
              ?"mobile_money"
              :paymentMethods.includes("cash")
                ?"cash"
                :"";

        if(!quotePaymentMethod){
          Alert.alert(
            "Payment unavailable",
            "Seller must add an accepted payment method first."
          );
          return;
        }

        const quoteOrderData=await apiJson(
          "/api/soko/orders",
          {
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({
              productId:realId,
              paymentMethod:quotePaymentMethod,
              clientKey:
                "delivery-quote-"+
                realId+"-"+
                Date.now().toString(36),
              requestDeliveryQuote:true,
              deliveryDetails:{
                fullName:delivery.fullName.trim(),
                phone:delivery.phone.trim(),
                country:delivery.country.trim(),
                state:delivery.state.trim(),
                city:delivery.city.trim(),
                streetAddress:delivery.streetAddress.trim(),
                postalCode:delivery.postalCode.trim(),
                instructions:delivery.instructions.trim()
              },
              deliverySelection:{}
            })
          }
        );

        setOrder(quoteOrderData.order||null);
        setCheckoutOpen(false);

        Alert.alert(
          "Delivery quote requested",
          "Seller amepokea ombi lako. Malipo yamefungwa mpaka seller atume bei ya delivery na wewe uikubali."
        );
        return;
      }

      if(!rates.length){
        setDeliveryRates([]);
        setSelectedDelivery(null);
        setDeliveryNotice("");
        setDeliveryError("Delivery is unavailable for this address. No carrier rate was returned.");
        return;
      }

      const previousId=String(selectedDelivery?.id||"");
      const stillValid=previousId
        ? rates.find((item:any)=>String(item.id||"")===previousId)
        : null;
      const nextSelection=stillValid||pickCheapestDeliveryRate(rates);

      setDeliveryRates(rates);
      setSelectedDelivery(nextSelection||null);
      setDeliveryNotice(
        previousId && !stillValid
          ? "The previous delivery option is no longer available. The cheapest available option was selected."
          : ""
      );
    }catch(error){
      setDeliveryError(
        String(
          (error as Error)?.message||
          error||
          "Delivery haikuweza kuhesabiwa."
        )
      );
    }finally{
      setDeliveryLoading(false);
      setCheckoutBusyStage(prev=>prev==="verifying_delivery"?"":prev);
    }
  };

  const continueSecureCheckout=async()=>{
    const required=[
      delivery.fullName,
      delivery.phone,
      delivery.country,
      delivery.state,
      delivery.city,
      delivery.streetAddress,
      delivery.postalCode
    ];

    if(
      delivery.fullName.trim().length<2||
      delivery.phone.trim().length<7||
      delivery.country.trim().length<2||
      delivery.state.trim().length<2||
      delivery.city.trim().length<2||
      delivery.streetAddress.trim().length<5||
      delivery.postalCode.trim().length<3||
      required.some(value=>!value.trim())
    ){
      Alert.alert(
        "Complete delivery details",
        "Jaza jina, simu na anwani kamili ya kufikisha mzigo."
      );
      return;
    }

    try{
      const userId=String(getSessionSync()?.userId||"").trim();

      if(userId){
        await AsyncStorage.setItem(
          DELIVERY_DETAILS_KEY+":"+userId,
          JSON.stringify({
            fullName:delivery.fullName.trim(),
            phone:delivery.phone.trim(),
            country:delivery.country.trim(),
            state:delivery.state.trim(),
            city:delivery.city.trim(),
            streetAddress:
              delivery.streetAddress.trim(),
            postalCode:
              delivery.postalCode.trim(),
            instructions:
              delivery.instructions.trim(),
            updatedAt:new Date().toISOString()
          })
        );
      }
    }catch{
      // Local saving failure must not stop checkout.
    }

    if(deliveryRates.length>0 && !selectedDelivery){
      return;
    }

    if(!selectedDelivery){
      await loadDeliveryRates();
      return;
    }

    const selectedCurrency=String(selectedDelivery.currency||product.currency||"").trim().toUpperCase();
    const itemCurrencyCode=String(product.currency||"").trim().toUpperCase();
    if(selectedCurrency&&itemCurrencyCode&&selectedCurrency!==itemCurrencyCode){
      setDeliveryNotice("Shipping currency does not match the product currency. Payment is locked until a matching rate is available.");
      return;
    }
    if(!String(selectedDelivery.id||"").trim()){
      return;
    }

    if(deliveryMode==="quote_required"){
      Alert.alert(
        "Payment locked",
        "Delivery quote lazima ikubaliwe kabla ya malipo."
      );
      return;
    }

    if(checkoutPaymentMethod==="stripe_card"){
      await beginCheckoutStripeCardPaymentRef.current();
      return;
    }

    openSokoProductConversation();
  };

  const applyCheckoutOrderStatus=(status:string)=>{
    if(orderLooksPaid(status)){
      setCheckoutPaymentPhase("paid");
      setCheckoutPaymentError("");
      setCheckoutPaymentNotice("Payment confirmed.");
      return "paid" as const;
    }
    if(orderLooksFailed(status)){
      setCheckoutPaymentPhase("failed");
      checkoutAttemptIdRef.current=newCheckoutAttemptId();
      setCheckoutPaymentError(
        "This payment was cancelled or rejected. Recalculate delivery if you need a new checkout."
      );
      return "failed" as const;
    }
    return "pending" as const;
  };

  const refreshCheckoutPaymentStatus=async()=>{
    const orderId=String(order?.id||"").trim();
    if(!orderId){
      setCheckoutPaymentError("No pending payment to check.");
      return;
    }
    try{
      const buying=await apiJson("/api/soko/orders?mode=buying",{method:"GET"});
      const rows=Array.isArray(buying.orders)?buying.orders:[];
      const current=rows.find((item:any)=>String(item?.id||"")===orderId)||null;
      if(current){
        setOrder(current);
        const outcome=applyCheckoutOrderStatus(String(current.status||""));
        if(outcome!=="pending")return;
      }
      const orderMethod=String(order?.paymentMethod||checkoutPaymentMethod||"");
      if(orderMethod==="stripe_card"||checkoutPaymentPhase==="confirming"){
        setCheckoutPaymentPhase(prev=>prev==="paid"||prev==="failed"?prev:"confirming");
        setCheckoutPaymentNotice("Confirming payment…");
        return;
      }
      return;
    }catch(error){
      setCheckoutPaymentError(
        checkoutPaymentErrorCopy(
          String((error as Error)?.message||error||"Payment status could not be refreshed.")
        )
      );
    }
  };
  refreshCheckoutPaymentStatusRef.current=refreshCheckoutPaymentStatus;

  const beginCheckoutStripeCardPayment=async()=>{
    if(paymentBusy||checkoutPaymentPhase==="preparing")return;
    if(product.paymentOptions?.stripeCardAvailable!==true){
      setCheckoutPaymentError("Card checkout is only available for this seller.");
      return;
    }
    const configMessage=stripeCardCheckoutConfigMessage();
    if(configMessage){
      setCheckoutPaymentError(configMessage);
      return;
    }
    setPaymentBusy(true);
    setCheckoutPaymentPhase("preparing");
    setCheckoutBusyStage("creating_order");
    setCheckoutPaymentError("");
    try{
      const itemAmount=Number(product.price||0);
      const shippingAmount=Number(selectedDelivery.amount);
      const displayedTotal=
        Number.isFinite(itemAmount)&&Number.isFinite(shippingAmount)
          ? itemAmount+shippingAmount
          : null;
      const displayedCents=moneyCents(displayedTotal);
      const data=await apiJson("/api/soko/orders",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          productId:realId,
          paymentMethod:"stripe_card",
          clientKey:checkoutClientKey(
            realId,
            String(selectedDelivery.id||""),
            delivery.postalCode,
            checkoutAttemptIdRef.current,
            "stripe_card"
          ),
          deliveryDetails:{
            fullName:delivery.fullName.trim(),
            phone:delivery.phone.trim(),
            country:delivery.country.trim(),
            state:delivery.state.trim(),
            city:delivery.city.trim(),
            streetAddress:delivery.streetAddress.trim(),
            postalCode:delivery.postalCode.trim(),
            instructions:delivery.instructions.trim()
          },
          deliverySelection:{
            rateId:String(selectedDelivery.id||""),
            shipmentId:String(selectedDelivery.shipmentId||"")
          }
        })
      });
      const activeOrder=data.order;
      setOrder(activeOrder);
      const status=String(activeOrder?.status||"");
      if(applyCheckoutOrderStatus(status)!=="pending"){
        return;
      }
      const totals=
        activeOrder?.product?.totals &&
        typeof activeOrder.product.totals==="object"
          ? activeOrder.product.totals
          : {};
      const serverItem=Number(totals.itemPrice);
      const serverShip=Number(totals.deliveryPrice);
      const serverTotal=Number(totals.finalTotal);
      const serverCurrency=String(totals.currency||activeOrder?.product?.currency||"").toUpperCase().trim();
      if(!Number.isFinite(serverTotal)||serverTotal<=0||!serverCurrency){
        throw new Error("Confirmed order total is unavailable.");
      }
      const serverCents=moneyCents(serverTotal);
      const reviewedCents=moneyCents(confirmedTotals?.finalTotal);
      if(
        Number.isFinite(displayedCents) &&
        displayedCents>0 &&
        serverCents!==displayedCents &&
        reviewedCents!==serverCents
      ){
        setConfirmedTotals({
          itemPrice:Number.isFinite(serverItem)?serverItem:serverTotal,
          deliveryPrice:Number.isFinite(serverShip)?serverShip:0,
          finalTotal:serverTotal,
          currency:serverCurrency
        });
        setCheckoutPaymentNotice("Your total changed. Review the updated amount before continuing.");
        setCheckoutPaymentPhase("idle");
        return;
      }
      setConfirmedTotals({
        itemPrice:Number.isFinite(serverItem)?serverItem:serverTotal,
        deliveryPrice:Number.isFinite(serverShip)?serverShip:0,
        finalTotal:serverTotal,
        currency:serverCurrency
      });
      setCheckoutPaymentNotice("");
      const orderId=String(activeOrder?.id||"").trim();
      setCheckoutBusyStage("opening_card");
      const intent=await apiJson("/api/soko/payments/stripe/payment-intent",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({orderId})
      });
      if(intent?.livemode===true||intent?.livemode===false){
        if(!expoStripeModeMatchesLivemode(intent.livemode===true)){
          throw new Error("Card checkout is not configured yet.");
        }
      }
      if(String(intent?.status||"")==="payment_approved"){
        setCheckoutPaymentPhase("paid");
        setCheckoutPaymentNotice("Payment confirmed.");
        return;
      }
      const clientSecret=String(intent?.clientSecret||"").trim();
      if(!clientSecret){
        setCheckoutPaymentPhase("confirming");
        setCheckoutPaymentNotice("Confirming payment…");
        checkoutPollTicksRef.current=0;
        return;
      }
      const init=await initPaymentSheet({
        merchantDisplayName:"SOKO",
        paymentIntentClientSecret:clientSecret,
        returnURL:STRIPE_URL_SCHEME+"://stripe-redirect",
        allowsDelayedPaymentMethods:false
      });
      if(init.error){
        throw new Error(init.error.message||"Card checkout could not start.");
      }
      const presented=await presentPaymentSheet();
      if(presented.error){
        if(String(presented.error.code||"")==="Canceled"){
          setCheckoutPaymentPhase("idle");
          setCheckoutPaymentNotice("Payment was cancelled. The order is still unpaid.");
          return;
        }
        throw new Error(presented.error.message||"Card payment did not complete.");
      }
      checkoutPollTicksRef.current=0;
      setCheckoutPaymentPhase("confirming");
      setCheckoutPaymentNotice("Confirming payment…");
    }catch(error){
      const message=String((error as Error)?.message||error||"Payment could not start.");
      setCheckoutPaymentPhase("idle");
      setCheckoutPaymentError(checkoutPaymentErrorCopy(message));
    }finally{
      setPaymentBusy(false);
      setCheckoutBusyStage("");
      setCheckoutPaymentPhase(prev=>prev==="preparing"?"idle":prev);
    }
  };
  beginCheckoutStripeCardPaymentRef.current=beginCheckoutStripeCardPayment;

  const openValidatedCashAppUrl=async(rawUrl:string)=>{
    if(!isSafeCashAppLaunchUrl(rawUrl)){
      throw new Error("Cash App payment URL is invalid.");
    }
    const canOpen=await Linking.canOpenURL(rawUrl).catch(()=>false);
    if(!canOpen){
      throw new Error("Cash App is not installed or this payment URL cannot open.");
    }
    try{
      await Linking.openURL(rawUrl);
    }catch{
      throw new Error("Cash App is not installed or this payment URL cannot open.");
    }
  };

  const beginCheckoutCashAppPayment=async()=>{
    openSokoProductConversation();
  };
  beginCheckoutCashAppPaymentRef.current=beginCheckoutCashAppPayment;

  const beginCashAppPayment=async(forcedOrder?:any)=>{
    const listingCashTag=String(
      product.paymentOptions?.cashTag||""
    ).replace(/^\$/,"").trim();

    if(!listingCashTag){
      Alert.alert(
        "Cash App unavailable",
        "Seller Cash App $Cashtag haijahifadhiwa."
      );
      return;
    }

    if(paymentBusy)return;
    setPaymentBusy(true);

    try{
      let activeOrder=forcedOrder||order;

      if(!activeOrder){
        if(!String(selectedDelivery?.id||"").trim()){
          throw new Error("Choose a verified carrier delivery rate.");
        }
        const data=await apiJson(
          "/api/soko/orders",
          {
            method:"POST",
            headers:{
              "Content-Type":"application/json"
            },
            body:JSON.stringify({
              productId:realId,
              paymentMethod:"cash_app",
              clientKey:
                "cashapp-"+realId+"-"+Date.now(),
              deliveryDetails:{
                fullName:delivery.fullName.trim(),
                phone:delivery.phone.trim(),
                country:delivery.country.trim(),
                state:delivery.state.trim(),
                city:delivery.city.trim(),
                streetAddress:
                  delivery.streetAddress.trim(),
                postalCode:
                  delivery.postalCode.trim(),
                instructions:
                  delivery.instructions.trim()
              },
              deliverySelection:selectedDelivery
                ?{
                    rateId:String(
                      selectedDelivery.id||""
                    ),
                    shipmentId:String(
                      selectedDelivery.shipmentId||""
                    )
                  }
                :{}
            })
          }
        );

        activeOrder=data.order;
        setOrder(activeOrder);
      }

      const paymentSnapshot=
        activeOrder?.product?.payment &&
        typeof activeOrder.product.payment==="object"
          ? activeOrder.product.payment
          :{};

      const sellerSnapshot=
        activeOrder?.product?.seller &&
        typeof activeOrder.product.seller==="object"
          ? activeOrder.product.seller
          :{};

      const totals=
        activeOrder?.product?.totals &&
        typeof activeOrder.product.totals==="object"
          ? activeOrder.product.totals
          :{};

      const cashTag=String(
        paymentSnapshot.cashTag||
        listingCashTag
      ).replace(/^\$/,"").trim();

      const sellerName=String(
        sellerSnapshot.name||
        product.seller?.name||
        "SOKO seller"
      ).trim();

      const amount=Number(
        totals.finalTotal||
        activeOrder?.product?.price||
        0
      );

      const currency=String(
        totals.currency||
        activeOrder?.product?.currency||
        product.currency||
        ""
      ).toUpperCase().trim();

      const orderId=String(
        activeOrder?.id||""
      ).trim();

      if(
        !/^[A-Za-z0-9]{1,20}$/.test(cashTag)||
        !/[A-Za-z]/.test(cashTag)
      ){
        throw new Error(
          "Seller Cash App $Cashtag is invalid."
        );
      }

      if(
        !Number.isFinite(amount)||
        amount<=0
      ){
        throw new Error(
          "Confirmed order total is unavailable."
        );
      }

      if(currency!=="USD"){
        throw new Error(
          "Cash App checkout currently supports USD orders only."
        );
      }

      const cashAppUrl=
        "https://cash.app/$"+
        encodeURIComponent(cashTag)+
        "/"+
        amount.toFixed(2);

      setCashConfirmation({
        sellerName,
        cashTag,
        amountText:
          "USD "+
          amount.toLocaleString(
            "en-US",
            {
              minimumFractionDigits:2,
              maximumFractionDigits:2
            }
          ),
        orderReference:
          orderId.length>18
            ? orderId.slice(-12).toUpperCase()
            : orderId.toUpperCase(),
        url:cashAppUrl
      });
    }catch(error){
      Alert.alert(
        "Cash App",
        String(
          (error as Error)?.message||
          error||
          "Cash App haikuweza kufunguka."
        )
      );
    }finally{
      setPaymentBusy(false);
    }
  };

  const loadBuyerOrders=async()=>{
    setBuyerOrdersLoading(true);
    setBuyerOrdersError("");
    try{
      const data=await apiJson(
        "/api/soko/orders?mode=buying",
        {method:"GET"}
      );
      const rows=Array.isArray(data.orders)?data.orders:[];
      setBuyerOrders(
        rows.filter(
          (item:any)=>
            String(item?.productId||"")===realId
        )
      );
    }catch(error){
      setBuyerOrdersError(
        String(
          (error as Error)?.message||
          error||
          "Order haikuweza kufunguka."
        )
      );
    }finally{
      setBuyerOrdersLoading(false);
    }
  };

  const openBuyerOrders=()=>{
    setBuyerOrdersOpen(true);
    void loadBuyerOrders();
  };

  const decideDeliveryQuote=async(
    buyerOrder:any,
    action:"accept_delivery_quote"|"reject_delivery_quote"
  )=>{
    if(buyerOrdersBusy)return;

    const deliveryAmount=Number(
      buyerOrder?.product?.totals?.deliveryPrice||
      buyerOrder?.product?.delivery?.amount||
      0
    );
    const finalTotal=Number(
      buyerOrder?.product?.totals?.finalTotal||
      0
    );
    const currency=String(
      buyerOrder?.product?.totals?.currency||
      buyerOrder?.product?.currency||
      ""
    );

    Alert.alert(
      action==="accept_delivery_quote"
        ?"Accept delivery quote?"
        :"Reject delivery quote?",
      action==="accept_delivery_quote"
        ?`Delivery: ${currency} ${deliveryAmount.toLocaleString()}
Final total: ${currency} ${finalTotal.toLocaleString()}

Ukikubali, malipo yatafunguliwa.`
        :"Order hii itafungwa na hutalipa.",
      [
        {text:"Cancel",style:"cancel"},
        {
          text:
            action==="accept_delivery_quote"
              ?"Accept Quote"
              :"Reject Quote",
          style:
            action==="reject_delivery_quote"
              ?"destructive"
              :"default",
          onPress:async()=>{
            setBuyerOrdersBusy(buyerOrder.id);
            try{
              const data=await apiJson(
                "/api/soko/orders",
                {
                  method:"PATCH",
                  headers:{"Content-Type":"application/json"},
                  body:JSON.stringify({
                    orderId:buyerOrder.id,
                    action
                  })
                }
              );

              setBuyerOrders(current=>
                current.map(item=>
                  item.id===data.order.id
                    ?data.order
                    :item
                )
              );

              if(action==="accept_delivery_quote"){
                Alert.alert(
                  "Quote accepted",
                  "Bei ya delivery imekubaliwa. Sasa unaweza kuendelea na Cash App."
                );
              }else{
                Alert.alert(
                  "Quote rejected",
                  "Delivery quote na order vimekataliwa."
                );
              }
            }catch(error){
              Alert.alert(
                "Delivery quote",
                String(
                  (error as Error)?.message||
                  error||
                  "Quote haikuweza kubadilishwa."
                )
              );
            }finally{
              setBuyerOrdersBusy("");
            }
          }
        }
      ]
    );
  };

  const payAcceptedQuote=async(buyerOrder:any)=>{
    if(buyerOrder?.status!=="awaiting_payment"){
      Alert.alert(
        "Payment locked",
        "Kubali delivery quote kwanza."
      );
      return;
    }

    setOrder(buyerOrder);
    setPaymentSent(false);
    setProofImages([]);
    setReceiptScan({
      recipient:"",
      cashTag:"",
      amounts:[],
      status:"",
      dateTime:"",
      fees:"",
      scannedCount:0
    });
    setReference("");
    setBuyerNote("");
    setBuyerOrdersOpen(false);
    openSokoProductConversation();
  };

  /*
   * KRISTO_SOKO_CASHAPP_MULTI_SCREENSHOT_OCR_V2
   *
   * 1–5 screenshots.
   * No crop/edit screen.
   * OCR reads every selected image.
   * OCR is evidence only — never final payment verification.
   */
  const pickPaymentProof=async()=>{
    const result=
      await ImagePicker.launchImageLibraryAsync({
        mediaTypes:["images"] as any,
        allowsEditing:false,
        allowsMultipleSelection:true,
        selectionLimit:5,
        quality:1
      });

    if(result.canceled)return;

    const assets=Array.isArray(result.assets)
      ?result.assets.slice(0,5)
      :[];

    if(!assets.length)return;

    const MAX_PROOF_BYTES=6*1024*1024;

    for(const asset of assets){
      const fileSize=Number(
        (asset as any)?.fileSize||0
      );

      if(
        Number.isFinite(fileSize)&&
        fileSize>MAX_PROOF_BYTES
      ){
        Alert.alert(
          "Screenshot too large",
          "Kila screenshot lazima iwe 6 MB au chini. Mfumo hautakata picha."
        );
        return;
      }
    }

    const selected=assets
      .map((asset,index)=>{
        const uri=String(
          asset?.uri||""
        ).trim();

        if(!uri)return null;

        const fileName=String(
          (asset as any)?.fileName||
          uri.split("/").pop()||
          ("payment-proof-"+(index+1)+".jpg")
        ).trim();

        let mimeType=String(
          (asset as any)?.mimeType||""
        )
          .trim()
          .toLowerCase();

        const source=(
          fileName+" "+uri.split("?")[0]
        ).toLowerCase();

        if(!mimeType){
          if(source.includes(".png")){
            mimeType="image/png";
          }else if(source.includes(".webp")){
            mimeType="image/webp";
          }else{
            mimeType="image/jpeg";
          }
        }

        return {
          uri,
          mimeType,
          fileName
        };
      })
      .filter(Boolean) as Array<{
        uri:string;
        mimeType:string;
        fileName:string;
      }>;

    const unsupported=selected.find(
      proof=>
        ![
          "image/jpeg",
          "image/png",
          "image/webp"
        ].includes(proof.mimeType)
    );

    if(unsupported){
      Alert.alert(
        "Unsupported screenshot",
        "Tumia JPEG, PNG au WebP."
      );
      return;
    }

    setProofImages(selected);

    /*
     * Remove a reference from the previous screenshot set.
     * A strong OCR result below will fill the new one.
     */
    setReference("");

    const texts:string[]=[];

    for(const proof of selected){
      try{
        const recognized=
          await recognizeText(proof.uri);

        const value=String(
          (recognized as any)?.text||
          ""
        )
          .replace(/\r/g,"")
          .trim();

        if(value){
          texts.push(value);
        }
      }catch(error){
        console.log(
          "KRISTO_SOKO_CASHAPP_OCR_IMAGE_FAILED",
          {
            uri:proof.uri,
            error:String(
              (error as Error)?.message||
              error||
              "OCR failed"
            )
          }
        );
      }
    }

    const fullText=texts.join("\n");

    if(!fullText){
      setReceiptScan({
        recipient:"",
        cashTag:"",
        amounts:[],
        status:"",
        dateTime:"",
        fees:"",
        scannedCount:0
      });
      return;
    }

    const lines=fullText
      .split("\n")
      .map(line=>line.trim())
      .filter(Boolean);

    const validReference=(value:string)=>{
      const candidate=value
        .replace(/^#/,"")
        .trim();

      if(
        candidate.length<3||
        candidate.length>120||
        !/[0-9]/.test(candidate)||
        /^(?:number|id|reference|transaction|confirmation)$/i
          .test(candidate)
      ){
        return "";
      }

      return candidate;
    };

    let detectedReference="";

    /*
     * IMPORTANT:
     * This scans the COMPLETE OCR text, not one line only.
     *
     * It therefore handles:
     *
     * Transaction number
     * #D-5RMQ7ZXE
     */
    const labeledReference=
      fullText.match(
        /(?:transaction\s*(?:number|id|#)|confirmation\s*(?:number|id|#)?|reference\s*(?:number|id|#)?)\s*[:#-]?\s*#?\s*([A-Za-z0-9][A-Za-z0-9-]{2,119})/i
      );

    if(labeledReference?.[1]){
      detectedReference=
        validReference(
          String(labeledReference[1])
        );
    }

    if(!detectedReference){
      for(const line of lines){
        const match=line.match(
          /(?:transaction|confirmation|reference)\s*[:#-]\s*#?\s*([A-Za-z0-9][A-Za-z0-9-]{2,119})/i
        );

        if(match?.[1]){
          detectedReference=
            validReference(
              String(match[1])
            );
        }

        if(detectedReference)break;
      }
    }

    /*
     * Strong fallback for IDs such as:
     * D-5RMQ7ZXE
     */
    if(!detectedReference){
      for(const line of lines){
        const matches=
          line.match(
            /#?[A-Za-z0-9]+-[A-Za-z0-9-]{4,}/g
          )||[];

        for(const raw of matches){
          const candidate=
            validReference(raw);

          if(
            candidate&&
            /[A-Za-z]/.test(candidate)
          ){
            detectedReference=candidate;
            break;
          }
        }

        if(detectedReference)break;
      }
    }

    if(detectedReference){
      setReference(detectedReference);
    }

    /*
     * CashTag begins with a letter after "$".
     * This avoids treating $10.00 as a CashTag.
     */
    const cashTags=Array.from(
      new Set(
        fullText.match(
          /\$[A-Za-z][A-Za-z0-9_]{1,19}/g
        )||[]
      )
    );

    const rawAmounts=
      fullText.match(
        /\$\s*[0-9]{1,7}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?/g
      )||[];

    const amounts=Array.from(
      new Set(
        rawAmounts.map(value=>
          value.replace(/\s+/g,"")
        )
      )
    ).slice(0,6);

    const sellerName=String(
      product?.seller?.name||""
    ).trim();

    const normalize=(value:string)=>
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g," ")
        .trim();

    let recipient="";

    /*
     * Best evidence: expected seller name actually appears
     * in OCR text.
     */
    if(
      sellerName&&
      normalize(fullText).includes(
        normalize(sellerName)
      )
    ){
      recipient=sellerName;
    }

    /*
     * Cash App may show:
     * "View history with Bitingingwa"
     */
    if(!recipient){
      for(const line of lines){
        const match=line.match(
          /(?:view\s+history\s+with|history\s+with)\s+(.+)$/i
        );

        if(!match?.[1])continue;

        const candidate=String(
          match[1]
        )
          .replace(/\s+/g," ")
          .trim();

        if(
          candidate.length>=2&&
          candidate.length<=80
        ){
          recipient=candidate;
          break;
        }
      }
    }

    /*
     * Other common payment-recipient labels.
     */
    if(!recipient){
      for(const line of lines){
        const match=line.match(
          /^(?:payment\s+to|paid\s+to|sent\s+to|to)\s*[:\-]?\s*(.+)$/i
        );

        if(!match?.[1])continue;

        const candidate=String(
          match[1]
        )
          .replace(/\s+/g," ")
          .trim();

        if(
          candidate.length>=2&&
          candidate.length<=80&&
          !candidate.startsWith("$")&&
          !/^\d/.test(candidate)
        ){
          recipient=candidate;
          break;
        }
      }
    }

    /*
     * Name beside CashTag.
     */
    if(!recipient&&cashTags[0]){
      const tagIndex=lines.findIndex(
        line=>line.includes(cashTags[0])
      );

      if(tagIndex>=0){
        const nearby=[
          lines[tagIndex-1],
          lines[tagIndex+1]
        ].filter(Boolean);

        const candidate=nearby.find(
          line=>
            line.length>=2&&
            line.length<=80&&
            /[A-Za-z]/.test(line)&&
            !line.startsWith("$")&&
            !/\b(?:completed|pending|sent|received|fees)\b/i
              .test(line)
        );

        if(candidate){
          recipient=candidate;
        }
      }
    }

    let status="";

    const exactStatus=lines.find(
      line=>
        /^(?:completed|complete|successful|success|payment completed|payment complete)$/i
          .test(line)
    );

    if(exactStatus){
      status=exactStatus;
    }else{
      const statusLine=lines.find(
        line=>
          /\b(?:payment completed|completed successfully|successful payment)\b/i
            .test(line)
      );

      if(statusLine){
        status=statusLine;
      }
    }

    /*
     * Fees. Cash App transaction detail screenshots may show:
     *
     * Fees
     * None applied
     */
    let fees="";

    for(let i=0;i<lines.length;i+=1){
      const line=lines[i];

      const inline=line.match(
        /^fees\s*[:\-]?\s*(.+)$/i
      );

      if(inline?.[1]){
        fees=String(inline[1]).trim();
        break;
      }

      if(
        /^fees$/i.test(line)&&
        lines[i+1]
      ){
        const candidate=String(
          lines[i+1]
        ).trim();

        if(candidate.length<=80){
          fees=candidate;
          break;
        }
      }
    }

    /*
     * Date/time detected from receipt text.
     * It remains advisory OCR evidence.
     */
    const monthDatePattern=
      /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?(?:\s+(?:at\s+)?\d{1,2}:\d{2}\s*(?:AM|PM)?)?/i;

    const numericDatePattern=
      /\b\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+(?:at\s+)?\d{1,2}:\d{2}\s*(?:AM|PM)?)?/i;

    const relativeDatePattern=
      /\b(?:Today|Yesterday)(?:\s+(?:at\s+)?\d{1,2}:\d{2}\s*(?:AM|PM)?)?/i;

    const timePattern=
      /\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/i;

    const dateMatch=
      fullText.match(monthDatePattern)||
      fullText.match(numericDatePattern)||
      fullText.match(relativeDatePattern);

    const timeMatch=
      fullText.match(timePattern);

    let dateTime=String(
      dateMatch?.[0]||""
    ).trim();

    if(
      dateTime&&
      timeMatch?.[0]&&
      !dateTime.toLowerCase().includes(
        String(timeMatch[0]).toLowerCase()
      )
    ){
      dateTime=
        dateTime+
        " · "+
        String(timeMatch[0]).trim();
    }else if(
      !dateTime&&
      timeMatch?.[0]
    ){
      dateTime=String(
        timeMatch[0]
      ).trim();
    }

    setReceiptScan({
      recipient,
      cashTag:cashTags[0]||"",
      amounts,
      status,
      dateTime,
      fees,
      scannedCount:texts.length
    });
  };

  const paymentAmountLabel=()=>{
    const finalTotal=Number(
      order?.product?.totals?.finalTotal||
      0
    );
    const currency=String(
      order?.product?.totals?.currency||
      order?.product?.currency||
      product.currency||
      ""
    );

    if(Number.isFinite(finalTotal)&&finalTotal>0){
      return currency+" "+finalTotal.toLocaleString();
    }

    return money(product);
  };

  const paymentDeliveryLabel=()=>{
    const deliveryPrice=Number(
      order?.product?.totals?.deliveryPrice||
      order?.product?.delivery?.amount||
      0
    );
    const currency=String(
      order?.product?.totals?.currency||
      order?.product?.currency||
      product.currency||
      ""
    );

    if(!Number.isFinite(deliveryPrice)||deliveryPrice<=0){
      return "";
    }

    return "Includes delivery: "+
      currency+" "+
      deliveryPrice.toLocaleString();
  };

  const submitPaymentProof=async()=>{
    if(!order?.id){
      Alert.alert(
        "Payment",
        "Order haijapatikana."
      );
      return;
    }

    if(proofImages.length<1){
      Alert.alert(
        "Screenshot required",
        "Chagua angalau screenshot moja ya malipo."
      );
      return;
    }

    if(proofImages.length>5){
      Alert.alert(
        "Too many screenshots",
        "Unaweza kutuma screenshots zisizozidi 5."
      );
      return;
    }

    if(reference.trim().length<3){
      Alert.alert(
        "Reference required",
        "Weka transaction reference au confirmation number."
      );
      return;
    }

    if(paymentBusy)return;

    setPaymentBusy(true);

    try{
      for(
        let index=0;
        index<proofImages.length;
        index+=1
      ){
        const proof=
          proofImages[index];

        const form=
          new FormData();

        form.append(
          "file",
          {
            uri:proof.uri,
            name:
              proof.fileName||
              (
                "payment-proof-"+
                (index+1)+
                ".jpg"
              ),
            type:proof.mimeType
          } as any
        );

        const query=
          "?index="+index+
          (index===0?"&reset=1":"");

        await apiJson(
          "/api/soko/orders/"+
          encodeURIComponent(order.id)+
          "/payment-proof"+
          query,
          {
            method:"POST",
            body:form
          }
        );
      }

      const data=await apiJson(
        "/api/soko/orders",
        {
          method:"PATCH",
          headers:{
            "Content-Type":
              "application/json"
          },
          body:JSON.stringify({
            orderId:order.id,
            action:"submit_payment",
            note:buyerNote.trim(),
            transactionReference:
              reference.trim(),
            paymentDate:
              new Date().toISOString()
          })
        }
      );

      setOrder(data.order);
      setPaymentSent(true);

      Alert.alert(
        "Payment submitted",
        proofImages.length+
        " screenshot"+
        (
          proofImages.length===1
            ?""
            :"s"
        )+
        " zimetumwa. Seller atathibitisha fedha kwenye account yake kabla ya usafirishaji kuanza."
      );
    }catch(error){
      Alert.alert(
        "Payment proof",
        String(
          (error as Error)?.message||
          error||
          "Uthibitisho haukutumwa."
        )
      );
    }finally{
      setPaymentBusy(false);
    }
  };

  const galleryUris=(Array.isArray(product.photos)&&product.photos.length?product.photos:[product.image]).filter(uri=>typeof uri==="string"&&!!uri.trim());
  const locationCondition=[product.location,product.condition].map(value=>String(value||"").trim()).filter(Boolean).join(" · ");
  const longDescription=String(product.description||"").trim();
  const descriptionCollapsed=longDescription.length>220&&!descriptionOpen;
  const fulfillmentType=String(product.fulfillmentOptions?.type||"").trim();
  const fulfillmentTitle=fulfillmentType==="pickup"?"Pickup":fulfillmentType==="local_delivery"?"Local delivery":fulfillmentType==="parcel"?"Parcel shipping":fulfillmentType==="freight"?"Freight":"";
  const fulfillmentBits=[
    fulfillmentTitle,
    Number.isFinite(Number(product.fulfillmentOptions?.flatFee))&&Number(product.fulfillmentOptions?.flatFee)>0?product.currency+" "+Number(product.fulfillmentOptions?.flatFee).toLocaleString():"",
    Number.isFinite(Number(product.fulfillmentOptions?.estimatedDays))&&Number(product.fulfillmentOptions?.estimatedDays)>0?Number(product.fulfillmentOptions?.estimatedDays)+" day estimate":""
  ].filter(Boolean);
  const canBuyCashApp=paymentMethods.includes("cash_app");
  const canBuy=stripeCardAvailable||canBuyCashApp;
  const buyWithCard=stripeCardAvailable===true;
  const shopTitle=product.seller.shopName||product.seller.name+" Shop";
  const sellerPlace=String(product.seller.shopLocation||"").trim();
  const shippingCurrency=String(selectedDelivery?.currency||product.currency||"").trim();
  const itemCurrency=String(product.currency||"").trim();
  const shippingMatches=!selectedDelivery||!shippingCurrency||!itemCurrency||shippingCurrency.toUpperCase()===itemCurrency.toUpperCase();
  const shippingAmount=selectedDelivery&&Number.isFinite(Number(selectedDelivery.amount))?Number(selectedDelivery.amount):null;
  const itemAmount=Number(product.price||0);
  const displayTotal=selectedDelivery&&shippingMatches&&shippingAmount!==null&&Number.isFinite(itemAmount)?itemAmount+shippingAmount:null;
  const summaryItemAmount=confirmedTotals&&Number.isFinite(confirmedTotals.itemPrice)?confirmedTotals.itemPrice:itemAmount;
  const summaryShippingAmount=confirmedTotals&&Number.isFinite(confirmedTotals.deliveryPrice)?confirmedTotals.deliveryPrice:shippingAmount;
  const summaryTotal=confirmedTotals&&Number.isFinite(confirmedTotals.finalTotal)?confirmedTotals.finalTotal:displayTotal;
  const summaryCurrency=String(confirmedTotals?.currency||itemCurrency||"").trim();
  const continueDisabled=
    checkoutPaymentPhase==="paid"||
    checkoutPaymentPhase==="preparing"||
    checkoutPaymentPhase==="confirming"||
    (checkoutPaymentPhase!=="awaiting"&&(
      paymentBusy||
      deliveryLoading||
      (deliveryRates.length>0&&!selectedDelivery)||
      (!!selectedDelivery&&!shippingMatches)||
      (!!deliveryError&&deliveryRates.length===0&&!deliveryLoading)
    ));
  const deliveryAmounts=deliveryRates.map(item=>Number(item?.amount)).filter(value=>Number.isFinite(value)&&value>=0);
  const cheapestDeliveryAmount=deliveryAmounts.length?Math.min(...deliveryAmounts):null;
  const deliveryDays=deliveryRates.map(item=>Number(item?.estimatedDays)).filter(value=>Number.isFinite(value)&&value>0);
  const fastestDeliveryDays=deliveryDays.length?Math.min(...deliveryDays):null;

  return <View style={height?{height}:undefined}>
    <SokoBuyerSellerChat
      visible={sokoChatOpen}
      productId={realId}
      sellerName={product.seller.name}
      productTitle={product.title}
      onClose={()=>setSokoChatOpen(false)}
    /><View style={[styles.card,{width:cardWidth}]}>
    <Pressable style={styles.media} onPress={()=>setSelected(true)}><SokoProductPhoto uri={product.image} style={[styles.cover,{height:imageHeight}]}/><View style={styles.badge}><Text style={styles.badgeText}>{product.condition.toUpperCase()}</Text></View></Pressable>
    <Pressable style={styles.identity} onPress={()=>setSelected(true)}><View style={styles.avatar}>{sellerAvatarUri&&!avatarFailed?<Image source={{uri:absolute(sellerAvatarUri)}} style={styles.avatarImage} onError={()=>setAvatarFailed(true)}/>:<Text style={styles.avatarText}>{initial}</Text>}</View><View style={styles.body}><View style={styles.sellerLine}><Text numberOfLines={1} style={styles.seller}>{product.seller.name}</Text><Ionicons name="checkmark-circle" size={15} color="#18724B"/></View><Text numberOfLines={2} style={styles.title}>{product.title}</Text><View style={styles.meta}><Text style={styles.price}>{money(product)}</Text><Text style={styles.dot}>•</Text><Text numberOfLines={1} style={styles.location}>{product.location}</Text></View></View></Pressable>
    {(paymentMethods.length>0||stripeCardAvailable)&&<View style={styles.payments}><Text style={styles.paymentsLabel}>PAY WITH</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.paymentList}>{stripeCardAvailable?<Pressable key="stripe_card" disabled={paymentBusy} onPress={()=>openSecureCheckout("stripe_card")} style={[styles.paymentChip,styles.cashAppChip,paymentBusy&&styles.disabledChip]}><View style={[styles.paymentIcon,styles.cashAppIcon]}><Ionicons name="card-outline" size={14} color="#FFF"/></View><Text style={[styles.paymentText,styles.cashAppText]}>{paymentBusy?"Opening…":"Card"}</Text></Pressable>:null}{paymentMethods.map(method=>{const cashApp=method==="cash_app";const mobile=method==="mobile_money";return <Pressable key={method} disabled={!cashApp||paymentBusy} onPress={()=>cashApp?void openSokoProductConversation():undefined} style={[styles.paymentChip,cashApp&&styles.cashAppChip,paymentBusy&&cashApp&&styles.disabledChip]}><View style={[styles.paymentIcon,cashApp&&styles.cashAppIcon]}><Ionicons name={cashApp?"logo-usd":mobile?"phone-portrait-outline":"cash-outline"} size={14} color={cashApp?"#FFF":"#176844"}/></View><Text style={[styles.paymentText,cashApp&&styles.cashAppText]}>{cashApp?(paymentBusy?"Opening…":"Cash App"):mobile?(product.paymentOptions?.mobileNetwork||"Mobile Money"):"Cash"}</Text></Pressable>;})}</ScrollView></View>}
    <View style={styles.commerceActions}><Pressable style={styles.contactButton} onPress={()=>void contactSeller()} disabled={contacting}><Ionicons name="chatbubble-ellipses" size={20} color="#FFF"/><Text style={styles.contactText}>{contacting?"Opening…":"Contact Seller"}</Text></Pressable><Action icon="share-outline" label="Share" onPress={()=>void share()}/><Action icon={saved?"bookmark":"bookmark-outline"} label={saved?"Saved":"Save"} active={saved} onPress={()=>void toggleSaved()}/><Action icon="information-circle-outline" label="Details" onPress={()=>setSelected(true)}/></View>
  </View><Modal visible={selected} animationType="slide" onRequestClose={()=>setSelected(false)}>
    <View style={styles.pdRoot}>
      <View style={[styles.pdHeader,{paddingTop:insets.top}]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Rudi Home" onPress={()=>setSelected(false)} style={styles.pdHeaderBtn} hitSlop={4}>
          <Ionicons name="chevron-back" size={24} color="#FFFFFF"/>
        </Pressable>
        <View style={styles.pdHeaderBtn}/>
        <View style={styles.pdHeaderCenter}>
          <Text style={styles.pdHeaderKicker}>SOKO</Text>
          <Text maxFontSizeMultiplier={1.2} style={styles.pdHeaderTitle}>Product Details</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Share" onPress={()=>void share()} style={styles.pdHeaderBtn} hitSlop={4}>
          <Ionicons name="share-outline" size={22} color="#FFFFFF"/>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={saved?"Saved":"Save"} onPress={()=>void toggleSaved()} style={styles.pdHeaderBtn} hitSlop={4}>
          <Ionicons name={saved?"bookmark":"bookmark-outline"} size={22} color="#FFFFFF"/>
        </Pressable>
      </View>
      <ScrollView style={styles.pdScrollFlex} contentContainerStyle={[styles.pdScroll,{paddingBottom:canBuy?24:16+insets.bottom}]}>
        <View style={[styles.pdGallery,{height:detailHeroHeight}]}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={event=>{
              const x=Number(event?.nativeEvent?.contentOffset?.x||0);
              setGalleryPage(Math.max(0,Math.round(x/Math.max(1,width))));
            }}
          >
            {(galleryUris.length?galleryUris:[""]).map((uri,index)=>
              <SokoProductPhoto key={uri||"missing-"+index} uri={uri} style={[styles.pdHero,{width,height:detailHeroHeight}]}/>
            )}
          </ScrollView>
          {galleryUris.length>1?
            <View style={styles.pdDots}>
              {galleryUris.map((uri,index)=>
                <View key={uri+"-dot"} style={[styles.pdDot,index===galleryPage&&styles.pdDotOn]}/>
              )}
            </View>
          :null}
        </View>
        <View style={styles.pdSummary}>
          {!!product.condition?
            <View style={styles.pdNew}><Text style={styles.pdNewText}>{String(product.condition).toUpperCase()}</Text></View>
          :null}
          <Text maxFontSizeMultiplier={1.25} numberOfLines={3} style={styles.pdName}>{product.title}</Text>
          <Text maxFontSizeMultiplier={1.2} style={styles.pdPrice}>{money(product)}</Text>
          {!!locationCondition?<Text maxFontSizeMultiplier={1.2} style={styles.pdMeta}>{locationCondition}</Text>:null}
        </View>
        <View style={styles.pdSeller}>
          <Pressable onPress={viewSellerProfile} style={styles.pdSellerAvatar}>
            {sellerAvatarUri&&!avatarFailed
              ? <Image source={{uri:absolute(sellerAvatarUri)}} style={styles.pdSellerAvatarImg} onError={()=>setAvatarFailed(true)}/>
              : <Text style={styles.pdSellerInitial}>{initial}</Text>}
          </Pressable>
          <Pressable onPress={viewSellerProfile} style={styles.pdSellerBody}>
            {product.seller.verified===true?<Text style={styles.pdVerified}>Verified SOKO seller</Text>:null}
            <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.pdStore}>{shopTitle}</Text>
            <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.pdSellerName}>{product.seller.name}</Text>
            {!!sellerPlace?<Text numberOfLines={1} style={styles.pdSellerPlace}>{sellerPlace}</Text>:null}
          </Pressable>
          <Pressable style={styles.pdContactMini} onPress={()=>void contactSeller()} disabled={contacting} accessibilityRole="button" accessibilityLabel="Contact Seller">
            <Text style={styles.pdContactMiniText}>{contacting?"…":"Contact"}</Text>
          </Pressable>
        </View>
        <Text style={[styles.pdStock,soldOut&&styles.pdStockOut]}>
          {soldOut?"Sold out":stockAvailable===1?"Only 1 left":stockAvailable+" available"}
        </Text>
        <View style={styles.pdSecondaryRow}>
          <Pressable style={styles.pdGhost} onPress={()=>void visitSellerStore()} accessibilityRole="button" accessibilityLabel={"Visit "+shopTitle}>
            <Ionicons name="storefront-outline" size={18} color="#176844"/>
            <Text style={styles.pdGhostText}>Visit Store</Text>
          </Pressable>
          <Pressable style={styles.pdGhost} onPress={openBuyerOrders} accessibilityRole="button" accessibilityLabel="My Order & Delivery Quote">
            <Ionicons name="receipt-outline" size={18} color="#176844"/>
            <Text style={styles.pdGhostText}>My orders</Text>
          </Pressable>
        </View>
        {!!longDescription?
          <View style={styles.pdSection}>
            <Text style={styles.pdSectionTitle}>About this product</Text>
            <Text style={styles.pdSectionBody}>{descriptionCollapsed?longDescription.slice(0,220).trim()+"…":longDescription}</Text>
            {longDescription.length>220?
              <Pressable onPress={()=>setDescriptionOpen(open=>!open)} hitSlop={8}>
                <Text style={styles.pdLink}>{descriptionOpen?"Show less":"Read more"}</Text>
              </Pressable>
            :null}
          </View>
        :null}
        {(!!product.condition||!!product.seller.shopCategory||!!sellerPlace)?
          <View style={styles.pdSection}>
            <Text style={styles.pdSectionTitle}>Product details</Text>
            {!!product.condition?
              <View style={styles.pdRow}><Text style={styles.pdRowLabel}>Condition</Text><Text style={styles.pdRowValue}>{product.condition}</Text></View>
            :null}
            {!!product.seller.shopCategory?
              <View style={styles.pdRow}><Text style={styles.pdRowLabel}>Category</Text><Text style={styles.pdRowValue}>{product.seller.shopCategory}</Text></View>
            :null}
            {!!sellerPlace?
              <View style={styles.pdRow}><Text style={styles.pdRowLabel}>Shop location</Text><Text style={styles.pdRowValue}>{sellerPlace}</Text></View>
            :null}
          </View>
        :null}
        {fulfillmentBits.length>0?
          <View style={styles.pdSection}>
            <Text style={styles.pdSectionTitle}>Pickup & shipping</Text>
            <Text style={styles.pdSectionBody}>{fulfillmentBits.join(" · ")}</Text>
          </View>
        :null}
        <View style={styles.pdSection}>
          <Pressable onPress={()=>setSellerInfoOpen(open=>!open)} style={styles.pdSellerInfoToggle} hitSlop={6}>
            <Text style={styles.pdSectionTitle}>Seller information</Text>
            <Ionicons name={sellerInfoOpen?"chevron-up":"chevron-down"} size={18} color="#6B746E"/>
          </Pressable>
          {sellerInfoOpen?
            <View>
              {!!product.seller.kristoId?<View style={styles.pdRow}><Text style={styles.pdRowLabel}>Kristo ID</Text><Text style={styles.pdRowValue}>{product.seller.kristoId}</Text></View>:null}
              {!!product.seller.churchName?<View style={styles.pdRow}><Text style={styles.pdRowLabel}>Church</Text><Text style={styles.pdRowValue}>{product.seller.churchName}</Text></View>:null}
              <Pressable style={styles.pdTextLink} onPress={viewSellerProfile}><Text style={styles.pdLink}>View profile</Text></Pressable>
              {!!product.seller.churchId?
                <Pressable style={styles.pdTextLink} onPress={viewSellerChurch}><Text style={styles.pdLink}>View church</Text></Pressable>
              :null}
            </View>
          :null}
        </View>
        {(paymentMethods.length>0||stripeCardAvailable)?
          <View style={styles.pdSection}>
            <Text style={styles.pdSectionTitle}>Payment methods</Text>
            {stripeCardAvailable?
              <Text style={styles.pdSectionBody}>Card — Secured by Stripe</Text>
            :null}
            {paymentMethods.map(method=>
              <Text key={method} style={styles.pdSectionBody}>
                {method==="cash_app"?"Cash App":method==="mobile_money"?(product.paymentOptions?.mobileNetwork||"Mobile Money"):"Cash"}
              </Text>
            )}
          </View>
        :null}
        <Text style={styles.pdNotice}>Thibitisha jina la mpokeaji kabla ya kulipa. Usitume PIN au OTP. Screenshot pekee si uthibitisho wa malipo. Kristo App haishikilii fedha wala kuhakikisha marejesho.</Text>
      </ScrollView>
      {canBuy?
        <View style={[styles.pdBuyBar,{paddingBottom:Math.max(insets.bottom,10)}]}>
          <View style={styles.pdBuyPriceWrap}>
            <Text style={styles.pdBuyPriceLabel}>Total</Text>
            <Text maxFontSizeMultiplier={1.2} style={styles.pdBuyPrice}>{money(product)}</Text>
          </View>
          <Pressable
            style={[styles.pdBuyBtn,(paymentBusy||soldOut)&&styles.submitDisabled,soldOut&&styles.pdBuyBtnSold]}
            disabled={paymentBusy||soldOut}
            onPress={()=>buyWithCard?openSecureCheckout("stripe_card"):openSokoProductConversation()}
            accessibilityRole="button"
            accessibilityLabel={soldOut?"Sold Out":buyWithCard?"Buy with Card":"Buy with Cash App"}
          >
            {paymentBusy?<ActivityIndicator color="#FFF"/>:<Ionicons name={buyWithCard?"card-outline":"logo-usd"} size={18} color="#FFF"/>}
            <Text style={styles.pdBuyBtnText}>{soldOut?"Sold Out":paymentBusy?"Opening…":buyWithCard?"Buy with Card":"Buy with Cash App"}</Text>
          </Pressable>
        </View>
      :null}
    </View>
  </Modal><Modal
    visible={storeOpen}
    animationType="slide"
    onRequestClose={()=>setStoreOpen(false)}
  >
    <SafeAreaView edges={["left","right","bottom"]} style={styles.storeScreen}>
      <View style={[styles.storeHeader,{paddingTop:Math.max(insets.top,46)}]}>
        <Pressable
          style={styles.storeBackButton}
          onPress={()=>setStoreOpen(false)}
        >
          <Ionicons name="chevron-back" size={24} color="#FFF"/>
        </Pressable>
        <View style={styles.storeHeaderTitles}>
          <Text style={styles.storeHeaderEyebrow}>VERIFIED SOKO STORE</Text>
          <Text numberOfLines={1} style={styles.storeHeaderTitle}>
            {product.seller.shopName||product.seller.name+" Shop"}
          </Text>
          <Text style={styles.storeHeaderSeller}>
            By {product.seller.name}
          </Text>
        </View>
        <View style={styles.storeHeaderSpacer}/>
      </View>

      {storeLoading
        ? <View style={styles.storeCentered}>
            <ActivityIndicator size="large" color="#176844"/>
            <Text style={styles.storeLoadingText}>
              Loading active products…
            </Text>
          </View>
        : storeError
          ? <View style={styles.storeCentered}>
              <Ionicons name="alert-circle-outline" size={42} color="#9C6B21"/>
              <Text style={styles.storeErrorText}>{storeError}</Text>
              <Pressable
                style={styles.storeRetryButton}
                onPress={()=>void visitSellerStore()}
              >
                <Text style={styles.storeRetryText}>Try Again</Text>
              </Pressable>
            </View>
          : <ScrollView contentContainerStyle={styles.storeContent}>
              <View style={styles.storeSummary}>
                <View style={styles.storeSummaryIcon}>
                  <Ionicons name="storefront" size={22} color="#176844"/>
                </View>
                <View style={styles.storeSummaryBody}>
                  <Text style={styles.storeSummaryTitle}>Available now</Text>
                  <Text style={styles.storeSummaryCopy}>
                    {storeProducts.length} active {storeProducts.length===1?"product":"products"}
                  </Text>
                </View>
                <View style={styles.activeStorePill}>
                  <View style={styles.activeStoreDot}/>
                  <Text style={styles.activeStoreText}>ACTIVE</Text>
                </View>
              </View>

              {storeProducts.length===0
                ? <View style={styles.emptyStore}>
                    <Ionicons name="bag-handle-outline" size={44} color="#90A098"/>
                    <Text style={styles.emptyStoreTitle}>No active products</Text>
                    <Text style={styles.emptyStoreCopy}>
                      Seller hana bidhaa nyingine zinazopatikana sasa.
                    </Text>
                  </View>
                : storeProducts.map(item=>
                    <View key={item.id} style={styles.storeProductCard}>
                      <SokoProductPhoto
                        uri={absolute(item.image)}
                        style={styles.storeProductImage}
                      />
                      <View style={styles.storeProductBody}>
                        <View style={styles.storeProductStatus}>
                          <Text style={styles.storeProductStatusText}>
                            {String(item.condition||"").toUpperCase()}
                          </Text>
                        </View>
                        <Text numberOfLines={2} style={styles.storeProductTitle}>
                          {item.title}
                        </Text>
                        <Text style={styles.storeProductPrice}>
                          {money(item)}
                        </Text>
                        <View style={styles.storeProductLocation}>
                          <Ionicons name="location-outline" size={13} color="#758078"/>
                          <Text numberOfLines={1} style={styles.storeProductLocationText}>
                            {item.location}
                          </Text>
                        </View>
                      </View>
                    </View>
                  )}
            </ScrollView>}
    </SafeAreaView>
  </Modal>

  <Modal
    visible={buyerOrdersOpen}
    animationType="slide"
    onRequestClose={()=>setBuyerOrdersOpen(false)}
  >
    <SafeAreaView
      edges={["left","right","bottom"]}
      style={{flex:1,backgroundColor:"#F4F7F4"}}
    >
      <View
        style={{
          minHeight:130,
          paddingTop:Math.max(insets.top,46),
          paddingHorizontal:16,
          paddingBottom:15,
          backgroundColor:"#145D3E",
          borderBottomLeftRadius:27,
          borderBottomRightRadius:27,
          flexDirection:"row",
          alignItems:"flex-end"
        }}
      >
        <Pressable
          onPress={()=>setBuyerOrdersOpen(false)}
          style={{
            width:44,
            height:44,
            borderRadius:22,
            backgroundColor:"rgba(255,255,255,.16)",
            borderWidth:1,
            borderColor:"rgba(255,255,255,.28)",
            alignItems:"center",
            justifyContent:"center"
          }}
        >
          <Ionicons
            name="chevron-back"
            size={24}
            color="#FFF"
          />
        </Pressable>

        <View style={{flex:1,alignItems:"center"}}>
          <Text
            style={{
              color:"#DDF25B",
              fontSize:9,
              fontWeight:"900",
              letterSpacing:1.5
            }}
          >
            SOKO SECURE ORDER
          </Text>
          <Text
            style={{
              color:"#FFF",
              fontSize:22,
              fontWeight:"900",
              marginTop:3
            }}
          >
            My Order
          </Text>
          <Text
            style={{
              color:"rgba(255,255,255,.72)",
              fontSize:10,
              fontWeight:"700",
              marginTop:3
            }}
          >
            Review delivery quote before payment
          </Text>
        </View>

        <Pressable
          disabled={buyerOrdersLoading}
          onPress={()=>void loadBuyerOrders()}
          style={{
            width:44,
            height:44,
            borderRadius:22,
            backgroundColor:"rgba(255,255,255,.14)",
            alignItems:"center",
            justifyContent:"center"
          }}
        >
          {buyerOrdersLoading
            ?<ActivityIndicator color="#DDF25B"/>
            :<Ionicons
                name="refresh"
                size={21}
                color="#DDF25B"
              />}
        </Pressable>
      </View>

      {buyerOrdersLoading&&!buyerOrders.length
        ?<View
            style={{
              flex:1,
              alignItems:"center",
              justifyContent:"center",
              gap:12
            }}
          >
            <ActivityIndicator
              size="large"
              color="#176844"
            />
            <Text
              style={{
                color:"#607067",
                fontWeight:"800"
              }}
            >
              Loading your order…
            </Text>
          </View>
        :buyerOrdersError
          ?<View
              style={{
                flex:1,
                alignItems:"center",
                justifyContent:"center",
                padding:28,
                gap:12
              }}
            >
              <Ionicons
                name="alert-circle-outline"
                size={38}
                color="#916D1E"
              />
              <Text
                style={{
                  color:"#6E5A2C",
                  textAlign:"center",
                  fontSize:14,
                  lineHeight:21,
                  fontWeight:"700"
                }}
              >
                {buyerOrdersError}
              </Text>
            </View>
          :buyerOrders.length===0
            ?<View
                style={{
                  flex:1,
                  alignItems:"center",
                  justifyContent:"center",
                  padding:28,
                  gap:9
                }}
              >
                <Ionicons
                  name="receipt-outline"
                  size={42}
                  color="#176844"
                />
                <Text
                  style={{
                    color:"#26342B",
                    fontSize:20,
                    fontWeight:"900"
                  }}
                >
                  No order yet
                </Text>
                <Text
                  style={{
                    color:"#758078",
                    textAlign:"center",
                    lineHeight:20
                  }}
                >
                  Request delivery first, then your order will appear here.
                </Text>
              </View>
            :<ScrollView
                contentContainerStyle={{
                  padding:15,
                  paddingBottom:40,
                  gap:13
                }}
                showsVerticalScrollIndicator={false}
              >
                {buyerOrders.map((buyerOrder:any)=>{
                  const snapshot=buyerOrder.product||{};
                  const totals=snapshot.totals||{};
                  const deliveryInfo=snapshot.delivery||{};
                  const currency=String(
                    totals.currency||
                    snapshot.currency||
                    ""
                  );
                  const itemPrice=Number(
                    totals.itemPrice||
                    snapshot.price||
                    0
                  );
                  const deliveryPrice=Number(
                    totals.deliveryPrice||
                    deliveryInfo.amount||
                    0
                  );
                  const finalTotal=Number(
                    totals.finalTotal||
                    itemPrice+deliveryPrice
                  );
                  const quoteReady=
                    buyerOrder.status==="delivery_quote_ready";
                  const quoteWaiting=
                    buyerOrder.status==="awaiting_delivery_quote";
                  const busy=
                    buyerOrdersBusy===buyerOrder.id;

                  return <View
                    key={buyerOrder.id}
                    style={{
                      backgroundColor:"#FFF",
                      borderRadius:20,
                      borderWidth:1.5,
                      borderColor:
                        quoteReady
                          ?"#E1C258"
                          :"#D8E4DC",
                      padding:14,
                      gap:12
                    }}
                  >
                    <View
                      style={{
                        flexDirection:"row",
                        alignItems:"center",
                        gap:11
                      }}
                    >
                      <SokoProductPhoto
                        uri={String(
                          snapshot.image||
                          product.image
                        )}
                        style={{
                          width:72,
                          height:72,
                          borderRadius:14,
                          backgroundColor:"#E8EEE9"
                        }}
                      />
                      <View style={{flex:1,minWidth:0}}>
                        <Text
                          numberOfLines={2}
                          style={{
                            color:"#18231C",
                            fontSize:16,
                            fontWeight:"900"
                          }}
                        >
                          {String(
                            snapshot.title||
                            product.title
                          )}
                        </Text>
                        <Text
                          style={{
                            color:"#17784D",
                            fontSize:15,
                            fontWeight:"900",
                            marginTop:4
                          }}
                        >
                          {currency} {itemPrice.toLocaleString()}
                        </Text>
                        <Text
                          style={{
                            color:quoteReady
                              ?"#80610C"
                              :"#68756D",
                            fontSize:10,
                            fontWeight:"900",
                            marginTop:5
                          }}
                        >
                          {quoteWaiting
                            ?"WAITING FOR SELLER QUOTE"
                            :quoteReady
                              ?"DELIVERY QUOTE READY"
                              :String(
                                  buyerOrder.status||
                                  ""
                                )
                                .replace(/_/g," ")
                                .toUpperCase()}
                        </Text>
                      </View>
                    </View>

                    {quoteWaiting&&
                      <View
                        style={{
                          backgroundColor:"#FFF7DF",
                          borderRadius:14,
                          padding:12,
                          flexDirection:"row",
                          alignItems:"center",
                          gap:9
                        }}
                      >
                        <Ionicons
                          name="time-outline"
                          size={21}
                          color="#8B680A"
                        />
                        <Text
                          style={{
                            flex:1,
                            color:"#735D21",
                            fontSize:12,
                            lineHeight:18,
                            fontWeight:"700"
                          }}
                        >
                          Seller anaandaa bei ya delivery. Payment bado imefungwa.
                        </Text>
                      </View>}

                    {(quoteReady||
                      buyerOrder.status==="awaiting_payment")&&
                      <View
                        style={{
                          backgroundColor:"#F3F7F4",
                          borderRadius:15,
                          padding:13,
                          gap:9
                        }}
                      >
                        <View
                          style={{
                            flexDirection:"row",
                            justifyContent:"space-between"
                          }}
                        >
                          <Text style={{color:"#647168",fontWeight:"700"}}>
                            Item price
                          </Text>
                          <Text style={{color:"#26342B",fontWeight:"900"}}>
                            {currency} {itemPrice.toLocaleString()}
                          </Text>
                        </View>

                        <View
                          style={{
                            flexDirection:"row",
                            justifyContent:"space-between"
                          }}
                        >
                          <Text style={{color:"#647168",fontWeight:"700"}}>
                            Delivery
                          </Text>
                          <Text style={{color:"#26342B",fontWeight:"900"}}>
                            {currency} {deliveryPrice.toLocaleString()}
                          </Text>
                        </View>

                        <View
                          style={{
                            height:1,
                            backgroundColor:"#D5E0D8"
                          }}
                        />

                        <View
                          style={{
                            flexDirection:"row",
                            justifyContent:"space-between",
                            alignItems:"center"
                          }}
                        >
                          <Text
                            style={{
                              color:"#176844",
                              fontSize:14,
                              fontWeight:"900"
                            }}
                          >
                            FINAL TOTAL
                          </Text>
                          <Text
                            style={{
                              color:"#176844",
                              fontSize:20,
                              fontWeight:"900"
                            }}
                          >
                            {currency} {finalTotal.toLocaleString()}
                          </Text>
                        </View>

                        {!!deliveryInfo.estimatedDays&&
                          <Text
                            style={{
                              color:"#738078",
                              fontSize:11,
                              fontWeight:"700"
                            }}
                          >
                            Estimated delivery: {deliveryInfo.estimatedDays} day{Number(deliveryInfo.estimatedDays)===1?"":"s"}
                          </Text>}
                      </View>}

                    {quoteReady&&
                      <View
                        style={{
                          flexDirection:"row",
                          gap:9
                        }}
                      >
                        <Pressable
                          disabled={busy}
                          onPress={()=>void decideDeliveryQuote(
                            buyerOrder,
                            "reject_delivery_quote"
                          )}
                          style={{
                            flex:1,
                            height:49,
                            borderRadius:14,
                            borderWidth:1.5,
                            borderColor:"#D9A7A7",
                            backgroundColor:"#FFF5F5",
                            alignItems:"center",
                            justifyContent:"center"
                          }}
                        >
                          <Text
                            style={{
                              color:"#9B3030",
                              fontWeight:"900"
                            }}
                          >
                            Reject
                          </Text>
                        </Pressable>

                        <Pressable
                          disabled={busy}
                          onPress={()=>void decideDeliveryQuote(
                            buyerOrder,
                            "accept_delivery_quote"
                          )}
                          style={{
                            flex:1.7,
                            height:49,
                            borderRadius:14,
                            backgroundColor:"#176844",
                            flexDirection:"row",
                            alignItems:"center",
                            justifyContent:"center",
                            gap:7
                          }}
                        >
                          {busy
                            ?<ActivityIndicator color="#FFF"/>
                            :<Ionicons
                                name="shield-checkmark"
                                size={19}
                                color="#FFF"
                              />}
                          <Text
                            style={{
                              color:"#FFF",
                              fontWeight:"900"
                            }}
                          >
                            Accept Quote
                          </Text>
                        </Pressable>
                      </View>}

                    {buyerOrder.status==="awaiting_payment"&&
                      <Pressable
                        disabled={paymentBusy}
                        onPress={()=>void payAcceptedQuote(buyerOrder)}
                        style={{
                          height:53,
                          borderRadius:15,
                          backgroundColor:"#00C748",
                          flexDirection:"row",
                          alignItems:"center",
                          justifyContent:"center",
                          gap:8
                        }}
                      >
                        {paymentBusy
                          ?<ActivityIndicator color="#FFF"/>
                          :<Ionicons
                              name="logo-usd"
                              size={20}
                              color="#FFF"
                            />}
                        <Text
                          style={{
                            color:"#FFF",
                            fontSize:15,
                            fontWeight:"900"
                          }}
                        >
                          Contact seller to pay with Cash App
                        </Text>
                      </Pressable>}
                  </View>;
                })}
              </ScrollView>}
    </SafeAreaView>
  </Modal>

  <Modal
    visible={cashConfirmation!==null}
    transparent
    animationType="fade"
    statusBarTranslucent
    onRequestClose={()=>setCashConfirmation(null)}
  >
    <View
      style={{
        flex:1,
        backgroundColor:"rgba(2,12,8,0.82)",
        justifyContent:"center",
        paddingHorizontal:22
      }}
    >
      <View
        style={{
          borderRadius:30,
          overflow:"hidden",
          backgroundColor:"#F8FBF8",
          borderWidth:1,
          borderColor:"rgba(221,242,91,0.55)",
          shadowColor:"#000000",
          shadowOpacity:0.35,
          shadowRadius:28,
          shadowOffset:{width:0,height:16},
          elevation:18
        }}
      >
        <View
          style={{
            backgroundColor:"#0B4A32",
            paddingHorizontal:24,
            paddingTop:27,
            paddingBottom:24
          }}
        >
          <View
            style={{
              flexDirection:"row",
              alignItems:"center",
              justifyContent:"space-between"
            }}
          >
            <View
              style={{
                width:54,
                height:54,
                borderRadius:18,
                backgroundColor:"#DDF25B",
                alignItems:"center",
                justifyContent:"center"
              }}
            >
              <Ionicons
                name="shield-checkmark"
                size={29}
                color="#0B4A32"
              />
            </View>

            <View
              style={{
                borderRadius:999,
                paddingHorizontal:12,
                paddingVertical:7,
                backgroundColor:"rgba(255,255,255,0.11)",
                borderWidth:1,
                borderColor:"rgba(255,255,255,0.18)"
              }}
            >
              <Text
                style={{
                  color:"#DDF25B",
                  fontSize:10,
                  fontWeight:"900",
                  letterSpacing:1.3
                }}
              >
                SECURE REVIEW
              </Text>
            </View>
          </View>

          <Text
            style={{
              color:"#DDF25B",
              fontSize:11,
              fontWeight:"900",
              letterSpacing:2.2,
              marginTop:22
            }}
          >
            CASH APP PAYMENT REVIEW
          </Text>

          <Text
            style={{
              color:"#FFFFFF",
              fontSize:28,
              lineHeight:34,
              fontWeight:"900",
              marginTop:7
            }}
          >
            Confirm recipient
          </Text>

          <Text
            style={{
              color:"rgba(255,255,255,0.72)",
              fontSize:14,
              lineHeight:21,
              marginTop:7
            }}
          >
            Review every detail before opening Cash App.
          </Text>
        </View>

        <View style={{padding:22}}>
          <View
            style={{
              borderRadius:22,
              backgroundColor:"#FFFFFF",
              borderWidth:1,
              borderColor:"#DCE8DF",
              padding:18
            }}
          >
            <Text
              style={{
                color:"#7B877F",
                fontSize:10,
                fontWeight:"900",
                letterSpacing:1.4
              }}
            >
              EXPECTED CASH APP NAME
            </Text>

            <Text
              style={{
                color:"#15251C",
                fontSize:21,
                fontWeight:"900",
                marginTop:6
              }}
              numberOfLines={2}
            >
              {cashConfirmation?.sellerName||"Seller"}
            </Text>

            <View
              style={{
                alignSelf:"flex-start",
                marginTop:12,
                borderRadius:999,
                backgroundColor:"#E8F8EE",
                borderWidth:1,
                borderColor:"#B9E5C9",
                paddingHorizontal:14,
                paddingVertical:9
              }}
            >
              <Text
                style={{
                  color:"#68776E",
                  fontSize:9,
                  fontWeight:"900",
                  letterSpacing:1.2,
                  marginBottom:3
                }}
              >
                CASH APP $CASHTAG
              </Text>

              <Text
                selectable
                style={{
                  color:"#07813E",
                  fontSize:17,
                  fontWeight:"900",
                  letterSpacing:0.2
                }}
              >
                ${cashConfirmation?.cashTag||""}
              </Text>
            </View>

            <View
              style={{
                height:1,
                backgroundColor:"#E4ECE6",
                marginVertical:17
              }}
            />

            <View
              style={{
                flexDirection:"row",
                alignItems:"flex-end",
                justifyContent:"space-between",
                gap:15
              }}
            >
              <View style={{flex:1}}>
                <Text
                  style={{
                    color:"#7B877F",
                    fontSize:10,
                    fontWeight:"900",
                    letterSpacing:1.4
                  }}
                >
                  TOTAL PAYMENT
                </Text>
                <Text
                  style={{
                    color:"#08733C",
                    fontSize:27,
                    fontWeight:"900",
                    marginTop:5
                  }}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {cashConfirmation?.amountText||""}
                </Text>
              </View>

              <View style={{alignItems:"flex-end"}}>
                <Text
                  style={{
                    color:"#7B877F",
                    fontSize:10,
                    fontWeight:"900",
                    letterSpacing:1.2
                  }}
                >
                  ORDER
                </Text>
                <Text
                  selectable
                  style={{
                    color:"#34463B",
                    fontSize:12,
                    fontWeight:"800",
                    marginTop:7
                  }}
                >
                  {cashConfirmation?.orderReference||""}
                </Text>
              </View>
            </View>
          </View>

          <View
            style={{
              flexDirection:"row",
              alignItems:"flex-start",
              gap:11,
              marginTop:15,
              borderRadius:17,
              backgroundColor:"#FFF8E4",
              borderWidth:1,
              borderColor:"#EED68A",
              padding:14
            }}
          >
            <Ionicons
              name="warning-outline"
              size={21}
              color="#8A6200"
            />
            <Text
              style={{
                flex:1,
                color:"#624900",
                fontSize:12,
                lineHeight:18,
                fontWeight:"700"
              }}
            >
              Confirm that Cash App displays this exact name and
              $Cashtag before you pay. If either one is different,
              cancel immediately.
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={()=>{
              setCashConfirmation(null);
              openSokoProductConversation();
            }}
            style={{
              marginTop:19,
              minHeight:58,
              borderRadius:18,
              backgroundColor:"#00C748",
              flexDirection:"row",
              alignItems:"center",
              justifyContent:"center",
              gap:10,
              shadowColor:"#00A53E",
              shadowOpacity:0.25,
              shadowRadius:14,
              shadowOffset:{width:0,height:8},
              elevation:7
            }}
          >
            <Ionicons
              name="logo-usd"
              size={23}
              color="#FFFFFF"
            />
            <Text
              style={{
                color:"#FFFFFF",
                fontSize:17,
                fontWeight:"900"
              }}
            >
              Contact seller to pay with Cash App
            </Text>
            <Ionicons
              name="arrow-forward"
              size={21}
              color="#FFFFFF"
            />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={()=>setCashConfirmation(null)}
            style={{
              minHeight:51,
              alignItems:"center",
              justifyContent:"center",
              marginTop:7
            }}
          >
            <Text
              style={{
                color:"#5D6B62",
                fontSize:15,
                fontWeight:"800"
              }}
            >
              Cancel
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  </Modal>

  <Modal
    visible={checkoutOpen}
    animationType="slide"
    onRequestClose={()=>setCheckoutOpen(false)}
  >
    <View style={styles.checkoutScreen}>
      <View style={[styles.checkoutHeader,{paddingTop:insets.top}]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close checkout"
          onPress={()=>setCheckoutOpen(false)}
          style={styles.checkoutBack}
        >
          <Ionicons name="chevron-back" size={24} color="#FFF"/>
        </Pressable>

        <View style={styles.checkoutHeaderBody}>
          <Text style={styles.checkoutEyebrow}>SOKO SECURE CHECKOUT</Text>
          <Text maxFontSizeMultiplier={1.2} style={styles.checkoutTitle}>Delivery Details</Text>
          <Text maxFontSizeMultiplier={1.2} style={styles.checkoutHeaderCopy}>
            Where should the seller send your order?
          </Text>
        </View>

        <View style={styles.checkoutHeaderSpacer}/>
      </View>

      <ScrollView
        style={styles.checkoutScroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[styles.checkoutContent,{paddingBottom:Math.max(24,insets.bottom+16)}]}
      >
        <View style={styles.checkoutProduct}>
          <SokoProductPhoto uri={product.image} style={styles.checkoutImage}/>
          <View style={styles.checkoutProductBody}>
            <Text numberOfLines={2} style={styles.checkoutProductTitle}>
              {product.title}
            </Text>
            <Text style={styles.checkoutPrice}>{money(product)}</Text>
            <Text
              style={{
                color:"#167A52",
                fontSize:11,
                fontWeight:"900",
                marginTop:3
              }}
            >
              {stockAvailable===1
                ?"Last one available"
                :stockAvailable+" available"}
            </Text>
            <Text numberOfLines={1} style={styles.checkoutSeller}>
              Seller: {product.seller.shopName||product.seller.name}
            </Text>
          </View>
          <View style={styles.checkoutSecureBadge}>
            <Ionicons name="shield-checkmark" size={19} color="#176844"/>
          </View>
        </View>

        <View style={styles.checkoutNotice}>
          <Ionicons name="location-outline" size={22} color="#176844"/>
          <Text style={styles.checkoutNoticeText}>
            Jaza anwani sahihi. Seller atatumia taarifa hizi
            kukutumia mzigo baada ya kuthibitisha malipo.
          </Text>
        </View>

        <View style={styles.checkoutSection}>
          <View style={styles.checkoutSectionTitleRow}>
            <View style={styles.checkoutStep}>
              <Text style={styles.checkoutStepText}>1</Text>
            </View>
            <Text style={styles.checkoutSectionTitle}>Contact information</Text>
          </View>

          <View style={styles.checkoutFieldGroup}>
            <Text style={styles.checkoutLabel}>Full name *</Text>
            <TextInput
              value={delivery.fullName}
              onChangeText={value=>setDelivery(current=>({...current,fullName:value}))}
              placeholder="Your full legal name"
              placeholderTextColor="#929A95"
              autoCapitalize="words"
              maxLength={120}
              style={styles.checkoutField}
            />
          </View>

          <View style={styles.checkoutFieldGroup}>
            <Text style={styles.checkoutLabel}>Phone number *</Text>
            <TextInput
              value={delivery.phone}
              onChangeText={value=>setDelivery(current=>({...current,phone:value}))}
              placeholder="+1 214 000 0000"
              placeholderTextColor="#929A95"
              keyboardType="phone-pad"
              maxLength={30}
              style={styles.checkoutField}
            />
          </View>
        </View>

        <View style={styles.checkoutSection}>
          <View style={styles.checkoutSectionTitleRow}>
            <View style={styles.checkoutStep}>
              <Text style={styles.checkoutStepText}>2</Text>
            </View>
            <Text style={styles.checkoutSectionTitle}>Delivery address</Text>
          </View>

          <View style={styles.checkoutFieldGroup}>
            <Text style={styles.checkoutLabel}>Country *</Text>
            <TextInput
              value={delivery.country}
              onChangeText={value=>setDelivery(current=>({...current,country:value}))}
              placeholder="Country"
              placeholderTextColor="#929A95"
              autoCapitalize="words"
              maxLength={80}
              style={styles.checkoutField}
            />
          </View>

          <View style={styles.checkoutRow}>
            <View style={styles.checkoutHalf}>
              <Text style={styles.checkoutLabel}>State/Region *</Text>
              <TextInput
                value={delivery.state}
                onChangeText={value=>setDelivery(current=>({...current,state:value}))}
                placeholder="Texas"
                placeholderTextColor="#929A95"
                autoCapitalize="words"
                maxLength={100}
                style={styles.checkoutField}
              />
            </View>

            <View style={styles.checkoutHalf}>
              <Text style={styles.checkoutLabel}>City *</Text>
              <TextInput
                value={delivery.city}
                onChangeText={value=>setDelivery(current=>({...current,city:value}))}
                placeholder="Dallas"
                placeholderTextColor="#929A95"
                autoCapitalize="words"
                maxLength={100}
                style={styles.checkoutField}
              />
            </View>
          </View>

          <View style={styles.checkoutFieldGroup}>
            <Text style={styles.checkoutLabel}>Street address *</Text>
            <TextInput
              value={delivery.streetAddress}
              onChangeText={value=>setDelivery(current=>({...current,streetAddress:value}))}
              placeholder="House number and street"
              placeholderTextColor="#929A95"
              autoCapitalize="words"
              maxLength={240}
              style={styles.checkoutField}
            />
          </View>

          <View style={styles.checkoutFieldGroup}>
            <Text style={styles.checkoutLabel}>ZIP / Postal code *</Text>
            <TextInput
              value={delivery.postalCode}
              onChangeText={value=>setDelivery(current=>({...current,postalCode:value}))}
              placeholder="75231"
              placeholderTextColor="#929A95"
              maxLength={30}
              style={styles.checkoutField}
            />
          </View>

          <View style={styles.checkoutFieldGroup}>
            <Text style={styles.checkoutLabel}>
              Delivery instructions (optional)
            </Text>
            <TextInput
              value={delivery.instructions}
              onChangeText={value=>setDelivery(current=>({...current,instructions:value}))}
              placeholder="Apartment, gate code or delivery instructions"
              placeholderTextColor="#929A95"
              multiline
              maxLength={500}
              style={[styles.checkoutField,styles.checkoutInstructions]}
            />
          </View>
        </View>

        <View style={styles.checkoutPrivacy}>
          <Ionicons name="lock-closed" size={18} color="#176844"/>
          <Text style={styles.checkoutPrivacyText}>
            Delivery details are shared only with this order's seller.
          </Text>
        </View>

        {(deliveryLoading||deliveryRates.length>0||!!deliveryError)&&(
          <View style={styles.checkoutSection} accessibilityRole="radiogroup">
            <View style={styles.checkoutSectionTitleRow}>
              <View style={styles.checkoutStep}>
                <Text style={styles.checkoutStepText}>3</Text>
              </View>
              <Text style={styles.checkoutSectionTitle}>
                Choose delivery
              </Text>
              {deliveryRates.length>0?
                <Text style={styles.deliveryCount}>{deliveryRates.length} option{deliveryRates.length===1?"":"s"}</Text>
              :null}
              {deliveryLoading?<ActivityIndicator color="#176844"/>:null}
            </View>
            {!!deliveryNotice?
              <Text style={styles.deliveryInlineNotice}>{deliveryNotice}</Text>
            :null}
            {!!deliveryError?
              <View style={styles.deliveryInlineError}>
                <Text style={styles.deliveryInlineErrorText}>{deliveryError}</Text>
                <Pressable
                  onPress={()=>void loadDeliveryRates()}
                  disabled={deliveryLoading}
                  style={styles.deliveryRetry}
                  accessibilityRole="button"
                  accessibilityLabel="Retry delivery rates"
                >
                  <Text style={styles.deliveryRetryText}>Retry</Text>
                </Pressable>
              </View>
            :null}
            {deliveryLoading&&deliveryRates.length===0?
              [0,1,2].map(index=>
                <View key={"delivery-skeleton-"+index} style={styles.deliverySkeleton}/>
              )
            :null}

            {deliveryRates.map(rate=>{
              const active=
                String(selectedDelivery?.id||"")===
                String(rate.id||"");
              const isCheapest=
                deliveryRates.length>1 &&
                cheapestDeliveryAmount!==null &&
                Number(rate.amount)===cheapestDeliveryAmount;
              const isFastest=
                deliveryRates.length>1 &&
                fastestDeliveryDays!==null &&
                Number(rate.estimatedDays)===fastestDeliveryDays;
              const carrier=String(rate.provider||"").trim();
              const service=String(rate.service||"").trim();
              const estimate=conciseDeliveryEstimate(rate);
              return (
                <Pressable
                  key={String(rate.id)}
                  onPress={()=>setSelectedDelivery(rate)}
                  accessibilityRole="radio"
                  accessibilityState={{selected:active}}
                  accessibilityLabel={[carrier,service,estimate,deliveryMoney(rate.currency,rate.amount,product.currency)].filter(Boolean).join(", ")}
                  style={[
                    styles.deliveryRate,
                    active&&styles.deliveryRateActive
                  ]}
                >
                  <View style={styles.deliveryRateIcon}>
                    <Ionicons
                      name={
                        rate.id==="pickup"
                          ?"storefront-outline"
                          :rate.id==="seller-local-delivery"
                            ?"car-outline"
                            :"cube-outline"
                      }
                      size={18}
                      color="#176844"
                    />
                  </View>
                  <View style={styles.deliveryRateBody}>
                    <Text numberOfLines={2} maxFontSizeMultiplier={1.2} style={styles.deliveryRateTitle}>
                      {[carrier,service].filter(Boolean).join(" · ")||"Delivery option"}
                    </Text>
                    {(isCheapest||isFastest)?
                      <View style={styles.deliveryBadgeRow}>
                        {isCheapest?<Text style={styles.deliveryBadgeCheap}>CHEAPEST</Text>:null}
                        {isFastest?<Text style={styles.deliveryBadgeFast}>FASTEST</Text>:null}
                      </View>
                    :null}
                    {!!estimate?
                      <Text numberOfLines={2} maxFontSizeMultiplier={1.2} style={styles.deliveryRateCopy}>{estimate}</Text>
                    :null}
                  </View>
                  <View style={styles.deliveryRateMeta}>
                    <Text maxFontSizeMultiplier={1.15} style={styles.deliveryRatePrice}>
                      {deliveryMoney(rate.currency,rate.amount,product.currency)}
                    </Text>
                    <Ionicons
                      name={active?"checkmark-circle":"ellipse-outline"}
                      size={22}
                      color={active?"#176844":"#AAB5AE"}
                    />
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        {deliveryMode==="quote_required"&&(
          <View style={styles.deliveryQuoteCard}>
            <Ionicons
              name="document-text-outline"
              size={25}
              color="#8A6200"
            />
            <View style={{flex:1}}>
              <Text style={styles.deliveryQuoteTitle}>
                Delivery quote required
              </Text>
              <Text style={styles.deliveryQuoteCopy}>
                {deliveryReason||
                  "Seller must calculate delivery before payment."}
              </Text>
            </View>
          </View>
        )}

        <View style={styles.checkoutTotalsCard}>
          <Text style={styles.checkoutSummaryTitle}>Order summary</Text>
          <View style={styles.checkoutAmountRow}>
            <Text style={styles.checkoutAmountLabel} numberOfLines={1}>Item</Text>
            <Text style={styles.checkoutAmountValue}>{formatMoneyAmount(summaryCurrency||product.currency,summaryItemAmount)}</Text>
          </View>
          <View style={styles.checkoutAmountRow}>
            <Text style={styles.checkoutAmountLabel} numberOfLines={1}>
              {selectedDelivery
                ? "Shipping · "+(String(selectedDelivery.service||selectedDelivery.provider||"Delivery").trim()||"Delivery")
                : "Shipping"}
            </Text>
            <Text style={styles.checkoutAmountValue}>
              {selectedDelivery
                ? deliveryMoney(summaryCurrency||selectedDelivery.currency,summaryShippingAmount,product.currency)
                : deliveryMode==="quote_required"
                  ? "Quote required"
                  : "—"}
            </Text>
          </View>
          {!shippingMatches&&selectedDelivery?
            <Text style={styles.deliveryInlineNotice}>
              Shipping currency {shippingCurrency} does not match item currency {itemCurrency}. Payment is locked.
            </Text>
          :null}
          <View style={styles.checkoutAmountDivider}/>
          <View style={styles.checkoutAmountRow}>
            <Text style={styles.checkoutTotalLabel}>Total</Text>
            <Text maxFontSizeMultiplier={1.15} style={styles.checkoutTotalPrice}>
              {summaryTotal!==null
                ? formatMoneyAmount(summaryCurrency||itemCurrency,summaryTotal)
                : money(product)}
            </Text>
          </View>
        </View>
        <View style={styles.checkoutSection}>
          <Text style={styles.checkoutSummaryTitle}>Payment method</Text>
          {product.paymentOptions?.stripeCardAvailable===true?
            <Pressable
              onPress={()=>{
                setCheckoutPaymentMethod("stripe_card");
                setCheckoutPaymentError(stripeCardCheckoutConfigMessage());
              }}
              accessibilityRole="radio"
              accessibilityState={{selected:checkoutPaymentMethod==="stripe_card"}}
              style={[
                styles.deliveryRate,
                checkoutPaymentMethod==="stripe_card"&&styles.deliveryRateActive,
                !isExpoStripePublishableConfigured()&&styles.submitDisabled
              ]}
            >
              <View style={styles.deliveryRateIcon}>
                <Ionicons name="card-outline" size={18} color="#176844"/>
              </View>
              <View style={styles.deliveryRateBody}>
                <Text style={styles.deliveryRateTitle}>Card</Text>
                <Text style={styles.deliveryRateCopy}>Debit or credit card</Text>
              </View>
              <Ionicons
                name={checkoutPaymentMethod==="stripe_card"?"checkmark-circle":"ellipse-outline"}
                size={22}
                color={checkoutPaymentMethod==="stripe_card"?"#176844":"#AAB5AE"}
              />
            </Pressable>
          :null}
          {paymentMethods.includes("cash_app")?
            <Pressable
              onPress={()=>setCheckoutPaymentMethod("cash_app")}
              accessibilityRole="radio"
              accessibilityState={{selected:checkoutPaymentMethod==="cash_app"}}
              style={[
                styles.deliveryRate,
                checkoutPaymentMethod==="cash_app"&&styles.deliveryRateActive
              ]}
            >
              <View style={styles.deliveryRateIcon}>
                <Ionicons name="logo-usd" size={18} color="#176844"/>
              </View>
              <View style={styles.deliveryRateBody}>
                <Text style={styles.deliveryRateTitle}>Cash App</Text>
                <Text style={styles.deliveryRateCopy}>Contact seller to pay with Cash App</Text>
              </View>
              <Ionicons
                name={checkoutPaymentMethod==="cash_app"?"checkmark-circle":"ellipse-outline"}
                size={22}
                color={checkoutPaymentMethod==="cash_app"?"#176844":"#AAB5AE"}
              />
            </Pressable>
          :null}
        </View>
        {!!checkoutPaymentNotice?
          <Text style={styles.deliveryInlineNotice}>{checkoutPaymentNotice}</Text>
        :null}
        {!!checkoutPaymentError?
          <View style={styles.deliveryInlineError}>
            <Text style={styles.deliveryInlineErrorText}>{checkoutPaymentError}</Text>
          </View>
        :null}

        <Pressable
          disabled={continueDisabled}
          onPress={()=>{
            if(checkoutPaymentPhase==="awaiting"||checkoutPaymentPhase==="confirming"){
              void refreshCheckoutPaymentStatusRef.current();
              return;
            }
            void continueSecureCheckout();
          }}
          style={[
            styles.continuePayment,
            continueDisabled&&styles.submitDisabled,
            deliveryMode==="quote_required"&&styles.quoteButton
          ]}
        >
          {paymentBusy||deliveryLoading||checkoutPaymentPhase==="preparing"||checkoutPaymentPhase==="confirming"
            ? <ActivityIndicator color="#FFF"/>
            : <Ionicons
                name={
                  deliveryMode==="quote_required"
                    ?"document-text-outline"
                    :checkoutPaymentPhase==="paid"
                      ?"checkmark-circle"
                      :selectedDelivery
                        ?checkoutPaymentMethod==="stripe_card"
                          ?"card-outline"
                          :"logo-usd"
                        :"calculator-outline"
                }
                size={20}
                color="#FFF"
              />}
          <Text style={styles.continuePaymentText}>
            {deliveryLoading||checkoutBusyStage==="verifying_delivery"
              ?"Verifying delivery"
              :checkoutBusyStage==="creating_order"
                ?"Creating secure order"
                :checkoutBusyStage==="opening_card"
                  ?"Opening card payment"
                    :checkoutPaymentPhase==="preparing"
                ?"Preparing secure payment…"
                :checkoutPaymentPhase==="confirming"
                  ?"Confirming payment…"
                  :checkoutPaymentPhase==="awaiting"
                  ?"Waiting for confirmation"
                  :checkoutPaymentPhase==="paid"
                    ?"Payment confirmed"
                    :checkoutPaymentPhase==="failed"
                      ?"Retry"
                      :deliveryMode==="quote_required"
                        ?"Request Delivery Quote"
                        :selectedDelivery
                          ?checkoutPaymentMethod==="stripe_card"
                            ?"Pay securely by card"
                            :"Contact seller to pay with Cash App"
                          :deliveryRates.length>0
                            ?"Choose a delivery option"
                            :"Calculate Delivery"}
          </Text>
          <Ionicons name="arrow-forward" size={18} color="#FFF"/>
        </Pressable>
        {checkoutPaymentPhase==="awaiting"||checkoutPaymentPhase==="confirming"?
          <Pressable
            onPress={()=>void refreshCheckoutPaymentStatusRef.current()}
            style={styles.deliveryRetry}
            accessibilityRole="button"
            accessibilityLabel="Check payment status"
          >
            <Text style={styles.deliveryRetryText}>Check payment status</Text>
          </Pressable>
        :null}
      </ScrollView>
    </View>
  </Modal><Modal visible={paymentOpen} transparent animationType="slide" onRequestClose={()=>setPaymentOpen(false)}><View style={styles.paymentBackdrop}><SafeAreaView style={styles.paymentSheet}><View style={styles.sheetHandle}/><View style={styles.sheetHeader}><View><Text style={styles.sheetEyebrow}>SOKO SECURE ORDER</Text><Text style={styles.sheetTitle}>{paymentSent?"Payment submitted":"Confirm your payment"}</Text></View><Pressable style={styles.sheetClose} onPress={()=>setPaymentOpen(false)}><Ionicons name="close" size={22} color="#405047"/></Pressable></View>{paymentSent?<View style={styles.successCard}><View style={styles.successIcon}><Ionicons name="checkmark" size={28} color="#FFF"/></View><Text style={styles.successTitle}>Proof received</Text><Text style={styles.successCopy}>Seller atathibitisha fedha. Usafirishaji hautaanza mpaka malipo yaidhinishwe.</Text><View style={styles.statusPill}><View style={styles.statusDot}/><Text style={styles.statusText}>PAYMENT SUBMITTED</Text></View><Pressable style={styles.doneButton} onPress={()=>setPaymentOpen(false)}><Text style={styles.doneText}>Done</Text></Pressable></View>:<ScrollView contentContainerStyle={styles.paymentForm} keyboardShouldPersistTaps="handled"><View style={styles.orderSummary}><SokoProductPhoto uri={product.image} style={styles.orderImage}/><View style={styles.orderBody}><Text numberOfLines={1} style={styles.orderTitle}>{product.title}</Text><Text style={styles.orderPrice}>{paymentAmountLabel()}</Text>{!!paymentDeliveryLabel()&&<Text style={{color:"#68756D",fontSize:10,fontWeight:"800",marginTop:2}}>{paymentDeliveryLabel()}</Text>}<Text numberOfLines={1} style={styles.orderSeller}>To: {product.seller.name}</Text><Text style={styles.orderTag}>${product.paymentOptions?.cashTag}</Text></View></View><View style={styles.stepCard}><View style={styles.stepNumber}><Text style={styles.stepNumberText}>1</Text></View><View style={styles.stepBody}><Text style={styles.stepTitle}>Complete payment in Cash App</Text><Text style={styles.stepCopy}>Tuma kiasi kamili kinachoonyeshwa juu. Kiasi hicho kinajumuisha bidhaa na delivery iliyokubaliwa.</Text><Pressable style={styles.reopenCash} onPress={()=>void beginCashAppPayment()} disabled={paymentBusy}><Ionicons name="logo-usd" size={18} color="#FFF"/><Text style={styles.reopenCashText}>Open Cash App again</Text></Pressable></View></View><View style={styles.stepCard}>
  <View style={styles.stepNumber}>
    <Text style={styles.stepNumberText}>2</Text>
  </View>

  <View style={styles.stepBody}>
    <Text style={styles.stepTitle}>
      Upload payment screenshots
    </Text>

    <Text style={styles.stepCopy}>
      Chagua screenshot 1 hadi 5. Mfumo hautakata picha; scanner itasoma picha nzima.
    </Text>

    <Pressable
      style={[
        styles.proofPicker,
        proofImages.length>0&&
          styles.proofPickerReady
      ]}
      onPress={()=>void pickPaymentProof()}
      disabled={paymentBusy}
    >
      <Ionicons
        name="images-outline"
        size={28}
        color="#176844"
      />

      <Text style={styles.proofPickerTitle}>
        {proofImages.length
          ?"Choose different screenshots"
          :"Choose screenshots"}
      </Text>

      <Text style={styles.proofPickerCopy}>
        1–5 images · no crop · up to 6 MB each
      </Text>
    </Pressable>

    {proofImages.length>0&&<>
      <Text
        style={{
          color:"#176844",
          fontSize:12,
          fontWeight:"900",
          marginTop:3
        }}
      >
        {proofImages.length}/5 screenshots selected
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingVertical:4,
          paddingRight:6
        }}
      >
        {proofImages.map(
          (proof,index)=>
            <View
              key={proof.uri+"-"+index}
              style={{
                width:220,
                marginRight:10
              }}
            >
              <Image
                source={{uri:proof.uri}}
                style={{
                  width:220,
                  height:320,
                  borderRadius:13,
                  backgroundColor:"#EDF1EE"
                }}
                resizeMode="contain"
              />

              <Text
                style={{
                  color:"#657068",
                  fontSize:10,
                  fontWeight:"800",
                  textAlign:"center",
                  marginTop:4
                }}
              >
                Screenshot {index+1}
              </Text>
            </View>
        )}
      </ScrollView>

      <View
        style={{
          backgroundColor:"#F3F8F5",
          borderWidth:1,
          borderColor:"#D4E4DA",
          borderRadius:14,
          padding:12,
          gap:7
        }}
      >
        <Text
          style={{
            color:"#176844",
            fontSize:10,
            fontWeight:"900",
            letterSpacing:1
          }}
        >
          RECEIPT SCAN
        </Text>

        <Text
          style={{
            color:"#344139",
            fontSize:12,
            fontWeight:"800"
          }}
        >
          Scanned: {receiptScan.scannedCount}/{proofImages.length}
        </Text>

        <Text style={{color:"#4D5C53",fontSize:12}}>
          Reference: {reference||"Not detected"}
        </Text>

        <Text style={{color:"#4D5C53",fontSize:12}}>
          Name / recipient: {receiptScan.recipient||"Not detected"}
        </Text>

        <Text style={{color:"#4D5C53",fontSize:12}}>
          CashTag: {receiptScan.cashTag||"Not detected"}
        </Text>

        <Text style={{color:"#4D5C53",fontSize:12}}>
          Amount: {receiptScan.amounts.length
            ?receiptScan.amounts.join(", ")
            :"Not detected"}
        </Text>

        <Text style={{color:"#4D5C53",fontSize:12}}>
          Status: {receiptScan.status||"Not detected"}
        </Text>

        <Text style={{color:"#4D5C53",fontSize:12}}>
          Date / time: {receiptScan.dateTime||"Not detected"}
        </Text>

        <Text style={{color:"#4D5C53",fontSize:12}}>
          Fees: {receiptScan.fees||"Not detected"}
        </Text>

        <Text
          style={{
            color:"#80633D",
            fontSize:10,
            lineHeight:15,
            marginTop:2
          }}
        >
          OCR ni taarifa ya kusaidia tu. Seller lazima ahakikishe transaction halisi kwenye Cash App account yake.
        </Text>
      </View>
    </>}
  </View>
</View>
<View style={styles.fieldGroup}><Text style={styles.fieldLabel}>Transaction reference</Text><TextInput value={reference} onChangeText={setReference} placeholder="Example: Cash App confirmation number" placeholderTextColor="#929A95" style={styles.field} maxLength={120}/></View><View style={styles.fieldGroup}><Text style={styles.fieldLabel}>Message to seller (optional)</Text><TextInput value={buyerNote} onChangeText={setBuyerNote} placeholder="Example: I have completed the payment." placeholderTextColor="#929A95" style={[styles.field,styles.noteField]} multiline maxLength={500}/></View><View style={styles.dateRow}><Ionicons name="calendar-outline" size={18} color="#176844"/><Text style={styles.dateText}>Payment date: {new Date().toLocaleDateString()}</Text></View><Text style={styles.proofWarning}>Screenshot pekee si uthibitisho wa mwisho. Seller lazima ahakikishe fedha zimeingia kwenye account yake.</Text><Pressable style={[styles.submitProof,(proofImages.length===0||reference.trim().length<3||paymentBusy)&&styles.submitDisabled]} onPress={()=>void submitPaymentProof()} disabled={proofImages.length===0||reference.trim().length<3||paymentBusy}>{paymentBusy?<ActivityIndicator color="#FFF"/>:<Ionicons name="shield-checkmark" size={20} color="#FFF"/>}<Text style={styles.submitProofText}>{paymentBusy?"Submitting…":"Submit payment proof"}</Text></Pressable></ScrollView>}</SafeAreaView></View></Modal></View>;
}
function Action({icon,label,onPress,active=false}:{icon:keyof typeof Ionicons.glyphMap;label:string;onPress:()=>void;active?:boolean}){return <Pressable style={styles.action} onPress={onPress}><Ionicons name={icon} size={25} color={active?"#18724B":"#667169"}/><Text style={[styles.actionText,active&&styles.active]}>{label}</Text></Pressable>;}
const styles=StyleSheet.create({card:{alignSelf:"center",marginTop:-14,marginBottom:8,backgroundColor:"#FFF",borderColor:"#D9E7DF",borderWidth:2,borderRadius:24,overflow:"hidden",shadowColor:"#000",shadowOpacity:.18,shadowRadius:12,shadowOffset:{width:0,height:5},elevation:5},media:{position:"relative",overflow:"hidden",backgroundColor:"#EDF2EE"},cover:{width:"100%"},photoPlaceholder:{width:"100%",backgroundColor:"#EDF2EE",alignItems:"center",justifyContent:"center",gap:8},photoPlaceholderText:{color:"#5F6F68",fontSize:13,fontWeight:"700"},badge:{position:"absolute",top:14,left:14,backgroundColor:"rgba(255,255,255,0.95)",borderRadius:99,paddingHorizontal:15,paddingVertical:8},badgeText:{color:"#145D3E",fontSize:13,fontWeight:"900",letterSpacing:.8},identity:{flexDirection:"row",alignItems:"center",paddingHorizontal:15,paddingVertical:10,minHeight:98},avatar:{width:40,height:40,borderRadius:20,backgroundColor:"#145D3E",borderWidth:2,borderColor:"#DDF25B",alignItems:"center",justifyContent:"center",marginRight:11,overflow:"hidden"},avatarImage:{width:"100%",height:"100%"},avatarText:{color:"#DDF25B",fontSize:16,fontWeight:"700"},body:{flex:1,minWidth:0},sellerLine:{flexDirection:"row",alignItems:"center",gap:4},seller:{color:"#18724B",fontSize:14,fontWeight:"600",maxWidth:"88%"},title:{color:"#111511",fontSize:16,fontWeight:"600",lineHeight:20,marginTop:2},meta:{flexDirection:"row",alignItems:"center",marginTop:2},price:{color:"#18724B",fontSize:16,fontWeight:"700"},dot:{color:"#768078",marginHorizontal:7},location:{color:"#68726B",fontSize:13,fontWeight:"400",flex:1},payments:{minHeight:57,paddingHorizontal:14,paddingVertical:8,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:"#E1E8E3",flexDirection:"row",alignItems:"center",gap:10},paymentsLabel:{color:"#667169",fontSize:10,fontWeight:"900",letterSpacing:1.1},paymentList:{alignItems:"center",gap:7,paddingRight:14},paymentChip:{height:39,minWidth:126,borderRadius:13,paddingHorizontal:11,backgroundColor:"#EDF5F0",borderWidth:1.5,borderColor:"#CCE0D4",flexDirection:"row",alignItems:"center",justifyContent:"center",gap:7},cashAppChip:{backgroundColor:"#00C748",borderColor:"#00B942",shadowColor:"#00B942",shadowOpacity:.24,shadowRadius:5,shadowOffset:{width:0,height:2},elevation:3},paymentIcon:{width:26,height:26,borderRadius:9,backgroundColor:"#D8EBDF",alignItems:"center",justifyContent:"center"},cashAppIcon:{backgroundColor:"rgba(255,255,255,.20)",borderWidth:1,borderColor:"rgba(255,255,255,.35)"},paymentText:{color:"#176844",fontSize:14,fontWeight:"900"},cashAppText:{color:"#FFF",fontSize:13,fontWeight:"900"},disabledChip:{opacity:.6},checkoutScreen:{flex:1,backgroundColor:"#F7F6F2"},checkoutHeader:{paddingHorizontal:8,paddingBottom:12,backgroundColor:"#145D3E",flexDirection:"row",alignItems:"center",overflow:"hidden"},checkoutScroll:{flex:1},checkoutBack:{width:44,height:44,borderRadius:22,backgroundColor:"rgba(255,255,255,.16)",borderWidth:1,borderColor:"rgba(255,255,255,.28)",alignItems:"center",justifyContent:"center"},checkoutHeaderBody:{flex:1,alignItems:"center",paddingHorizontal:8,minWidth:0},checkoutEyebrow:{color:"#DDF25B",fontSize:10,fontWeight:"600",letterSpacing:1.2},checkoutTitle:{color:"#FFF",fontSize:27,fontWeight:"600",marginTop:2},checkoutHeaderCopy:{color:"rgba(255,255,255,.78)",fontSize:13,fontWeight:"400",marginTop:2,textAlign:"center"},checkoutHeaderSpacer:{width:44,height:44},checkoutContent:{paddingHorizontal:16,paddingTop:16,paddingBottom:24,gap:16},checkoutProduct:{minHeight:92,borderRadius:18,backgroundColor:"#FFF",borderWidth:1,borderColor:"#D9E4DC",padding:10,flexDirection:"row",alignItems:"center"},checkoutImage:{width:70,height:70,borderRadius:13,backgroundColor:"#E8EEE9"},checkoutProductBody:{flex:1,minWidth:0,paddingHorizontal:11},checkoutProductTitle:{color:"#172019",fontSize:15,fontWeight:"900"},checkoutPrice:{color:"#17784D",fontSize:17,fontWeight:"900",marginTop:3},checkoutSeller:{color:"#748078",fontSize:10,fontWeight:"700",marginTop:3},checkoutSecureBadge:{width:36,height:36,borderRadius:18,backgroundColor:"#E8F5ED",alignItems:"center",justifyContent:"center"},checkoutNotice:{borderRadius:15,backgroundColor:"#EAF5EE",padding:12,flexDirection:"row",alignItems:"center",gap:9},checkoutNoticeText:{flex:1,color:"#4A6055",fontSize:11,lineHeight:17,fontWeight:"700"},checkoutSection:{borderRadius:19,backgroundColor:"#FFF",borderWidth:1,borderColor:"#D9E5DD",padding:14,gap:12},checkoutSectionTitleRow:{flexDirection:"row",alignItems:"center",gap:9},checkoutStep:{width:28,height:28,borderRadius:14,backgroundColor:"#176844",alignItems:"center",justifyContent:"center"},checkoutStepText:{color:"#FFF",fontSize:12,fontWeight:"900"},checkoutSectionTitle:{color:"#253129",fontSize:16,fontWeight:"900"},checkoutFieldGroup:{gap:6},checkoutLabel:{color:"#435148",fontSize:11,fontWeight:"900"},checkoutField:{minHeight:48,borderRadius:13,borderWidth:1,borderColor:"#CBDACF",backgroundColor:"#FBFCFB",paddingHorizontal:12,color:"#18231C",fontSize:13},checkoutInstructions:{minHeight:82,paddingTop:12,textAlignVertical:"top"},checkoutRow:{flexDirection:"row",gap:9},checkoutHalf:{flex:1,gap:6},checkoutPrivacy:{minHeight:46,borderRadius:13,backgroundColor:"#EDF3EF",paddingHorizontal:12,flexDirection:"row",alignItems:"center",gap:8},checkoutPrivacyText:{flex:1,color:"#627068",fontSize:10,fontWeight:"700"},deliveryRate:{minHeight:82,borderRadius:14,borderWidth:1,borderColor:"#D5E1D9",backgroundColor:"#FFF",paddingHorizontal:12,paddingVertical:12,flexDirection:"row",alignItems:"center",gap:10},deliveryRateActive:{borderColor:"#188052",backgroundColor:"#ECF8F0"},deliveryRateIcon:{width:32,height:32,borderRadius:10,backgroundColor:"#E3F1E8",alignItems:"center",justifyContent:"center"},deliveryRateBody:{flex:1,minWidth:0},deliveryRateTitle:{color:"#26342B",fontSize:14,fontWeight:"600",lineHeight:18},deliveryRateCopy:{color:"#6B746E",fontSize:12,fontWeight:"400",marginTop:4,lineHeight:16},deliveryRateMeta:{alignItems:"flex-end",flexShrink:0,gap:6,marginLeft:8},deliveryRatePrice:{color:"#176844",fontSize:14,fontWeight:"700"},deliveryBadgeRow:{flexDirection:"row",flexWrap:"wrap",gap:6,marginTop:4},deliveryBadgeCheap:{color:"#176844",fontSize:9,fontWeight:"700",letterSpacing:0.4,backgroundColor:"#E8F7EE",overflow:"hidden",borderRadius:6,paddingHorizontal:6,paddingVertical:2},deliveryBadgeFast:{color:"#805C00",fontSize:9,fontWeight:"700",letterSpacing:0.4,backgroundColor:"#FFF5D9",overflow:"hidden",borderRadius:6,paddingHorizontal:6,paddingVertical:2},deliveryCount:{color:"#6B746E",fontSize:12,fontWeight:"500",marginLeft:"auto"},deliveryQuoteCard:{minHeight:76,borderRadius:16,backgroundColor:"#FFF7DF",borderWidth:1,borderColor:"#EACF7A",padding:13,flexDirection:"row",alignItems:"center",gap:10},deliveryQuoteTitle:{color:"#745200",fontSize:14,fontWeight:"900"},deliveryQuoteCopy:{color:"#806D3E",fontSize:10,lineHeight:15,fontWeight:"700",marginTop:3},checkoutTotalsCard:{borderRadius:16,backgroundColor:"#FFF",borderWidth:1,borderColor:"#D8E4DC",padding:16,gap:10,width:"100%"},checkoutSummaryTitle:{color:"#161C18",fontSize:16,fontWeight:"600"},checkoutAmountRow:{flexDirection:"row",alignItems:"center",width:"100%",gap:12},checkoutAmountLabel:{flex:1,flexShrink:1,minWidth:0,color:"#68756D",fontSize:13,fontWeight:"500"},checkoutAmountValue:{flexShrink:0,color:"#2E3C33",fontSize:13,fontWeight:"600"},checkoutAmountDivider:{height:1,backgroundColor:"#E1E8E3"},quoteButton:{backgroundColor:"#9A7100",shadowColor:"#795900"},checkoutTotal:{minHeight:67,borderRadius:16,backgroundColor:"#FFF",borderWidth:1,borderColor:"#D8E4DC",paddingHorizontal:14,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},checkoutTotalLabel:{flex:1,flexShrink:1,color:"#161C18",fontSize:15,fontWeight:"600"},checkoutTotalCopy:{color:"#8B948E",fontSize:9,fontWeight:"700",marginTop:3},checkoutTotalPrice:{flexShrink:0,color:"#176F49",fontSize:22,fontWeight:"700"},continuePayment:{height:56,minHeight:56,borderRadius:16,backgroundColor:"#00C748",paddingHorizontal:16,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:10},continueCashIcon:{width:34,height:34,borderRadius:11,backgroundColor:"rgba(255,255,255,.2)",borderWidth:1,borderColor:"rgba(255,255,255,.35)",alignItems:"center",justifyContent:"center"},continuePaymentText:{color:"#FFF",fontSize:16,fontWeight:"600"},continuePaymentSub:{color:"rgba(255,255,255,.84)",fontSize:8,fontWeight:"700",marginTop:2},paymentBackdrop:{flex:1,backgroundColor:"rgba(0,0,0,.52)",justifyContent:"flex-end"},paymentSheet:{maxHeight:"92%",backgroundColor:"#F6F9F6",borderTopLeftRadius:28,borderTopRightRadius:28,overflow:"hidden"},sheetHandle:{width:44,height:5,borderRadius:5,backgroundColor:"#C5CEC8",alignSelf:"center",marginTop:9},sheetHeader:{paddingHorizontal:18,paddingTop:12,paddingBottom:13,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:"#D3DED6",flexDirection:"row",alignItems:"center",justifyContent:"space-between"},sheetEyebrow:{color:"#17804F",fontSize:9,fontWeight:"900",letterSpacing:1.2},sheetTitle:{color:"#122019",fontSize:22,fontWeight:"900",marginTop:2},sheetClose:{width:38,height:38,borderRadius:19,backgroundColor:"#E4EBE6",alignItems:"center",justifyContent:"center"},paymentForm:{padding:16,paddingBottom:35,gap:13},orderSummary:{backgroundColor:"#FFF",borderRadius:18,padding:11,flexDirection:"row",borderWidth:1,borderColor:"#D8E4DC"},orderImage:{width:76,height:76,borderRadius:13,backgroundColor:"#E9EFEB"},orderBody:{flex:1,minWidth:0,justifyContent:"center",paddingLeft:11},orderTitle:{color:"#18221C",fontSize:16,fontWeight:"900"},orderPrice:{color:"#16784C",fontSize:18,fontWeight:"900",marginTop:2},orderSeller:{color:"#657068",fontSize:12,fontWeight:"700"},orderTag:{color:"#00A83D",fontSize:13,fontWeight:"900",marginTop:2},stepCard:{backgroundColor:"#FFF",borderRadius:17,padding:13,flexDirection:"row",gap:11,borderWidth:1,borderColor:"#DCE6DF"},stepNumber:{width:28,height:28,borderRadius:14,backgroundColor:"#176844",alignItems:"center",justifyContent:"center"},stepNumberText:{color:"#FFF",fontWeight:"900"},stepBody:{flex:1,gap:6},stepTitle:{color:"#1A271F",fontSize:15,fontWeight:"900"},stepCopy:{color:"#68736C",fontSize:12,lineHeight:17},reopenCash:{height:39,borderRadius:12,backgroundColor:"#00C748",flexDirection:"row",alignItems:"center",justifyContent:"center",gap:7,marginTop:3},reopenCashText:{color:"#FFF",fontSize:13,fontWeight:"900"},proofPicker:{minHeight:112,borderRadius:14,borderWidth:1.5,borderStyle:"dashed",borderColor:"#8DC5A5",backgroundColor:"#F3FBF6",alignItems:"center",justifyContent:"center",padding:10},proofPickerReady:{padding:3,borderStyle:"solid"},proofPreview:{width:"100%",height:150,borderRadius:11,resizeMode:"contain",backgroundColor:"#EDF1EE"},proofPickerTitle:{color:"#176844",fontWeight:"900",marginTop:4},proofPickerCopy:{color:"#7B857F",fontSize:10,marginTop:2},changeProof:{color:"#16794C",fontSize:12,fontWeight:"900",textAlign:"center"},fieldGroup:{gap:6},fieldLabel:{color:"#334139",fontSize:12,fontWeight:"900"},field:{minHeight:47,borderWidth:1,borderColor:"#CFDCD3",backgroundColor:"#FFF",borderRadius:13,paddingHorizontal:13,color:"#17221B",fontSize:14},noteField:{minHeight:82,paddingTop:12,textAlignVertical:"top"},dateRow:{height:42,borderRadius:12,backgroundColor:"#EAF4ED",paddingHorizontal:12,flexDirection:"row",alignItems:"center",gap:7},dateText:{color:"#376047",fontSize:12,fontWeight:"800"},proofWarning:{color:"#7B6641",fontSize:11,lineHeight:16,backgroundColor:"#FFF7E8",padding:11,borderRadius:11},submitProof:{height:52,borderRadius:15,backgroundColor:"#176844",flexDirection:"row",alignItems:"center",justifyContent:"center",gap:8},submitDisabled:{opacity:.5},submitProofText:{color:"#FFF",fontSize:15,fontWeight:"900"},successCard:{margin:18,backgroundColor:"#FFF",borderRadius:22,padding:22,alignItems:"center",gap:10},successIcon:{width:58,height:58,borderRadius:29,backgroundColor:"#198754",alignItems:"center",justifyContent:"center"},successTitle:{color:"#163122",fontSize:23,fontWeight:"900"},successCopy:{color:"#66736B",fontSize:14,lineHeight:21,textAlign:"center"},statusPill:{height:34,borderRadius:17,backgroundColor:"#FFF5D8",paddingHorizontal:13,flexDirection:"row",alignItems:"center",gap:7},statusDot:{width:8,height:8,borderRadius:4,backgroundColor:"#E2A916"},statusText:{color:"#80610C",fontSize:10,fontWeight:"900",letterSpacing:.8},doneButton:{height:48,alignSelf:"stretch",borderRadius:14,backgroundColor:"#176844",alignItems:"center",justifyContent:"center",marginTop:4},doneText:{color:"#FFF",fontSize:15,fontWeight:"900"},commerceActions:{height:62,paddingHorizontal:10,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:"#D8E0DA",flexDirection:"row",alignItems:"center",justifyContent:"space-between"},contactButton:{height:42,minWidth:138,paddingHorizontal:14,borderRadius:14,backgroundColor:"#176844",flexDirection:"row",alignItems:"center",justifyContent:"center",gap:7,shadowColor:"#176844",shadowOpacity:.24,shadowRadius:6,shadowOffset:{width:0,height:3},elevation:3},contactText:{color:"#FFF",fontSize:13,fontWeight:"900"},action:{minWidth:58,alignItems:"center",gap:1,paddingVertical:4},actionText:{color:"#667169",fontSize:11,fontWeight:"700"},active:{color:"#18724B"},modal:{flex:1,backgroundColor:"#F7F9F5"},detailHeader:{minHeight:104,paddingHorizontal:16,paddingBottom:13,backgroundColor:"#145D3E",borderBottomLeftRadius:24,borderBottomRightRadius:24,flexDirection:"row",alignItems:"flex-end",shadowColor:"#061A11",shadowOpacity:.2,shadowRadius:10,shadowOffset:{width:0,height:4},elevation:5},backButton:{width:44,height:44,borderRadius:22,backgroundColor:"rgba(255,255,255,.16)",borderWidth:1,borderColor:"rgba(255,255,255,.28)",alignItems:"center",justifyContent:"center"},headerTitles:{flex:1,alignItems:"center",justifyContent:"center",paddingBottom:2},headerEyebrow:{color:"#DDF25B",fontSize:9,fontWeight:"900",letterSpacing:2},headerTitle:{color:"#FFFFFF",fontSize:18,fontWeight:"900",marginTop:2},headerSpacer:{width:44,height:44},detail:{padding:16,gap:14},detailImage:{height:330,marginRight:8,borderRadius:20,backgroundColor:"#E8EEE9"},detailTitle:{color:"#111511",fontSize:26,fontWeight:"900"},detailPrice:{color:"#18724B",fontSize:21,fontWeight:"900"},detailCopy:{color:"#4D5851",fontSize:16},sellerProfileCard:{backgroundColor:"#FFF",borderRadius:20,borderWidth:1.5,borderColor:"#D5E5DA",overflow:"hidden",shadowColor:"#173E2A",shadowOpacity:.1,shadowRadius:9,shadowOffset:{width:0,height:4},elevation:3},sellerCardTop:{padding:15,flexDirection:"row",alignItems:"center"},sellerLargeAvatar:{width:66,height:66,borderRadius:33,backgroundColor:"#145D3E",borderWidth:3,borderColor:"#DDF25B",alignItems:"center",justifyContent:"center",position:"relative",overflow:"visible"},sellerAvatarImage:{width:"100%",height:"100%",borderRadius:30},sellerLargeInitial:{color:"#DDF25B",fontSize:28,fontWeight:"900"},sellerVerifiedBadge:{position:"absolute",right:-2,bottom:-1,width:22,height:22,borderRadius:11,backgroundColor:"#187A50",borderWidth:2,borderColor:"#FFF",alignItems:"center",justifyContent:"center"},sellerCardIdentity:{flex:1,minWidth:0,paddingLeft:13},sellerCardEyebrow:{color:"#768078",fontSize:9,fontWeight:"900",letterSpacing:1.1},sellerShopName:{color:"#125C3D",fontSize:20,fontWeight:"900",marginTop:2},sellerNameLine:{flexDirection:"row",alignItems:"center",gap:5,marginTop:3},sellerCardName:{color:"#253129",fontSize:14,fontWeight:"800",maxWidth:"88%"},sellerKristoId:{color:"#748078",fontSize:11,fontWeight:"700",marginTop:2},sellerFacts:{borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:"#DDE6E0",paddingHorizontal:14,paddingVertical:5},sellerFactRow:{minHeight:52,flexDirection:"row",alignItems:"center",borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:"#E3E9E5"},sellerFactIcon:{width:34,height:34,borderRadius:11,backgroundColor:"#EAF5EE",alignItems:"center",justifyContent:"center"},churchFactIcon:{backgroundColor:"#FFF6D8"},sellerFactBody:{flex:1,minWidth:0,paddingHorizontal:10},sellerFactLabel:{color:"#879088",fontSize:8,fontWeight:"900",letterSpacing:.9},sellerFactValue:{color:"#354139",fontSize:13,fontWeight:"800",marginTop:2},sellerCardButtons:{padding:12,flexDirection:"row",gap:9},viewSellerButton:{flex:1,height:43,borderRadius:13,borderWidth:1.5,borderColor:"#BBD6C5",backgroundColor:"#F3FAF5",flexDirection:"row",alignItems:"center",justifyContent:"center",gap:6},viewSellerText:{color:"#176844",fontSize:12,fontWeight:"900"},viewChurchButton:{flex:1,height:43,borderRadius:13,backgroundColor:"#176844",flexDirection:"row",alignItems:"center",justifyContent:"center",gap:6},viewChurchText:{color:"#FFF",fontSize:12,fontWeight:"900"},sellerButtonDisabled:{opacity:.42},detailCommerceButtons:{flexDirection:"row",gap:10},buyNowButton:{flex:1,minHeight:58,borderRadius:16,backgroundColor:"#00C748",paddingHorizontal:13,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:9,shadowColor:"#00A93B",shadowOpacity:.28,shadowRadius:7,shadowOffset:{width:0,height:4},elevation:4},buyCashIcon:{width:32,height:32,borderRadius:10,backgroundColor:"rgba(255,255,255,.2)",borderWidth:1,borderColor:"rgba(255,255,255,.35)",alignItems:"center",justifyContent:"center"},buyNowText:{color:"#FFF",fontSize:15,fontWeight:"900"},buyNowSub:{color:"rgba(255,255,255,.84)",fontSize:9,fontWeight:"800",marginTop:1},visitStoreButton:{flex:1,minHeight:58,borderRadius:16,backgroundColor:"#F2FAF5",borderWidth:1.5,borderColor:"#B8D8C4",paddingHorizontal:13,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:9},visitStoreWide:{flexBasis:"100%"},visitStoreText:{color:"#176844",fontSize:14,fontWeight:"900"},visitStoreSub:{color:"#748078",fontSize:9,fontWeight:"700",marginTop:1},storeButtonPressed:{opacity:.72,transform:[{scale:.98}]},storeScreen:{flex:1,backgroundColor:"#F4F7F4"},storeHeader:{minHeight:132,paddingHorizontal:16,paddingBottom:15,backgroundColor:"#145D3E",borderBottomLeftRadius:27,borderBottomRightRadius:27,flexDirection:"row",alignItems:"flex-end",shadowColor:"#071A11",shadowOpacity:.22,shadowRadius:11,shadowOffset:{width:0,height:5},elevation:6},storeBackButton:{width:44,height:44,borderRadius:22,backgroundColor:"rgba(255,255,255,.16)",borderWidth:1,borderColor:"rgba(255,255,255,.28)",alignItems:"center",justifyContent:"center"},storeHeaderTitles:{flex:1,minWidth:0,alignItems:"center",paddingHorizontal:8},storeHeaderEyebrow:{color:"#DDF25B",fontSize:8,fontWeight:"900",letterSpacing:1.6},storeHeaderTitle:{color:"#FFF",fontSize:20,fontWeight:"900",marginTop:2,maxWidth:"100%"},storeHeaderSeller:{color:"rgba(255,255,255,.72)",fontSize:10,fontWeight:"700",marginTop:2},storeHeaderSpacer:{width:44,height:44},storeCentered:{flex:1,alignItems:"center",justifyContent:"center",padding:28,gap:13},storeLoadingText:{color:"#66736B",fontSize:14,fontWeight:"800"},storeErrorText:{color:"#6F5530",fontSize:14,lineHeight:21,textAlign:"center"},storeRetryButton:{height:44,minWidth:130,borderRadius:13,backgroundColor:"#176844",alignItems:"center",justifyContent:"center"},storeRetryText:{color:"#FFF",fontSize:13,fontWeight:"900"},storeContent:{padding:15,paddingBottom:38,gap:11},storeSummary:{minHeight:72,borderRadius:18,backgroundColor:"#FFF",borderWidth:1,borderColor:"#D9E5DD",paddingHorizontal:13,flexDirection:"row",alignItems:"center"},storeSummaryIcon:{width:42,height:42,borderRadius:13,backgroundColor:"#EAF5EE",alignItems:"center",justifyContent:"center"},storeSummaryBody:{flex:1,paddingHorizontal:11},storeSummaryTitle:{color:"#253129",fontSize:15,fontWeight:"900"},storeSummaryCopy:{color:"#768078",fontSize:11,fontWeight:"700",marginTop:2},activeStorePill:{height:27,borderRadius:14,backgroundColor:"#ECF8F0",paddingHorizontal:9,flexDirection:"row",alignItems:"center",gap:5},activeStoreDot:{width:7,height:7,borderRadius:4,backgroundColor:"#19A35B"},activeStoreText:{color:"#18724B",fontSize:8,fontWeight:"900",letterSpacing:.7},emptyStore:{marginTop:35,alignItems:"center",padding:25,gap:8},emptyStoreTitle:{color:"#354139",fontSize:19,fontWeight:"900"},emptyStoreCopy:{color:"#7A857E",fontSize:13,lineHeight:19,textAlign:"center"},storeProductCard:{minHeight:132,borderRadius:18,backgroundColor:"#FFF",borderWidth:1,borderColor:"#D9E4DC",padding:9,flexDirection:"row",shadowColor:"#173A28",shadowOpacity:.08,shadowRadius:7,shadowOffset:{width:0,height:3},elevation:2},storeProductImage:{width:116,height:116,borderRadius:14,backgroundColor:"#E8EEE9"},storeProductBody:{flex:1,minWidth:0,paddingHorizontal:12,paddingVertical:3},storeProductStatus:{alignSelf:"flex-start",borderRadius:9,backgroundColor:"#EFF6F1",paddingHorizontal:7,paddingVertical:4},storeProductStatusText:{color:"#176844",fontSize:8,fontWeight:"900",letterSpacing:.6},storeProductTitle:{color:"#172019",fontSize:16,fontWeight:"900",lineHeight:20,marginTop:6},storeProductPrice:{color:"#187A50",fontSize:17,fontWeight:"900",marginTop:5},storeProductLocation:{flexDirection:"row",alignItems:"center",gap:3,marginTop:5},storeProductLocationText:{color:"#758078",fontSize:10,fontWeight:"700",flex:1},detailPayment:{backgroundColor:"#FFF",padding:15,borderRadius:14,borderWidth:1,borderColor:"#D7E5DB",gap:7},detailPaymentTitle:{color:"#145D3E",fontSize:16,fontWeight:"900"},detailPaymentLine:{color:"#39483E",fontSize:15,fontWeight:"700"},detailContactButton:{height:50,borderRadius:15,backgroundColor:"#176844",flexDirection:"row",alignItems:"center",justifyContent:"center",gap:8},description:{color:"#263129",fontSize:16,lineHeight:24,backgroundColor:"#FFF",padding:15,borderRadius:14},notice:{color:"#68726B",fontSize:13,lineHeight:19,backgroundColor:"#EAF1EC",padding:13,borderRadius:12},pdRoot:{flex:1,backgroundColor:"#F7F6F2"},pdHeader:{minHeight:48,paddingHorizontal:4,paddingBottom:8,backgroundColor:"#145D3E",flexDirection:"row",alignItems:"center"},pdHeaderBtn:{width:44,height:44,alignItems:"center",justifyContent:"center"},pdHeaderCenter:{flex:1,alignItems:"center",justifyContent:"center"},pdHeaderKicker:{color:"#DDF25B",fontSize:8,fontWeight:"700",letterSpacing:1.4,lineHeight:10},pdHeaderTitle:{color:"#FFF",fontSize:18,fontWeight:"600",marginTop:1},pdScroll:{backgroundColor:"#F7F6F2"},pdScrollFlex:{flex:1},pdGallery:{position:"relative",overflow:"hidden",backgroundColor:"#EEECE6"},pdHero:{backgroundColor:"#EEECE6"},pdDots:{position:"absolute",left:0,right:0,bottom:10,flexDirection:"row",justifyContent:"center",gap:6},pdDot:{width:6,height:6,borderRadius:3,backgroundColor:"rgba(255,255,255,0.7)"},pdDotOn:{backgroundColor:"#145D3E"},pdSummary:{paddingHorizontal:16,paddingTop:14,paddingBottom:6,gap:8},pdNew:{alignSelf:"flex-start",backgroundColor:"#EAF5EE",borderRadius:8,paddingHorizontal:8,paddingVertical:3},pdNewText:{color:"#176844",fontSize:11,fontWeight:"600"},pdName:{color:"#161C18",fontSize:22,fontWeight:"600",lineHeight:28},pdPrice:{color:"#176844",fontSize:24,fontWeight:"700"},pdMeta:{color:"#6B746E",fontSize:13,fontWeight:"400"},pdSeller:{marginHorizontal:16,marginTop:10,padding:12,borderRadius:16,borderWidth:1,borderColor:"#DDE6E0",backgroundColor:"#FFF",flexDirection:"row",alignItems:"center"},pdSellerAvatar:{width:48,height:48,borderRadius:24,backgroundColor:"#145D3E",overflow:"hidden",alignItems:"center",justifyContent:"center"},pdSellerAvatarImg:{width:"100%",height:"100%"},pdSellerInitial:{color:"#DDF25B",fontSize:18,fontWeight:"700"},pdSellerBody:{flex:1,minWidth:0,marginHorizontal:10},pdVerified:{color:"#176844",fontSize:10,fontWeight:"600",marginBottom:2},pdStore:{color:"#145D3E",fontSize:16,fontWeight:"600"},pdSellerNameRow:{flexDirection:"row",alignItems:"center",gap:4,marginTop:2},pdSellerName:{color:"#3A433E",fontSize:13,fontWeight:"400",flexShrink:1},pdSellerPlace:{color:"#6B746E",fontSize:12,marginTop:2},pdContactMini:{minWidth:44,height:44,paddingHorizontal:12,borderRadius:12,borderWidth:1,borderColor:"#B7D4C4",backgroundColor:"#F3FAF6",alignItems:"center",justifyContent:"center"},pdContactMiniText:{color:"#176844",fontSize:13,fontWeight:"600"},pdStock:{marginHorizontal:16,marginTop:10,color:"#176844",fontSize:13,fontWeight:"600"},pdStockOut:{color:"#A23B3B"},pdSecondaryRow:{flexDirection:"row",gap:8,marginHorizontal:16,marginTop:12},pdGhost:{flex:1,minHeight:44,height:44,borderRadius:12,borderWidth:1,borderColor:"#D5E5DA",backgroundColor:"#FFF",flexDirection:"row",alignItems:"center",justifyContent:"center",gap:6},pdGhostText:{color:"#176844",fontSize:13,fontWeight:"600"},pdSection:{marginHorizontal:16,marginTop:16,paddingTop:12,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:"#E1E8E3"},pdSectionTitle:{color:"#161C18",fontSize:15,fontWeight:"600",marginBottom:6},pdSectionBody:{color:"#4D5851",fontSize:14,lineHeight:21},pdRow:{flexDirection:"row",justifyContent:"space-between",alignItems:"flex-start",paddingVertical:8,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:"#E8EEE9"},pdRowLabel:{color:"#6B746E",fontSize:13},pdRowValue:{color:"#161C18",fontSize:13,fontWeight:"600",flex:1,textAlign:"right",marginLeft:16},pdLink:{color:"#176844",fontSize:13,fontWeight:"600",marginTop:6},pdSellerInfoToggle:{flexDirection:"row",alignItems:"center",justifyContent:"space-between"},pdTextLink:{minHeight:44,justifyContent:"center"},pdNotice:{marginHorizontal:16,marginTop:16,marginBottom:8,color:"#68726B",fontSize:12,lineHeight:18},pdBuyBar:{borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:"#E1E8E3",backgroundColor:"#F7F6F2",paddingHorizontal:16,paddingTop:10,flexDirection:"row",alignItems:"center",gap:12},pdBuyPriceWrap:{maxWidth:"36%"},pdBuyPriceLabel:{color:"#6B746E",fontSize:11,fontWeight:"500"},pdBuyPrice:{color:"#176844",fontSize:18,fontWeight:"700"},pdBuyBtn:{flex:1,height:54,borderRadius:14,backgroundColor:"#176844",flexDirection:"row",alignItems:"center",justifyContent:"center",gap:8},pdBuyBtnSold:{backgroundColor:"#8B4545"},pdBuyBtnText:{color:"#FFF",fontSize:16,fontWeight:"600"},deliveryInlineNotice:{color:"#6F5205",fontSize:12,lineHeight:18,marginTop:8,marginBottom:4},deliveryInlineError:{marginTop:8,padding:12,borderRadius:12,backgroundColor:"#FCECEC",borderWidth:1,borderColor:"#E9BBBB"},deliveryInlineErrorText:{color:"#983A3A",fontSize:13,lineHeight:19,fontWeight:"600"},deliveryRetry:{marginTop:10,alignSelf:"flex-start",minHeight:44,paddingHorizontal:14,borderRadius:12,backgroundColor:"#176844",alignItems:"center",justifyContent:"center"},deliveryRetryText:{color:"#FFF",fontSize:13,fontWeight:"600"},deliverySkeleton:{minHeight:67,height:67,borderRadius:14,backgroundColor:"#EDF2EE",marginTop:8}});
