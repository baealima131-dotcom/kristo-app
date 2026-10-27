type Input={action:string;buyer:boolean;checkout?:{method?:string;orderId?:string};order?:{status:string;paymentMethod?:string}|null};
export function assertLivePaymentAction({action,buyer,checkout,order}:Input){
 if(action==='checkout'&&checkout)throw new Error('Resume the existing checkout.');
 const buyerActions=['checkout','method','activity','create_order','proof','accept_delivery_quote'];
 const sellerActions=['approve_payment','reject_payment','provide_delivery_quote'];
 if((buyerActions.includes(action)&&!buyer)||(sellerActions.includes(action)&&buyer))throw new Error('Only the correct call participant can perform this action.');
 if(action==='method'&&(!checkout||checkout.orderId))throw new Error('Resume the existing checkout.');
 if(action==='create_order'&&checkout?.method!=='mobile_money')throw new Error('Choose an accepted mobile money method first.');
 if(['proof','approve_payment','reject_payment','accept_delivery_quote','provide_delivery_quote'].includes(action)&&!order)throw new Error('Create the live order first.');
 if(action==='proof'&&order&&!['awaiting_payment','payment_rejected','payment_submitted'].includes(order.status))throw new Error('Payment proof cannot be changed at this stage.');
 if(sellerActions.includes(action)&&order&&order.paymentMethod!=='mobile_money')throw new Error('This live flow requires mobile money.');
}
