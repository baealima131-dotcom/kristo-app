import React,{useEffect,useState} from 'react';
import {ActivityIndicator,AppState,Image,Modal,ScrollView,Pressable,StyleSheet,Text,TextInput,View} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

import MobileMoneyProviderIcon from '../MobileMoneyProviderIcon';
const providerName=(value:unknown)=>{const text=String(value||'').trim();const label=text.includes(' · ')?text.split(' · ').slice(1).join(' · '):text;const key=label.toLowerCase().replace(/[^a-z0-9]/g,'');const names:Record<string,string>={mpesa:'M-Pesa',vodacommpesa:'M-Pesa',safaricommpesa:'M-Pesa',airtelmoney:'Airtel Money',airtel:'Airtel Money',tpesa:'T-PESA',azampesa:'AzamPesa',halopesa:'HaloPesa',tigopesa:'Mixx by Yas',mixxbyyas:'Mixx by Yas',orangemoney:'Orange Money',mtnmomo:'MTN MoMo'};return names[key]||label||'Mobile money';};
type Props={state:any;order:any;products:any[];buyer:boolean;path:string;request:(path:string,init?:RequestInit)=>Promise<any>;onData:(data:any)=>void};
export default function LiveStorePayment({state,order,products,buyer,path,request,onData}:Props){
 const [photoOpen,setPhotoOpen]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[proof,setProof]=useState('');
 const [address,setAddress]=useState<Record<string,string>>({fullName:'',phone:'',country:'',state:'',city:'',streetAddress:'',postalCode:''});
 const [rates,setRates]=useState<any[]>([]),[rate,setRate]=useState<any>(null);
 const [reference,setReference]=useState(''),[date,setDate]=useState(new Date().toISOString()),[quote,setQuote]=useState(''),[days,setDays]=useState('');
 const checkout=state?.checkout,product=products.find(p=>p.id===checkout?.productId),options=product?.paymentOptions||{};
 const pending=order&&['awaiting_payment','payment_rejected'].includes(order.status);
 const action=async(name:string,extra:Record<string,unknown>={})=>{
 if(busy)return;setBusy(true);setError('');try{onData(await request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:name,version:state.version,...extra})}));}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 useEffect(()=>{if(!buyer||!checkout)return;let previous=AppState.currentState;
 const sub=AppState.addEventListener('change',next=>{const changed=next!==previous;previous=next;if(!changed)return;
 const activity=next==='active'?'returned':next==='background'?'away':'';if(!activity)return;
 void request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'activity',activity,version:state.version})}).then(onData).catch(()=>{});
 });return()=>sub.remove();},[buyer,path,state?.version,!!checkout]);
 useEffect(()=>{setProof('');if(!order?.hasPaymentProof)return;let active=true;
 void request(path+'&proof=1').then(data=>{if(active)setProof(data.image||'');}).catch(()=>{});return()=>{active=false;};},[order?.id,order?.updatedAt,order?.hasPaymentProof,path]);
 useEffect(()=>{setRates([]);setRate(null);},[checkout?.productId]);
 const calculate=async()=>{if(busy||!product)return;setBusy(true);setError('');try{
 const data=await request('/api/soko/delivery/rates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productId:product.id,address})});
 const rows=(data.rates||[]).filter((r:any)=>String(r.currency).toUpperCase()===String(product.currency).toUpperCase()&&Number.isFinite(Number(r.amount))&&Number(r.amount)>=0).map((r:any)=>({...r,shipmentId:r.shipmentId||data.shipmentId||''}));
 setRates(rows);setRate(null);if(!rows.length)throw new Error(data.reason||'A verified delivery quote is required before payment. Arrange delivery with the seller.');
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const sendProof=async()=>{if(busy||!order)return;setBusy(true);setError('');try{
 if(!reference.trim()||Number.isNaN(Date.parse(date)))throw new Error('Enter the transaction reference and payment date.');
 const picked=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],quality:.9});if(picked.canceled)return;
 const img=await ImageManipulator.manipulateAsync(picked.assets[0].uri,[{resize:{width:1600}}],{compress:.85,format:ImageManipulator.SaveFormat.JPEG});
 const form=new FormData();form.append('action','proof');form.append('version',String(state.version));form.append('transactionReference',reference.trim());form.append('paymentDate',date);form.append('image',{uri:img.uri,name:'payment-proof.jpg',type:'image/jpeg'} as any);
 onData(await request(path,{method:'POST',body:form}));
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const button=(label:string,fn:()=>void)=><Pressable accessibilityRole="button" disabled={busy} onPress={fn} style={[s.button,busy&&{opacity:.5}]}><Text style={s.buttonText}>{label}</Text></Pressable>;
 const statusLabels:Record<string,string>={awaiting_delivery_quote:'Waiting for delivery quote',delivery_quote_ready:'Review delivery quote',awaiting_payment:'Waiting for payment',payment_rejected:'Payment needs correction',payment_submitted:'Screenshot sent · waiting for seller',payment_approved:'Seller approved · order in tracking',preparing_shipment:'Preparing shipment',shipped:'Shipped',delivered:'Delivered',cancelled:'Cancelled'};
 const payment=order?.product?.payment||options,total=order?.product?.totals;
 if(!checkout)return null;
 return <View style={s.card}>
 <Text style={s.eyebrow}>LIVE CHECKOUT</Text>
 <Pressable accessibilityLabel="Open product photo" onPress={()=>setPhotoOpen(true)}><Image source={{uri:product?.image||order?.product?.image}} style={s.productPhoto}/><View style={s.zoom}><Text style={s.small}>Tap to enlarge ↗</Text></View></Pressable>
 <Text numberOfLines={2} style={s.title}>{product?.title||order?.product?.title||'Selected product'}</Text>
 <View style={s.summary}><Text style={s.price}>{product?.currency||order?.product?.currency} {Number(product?.price||order?.product?.price||0).toFixed(2)}</Text><View style={s.quantity}><Text style={s.small}>Checkout: 1 unit</Text></View></View>
 <Text style={s.hint}>In shared cart: {state?.cart?.[checkout.productId]||0} units · this checkout purchases 1</Text>
 <Modal visible={photoOpen} animationType="fade" onRequestClose={()=>setPhotoOpen(false)}><View style={s.fullscreen}><Pressable accessibilityLabel="Close product photo" style={s.close} onPress={()=>setPhotoOpen(false)}><Text style={s.buttonText}>Close ✕</Text></Pressable><ScrollView maximumZoomScale={4} minimumZoomScale={1} contentContainerStyle={{flexGrow:1,justifyContent:'center'}}><Image source={{uri:product?.image||order?.product?.image}} style={s.fullPhoto}/></ScrollView></View></Modal>
 <Text style={s.hint}>{order?statusLabels[order.status]||order.status:checkout.stage==='choosing_method'?'Choosing payment method':'Entering delivery details'}{state.buyerActivity==='away'?' · Buyer left the app':state.buyerActivity==='returned'?' · Buyer returned':''}</Text>
 {!!error&&<Text style={s.error}>{error}</Text>}{busy?<ActivityIndicator color="#E4C883"/>:null}
 {!order&&checkout.stage==='choosing_method'&&(buyer?<>
 <Text style={s.text}>Mobile money methods accepted by this seller</Text>
 {options.methods?.includes('mobile_money')?<Pressable accessibilityRole="button" disabled={busy} onPress={()=>void action('method',{method:'mobile_money'})} style={s.paymentMethod}><MobileMoneyProviderIcon name={providerName(options.mobileNetwork)}/><View style={{flex:1,gap:4}}><Text style={s.provider}>{providerName(options.mobileNetwork)}</Text><Text selectable style={s.account}>{options.mobileNumber||'Recipient number not configured'}</Text><Text style={s.text}>{options.recipientName||'Recipient name not configured'}</Text></View><Text style={s.provider}>›</Text></Pressable>:<Text style={s.hint}>This listing has no mobile money method. Ask the seller to update the listing.</Text>}
 <Text style={s.hint}>Choose the account above to continue. Final total follows delivery confirmation.</Text>
 </>:<Text style={s.hint}>Buyer is choosing a mobile money method.</Text>)}
 {!order&&checkout.method==='mobile_money'&&(buyer?<>
 <View style={s.paymentMethod}><MobileMoneyProviderIcon name={providerName(options.mobileNetwork)}/><View style={{flex:1,gap:4}}><Text style={s.provider}>{providerName(options.mobileNetwork)}</Text><Text selectable style={s.account}>{options.mobileNumber||'Number not configured'}</Text><Text style={s.text}>{options.recipientName||'Name not configured'}</Text></View></View>
 <Text style={s.text}>Delivery address</Text>
 {Object.entries({fullName:'Full name',phone:'Phone',country:'Country',state:'Region / State',city:'City',streetAddress:'Street / Village',postalCode:'Postal code'}).map(([key,label])=><TextInput key={key} editable={!busy} accessibilityLabel={label} placeholder={label} placeholderTextColor="#8EA598" value={address[key]} onChangeText={v=>{setAddress(a=>({...a,[key]:v}));setRate(null);setRates([]);}} style={s.input}/>)}
 {button('Check delivery',()=>void calculate())}
 {rates.map(r=><Pressable key={r.id} disabled={busy} style={[s.option,rate?.id===r.id&&s.selected]} onPress={()=>setRate(r)}><Text style={s.text}>{r.service||r.provider||'Delivery'} · {r.currency} {Number(r.amount).toFixed(2)}</Text></Pressable>)}
 {rate?<><Text style={s.price}>Estimated total: {product.currency} {(Number(product.price)+Number(rate.amount)).toFixed(2)}</Text>{button('Confirm order and continue to payment',()=>void action('create_order',{deliveryDetails:address,deliverySelection:{rateId:rate.id,shipmentId:rate.shipmentId}}))}</>:null}
 </>:<Text style={s.hint}>Buyer is entering delivery details. The server checks the final total.</Text>)}
 {order?<><Text style={s.hint}>Order {order.id}</Text>{total?<Text style={s.price}>{total.currency} {Number(total.finalTotal).toFixed(2)}</Text>:null}
 <View style={s.paymentMethod}><MobileMoneyProviderIcon name={providerName(payment.mobileNetwork)}/><View style={{flex:1,gap:4}}><Text style={s.provider}>{providerName(payment.mobileNetwork)}</Text><Text selectable style={s.account}>{payment.mobileNumber||'Number unavailable'}</Text><Text style={s.text}>{payment.recipientName||'Confirm recipient with seller'}</Text></View></View>
 {buyer&&pending?<><Text style={s.hint}>Pay the confirmed total using your mobile wallet. Return here and send the receipt screenshot. Seller approval follows verification of receipt.</Text>
 <TextInput editable={!busy} style={s.input} value={reference} onChangeText={setReference} placeholder="Transaction reference" placeholderTextColor="#8EA598"/>
 <TextInput editable={!busy} style={s.input} value={date} onChangeText={setDate} placeholder="Payment date (ISO date/time)" placeholderTextColor="#8EA598"/>
 {button('Send payment screenshot',()=>void sendProof())}</>:null}
 {proof?<><Text style={s.text}>Payment screenshot</Text><Image source={{uri:proof}} resizeMode="contain" style={s.proof}/></>:null}
 {!buyer&&order.status==='payment_submitted'?<><Text style={s.hint}>Check the transaction reference and confirm money arrived in your wallet before approving.</Text><Text style={s.text}>Reference: {order.transactionReference}</Text><Text style={s.hint}>Paid: {order.paymentDate}</Text>{button('Approve payment',()=>void action('approve_payment'))}{button('Request correction',()=>void action('reject_payment',{note:'Please correct the payment details or screenshot.'}))}</>:null}
 {!buyer&&order.status==='awaiting_delivery_quote'?<><TextInput style={s.input} value={quote} onChangeText={setQuote} placeholder="Delivery amount" placeholderTextColor="#8EA598" keyboardType="decimal-pad"/><TextInput style={s.input} value={days} onChangeText={setDays} placeholder="Estimated days" placeholderTextColor="#8EA598" keyboardType="number-pad"/>{button('Send delivery quote',()=>void action('provide_delivery_quote',{deliveryQuoteAmount:quote,deliveryQuoteEstimatedDays:days}))}</>:null}
 {buyer&&order.status==='delivery_quote_ready'?button('Accept delivery quote',()=>void action('accept_delivery_quote')):null}
 {['payment_approved','preparing_shipment','shipped','delivered'].includes(order.status)?<Text style={s.hint}>This order is available in Track Order and Seller Orders. Continue shipment updates there.</Text>:null}
 </>:null}
 </View>;
}
const s=StyleSheet.create({
 productPhoto:{width:'100%',aspectRatio:1,resizeMode:'cover',borderRadius:14,backgroundColor:'#0B1710'},
 zoom:{position:'absolute',bottom:10,left:10,paddingHorizontal:10,paddingVertical:7,borderRadius:9,backgroundColor:'rgba(5,15,9,.8)'},
 small:{fontSize:11,color:'#EAF4EC',fontWeight:'600'},summary:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},quantity:{paddingHorizontal:10,paddingVertical:8,borderRadius:10,backgroundColor:'#263D2E'},
 paymentMethod:{flexDirection:'row',alignItems:'center',gap:12,padding:14,borderWidth:1,borderColor:'#527B5E',borderRadius:14,backgroundColor:'#20392A'},provider:{fontSize:16,color:'#FFFFFF',fontWeight:'700'},account:{fontSize:18,color:'#E4C883',fontWeight:'700'},
 fullscreen:{flex:1,backgroundColor:'#060D09',paddingTop:60,paddingBottom:30},close:{alignSelf:'flex-end',padding:16,marginRight:12},fullPhoto:{width:'100%',height:600,resizeMode:'contain'},
 card:{padding:16,gap:12,backgroundColor:'#14261B',borderRadius:18,borderWidth:1,borderColor:'#33533E'},eyebrow:{fontSize:11,color:'#9CD8AE',fontWeight:'700',letterSpacing:1},title:{fontSize:14,color:'#F4F3EB',fontWeight:'700'},text:{fontSize:14,color:'#F4F3EB',lineHeight:20},hint:{fontSize:12,color:'#AFBCAF',lineHeight:18},error:{fontSize:13,color:'#FFBD9A'},price:{fontSize:18,fontWeight:'700',color:'#E4C883'},button:{minHeight:44,padding:12,borderRadius:12,backgroundColor:'#245539',alignItems:'center'},buttonText:{color:'#FFF',fontSize:13,fontWeight:'700'},input:{minHeight:46,padding:12,borderWidth:1,borderColor:'#3C5545',borderRadius:10,color:'#FFF'},option:{padding:12,borderWidth:1,borderColor:'#3C5545',borderRadius:10},selected:{backgroundColor:'#245539'},proof:{width:'100%',height:280}});
