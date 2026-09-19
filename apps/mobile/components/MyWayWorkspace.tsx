import React, { useState } from "react";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { products, formatPrice } from "@/src/lib/myway-soko/data";
import type { Product } from "@/src/lib/myway-soko/types";

export default function MyWayWorkspace() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>(products);
  const [selected, setSelected] = useState<Product | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const note = (message: string) => setEvents(old => [`${new Date().toLocaleTimeString()} · ${message}`, ...old].slice(0, 6));
  function search() {
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const found = products.filter(p => {
      const text = [p.title, p.category, p.location, p.seller.name, p.condition].join(" ").toLocaleLowerCase();
      return terms.every(term => text.includes(term));
    });
    setResults(found); setSelected(null);
    note(`Utafutaji umekamilika: bidhaa ${found.length} kati ya ${products.length}.`);
  }
  return <View style={s.shell}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} style={s.heading}
      onPress={() => { setOpen(!open); if (!open) note("Screen ya SOKO imefunguliwa."); }}>
      <Ionicons name="storefront-outline" color="#DDF25B" size={24}/>
      <View style={{flex:1}}><Text style={s.title}>Screen ya kazi</Text><Text style={s.muted}>SOKO · Tafuta na chunguza bidhaa</Text></View>
      <Ionicons name={open ? "chevron-up" : "chevron-down"} color="#DDF25B" size={20}/>
    </Pressable>
    {open && <View style={s.body}>
      <Text style={s.badge}>SOKO / BIDHAA ZA MFANO</Text>
      <Text style={s.muted}>Katalogi ya majaribio kutoka SOKO v0.2.0. Bei, wauzaji na bidhaa hizi hazijathibitishwa kuwa zinapatikana sasa.</Text>
      <View style={s.search}>
        <TextInput style={s.input} value={query} onChangeText={setQuery} placeholder="Mfano: iPhone au Dallas"
          placeholderTextColor="#8A96A5" accessibilityLabel="Tafuta bidhaa SOKO" returnKeyType="search" onSubmitEditing={search} maxLength={120}/>
        <Pressable accessibilityRole="button" accessibilityLabel="Tafuta" style={s.go} onPress={search}><Ionicons name="search" size={22} color="#0B121A"/></Pressable>
      </View>
      <Text style={s.label}>MATOKEO · {results.length}</Text>
      {!results.length && <Text style={s.muted}>Hakuna bidhaa inayolingana. Jaribu jina, mji au category nyingine.</Text>}
      {results.map(p => <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`Chunguza ${p.title}`} style={[s.product, selected?.id===p.id && s.chosen]}
        onPress={() => {setSelected(p); note(`Maelezo yamefunguliwa: ${p.title}.`);}}>
        <Image source={{uri:p.image}} style={s.image}/><View style={{flex:1}}><Text style={s.title}>{p.title}</Text><Text style={s.price}>{formatPrice(p.price,p.currency)}</Text><Text style={s.muted}>{p.location}</Text></View>
        <Ionicons name="chevron-forward" size={17} color="#9FA9B8"/>
      </Pressable>)}
      {selected && <View style={s.detail}>
        <Text style={s.label}>UCHUNGUZI WA TAARIFA</Text>
        <Text style={s.title}>{selected.title}</Text>
        <Text style={s.muted}>Muuzaji wa mfano: {selected.seller.name}{"\n"}Category: {selected.category}{"\n"}Hali iliyoandikwa: {selected.condition}{"\n"}Bei iliyoandikwa: {formatPrice(selected.price, selected.currency)}</Text>
        <Text style={s.muted}>Kabla ya kununua: thibitisha bidhaa ipo, hali yake, utambulisho wa muuzaji na gharama za usafirishaji. Hakuna muuzaji aliyewasilishwa ujumbe hapa.</Text>
      </View>}
      <View style={s.timeline}><Text style={s.label}>HATUA ZILIZOFANYIKA</Text>{events.map((event,i)=><Text key={`${i}-${event}`} style={s.event}>{event}</Text>)}</View>
    </View>}
  </View>;
}
const s=StyleSheet.create({
 shell:{marginVertical:18,borderRadius:22,borderWidth:1,borderColor:"#354337",backgroundColor:"#101A20",overflow:"hidden"},
 heading:{flexDirection:"row",gap:12,alignItems:"center",padding:17,minHeight:76},body:{padding:16,paddingTop:0,gap:14},
 title:{color:"#F2F5F7",fontSize:15,fontWeight:"700"},muted:{color:"#A6B0BF",fontSize:12,lineHeight:19,marginTop:4},
 badge:{color:"#DDF25B",fontWeight:"800",fontSize:10,letterSpacing:1.2},label:{color:"#C3CCDA",fontSize:10,fontWeight:"800",letterSpacing:1},
 search:{flexDirection:"row",gap:8,alignItems:"center"},input:{flex:1,minHeight:48,color:"#FFF",backgroundColor:"#080F17",padding:12,borderRadius:13},
 go:{backgroundColor:"#DDF25B",width:48,height:48,borderRadius:13,alignItems:"center",justifyContent:"center"},
 product:{flexDirection:"row",alignItems:"center",gap:10,padding:10,borderRadius:15,backgroundColor:"#19232B",borderWidth:1,borderColor:"#29333C"},chosen:{borderColor:"#DDF25B"},
 image:{width:58,height:70,borderRadius:10,backgroundColor:"#2B3440"},price:{color:"#DDF25B",fontSize:13,fontWeight:"700",marginTop:5},
 detail:{padding:14,gap:9,backgroundColor:"#1D292B",borderRadius:15},timeline:{borderTopWidth:1,borderColor:"#2C3941",paddingTop:15,gap:9},event:{color:"#95B9A6",fontSize:11,lineHeight:18}
});
