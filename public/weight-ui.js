/* Product quantities shown here are API display units, never storage integers. */
window.WeightUI=(()=>{
  const ar=()=>document.documentElement.lang==='ar',t=(a,b)=>ar()?a:b;
  const unit=code=>code==='g'?t('جم','g'):t('قطعة','pcs');
  const measure=p=>typeof p==='string'?state.products.find(row=>row.product_id===p)||{}:p||{};
  const quantity=(value,p)=>`${n(value)} ${unit(measure(p).unit_code)}`;
  const grouped=groups=>Object.entries(groups||{}).filter(([,v])=>v!==0).map(([code,value])=>`${n(value)} ${unit(code)}`).join(' + ')||'—';
  const packageLabel=code=>({quarter_ounce:t('ربع أوقية','Quarter ounce'),half_ounce:t('نصف أوقية','Half ounce'),ounce:t('أوقية','Ounce'),gram:t('جرام','Gram')})[code]||t('عبوة جملة','Wholesale pack');
  function configureRow(row){
    const p=measure(row.querySelector('.transfer-item-product').value),input=row.querySelector('.transfer-item-qty');
    input.step=p.unit_code==='g'?'0.01':'1';input.min=p.unit_code==='g'?'0.01':'1';input.max=p.unit_code==='g'?'10000':'1000000';
    input.setAttribute('aria-label',t('الكمية','Quantity')+' ('+unit(p.unit_code)+')');
    const label=row.querySelector('.transfer-unit-label');if(label)label.textContent=t('الكمية','Quantity')+' ('+unit(p.unit_code)+')';
    if(p.unit_code!=='g'&&Number(input.value)%1!==0)input.value='';
  }
  function draftTotals(){
    const groups={};document.querySelectorAll('.transfer-item-row').forEach(row=>{const p=measure(row.querySelector('.transfer-item-product').value),code=p.unit_code||'piece',value=Number(row.querySelector('.transfer-item-qty').value);if(Number.isFinite(value)&&value>=0)groups[code]=(groups[code]||0)+value;});
    for(const key of Object.keys(groups))groups[key]=Math.round(groups[key]*100)/100;
    document.getElementById('transferTotalUnits').textContent=grouped(groups);
  }
  function optionsMarkup(info){
    if(!info||info.unit_code!=='g')return '';
    const money=v=>new Intl.NumberFormat(ar()?'ar-SA':'en-GB',{style:'currency',currency:'SAR',maximumFractionDigits:2}).format(v);
    const packs=(items)=>items.map(p=>`<div style="padding:10px;border:1px solid var(--line);border-radius:10px;background:white"><strong>${packageLabel(p.code)} · ${n(p.grams)} ${unit('g')}</strong><div>${money(p.price_sar)}</div></div>`).join('');
    return `<section class="recommendation-card" data-no-translate><p class="panel-kicker">${t('الوزن وخيارات البيع','WEIGHT & SALE OPTIONS')}</p><h3>${t('وحدة المخزون: جرام · دقة 0.01 جم','Stock unit: grams · precision 0.01 g')}</h3><p>${t('الأوقية = 30 جم · النصف = 15 جم · الربع = 7.50 جم','Ounce = 30 g · half = 15 g · quarter = 7.50 g')}</p>${info.is_demo?`<p><strong>${t('صنف تجريبي — الأسعار والمبيعات أمثلة للاختبار','Demo product — prices and sales are test examples')}</strong></p>`:''}<h4>${t('التجزئة','Retail')}</h4><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px">${packs(info.retail)}</div>${info.kind==='wood'?`<p>${t('ربع الأوقية متاح عندما يكون سعر الأوقية 1500 ريال فأكثر.','Quarter-ounce sales require an ounce price of SAR 1,500 or more.')}</p>`:`<p>${t('يمكن حساب الدهون بأوزان كسرية بدقة 0.01 جم؛ السعر المعروض لكل جرام.','Oils support fractional weights in 0.01 g increments; the displayed price is per gram.')}</p>`}<h4>${t('الجملة','Wholesale')}</h4><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px">${packs(info.wholesale)}</div><p>${t('هذه أسعار الأساس حسب الوزن؛ لم يُحدد خصم للجملة. خيارات البيع للعرض وليست شاشة تسجيل عملية بيع.','These are base prices by weight; no wholesale discount has been configured. Sale options are informational, not a sales checkout.')}</p></section>`;
  }
  return {unit,quantity,grouped,configureRow,draftTotals,optionsMarkup};
})();
