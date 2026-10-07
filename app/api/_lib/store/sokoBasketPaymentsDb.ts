import {createHash} from "node:crypto";
import type Stripe from "stripe";
import {getSokoNeonSql} from "./sokoNeon";
import {ensureSokoOrdersSchema,getSokoStripePaymentContext,updateSokoOrder} from "./sokoOrdersDb";
import {configuredSokoStripeSellerUserId,stripeModeFromSecretKey,opaqueBuyerReference} from "../sokoStripeCheckout";
import {getStripeClient,getStripeSecretKey} from "../sokoStripeServer";
import {validateBasketContexts,validateBasketCapture} from "../sokoBasketPayment";
type Batch={id:string;buyer_user_id:string;seller_user_id:string;currency:string;amount_minor:number;order_ids:string[];payment_intent_id:string;status:string};
let ready:Promise<unknown>|null=null;
async function schema(){if(!ready)ready=(async()=>{await ensureSokoOrdersSchema();const sql=getSokoNeonSql();await sql`CREATE TABLE IF NOT EXISTS soko_basket_payments (id text PRIMARY KEY,buyer_user_id text NOT NULL,seller_user_id text NOT NULL,currency text NOT NULL,amount_minor bigint NOT NULL,order_ids jsonb NOT NULL,payment_intent_id text NOT NULL DEFAULT '',status text NOT NULL DEFAULT 'pending',created_at timestamptz NOT NULL DEFAULT NOW(),updated_at timestamptz NOT NULL DEFAULT NOW())`;})().catch(error=>{ready=null;throw error;});await ready;}
function batchId(buyer:string,ids:string[]){return 'basket_'+createHash('sha256').update(JSON.stringify([buyer,[...ids].sort()])).digest('hex').slice(0,48);}
export async function prepareBasketPayment(buyer:string,rawIds:unknown){
  if(!Array.isArray(rawIds)||rawIds.length<1||rawIds.length>20||rawIds.some(id=>typeof id!=="string"||!id||id.length>100)||new Set(rawIds).size!==rawIds.length)throw new Error("Choose 1–20 unique order IDs.");
  const ids=rawIds as string[];await schema();const sql=getSokoNeonSql();const id=batchId(buyer,ids);
  let rows=await sql`SELECT * FROM soko_basket_payments WHERE id=${id} AND buyer_user_id=${buyer}` as Batch[];
  if(!rows[0]){
    const contexts=await Promise.all(ids.map(orderId=>getSokoStripePaymentContext({orderId,buyerUserId:buyer})));
    const valid=validateBasketContexts(contexts,buyer,configuredSokoStripeSellerUserId());
    // Claim all reserved orders and persist the immutable total in one SQL statement.
    rows=await sql`WITH locked AS (SELECT * FROM soko_orders WHERE id=ANY(${valid.orderIds}::text[]) ORDER BY id FOR UPDATE), eligible AS (
      SELECT COUNT(*) AS n FROM locked WHERE buyer_user_id=${buyer} AND seller_user_id=${configuredSokoStripeSellerUserId()} AND payment_method='stripe_card' AND status='awaiting_payment' AND provider_payment_id='' AND COALESCE(snapshot #>> '{payment,basketId}','')=''
    ), inserted AS (
      INSERT INTO soko_basket_payments(id,buyer_user_id,seller_user_id,currency,amount_minor,order_ids)
      SELECT ${id},${buyer},${configuredSokoStripeSellerUserId()},${valid.currency},${valid.amountMinor},${JSON.stringify(valid.orderIds)}::jsonb FROM eligible WHERE n=${valid.orderIds.length}
      ON CONFLICT(id) DO NOTHING RETURNING *
    ), claimed AS (
      UPDATE soko_orders SET snapshot=jsonb_set(snapshot,'{payment,basketId}',to_jsonb(${id}::text),true),updated_at=NOW() FROM inserted WHERE soko_orders.id=ANY(${valid.orderIds}::text[]) RETURNING soko_orders.id
    ) SELECT inserted.* FROM inserted WHERE (SELECT COUNT(*) FROM claimed)=${valid.orderIds.length}` as Batch[];
    if(!rows[0]) rows=await sql`SELECT * FROM soko_basket_payments WHERE id=${id} AND buyer_user_id=${buyer}` as Batch[];
    if(!rows[0])throw new Error("Basket changed. Reload checkout.");
  }
  const batch=rows[0];if(["cancelled","cancelling"].includes(batch.status))throw new Error("This basket is cancelled or cancelling.");const stripe=getStripeClient();
  let intent:Stripe.PaymentIntent;
  if(batch.payment_intent_id)intent=await stripe.paymentIntents.retrieve(batch.payment_intent_id);
  else{
    const preparing=await sql`UPDATE soko_basket_payments SET status='preparing',updated_at=NOW() WHERE id=${batch.id} AND status IN ('pending','preparing') AND payment_intent_id='' RETURNING id` as Array<{id:string}>;
    if(!preparing.length)throw new Error("Basket changed while preparing payment. Retry checkout.");
    intent=await stripe.paymentIntents.create({amount:Number(batch.amount_minor),currency:batch.currency.toLowerCase(),payment_method_types:['card'],metadata:{sokoBasketId:batch.id,sellerUserId:batch.seller_user_id,buyerRef:opaqueBuyerReference(buyer)}},{idempotencyKey:`zpora-basket-${batch.id}`});
    const bound=await sql`UPDATE soko_basket_payments SET payment_intent_id=${intent.id},status='pending',updated_at=NOW() WHERE id=${batch.id} AND status IN ('pending','preparing') AND (payment_intent_id='' OR payment_intent_id=${intent.id}) RETURNING id` as Array<{id:string}>;
    if(!bound.length)throw new Error("Basket payment binding failed.");
  }
  if(intent.metadata.sokoBasketId!==batch.id||intent.amount!==Number(batch.amount_minor)||intent.currency.toUpperCase()!==batch.currency)throw new Error("Basket payment mismatch.");
  if(intent.status==='canceled')throw new Error("This basket payment was cancelled. Contact support before starting another payment.");
  if(intent.status==='succeeded')await applyBasketCapture(intent,'retrieve-'+intent.id);
  return {ok:true,basketId:batch.id,orderIds:batch.order_ids,status:intent.status,clientSecret:intent.status==='succeeded'?null:intent.client_secret,livemode:intent.livemode,amountMinor:Number(batch.amount_minor),currency:batch.currency};
}
export async function basketPaymentStatus(buyer:string,id:string){await schema();const sql=getSokoNeonSql();const rows=await sql`SELECT * FROM soko_basket_payments WHERE id=${id} AND buyer_user_id=${buyer}` as Batch[];if(!rows[0])throw new Error("Basket not found.");const batch=rows[0];if(batch.status!=='paid'&&batch.payment_intent_id){const intent=await getStripeClient().paymentIntents.retrieve(batch.payment_intent_id);if(intent.status==='succeeded')await applyBasketCapture(intent,'retrieve-'+intent.id);}const latest=await sql`SELECT status FROM soko_basket_payments WHERE id=${id} AND buyer_user_id=${buyer}` as Array<{status:string}>;return {ok:true,status:latest[0].status,basketId:id,orderIds:batch.order_ids};}
export async function applyBasketCapture(intent:Stripe.PaymentIntent,eventId:string){
  await schema();const sql=getSokoNeonSql();const rows=await sql`SELECT * FROM soko_basket_payments WHERE id=${String(intent.metadata?.sokoBasketId||'')}` as Batch[];const batch=rows[0];
  if(!batch)throw new Error("Basket capture could not be verified.");
  validateBasketCapture({storedIntentId:batch.payment_intent_id,eventIntentId:intent.id,batchId:batch.id,metadataBatchId:String(intent.metadata.sokoBasketId||''),buyerRef:opaqueBuyerReference(batch.buyer_user_id),metadataBuyerRef:String(intent.metadata.buyerRef||''),sellerId:batch.seller_user_id,metadataSellerId:String(intent.metadata.sellerUserId||''),allowedSellerId:configuredSokoStripeSellerUserId(),expectedAmount:Number(batch.amount_minor),receivedAmount:intent.amount_received,expectedCurrency:batch.currency,eventCurrency:intent.currency,status:intent.status,livemode:intent.livemode,expectedMode:String(stripeModeFromSecretKey(getStripeSecretKey())||'')});
  // All child orders approve atomically; repeat webhook deliveries cannot deduct inventory again.
  const result=await sql`WITH batch_lock AS (SELECT * FROM soko_basket_payments WHERE id=${batch.id} FOR UPDATE), locked AS (SELECT * FROM soko_orders WHERE id=ANY(${batch.order_ids}::text[]) ORDER BY id FOR UPDATE), valid AS (
    SELECT COUNT(*) AS n,SUM(ROUND((snapshot #>> '{totals,finalTotal}')::numeric*100)) AS amount FROM locked WHERE buyer_user_id=${batch.buyer_user_id} AND seller_user_id=${batch.seller_user_id} AND payment_method='stripe_card' AND UPPER(snapshot #>> '{totals,currency}')=${batch.currency} AND snapshot #>> '{payment,basketId}'=${batch.id} AND status IN ('awaiting_payment','payment_approved','preparing_shipment','shipped','delivered')
  ), approved AS (
    UPDATE soko_orders SET status='payment_approved',payment_date=COALESCE(payment_date,NOW()),payment_provider='stripe',provider_payment_id=${intent.id},
      snapshot=jsonb_set(jsonb_set(jsonb_set(snapshot,'{fulfillment,clockStartedAt}',to_jsonb(NOW()::text),true),'{fulfillment,paymentApprovedAt}',to_jsonb(NOW()::text),true),'{payment,stripeCaptureAudit}',${JSON.stringify({provider:'stripe',paymentIntentId:intent.id,basketId:batch.id,eventId,amountMinor:Number(batch.amount_minor),currency:batch.currency,livemode:intent.livemode,capturedAt:new Date().toISOString()})}::jsonb,true),updated_at=NOW()
    FROM valid,batch_lock WHERE soko_orders.id=ANY(${batch.order_ids}::text[]) AND soko_orders.status='awaiting_payment' AND valid.n=${batch.order_ids.length} AND valid.amount=${Number(batch.amount_minor)} RETURNING soko_orders.id
  ) UPDATE soko_basket_payments SET status='paid',updated_at=NOW() FROM valid WHERE soko_basket_payments.id=${batch.id} AND valid.n=${batch.order_ids.length} AND valid.amount=${Number(batch.amount_minor)} AND (SELECT COUNT(*) FROM approved)>=0 RETURNING soko_basket_payments.id` as Array<{id:string}>;
  if(!result.length)throw new Error("Basket orders changed; payment requires reconciliation.");return {applied:true};
}

