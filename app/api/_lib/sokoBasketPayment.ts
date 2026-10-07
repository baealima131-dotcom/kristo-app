export function validateBasketContexts(rows: Array<{orderId:string; buyerUserId:string; sellerUserId:string; currency:string; amountMinor:number; status:string; providerPaymentId:string}>, buyerId:string, sellerId:string) {
  if (!rows.length || rows.length > 20 || new Set(rows.map(row=>row.orderId)).size !== rows.length) throw new Error("Choose 1–20 unique orders.");
  const currency=rows[0].currency.toUpperCase();
  if (rows.some(row=>row.buyerUserId!==buyerId || row.sellerUserId!==sellerId || row.currency.toUpperCase()!==currency || row.status!=="awaiting_payment" || row.providerPaymentId || !Number.isSafeInteger(row.amountMinor) || row.amountMinor<=0)) throw new Error("Basket orders must be unpaid, owned by this buyer, and use the same supported seller and currency.");
  const amountMinor=rows.reduce((total,row)=>total+row.amountMinor,0);
  if (!Number.isSafeInteger(amountMinor)) throw new Error("Invalid basket total.");
  return {currency,amountMinor,orderIds:rows.map(row=>row.orderId).sort()};
}

export function validateBasketCapture(input:{storedIntentId:string;eventIntentId:string;batchId:string;metadataBatchId:string;buyerRef:string;metadataBuyerRef:string;sellerId:string;metadataSellerId:string;allowedSellerId:string;expectedAmount:number;receivedAmount:number;expectedCurrency:string;eventCurrency:string;status:string;livemode:boolean;expectedMode:string}){
  if(!['live','test'].includes(input.expectedMode)||input.livemode!==(input.expectedMode==='live')||!input.storedIntentId||input.storedIntentId!==input.eventIntentId||input.batchId!==input.metadataBatchId||input.buyerRef!==input.metadataBuyerRef||input.sellerId!==input.allowedSellerId||input.sellerId!==input.metadataSellerId||!Number.isSafeInteger(input.expectedAmount)||input.expectedAmount<=0||input.expectedAmount!==input.receivedAmount||input.expectedCurrency.toUpperCase()!==input.eventCurrency.toUpperCase()||input.status!=='succeeded')throw new Error('Basket capture could not be verified.');
  return true;
}
