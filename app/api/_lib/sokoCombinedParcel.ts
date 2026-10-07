import {createHash} from 'node:crypto';
export type ParcelLine={productId:string;quantity:number};
export type ParcelProduct={id:string;seller_user_id:string;status:string;stock_available:number;payload:Record<string,any>};
export function parcelLines(raw:unknown):ParcelLine[]{
  if(!Array.isArray(raw)||!raw.length||raw.length>20)throw new Error('Choose 1–20 products.');
  const lines=raw.map(row=>({productId:String(row?.productId||'').trim(),quantity:Number(row?.quantity)})).sort((a,b)=>a.productId.localeCompare(b.productId));
  if(lines.some(row=>!row.productId||row.productId.length>100||!Number.isInteger(row.quantity)||row.quantity<1||row.quantity>20)||new Set(lines.map(row=>row.productId)).size!==lines.length||lines.reduce((n,row)=>n+row.quantity,0)>20)throw new Error('Invalid product quantities. Choose at most 20 units.');
  return lines;
}
function origin(from:Record<string,any>){return ['street1','street2','city','state','zip','country'].map(key=>String(from[key]||'').trim().toUpperCase()).join('\n');}
function pos(value:unknown){const n=Number(value);if(!Number.isFinite(n)||n<=0)throw new Error('Seller must add valid packed weight and dimensions.');return n;}
export function combineParcel(lines:ParcelLine[],products:ParcelProduct[]){
  const validated=parcelLines(lines);const first=products.find(p=>p.id===validated[0].productId);if(!first)throw new Error('Product unavailable.');
  const currency=String(first.payload.currency||'').toUpperCase();const from=first.payload.fulfillmentOptions?.addressFrom||{};
  if(!currency||!from.street1||!from.city||!from.zip||!from.country)throw new Error('Seller shipping address is incomplete.');
  let weight=0,length=0,width=0,height=0,valueMinor=0;
  const items=validated.map(line=>{
    const product=products.find(p=>p.id===line.productId);if(!product||product.status!=='Active'||Number(product.stock_available)<line.quantity)throw new Error('Requested quantity is unavailable.');
    const payload=product.payload,fulfillment=payload.fulfillmentOptions||{},parcel=fulfillment.parcel||{};
    if(product.seller_user_id!==first.seller_user_id||origin(fulfillment.addressFrom||{})!==origin(from)||String(payload.currency||'').toUpperCase()!==currency)throw new Error('One parcel requires the same seller, shipping origin and currency.');
    if(fulfillment.type!=='parcel'||fulfillment.separateParcel===true||String(payload.category||'').toLowerCase()==='vehicles')throw new Error('This product requires separate delivery. Contact the seller.');
    const distance=String(parcel.distanceUnit||'in'),mass=String(parcel.massUnit||'lb');
    if(!['in','cm'].includes(distance)||!['lb','kg'].includes(mass))throw new Error('Unsupported parcel measurement units.');
    const factor=distance==='cm'?1/2.54:1;
    length=Math.max(length,pos(parcel.length)*factor);width=Math.max(width,pos(parcel.width)*factor);
    // Enclose the seller's packed units in one vertical stack, without inventing an average box size.
    height+=pos(parcel.height)*factor*line.quantity;weight+=pos(parcel.weight)*(mass==='kg'?2.20462262185:1)*line.quantity;
    const unitMinor=Math.round(pos(payload.price)*100);if(!Number.isSafeInteger(unitMinor))throw new Error('Invalid product price.');valueMinor+=unitMinor*line.quantity;
    return {productId:line.productId,quantity:line.quantity,title:String(payload.title||''),unitPrice:unitMinor/100,lineTotal:unitMinor*line.quantity/100,image:payload.image||payload.imageUrl||'',currency};
  });
  if(!Number.isSafeInteger(valueMinor)||valueMinor<=0)throw new Error('Invalid parcel value.');
  const round=(n:number)=>Math.ceil(n*1000)/1000;
  const parcel={length:round(length),width:round(width),height:round(height),weight:round(weight),distanceUnit:'in',massUnit:'lb'};
  const signature=createHash('sha256').update(JSON.stringify({lines:validated,seller:first.seller_user_id,origin:origin(from),currency,parcel,valueMinor})).digest('hex');
  return {lines:validated,items,sellerId:first.seller_user_id,currency,from,parcel,valueMinor,unitCount:validated.reduce((n,row)=>n+row.quantity,0),quoteKey:'parcel_'+signature.slice(0,48),signature};
}