export async function cancelBasketPayment(buyer:string,id:string){
  await schema();const sql=getSokoNeonSql();const rows=await sql`SELECT * FROM soko_basket_payments WHERE id=${id} AND buyer_user_id=${buyer}` as Batch[];const batch=rows[0];if(!batch)throw new Error("Basket not found.");
  if(batch.status==='paid')throw new Error("This basket is already paid.");
  const cancelling=await sql`UPDATE soko_basket_payments SET status='cancelling',updated_at=NOW() WHERE id=${id} AND status IN ('pending','cancelling','cancelled') AND payment_intent_id=${batch.payment_intent_id} RETURNING id` as Array<{id:string}>;
  if(!cancelling.length)throw new Error("Payment is being prepared. Retry cancellation after preparation completes.");
  try{
    if(batch.payment_intent_id){const stripe=getStripeClient();const intent=await stripe.paymentIntents.retrieve(batch.payment_intent_id);if(intent.status==='succeeded'||intent.status==='processing')throw new Error("Payment is already in progress. Confirm its status before cancelling.");if(intent.status!=='canceled')await stripe.paymentIntents.cancel(intent.id);}
  }catch(error){await sql`UPDATE soko_basket_payments SET status='pending' WHERE id=${id} AND status='cancelling'`;throw error;}
  // Stripe has confirmed that this intent cannot capture funds.
  await sql`UPDATE soko_basket_payments SET status='cancelled',updated_at=NOW() WHERE id=${id} AND status='cancelling'`;
  await sql`UPDATE soko_orders SET snapshot=snapshot #- '{payment,basketId}',updated_at=NOW() WHERE id=ANY(${batch.order_ids}::text[]) AND buyer_user_id=${buyer} AND status='awaiting_payment'`;
  for(const orderId of batch.order_ids){const orders=await sql`SELECT status FROM soko_orders WHERE id=${orderId} AND buyer_user_id=${buyer}` as Array<{status:string}>;if(orders[0]?.status==='awaiting_payment')await updateSokoOrder({userId:buyer,orderId,action:'cancel'});}
  return {ok:true,status:'cancelled'};
}
