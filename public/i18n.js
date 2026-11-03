/* Localize legacy UI text while preserving all API values, identifiers and user data. */
window.RetailFlowLanguage = (() => {
  let language='en';
  try { language=localStorage.getItem('retailflow.language')==='ar'?'ar':'en'; } catch {}
  const originals=new WeakMap(), attributes=new WeakMap();
  const dictionary={
    'Supply Planning':'احتياجات التوريد والوارد المتوقع',
    'Overview':'نظرة عامة','Inventory':'المخزون','Transfers':'التحويلات','Warehouse':'المستودع','Alerts':'التنبيهات','Performance':'الأداء','Accounts':'الحسابات',
    'Inventory Operations':'إدارة المخزون','SMART REPLENISHMENT':'إعادة التزويد الذكية','Inventory Command Center':'لوحة إدارة المخزون','Inventory Health':'حالة المخزون','Replenishment Workflow':'إدارة التحويلات','Central Warehouse':'المستودع المركزي','Stock & Transfer Alerts':'تنبيهات المخزون والتحويلات','Operations Performance':'أداء العمليات','Account Management':'إدارة الحسابات',
    'Updated':'آخر تحديث','Refresh data':'تحديث البيانات','+ New transfer':'+ تحويل جديد','Branches':'الفروع','Products':'المنتجات','Critical / OOS':'حرج / نفاد المخزون','At Risk':'معرض للنقص','Pending Transfers':'التحويلات المعلقة',
    'Active retail locations':'الفروع النشطة','Tracked SKUs':'المنتجات المتابعة','Needs immediate attention':'تحتاج إجراءً فوريًا','Low + critical stock':'المخزون المنخفض والحرج','Awaiting warehouse action':'بانتظار إجراء المستودع',
    'NETWORK HEALTH':'حالة الشبكة','Stock status distribution':'توزيع حالات المخزون','SKU locations':'سجلات مخزون الفروع','BRANCH PRIORITY':'أولوية الفروع','Highest stock risk':'الفروع الأكثر عرضة للنقص','Open inventory →':'فتح المخزون ←',
    'ACTION QUEUE':'قائمة الإجراءات','Critical inventory items':'الأصناف ذات المخزون الحرج','View all inventory →':'عرض المخزون كاملًا ←','DELIVERIES':'التسليمات','Recent branch deliveries':'آخر تسليمات الفروع','Sorted by actual received time — newest first':'مرتبة حسب وقت الاستلام الفعلي، الأحدث أولًا','Open transfers →':'فتح التحويلات ←',
    'Branch':'الفرع','Product':'المنتج','Category':'الفئة','Stock':'المخزون','Days cover':'أيام التغطية','Status':'الحالة','Suggested':'الكمية المقترحة','Qty':'الكمية','Delivered at':'وقت التسليم','Request':'الطلب','Created':'تاريخ الإنشاء','Items':'الأصناف','Total Units':'إجمالي الوحدات','Priority':'الأولوية','Last update':'آخر تحديث','Details':'التفاصيل',
    'LIVE INVENTORY':'المخزون الحالي','Branch inventory health':'حالة مخزون الفروع','All branches':'جميع الفروع','All categories':'جميع الفئات','All statuses':'جميع الحالات','30D sales':'مبيعات 30 يومًا','Avg/day':'المتوسط اليومي','Reorder point':'حد إعادة الطلب','← Previous':'السابق →','Next →':'← التالي',
    'Out of Stock':'نفد المخزون','Critical':'حرج','Low':'منخفض','Healthy':'جيد','Overstock':'فائض','No Demand':'لا يوجد طلب','Pending':'معلق','Approved':'معتمد','Shipped':'تم الشحن','Received':'تم الاستلام','Rejected':'مرفوض','Cancelled':'ملغى','Normal':'عادي','High':'مرتفع',
    'REPLENISHMENT WORKFLOW':'إدارة إعادة التزويد','Transfer requests':'طلبات التحويل','Every status change is recorded in the request timeline.':'يُسجل كل تغيير في حالة الطلب ضمن سجله الزمني.','CENTRAL WAREHOUSE':'المستودع المركزي','Available stock by product':'المخزون المتاح حسب المنتج','Current':'الحالي','Reserved':'المحجوز','Available':'المتاح','View details':'عرض التفاصيل','From warehouse':'من المستودع','Create transfer':'إنشاء تحويل','Transfer':'تحويل',
    'Critical stock alerts':'تنبيهات المخزون الحرج','Warnings':'تنبيهات تحذيرية','Overdue transfers':'التحويلات المتأخرة','ACTION CENTER':'مركز الإجراءات','Prioritized alerts':'التنبيهات حسب الأولوية','Refreshes every minute while signed in. Open a stock alert to review its replenishment recommendation.':'تُحدث كل دقيقة أثناء تسجيل الدخول. افتح تنبيه المخزون لمراجعة توصية إعادة التزويد.',
    'All priorities':'جميع الأولويات','Warning':'تحذير','All alert types':'جميع أنواع التنبيهات','Overdue transfer':'تحويل متأخر','Review product':'مراجعة المنتج','View transfer':'عرض التحويل','No matching alerts.':'لا توجد تنبيهات مطابقة.','No stock available.':'لا يوجد مخزون متاح.',
    'Product availability':'توفر المنتجات','Average delivery':'متوسط مدة التسليم','On-time delivery':'التسليم في الموعد','Overdue requests':'الطلبات المتأخرة','SKU locations with positive stock':'سجلات الفروع التي تحتوي مخزونًا','Creation to actual receipt':'من الإنشاء إلى الاستلام الفعلي','Received within 3 days':'استلام خلال 3 أيام','Open for more than 3 days':'مفتوحة لأكثر من 3 أيام','Availability by branch':'توفر المنتجات حسب الفرع','In stock / Total':'المتوفر / الإجمالي','Availability':'نسبة التوفر','At risk':'معرض للنقص','Delayed transfers':'التحويلات المتأخرة','No overdue transfers.':'لا توجد تحويلات متأخرة.',
    'BRANCH TRANSFER POLICY':'سياسة التحويل بين الفروع','Source branch protection':'حماية مخزون الفرع المصدر','Branch-to-branch transfers are available to administrators only and within the same city. The source always keeps its safety stock plus the configured days of recent demand.':'التحويل بين الفروع متاح للمدير فقط وداخل المدينة نفسها. يحتفظ المصدر بمخزون الأمان واحتياج المبيعات لعدد الأيام المحدد.',
    'Source coverage (days)':'تغطية الفرع المصدر (أيام)','Save transfer policy':'حفظ سياسة التحويل','Transfer policy saved.':'تم حفظ سياسة التحويل.','ACCESS CONTROL':'إدارة الصلاحيات','Create an account':'إنشاء حساب','Approver approves requests; warehouse ships; branch manager requests and receives for one branch; viewer can read only.':'مسؤول الاعتماد يعتمد الطلبات، والمستودع يشحن، ومدير الفرع يطلب ويستلم لفرعه، والمشاهد يطلع فقط.',
    'Name':'الاسم','Email':'البريد الإلكتروني','Initial password':'كلمة المرور الأولية','Role':'الدور','Assigned branch':'الفرع المخصص','Create account':'إنشاء حساب','Account created.':'تم إنشاء الحساب.','Name / Email':'الاسم / البريد الإلكتروني','Action':'الإجراء','Active':'نشط','Disabled':'معطل','Disable':'تعطيل','Enable':'تفعيل','Administrator':'المدير','Approver':'مسؤول الاعتماد','Branch manager':'مدير الفرع','Viewer':'مشاهد',
    'NEW REQUEST':'طلب جديد','Create stock transfer':'إنشاء تحويل مخزون','Transfer type':'نوع التحويل','Warehouse Replenishment':'تزويد من المستودع','Branch Transfer':'تحويل بين الفروع','Source branch':'الفرع المصدر','Destination Branch':'الفرع المستلم','Warehouse stock will be reserved on approval.':'يُحجز مخزون المستودع عند اعتماد الطلب.','No other branches in this city':'لا توجد فروع أخرى في هذه المدينة','No other branches have the same city as this destination. Choose another destination or warehouse replenishment.':'لا يوجد فرع آخر في مدينة الفرع المستلم. اختر فرعًا مستلمًا آخر أو التزويد من المستودع.',
    'Transfer Items':'أصناف التحويل','Add one or more products':'أضف منتجًا أو أكثر','+ Add item':'+ إضافة صنف','Quantity':'الكمية','Remove item':'حذف الصنف','Cancel':'إلغاء','Create Transfer':'إنشاء التحويل','AUDIT TRAIL':'سجل العمليات','Transfer history':'سجل التحويل','Times shown in Saudi Arabia time (GMT+3).':'الأوقات حسب توقيت السعودية (GMT+3).','Transfer Details':'تفاصيل التحويل','Status Timeline':'السجل الزمني للحالات','Loading transfer details...':'جارٍ تحميل تفاصيل التحويل…',
    'PRODUCT INSIGHTS':'تحليل المنتج','Product Insights':'تحليل المنتج','Loading product insights...':'جارٍ تحميل تحليل المنتج…','Close Product Insights':'إغلاق تحليل المنتج','Current Inventory':'المخزون الحالي','Current Stock':'المخزون الحالي','Available Stock':'المخزون المتاح','Safety Stock':'مخزون الأمان','Historical Sales':'المبيعات السابقة','Last 30 Days':'آخر 30 يومًا','Units sold':'الوحدات المباعة','Avg Daily — 30D':'متوسط المبيعات اليومية — 30 يومًا','Last 12 Months':'آخر 12 شهرًا','Seasonal Performance':'الأداء الموسمي','Season':'الموسم','Units Sold':'الوحدات المباعة','Avg / Day':'المتوسط اليومي','Vs Normal':'مقارنة بالفترة العادية','Normal Period':'الفترة العادية','Baseline':'الأساس','Ramadan':'رمضان','Ramadan Peak':'ذروة رمضان','Eid Al-Fitr':'عيد الفطر','Eid Al-Adha':'عيد الأضحى','Promotion Sales':'مبيعات العروض','Promotion Days':'أيام العروض',
    'REPLENISHMENT RECOMMENDATION':'توصية إعادة التزويد','Available stock':'المخزون المتاح','Days of cover':'أيام التغطية','Open incoming units':'الوحدات الواردة في الطلبات المفتوحة','Suggested quantity':'الكمية المقترحة','No recent sales':'لا توجد مبيعات حديثة','Supply from':'مصدر التزويد','Review transfer':'مراجعة التحويل','Recent demand is zero; replenish only the safety-stock gap.':'لا توجد مبيعات حديثة؛ تُقترح فقط الكمية اللازمة لمخزون الأمان.',
    'Open requests are counted as incoming; stock is reserved only when approved. Seasonal history is shown below and is not automatically forecast.':'تُحتسب الطلبات المفتوحة ضمن الوارد، ويُحجز المخزون عند الاعتماد فقط. يظهر السجل الموسمي أدناه دون تطبيق توقع موسمي تلقائي.',
    'Your role can review this product; request creation is restricted.':'يمكنك مراجعة هذا المنتج، وإنشاء الطلبات مقيد حسب الصلاحية.','No additional replenishment needed after open transfers.':'لا حاجة لتزويد إضافي بعد احتساب التحويلات المفتوحة.','The quantity is limited to the selected source’s available supply.':'تقتصر الكمية على المخزون القابل للنقل لدى المصدر المختار.',
    'Sign in':'تسجيل الدخول','Sign out':'تسجيل الخروج','Signed out':'لم يتم تسجيل الدخول','Create your administrator':'إنشاء حساب المدير','Create administrator':'إنشاء حساب المدير','Password':'كلمة المرور','Use your account.':'استخدم حسابك في النظام.','Use your account. Sessions last 8 hours.':'استخدم حسابك في النظام. تستمر الجلسة 8 ساعات.','First-time setup on this computer. Choose a password with at least 12 characters.':'إعداد أولي على هذا الجهاز. اختر كلمة مرور لا تقل عن 12 حرفًا.',
    'Checking API...':'جارٍ التحقق من الاتصال…','API connected':'الخادم متصل','API unavailable':'الخادم غير متاح','Loading live data...':'جارٍ تحميل البيانات الحالية…','No received deliveries yet.':'لا توجد تسليمات مستلمة حتى الآن.','Data refreshed':'تم تحديث البيانات','Data updated':'تم تحديث البيانات','Request failed':'تعذر تنفيذ الطلب','Authentication failed.':'تعذر تسجيل الدخول.','Data unavailable':'البيانات غير متاحة','Source and destination must be in the same city.':'يجب أن يكون المصدر والمستلم في المدينة نفسها.',
    'Search product...':'ابحث عن منتج…','Search branch...':'ابحث عن فرع…','Search product, branch or request':'ابحث عن منتج أو فرع أو طلب','Search alerts':'البحث في التنبيهات','Alert branch':'فرع التنبيه','Alert severity':'أولوية التنبيه','Alert type':'نوع التنبيه',
    'Invalid email or password.':'البريد الإلكتروني أو كلمة المرور غير صحيحة.','Too many attempts. Try again in 15 minutes.':'محاولات كثيرة. حاول مجددًا بعد 15 دقيقة.','Email already exists.':'البريد الإلكتروني مستخدم بالفعل.','Enter a valid email.':'أدخل بريدًا إلكترونيًا صحيحًا.','Use a password with 12–128 characters.':'استخدم كلمة مرور من 12 إلى 128 حرفًا.','Your role cannot create transfers.':'دورك لا يسمح بإنشاء تحويلات.','Your role cannot create this transfer.':'دورك لا يسمح بإنشاء هذا التحويل.','Only an administrator can create branch-to-branch transfers.':'إنشاء التحويلات بين الفروع متاح للمدير فقط.','Only an administrator can change transfer settings.':'تعديل إعدادات التحويل متاح للمدير فقط.','Administrator access required.':'يلزم حساب مدير.','Sign in to continue.':'سجّل الدخول للمتابعة.','You cannot disable your own account.':'لا يمكنك تعطيل حسابك.','Keep at least one active administrator.':'يجب الإبقاء على مدير نشط واحد على الأقل.','Create requests only for your assigned branch.':'يمكنك إنشاء طلبات لفرعك المخصص فقط.','Choose a destination branch.':'اختر الفرع المستلم.','Choose a different source branch.':'اختر فرعًا مصدرًا مختلفًا.','Choose an existing branch.':'اختر فرعًا موجودًا.','Branch transfers are allowed only between different branches in the same city. Both branches need a known city.':'التحويل متاح بين فرعين مختلفين في المدينة نفسها فقط. يجب تحديد مدينة كلا الفرعين.','Source coverage must be a whole number from 1 to 30 days.':'يجب أن تكون التغطية عددًا صحيحًا من 1 إلى 30 يومًا.','The same product cannot appear twice.':'لا يمكن إضافة المنتج نفسه مرتين.','This status change is not permitted for your role or the current request state.':'لا يسمح دورك أو الحالة الحالية للطلب بهذا التغيير.','Source and destination must be in the same city. Cancel or reject the old request instead.':'يجب أن يكون المصدر والمستلم في المدينة نفسها. ألغِ الطلب القديم أو ارفضه.',
    'Add 1–100 products.':'أضف من منتج واحد إلى 100 منتج.','Each product needs a positive whole-number quantity, up to 1,000,000.':'يجب أن تكون كمية كل منتج عددًا صحيحًا موجبًا لا يتجاوز 1,000,000.','Replenishment settings are unavailable.':'إعدادات إعادة التزويد غير متاحة.','Branch inventory not found.':'لم يُعثر على مخزون الفرع.','Service unavailable. Check the server configuration.':'الخدمة غير متاحة. تحقق من إعدادات الخادم.'
  };
  dictionary['Reports']='التقارير';
  dictionary['Sales Reports']='تقارير المبيعات';
  dictionary['Total Quantities']='الكميات حسب الوحدة';
  dictionary['Grams sold']='الجرامات المباعة';
  const patterns=[
    [/^Page (.+) of (.+)$/,(_,a,b)=>`الصفحة ${a} من ${b}`], [/^Page (\d+)$/,(_,a)=>`الصفحة ${a}`],
    [/^(.+) records$/,(_,a)=>`${a} سجل`],[/^(.+) matching alerts$/,(_,a)=>`${a} تنبيه مطابق`],
    [/^Warehouse · (.+) available$/,(_,a)=>`المستودع · ${a} متاح`],[/^(.+) · (.+) transferable$/,(_,a,b)=>`${a} · ${b} قابل للنقل`],
    [/^Cover (\d+) days of recent demand plus safety stock, after open transfers\.$/,(_,a)=>`تغطية ${a} يومًا من المبيعات الحديثة ومخزون الأمان بعد احتساب التحويلات المفتوحة.`],
    [/^Only branches in (.+) are eligible; they keep safety stock plus (\d+) days of demand\.$/,(_,a,b)=>`الفروع المؤهلة داخل ${city(a)} فقط؛ تحتفظ بمخزون الأمان واحتياج ${b} أيام.`],
    [/^No branches in (.+) have eligible surplus after keeping safety stock and (\d+) days of demand\.$/,(_,a,b)=>`لا يوجد فائض قابل للنقل داخل ${city(a)} بعد احتساب مخزون الأمان واحتياج ${b} أيام.`],
    [/^Only branches in (.+) can supply this destination\. The source keeps safety stock and (\d+) days of demand\.$/,(_,a,b)=>`التزويد من فروع ${city(a)} فقط. يحتفظ المصدر بمخزون الأمان واحتياج ${b} أيام.`],
    [/^Sales history through (.+)$/,(_,a)=>`بيانات المبيعات حتى ${a}`],
    [/^Stock cover: (.+)\.$/,(_,a)=>`تغطية المخزون: ${a.replace(' days',' أيام').replace('unknown','غير معروفة')}.`],
    [/^(.+) · Open for (.+) days; target is (\d+) days\.$/,(_,a,b,c)=>`${a} · مفتوح منذ ${b} أيام؛ المدة المستهدفة ${c} أيام.`],
    [/^Open for (.+) days; target is (\d+) days\.$/,(_,a,b)=>`مفتوح منذ ${a} أيام؛ المدة المستهدفة ${b} أيام.`],
    [/^(.+) · Stock cover: (.+)\.$/,(_,a,b)=>`${a} · تغطية المخزون: ${b.replace(' days',' أيام').replace('unknown','غير معروفة')}.`],
    [/^(.+) · (.+) days open$/,(_,a,b)=>`${dictionary[a]||a} · مفتوح منذ ${b} أيام`],
    [/^(.+) d$/,(_,a)=>`${a} يوم`],[/^From (BR\d+)$/,(_,a)=>`من ${a}`],[/^(.+) products$/,(_,a)=>`${a} منتجات`],
    [/^(.+) — Transfer Details$/,(_,a)=>`${a} — تفاصيل التحويل`],
    [/^(.+) received transfers with valid timing, out of (.+) completed\. Availability uses current on-hand stock across (.+) SKU locations\. No timing data is shown as —\.$/,(_,a,b,c)=>`${a} تحويلات مستلمة ببيانات زمنية صالحة من ${b} مكتملة. التوفر محسوب من المخزون الحالي في ${c} سجل. البيانات الزمنية غير المتاحة تظهر —.`],
    [/^(.+) · (Administrator|Approver|Warehouse|Branch manager|Viewer)(.*)$/,(_,a,b,c)=>`${a} · ${dictionary[b]}${c}`],
    [/^(TR-[\w-]+) created$/,(_,a)=>`تم إنشاء ${a}`],[/^(TR-[\w-]+) updated to (.+)$/,(_,a,b)=>`تم تحديث ${a} إلى ${dictionary[b]||b}`],
    [/^(.+) KSA$/,(_,a)=>`${a} بتوقيت السعودية`]
  ];
  dictionary['Promotion Performance']='أداء العروض';
  dictionary['Name must be 1–80 characters.']='يجب أن يتكون الاسم من 1 إلى 80 حرفًا.';
  dictionary['Account not found.']='لم يُعثر على الحساب.';
  dictionary['No receiving branches in the source city']='لا توجد فروع مستلمة في مدينة المصدر';
  dictionary['No other branches exist in the selected source city. Choose another source or warehouse replenishment.']='لا توجد فروع أخرى في مدينة المصدر المختار. اختر مصدرًا آخر أو التزويد من المستودع.';
  patterns.push([/^Choose a receiving branch in (.+)\. The source keeps safety stock and (\d+) days of demand\.$/,(_,a,b)=>`اختر فرعًا مستلمًا داخل ${city(a)}. يحتفظ المصدر بمخزون الأمان واحتياج ${b} أيام.`]);
  dictionary['Branch transfers are allowed only between branches in the same known city']='التحويل متاح بين فروع المدينة نفسها فقط، مع ضرورة تحديد المدينة.';
  patterns.push([/^Insufficient transferable stock for (.+)\. Available (.+), requested (.+)$/,(_,a,b,c)=>`المخزون القابل للنقل للمنتج ${a} غير كافٍ. المتاح ${b} والمطلوب ${c}.`]);
  patterns.push([/^Transfer would consume source safety stock or configured source demand for (.+)$/,(_,a)=>`هذا التحويل سيستهلك مخزون الأمان أو احتياج الفرع المصدر للمنتج ${a}.`]);
  function city(value){return ({Jeddah:'جدة',Makkah:'مكة',Riyadh:'الرياض',Dammam:'الدمام',Khobar:'الخبر',Madinah:'المدينة المنورة',Taif:'الطائف',Abha:'أبها',Tabuk:'تبوك',Yanbu:'ينبع',Qassim:'القصيم','this city':'هذه المدينة'})[value]||value;}
  function translate(text){if(language!=='ar')return text;if(Object.hasOwn(dictionary,text))return dictionary[text];for(const [pattern,render] of patterns)if(pattern.test(text))return text.replace(pattern,render);return text;}
  function excluded(element){return !element||element.closest('script,style,#languageControl,[data-no-translate]');}
  function localizeText(node){
    if(excluded(node.parentElement))return;
    const previous=originals.get(node),current=node.nodeValue;
    const source=previous&&current===previous.rendered?previous.source:current;
    const trimmed=source.trim();if(!trimmed)return;
    const translated=translate(trimmed),rendered=source.replace(trimmed,()=>translated);
    // Status/type options may originally use their displayed English label as their value.
    const option=node.parentElement.closest('option');if(option&&!option.hasAttribute('value'))option.setAttribute('value',option.value);
    originals.set(node,{source,rendered});if(current!==rendered)node.nodeValue=rendered;
  }
  function localizeAttributes(element){
    if(excluded(element))return;
    const saved=attributes.get(element)||{};
    for(const key of ['placeholder','title','aria-label']){
      if(!element.hasAttribute(key))continue;
      const current=element.getAttribute(key),previous=saved[key];
      const source=previous&&current===previous.rendered?previous.source:current;
      const rendered=translate(source);saved[key]={source,rendered};if(current!==rendered)element.setAttribute(key,rendered);
    }attributes.set(element,saved);
  }
  function walk(root){
    if(root.nodeType===Node.TEXT_NODE){localizeText(root);return;}
    if(root.nodeType!==Node.ELEMENT_NODE||excluded(root))return;
    localizeAttributes(root);for(const child of root.childNodes)walk(child);
  }
  function apply(){document.documentElement.lang=language;document.documentElement.dir=language==='ar'?'rtl':'ltr';const select=document.getElementById('languageSelect');if(select)select.value=language;walk(document.body);}
  function setLanguage(value){language=value==='ar'?'ar':'en';try{localStorage.setItem('retailflow.language',language);}catch{}apply();window.dispatchEvent(new Event('retailflow:language'));}
  document.addEventListener('DOMContentLoaded',()=>{
    document.getElementById('languageSelect').addEventListener('change',e=>setLanguage(e.target.value));apply();
    new MutationObserver(records=>{for(const r of records){if(r.type==='characterData')localizeText(r.target);else if(r.type==='attributes')localizeAttributes(r.target);else for(const node of r.addedNodes)walk(node);}}).observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['placeholder','title','aria-label']});
  });
  return {setLanguage,apply,translate,locale:()=>language==='ar'?'ar-SA':'en-GB'};
})();
