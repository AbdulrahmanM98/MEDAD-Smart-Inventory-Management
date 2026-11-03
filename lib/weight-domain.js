'use strict';
const OUNCE_GRAMS=30, SCALE=100, QUARTER_THRESHOLD_SAR=1500;
const PIECE={unit_code:'piece',quantity_scale:1,price_basis:'piece',kind:'piece',is_demo:false};
const error=message=>Object.assign(new Error(message),{status:400});
function atoms(value,scale=SCALE,{allowZero=false}={}) {
  const text=typeof value==='number'&&Number.isFinite(value)?String(value):typeof value==='string'?value.trim():'';
  const pattern=scale===1?/^\d+$/:/^\d+(?:\.\d{1,2})?$/;
  if(!pattern.test(text))throw error(scale===1?'Piece quantities must be whole numbers.':'Gram quantities must use increments of 0.01 g.');
  const [whole,fraction='']=text.split('.');
  const result=BigInt(whole)*BigInt(scale)+(scale===1?0n:BigInt(fraction.padEnd(2,'0')));
  if(result<0n||(!allowZero&&result===0n)||result>1000000n)throw error(scale===1?'Choose 1–1,000,000 pieces.':'Choose 0.01–10,000 grams.');
  return Number(result);
}
function metadata(row){
  if(!row)return {...PIECE};
  if(row.unit_code!=='g'||row.quantity_scale!==100||!['wood','oil'].includes(row.kind)||(row.kind==='wood'?row.price_basis!=='ounce':row.price_basis!=='g'))throw new Error('Invalid product measurement configuration.');
  const wholesale=row.wholesale_pack_grams||[125,1000];
  if(!Array.isArray(wholesale)||!wholesale.length||wholesale.some(w=>!Number.isFinite(Number(w))||Number(w)<=0||Number(w)>10000))throw new Error('Invalid wholesale pack configuration.');
  return {unit_code:'g',quantity_scale:100,price_basis:row.price_basis,kind:row.kind,is_demo:!!row.is_demo,wholesale_pack_grams:wholesale.map(Number)};
}
function packages(product,measure){
  if(measure.unit_code!=='g')return {retail:[],wholesale:[]};
  const retail=measure.kind==='wood'?[...(Number(product.unit_price_sar)>=QUARTER_THRESHOLD_SAR?[{code:'quarter_ounce',grams:7.5}]:[]),{code:'half_ounce',grams:15},{code:'ounce',grams:30}]:[{code:'gram',grams:1}];
  return {retail,wholesale:measure.wholesale_pack_grams.map(grams=>({code:'wholesale_'+grams,grams}))};
}
function packageWeight(product,measure,channel,code,count=1){
  if(measure.kind==='oil'&&channel==='retail'&&code==='gram')return atoms(count)/100;
  if(!Number.isSafeInteger(count)||count<1)throw error('Package count must be a positive whole number.');
  const choices=packages(product,measure)[channel];
  const pack=choices?.find(p=>p.code===code);
  if(!pack)throw error('This sale package is not available for this product.');
  return atoms((pack.grams*count).toFixed(2))/100;
}
function quote(product,measure,grams){
  const weight=atoms(grams),priceText=String(product.unit_price_sar);
  if(!/^\d+(?:\.\d{1,2})?$/.test(priceText))throw error('The product price is not configured correctly.');
  const [whole,fraction='']=priceText.split('.'),priceCents=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  const denominator=measure.price_basis==='ounce'?3000n:100n;
  const cents=(priceCents*BigInt(weight)+denominator/2n)/denominator;
  return Number(cents)/100;
}
function totals(items,catalog){
  const groups={};
  for(const item of items){const m=catalog.get(item.product_id)||PIECE;const raw=Number(item.requested_qty??item.quantity??0);if(!Number.isSafeInteger(raw)||raw<0)throw new Error('Invalid stored quantity.');groups[m.unit_code]=(groups[m.unit_code]||0)+raw/m.quantity_scale;}
  for(const k of Object.keys(groups))groups[k]=Math.round(groups[k]*100)/100;
  return groups;
}
module.exports={OUNCE_GRAMS,SCALE,QUARTER_THRESHOLD_SAR,PIECE,atoms,metadata,packages,packageWeight,quote,totals};
