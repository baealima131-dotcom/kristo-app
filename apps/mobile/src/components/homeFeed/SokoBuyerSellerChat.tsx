import SokoPurchaseReceipt from "./SokoPurchaseReceipt";
import {useRouter} from "expo-router";
import {Ionicons} from "@expo/vector-icons";
import {sokoCheckoutJson} from "@/src/lib/sokoCheckoutApi";
import {contactSummaryText,type ContactSummary} from "./SokoContactCheckout";
import SokoChatPaymentPanel from "./SokoChatPaymentPanel";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import {
  sokoListBuyerSellerMessages,
  sokoOpenBuyerSellerConversation,
  sokoSendBuyerSellerMessage,
  type SokoBuyerSellerMessage,
  type SokoBuyerSellerThread,
} from "@/src/lib/sokoCheckoutApi";

export default function SokoBuyerSellerChat({
  visible,
  productId,
  sellerName,
  productTitle,
  onClose,
  onCard,
  checkoutSummary,
}: {
  checkoutSummary?: ContactSummary|null;
  visible: boolean;
  productId: string;
  sellerName?: string;
  productTitle?: string;
  onClose: () => void;
  onCard?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const router=useRouter();
  const callLock=React.useRef(false);
  const [calling,setCalling]=useState(false);
  const [thread, setThread] = useState<SokoBuyerSellerThread | null>(null);
  const [messages, setMessages] = useState<SokoBuyerSellerMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [summaryExpanded,setSummaryExpanded]=useState(false);
  const [enquirySent,setEnquirySent]=useState(false);
  const [sendingEnquiry,setSendingEnquiry]=useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void (async () => {
      setDraft("");setSummaryExpanded(false);setEnquirySent(false);
      setLoading(true);
      setError("");
      setThread(null);
      setMessages([]);
      try {
        const opened = await sokoOpenBuyerSellerConversation(productId);
        if (cancelled) return;
        setThread(opened);
        setMessages(await sokoListBuyerSellerMessages(opened.conversationId));
      } catch (err) {
        if (!cancelled) {
          setError(
            String((err as Error)?.message || err || "Chat could not open.")
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
  return () => {
      cancelled = true;
    };
  }, [visible, productId]);

  const send = async () => {
    if (!thread || !draft.trim()) return;
    const text = draft.trim();
    setDraft("");
    try {
      await sokoSendBuyerSellerMessage(thread.conversationId, text);
      setMessages((current) => [
        ...current,
        { id: `local-${Date.now()}`, text, mine: true, time: "Now" },
      ]);
    } catch (err) {
      setError(String((err as Error)?.message || err || "Message was not sent."));
      setDraft(text);
    }
  };

    const sendEnquiry=async(buyerNote:string='')=>{
    if(!thread||!checkoutSummary||sendingEnquiry||enquirySent)return;
    setSendingEnquiry(true);setError('');
    const text=contactSummaryText(productTitle||'Product',checkoutSummary)+(buyerNote.trim()?`\n\nBuyer note:\n${buyerNote.trim().slice(0,700)}`:'');
    try{await sokoSendBuyerSellerMessage(thread.conversationId,text);setMessages(current=>[...current,{id:`enquiry-${Date.now()}`,text,mine:true,time:'Now'}]);setEnquirySent(true);}catch(err){setError(String((err as Error)?.message||'Enquiry was not sent.'));}finally{setSendingEnquiry(false);}
  };
  const callSeller=async()=>{
    if(!thread||callLock.current)return;
    callLock.current=true;setCalling(true);setError('');
    try{
      const response=await sokoCheckoutJson('/api/church/private-call',{method:'POST',body:JSON.stringify({sokoConversationId:thread.conversationId})});
      const callId=String(response?.data?.id||'');
      if(!callId)throw new Error('Could not start seller call.');
      onClose();
      router.push({pathname:'/(tabs)/more/private-call/[callId]',params:{callId}} as any);
    }catch(err){setError(String((err as Error)?.message||'Could not start seller call.'));}
    finally{callLock.current=false;setCalling(false);}
  };
  if(checkoutSummary)return <SokoPurchaseReceipt visible={visible} productId={productId} conversationId={thread?.conversationId} sellerName={sellerName} productTitle={productTitle} summary={checkoutSummary} sent={enquirySent} sending={sendingEnquiry} calling={calling} error={error} onClose={onClose} onSend={note=>void sendEnquiry(note)} onCall={()=>void callSeller()}/>;
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.screen,{paddingTop:Math.max(insets.top,44),paddingBottom:Math.max(insets.bottom,12)}]} edges={["left", "right"]}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#1F6B46" />
            <Pressable onPress={onClose} style={styles.backLink}>
              <Text style={styles.backText}>Close</Text>
            </Pressable>
          </View>
        ) : (
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.flex}
          >
            <View style={styles.header}>
              <Pressable onPress={onClose} hitSlop={8}>
                <Text style={styles.backText}>‹</Text>
              </Pressable>
              <View style={styles.headerTitles}>
                <Text style={{fontSize:9,fontWeight:"700",letterSpacing:1.5,color:"#887440",marginBottom:3}}>SELLER CONVERSATION</Text>
                <Text numberOfLines={1} style={styles.title}>
                  {sellerName || thread?.title || "Seller"}
                </Text>
                {!!(productTitle || thread?.subtitle) && (
                  <Text style={styles.sub}>
                    {productTitle || thread?.subtitle}
                  </Text>
                )}
              </View>
            </View>
            <ScrollView style={styles.flex} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.messages}>
              {thread?<SokoChatPaymentPanel conversationId={thread.conversationId} productId={productId} onCard={onCard}/>:null}
              <View style={styles.chatDivider}><View style={styles.chatLine}/><Text style={styles.chatLabel}>MESSAGES</Text><View style={styles.chatLine}/></View>
              {!messages.length&&!error?<View style={styles.emptyChat}><Ionicons name="chatbubble-ellipses-outline" size={22} color="#9AA89D"/><Text style={styles.emptyChatText}>No messages yet</Text></View>:null}
              {!!error && <Text style={styles.error}>{error}</Text>}
              {messages.map((message) => (
                <View
                  key={message.id}
                  style={[
                    styles.bubble,
                    message.mine ? styles.mine : styles.other,
                  ]}
                >
                  <Text
                    style={[styles.bubbleText, message.mine && styles.mineText]}
                  >
                    {message.text}
                  </Text>
                  {!!message.time && (
                    <Text style={styles.time}>{message.time}</Text>
                  )}
                </View>
              ))}
            </ScrollView>
            <View style={styles.composer}>
              <TextInput
                multiline
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={() => void send()}
                placeholder="Write a message…"
                placeholderTextColor="#8A8F86"
                style={styles.input}
                editable={Boolean(thread)}
              />
              <Pressable
                onPress={() => void send()}
                style={styles.send}
                disabled={!thread}
              >
                <Text style={styles.sendText}>↑</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  previewHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},
  previewHeading:{fontSize:9,fontWeight:'700',letterSpacing:1,color:'#69796D'},
  previewBadge:{flexDirection:'row',alignItems:'center',gap:4,paddingHorizontal:8,paddingVertical:5,borderRadius:8,backgroundColor:'#FFF3D9'},
  previewSent:{backgroundColor:'#EAF3EC'},
  previewBadgeText:{fontSize:10,fontWeight:'600',color:'#8B6422'},
  previewHelp:{fontSize:11,lineHeight:16,color:'#748276',marginBottom:4},
  chatDivider:{flexDirection:'row',alignItems:'center',gap:10,marginTop:14,marginBottom:4},
  chatLine:{flex:1,height:1,backgroundColor:'#DFE7DF'},
  chatLabel:{fontSize:9,fontWeight:'700',letterSpacing:1.3,color:'#8A978D'},
  emptyChat:{alignItems:'center',gap:6,paddingVertical:18},
  emptyChatText:{fontSize:12,color:'#8A978D'},
  buyActions:{flexDirection:'row',gap:8,marginTop:6},
  buyCallButton:{flex:1,minHeight:44,paddingHorizontal:8,borderRadius:11,backgroundColor:'#FFFFFF',borderWidth:1,borderColor:'#B8CDBD',flexDirection:'row',justifyContent:'center',alignItems:'center',gap:6},
  buyCallText:{fontSize:12,fontWeight:'700',color:'#176844'},
  buyCallHint:{fontSize:11,color:'#748276',marginTop:2},
  summaryCard:{backgroundColor:'#FFFFFF',borderWidth:1,borderColor:'#DFE7DF',padding:12,borderRadius:14,gap:6},
  summaryRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  summaryLabel:{fontSize:9,fontWeight:'700',letterSpacing:1,color:'#748276'},
  summaryTotal:{fontSize:18,fontWeight:'700',color:'#176844',marginTop:3},
  summaryLink:{fontSize:12,fontWeight:'600',color:'#176844'},
  enquiryButton:{flex:1,paddingHorizontal:8,minHeight:44,borderRadius:11,backgroundColor:'#176844',justifyContent:'center',alignItems:'center',flexDirection:'row',gap:6},
  enquiryText:{fontSize:12,fontWeight:'700',color:'#FFFFFF'},
  screen: { flex: 1, backgroundColor: "#F7F8F3" },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E4E8DF",
  },
  headerTitles: { flex: 1 },
  backLink: { marginTop: 12 },
  backText: { fontSize: 28, color: "#171A16", fontWeight: "600" },
  title: { fontSize: 16, fontWeight: "700", color: "#171A16" },
  sub: { color: "#74796F", fontSize: 12 },
  error: { color: "#8A4B16", paddingHorizontal: 16, marginBottom: 8 },
  messages: { padding: 14, gap: 8, flexGrow: 1 },
  bubble: {
    maxWidth: "80%",
    borderRadius: 16,
    padding: 10,
    backgroundColor: "#FFF",
  },
  mine: { alignSelf: "flex-end", backgroundColor: "#1F6B46" },
  other: { alignSelf: "flex-start" },
  bubbleText: { color: "#171A16" },
  mineText: { color: "#FFF" },
  time: { fontSize: 10, color: "#9AA39A", marginTop: 4 },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 8,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: "#E4E8DF",
  },
  input: {
    flex: 1,
    maxHeight: 88,
    minHeight: 44,
    borderRadius: 16,
    backgroundColor: "#F1F4EE",
    paddingHorizontal: 14,
    color: "#171A16",
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#1F6B46",
    alignItems: "center",
    justifyContent: "center",
  },
  sendText: { color: "#FFF", fontSize: 18, fontWeight: "900" },
});
