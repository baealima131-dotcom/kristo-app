import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';
const code=stripTypeScriptTypes(readFileSync(new URL('../app/api/_lib/sokoBasketPayment.ts',import.meta.url),'utf8'));
const {validateBasketContexts,validateBasketCapture}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const row={orderId:'o1',buyerUserId:'buyer',sellerUserId:'seller',currency:'USD',amountMinor:1500,status:'awaiting_payment',providerPaymentId:''};
test('aggregate includes every quantity unit and all server delivery amounts',()=>{assert.deepEqual(validateBasketContexts([row,{...row,orderId:'o2',amountMinor:2700},{...row,orderId:'o3',amountMinor:1500}],'buyer','seller'),{currency:'USD',amountMinor:5700,orderIds:['o1','o2','o3']});});
test('rejects duplicate, foreign, paid, bound or mixed-currency child orders',()=>{
 for(const rows of [[],[row,row],[{...row,buyerUserId:'other'}],[{...row,sellerUserId:'other'}],[{...row,status:'payment_approved'}],[{...row,providerPaymentId:'pi_other'}],[row,{...row,orderId:'o2',currency:'TZS'}],[{...row,amountMinor:0}],[{...row,amountMinor:15.5}],Array.from({length:21},(_,i)=>({...row,orderId:`o${i}`}))])assert.throws(()=>validateBasketContexts(rows,'buyer','seller'));
});
const capture={storedIntentId:'pi_1',eventIntentId:'pi_1',batchId:'b1',metadataBatchId:'b1',buyerRef:'ref1',metadataBuyerRef:'ref1',sellerId:'seller',metadataSellerId:'seller',allowedSellerId:'seller',expectedAmount:4200,receivedAmount:4200,expectedCurrency:'USD',eventCurrency:'usd',status:'succeeded',livemode:false,expectedMode:'test'};
test('validates one complete signed-provider capture against immutable basket total',()=>assert.equal(validateBasketCapture(capture),true));
test('partial capture, wrong provider identity, mode, buyer, seller or currency cannot approve a basket',()=>{
 for(const change of [{receivedAmount:1500},{receivedAmount:4300},{eventIntentId:'pi_other'},{storedIntentId:''},{metadataBatchId:'other'},{metadataBuyerRef:'other'},{metadataSellerId:'other'},{allowedSellerId:'other'},{eventCurrency:'TZS'},{status:'processing'},{livemode:true},{expectedMode:''}])assert.throws(()=>validateBasketCapture({...capture,...change}));
});
