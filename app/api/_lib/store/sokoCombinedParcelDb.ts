import {resolveSokoOrderCatalogImages} from '../sokoOrderSnapshotMedia';
import {randomUUID,createHash} from 'node:crypto';
import {getSokoNeonSql} from './sokoNeon';
import {ensureSokoOrdersSchema,publicOrder} from './sokoOrdersDb';
import {combineParcel,parcelLines,type ParcelProduct} from '../sokoCombinedParcel';
import {findReusableSokoShippingQuote,sokoShippingAddressFingerprint,sokoShippingOriginFingerprint} from '../sokoShippingQuotes';
import {assertSokoStripeSellerGate,configuredSokoStripeSellerUserId} from '../sokoStripeCheckout';
export async function loadCombinedParcel(raw:unknown){
  await ensureSokoOrdersSchema();const lines=parcelLines(raw),sql=getSokoNeonSql();
  const products=await sql`SELECT id,seller_user_id,status,stock_available,payload FROM soko_products WHERE id=ANY(${lines.map(row=>row.productId)}::text[])` as ParcelProduct[];
  return {group:combineParcel(lines,products),products};
}
export async function createCombinedParcelOrder(args:{buyer:string;buyerName:string;items:unknown;clientKey:string;address:Record<string,any>;selection:Record<string,any>}){
  await ensureSokoOrdersSchema();const sql=getSokoNeonSql(),lines=parcelLines(args.items);
  if(!/^[A-Za-z0-9_-]{1,120}$/.test(args.clientKey))throw new Error('Invalid checkout reference.');
  const address=Object.fromEntries(['fullName','phone','country','state','city','streetAddress','apartment','postalCode','instructions'].map(key=>[key,String(args.address?.[key]||'').trim().slice(0,key==='instructions'?500:240)])) as Record<string,string>;
  if(address.fullName.length<2||address.phone.length<7||!address.country||!address.state||!address.city||address.streetAddress.length<5||address.postalCode.length<3)throw new Error('Complete the delivery address.');
  const selection={rateId:String(args.selection?.rateId||''),shipmentId:String(args.selection?.shipmentId||'')};
  const requestKey=createHash('sha256').update(JSON.stringify({lines,address,selection})).digest('hex');
  const existing=await sql`SELECT * FROM soko_orders WHERE buyer_user_id=${args.buyer} AND client_key=${args.clientKey}` as any[];
  if(existing[0]){if(existing[0].snapshot?.combinedParcel?.requestKey!==requestKey)throw new Error('Checkout reference belongs to a different parcel.');return publicOrder(existing[0]);}
  const {group,products}=await loadCombinedParcel(lines);
  const gate=assertSokoStripeSellerGate({sellerUserId:group.sellerId,buyerUserId:args.buyer,productStatus:'Active',currency:group.currency,allowedSellerUserId:configuredSokoStripeSellerUserId()});if(!gate.ok)throw new Error(gate.error);
  const quote=await findReusableSokoShippingQuote({buyerUserId:args.buyer,productId:group.quoteKey,rateId:selection.rateId,shipmentId:selection.shipmentId,addressFp:sokoShippingAddressFingerprint(address as any),originFp:sokoShippingOriginFingerprint({fulfillmentType:'parcel',from:group.from,parcel:group.parcel})});
  // Never fall back to accepting an arbitrary carrier rate: it must be bound to this exact basket, buyer and address.
  if(!quote.ok||quote.quote.currency.toUpperCase()!==group.currency)throw new Error('Delivery quote expired or products changed. Choose delivery again.');
  const rate=quote.quote,deliveryMinor=Math.round(rate.amount*100);if(!Number.isSafeInteger(deliveryMinor)||deliveryMinor<=0)throw new Error('Invalid delivery amount.');
  const primary=products.find(p=>p.id===lines[0].productId)!;
  const delivery={rateId:rate.rateId,shipmentId:rate.shipmentId,provider:rate.provider,service:rate.service,amount:deliveryMinor/100,currency:group.currency,estimatedDays:rate.estimatedDays,type:'parcel'};
  const media=resolveSokoOrderCatalogImages(primary.payload);
  const items=group.items.map(item=>({...item,image:resolveSokoOrderCatalogImages(products.find(p=>p.id===item.productId)!.payload).image}));
  const snapshot={image:media.image,photos:media.photos,location:primary.payload.location||'',condition:primary.payload.condition||'',seller:primary.payload.seller||{},title:group.items.map(item=>`${item.title} × ${item.quantity}`).join(' · '),price:group.valueMinor/100,currency:group.currency,
    items,inventory:{quantity:group.unitCount,reserved:true,lines},combinedParcel:{version:1,signature:group.signature,requestKey,value:group.valueMinor/100},buyerName:args.buyerName,
    deliveryDetails:address,delivery,acceptedQuote:delivery,fulfillment:{type:'parcel',handlingDays:2,shipByRule:'payment_clock_plus_2_calendar_days',addressFrom:group.from,parcel:group.parcel},
    totals:{itemPrice:group.valueMinor/100,deliveryPrice:deliveryMinor/100,finalTotal:(group.valueMinor+deliveryMinor)/100,currency:group.currency},payment:{method:'stripe_card'}};
  const expected=lines.map(line=>({...line,payload:products.find(p=>p.id===line.productId)!.payload}));
  const orderId='order-'+randomUUID();
  const inserted=await sql`WITH wanted AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(expected)}::jsonb) AS x("productId" text,quantity integer,payload jsonb)),
    locked AS MATERIALIZED (SELECT p.* FROM soko_products p JOIN wanted w ON w."productId"=p.id ORDER BY p.id FOR UPDATE OF p),
    eligible AS (SELECT COUNT(*) n FROM locked p JOIN wanted w ON w."productId"=p.id WHERE p.status='Active' AND p.stock_available>=w.quantity AND p.payload=w.payload AND p.seller_user_id=${group.sellerId}),
    inserted_order AS (INSERT INTO soko_orders(id,product_id,buyer_user_id,seller_user_id,client_key,payment_method,status,snapshot,inventory_reserved)
      SELECT ${orderId},${lines[0].productId},${args.buyer},${group.sellerId},${args.clientKey},'stripe_card','awaiting_payment',${JSON.stringify(snapshot)}::jsonb,TRUE FROM eligible WHERE n=${lines.length}
      ON CONFLICT(buyer_user_id,client_key) DO NOTHING RETURNING *),
    reserved AS (UPDATE soko_products p SET stock_available=p.stock_available-w.quantity,status=CASE WHEN p.stock_available-w.quantity=0 THEN 'Sold' ELSE p.status END,updated_at=NOW() FROM wanted w,inserted_order i WHERE p.id=w."productId" RETURNING p.id)
    SELECT * FROM inserted_order` as any[];
  if(inserted[0])return publicOrder(inserted[0]);
  const retry=await sql`SELECT * FROM soko_orders WHERE buyer_user_id=${args.buyer} AND client_key=${args.clientKey}` as any[];
  if(retry[0]?.snapshot?.combinedParcel?.requestKey===requestKey)return publicOrder(retry[0]);
  throw new Error('Stock or product information changed. Review delivery again.');
}
