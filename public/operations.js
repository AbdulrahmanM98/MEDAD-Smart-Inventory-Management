/* RetailFlow operations UI. Authentication is enforced by the server. */
window.RetailFlow = (() => {
  const el=id=>document.getElementById(id);
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let user=null,setup=false,resolveStart=null,alertPage=1,alertPages=1,alertSequence=0,pollTimer=null,sourceDays=7;
  const canBranchTransfer=()=>user?.role==='admin';
  async function loadSettings(){const settings=await api('/api/operations/settings');sourceDays=settings.source_days;el('sourceRetentionDays').value=sourceDays;}
  const roles={admin:'Administrator',approver:'Approver',warehouse:'Warehouse',branch_manager:'Branch manager',viewer:'Viewer'};
  const canCreate=branch=>!!user&&['admin','approver','branch_manager'].includes(user.role)&&(!branch||user.role!=='branch_manager'||branch===user.branch_id);
  async function authRequest(url,body) {
    const r=await fetch(url,{method:body?'POST':'GET',credentials:'same-origin',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const data=await r.json();if(!r.ok)throw new Error(data.error||'Authentication failed.');return data;
  }
  function lock() {
    window.RetailFlowSupply?.reset();
    user=null;document.body.classList.add('auth-locked');el('authModal').hidden=false;
    el('languageControl').hidden=true;
    if(!setup){el('authTitle').textContent='Sign in';el('authDescription').textContent='Use your account. Sessions last 8 hours.';el('authNameLabel').hidden=true;el('authName').required=false;el('authPassword').minLength=1;el('authSubmit').textContent='Sign in';}
    el('signOutBtn').hidden=true;el('authPassword').value='';
    el('accountsTable').innerHTML='';el('accountPassword').value='';
    if(pollTimer){clearInterval(pollTimer);pollTimer=null;}
  }
  function accept(nextUser) {
    user=nextUser;setup=false;document.body.classList.remove('auth-locked');el('authModal').hidden=true;
    el('languageControl').hidden=false;
    el('accountsNav').hidden=user.role!=='admin';el('signOutBtn').hidden=false;
    el('supplyNav').hidden=user.role==='branch_manager';
    el('currentAccount').textContent=`${user.name} · ${roles[user.role]}${user.branch_id?' · '+user.branch_id:''}`;
    el('newTransferBtn').hidden=!canCreate();el('authPassword').value='';
    if(!pollTimer)pollTimer=setInterval(()=>{
      if(user&&!document.hidden)loadAlerts().catch(()=>{});
    },60000);
  }
  async function start() {
    try {
      const [config,session]=await Promise.all([authRequest('/api/auth/config'),authRequest('/api/auth/me')]);
      setup=config.setup_required;
      el('authTitle').textContent=setup?'Create your administrator':'Sign in';
      el('authDescription').textContent=setup?'First-time setup on this computer. Choose a password with at least 12 characters.':'Use your account. Sessions last 8 hours.';
      el('authNameLabel').hidden=!setup;el('authName').required=setup;el('authPassword').minLength=setup?12:1;
      el('authSubmit').textContent=setup?'Create administrator':'Sign in';
      if(session.user){accept(session.user);await loadSettings();return true;}
      lock();return await new Promise(resolve=>{resolveStart=resolve;});
    }catch(error){el('authError').textContent=error.message;return false;}
  }
  el('authForm').addEventListener('submit',async e=>{
    e.preventDefault();const button=el('authSubmit');if(button.disabled)return;button.disabled=true;el('authError').textContent='';
    try {
      const data=await authRequest(setup?'/api/auth/setup':'/api/auth/login',{name:el('authName').value,email:el('authEmail').value,password:el('authPassword').value});
      accept(data.user);
      await loadSettings();
      if(resolveStart){const resolve=resolveStart;resolveStart=null;resolve(true);}
      else{await loadReferenceData();initializeNavigation();}
      await loadAlerts();
    }catch(error){el('authError').textContent=error.message;}finally{button.disabled=false;}
  });
  el('signOutBtn').addEventListener('click',async()=>{
    try{await authRequest('/api/auth/logout',{});setup=false;el('authTitle').textContent='Sign in';el('authNameLabel').hidden=true;el('authName').required=false;el('authPassword').minLength=1;el('authSubmit').textContent='Sign in';lock();}
    catch(error){showToast(error.message,'error');}
  });
  function populateBranches() {
    const options=state.branches.map(b=>`<option value="${escape(b.branch_id)}">${escape(b.branch_name)} (${escape(b.branch_id)})</option>`).join('');
    for(const id of ['alertBranch','accountBranch']){
      const select=el(id),old=select.value;
      select.innerHTML=(id==='alertBranch'?'<option value="All">All branches</option>':'')+options;
      if([...select.options].some(o=>o.value===old))select.value=old;
    }
  }
  function branchOptions(branches) {
    return branches.map(b=>`<option value="${escape(b.branch_id)}">${escape(b.branch_name)} (${escape(b.branch_id)})</option>`).join('');
  }
  function updateSource() {
    if(!canBranchTransfer())el('transferType').value='Warehouse Replenishment';
    const branchTransfer=el('transferType').value==='Branch Transfer';
    el('transferSourceLabel').hidden=!branchTransfer;el('transferSource').required=branchTransfer;
    const previousSource=el('transferSource').value,previousDestination=el('transferBranch').value;
    const priorDestination=state.branches.find(b=>b.branch_id===previousDestination);
    // The source always lists the complete network. It drives the destination list.
    el('transferSource').innerHTML=branchOptions(state.branches);
    if(state.branches.some(b=>b.branch_id===previousSource))el('transferSource').value=previousSource;
    else {
      const preferred=state.branches.find(b=>b.branch_id!==previousDestination&&String(b.city||'').trim().toLowerCase()===String(priorDestination?.city||'').trim().toLowerCase());
      if(preferred)el('transferSource').value=preferred.branch_id;
    }
    const source=state.branches.find(b=>b.branch_id===el('transferSource').value);
    const city=String(source?.city||'').trim().toLowerCase();
    const destinations=branchTransfer
      ?state.branches.filter(b=>b.branch_id!==source?.branch_id&&city&&String(b.city||'').trim().toLowerCase()===city)
      :(user?.role==='branch_manager'?state.branches.filter(b=>b.branch_id===user.branch_id):state.branches);
    el('transferBranch').innerHTML=destinations.length?branchOptions(destinations):'<option value="">No receiving branches in the source city</option>';
    if(destinations.some(b=>b.branch_id===previousDestination))el('transferBranch').value=previousDestination;
    el('transferSourceHint').textContent=branchTransfer
      ?(destinations.length?`Choose a receiving branch in ${source.city}. The source keeps safety stock and ${sourceDays} days of demand.`:'No other branches exist in the selected source city. Choose another source or warehouse replenishment.')
      :'Warehouse stock will be reserved on approval.';
  }
  function prepareTransfer(branch) {
    el('transferType').innerHTML='<option>Warehouse Replenishment</option>'+(canBranchTransfer()?'<option>Branch Transfer</option>':'');
    const destinations=user?.role==='branch_manager'?state.branches.filter(b=>b.branch_id===user.branch_id):state.branches;
    el('transferBranch').innerHTML=branchOptions(destinations);
    if(branch&&destinations.some(b=>b.branch_id===branch))el('transferBranch').value=branch;
    el('transferSource').innerHTML=branchOptions(state.branches);el('transferSource').value='';
    el('transferType').value='Warehouse Replenishment';updateSource();
  }
  el('transferType').addEventListener('change',updateSource);
  el('transferSource').addEventListener('change',updateSource);
  function recommendationMarkup(bundle,branch,product) {
    const r=bundle.recommendation;
    const candidates=[{id:'warehouse',name:`Warehouse · ${WeightUI.quantity(bundle.warehouse_available,product)} available`,capacity:bundle.warehouse_available},
      ...(canBranchTransfer()?bundle.sources:[]).map(s=>({id:s.branch_id,name:`${s.branch_name} · ${WeightUI.quantity(s.transferable_qty,product)} transferable`,capacity:s.transferable_qty}))];
    return `<section class="recommendation-card"><p class="panel-kicker">REPLENISHMENT RECOMMENDATION</p>
      <div class="recommendation-stats"><div><span>Available stock</span><strong>${WeightUI.quantity(r.available_stock,product)}</strong></div><div><span>Days of cover</span><strong>${r.days_of_cover==null?'No recent sales':n(r.days_of_cover,1)}</strong></div><div><span>Open incoming units</span><strong>${WeightUI.quantity(r.incoming_units,product)}</strong></div><div><span>Suggested quantity</span><strong>${WeightUI.quantity(r.suggested_qty,product)}</strong></div></div>
      <p>${escape(r.reason)}</p><p class="panel-sub">Open requests are counted as incoming; stock is reserved only when approved. Seasonal history is shown below and is not automatically forecast.</p>
      ${canBranchTransfer()?`<p class="panel-sub">${bundle.sources.length?`Only branches in ${escape(bundle.destination_city)} are eligible; they keep safety stock plus ${bundle.source_retention_days} days of demand.`:`No branches in ${escape(bundle.destination_city||'this city')} have eligible surplus after keeping safety stock and ${bundle.source_retention_days} days of demand.`}</p>`:''}
      <div class="recommendation-actions"><label>Supply from<select id="recommendationSource" class="control">${candidates.map(c=>`<option value="${escape(c.id)}" ${c.capacity>0?'':'disabled'}>${escape(c.name)}</option>`).join('')}</select></label>
        <button id="recommendationTransfer" type="button" class="btn btn-primary" ${r.suggested_qty>0&&canCreate(branch)&&candidates.some(c=>c.capacity>0)?'':'disabled'}>Review transfer</button></div>
      <p id="recommendationHint" class="panel-sub">${!canCreate(branch)?'Your role can review this product; request creation is restricted.':r.suggested_qty===0?'No additional replenishment needed after open transfers.':'The quantity is limited to the selected source’s available supply.'}</p>
    </section>`;
  }
  function bindRecommendation(bundle,branch,product) {
    const select=el('recommendationSource');
    if(canBranchTransfer()&&bundle.warehouse_available===0&&bundle.sources.length)select.value=bundle.sources[0].branch_id;
    el('recommendationTransfer').addEventListener('click',()=>{
      const source=select.value;
      if(source!=='warehouse'&&!canBranchTransfer())return;
      const capacity=source==='warehouse'?bundle.warehouse_available:bundle.sources.find(s=>s.branch_id===source)?.transferable_qty||0;
      const qty=Math.min(bundle.recommendation.suggested_qty,capacity);
      if(!qty||!canCreate(branch))return;
      el('productInsightsModal').classList.remove('open');openTransferModal(branch,product,qty);
      if(source!=='warehouse'){el('transferType').value='Branch Transfer';el('transferSource').value=source;updateSource();}
    });
  }
  async function loadAlerts() {
    if(!user)return;populateBranches();const sequence=++alertSequence;
    const params=new URLSearchParams({page:alertPage,branch:el('alertBranch').value,severity:el('alertSeverity').value,kind:el('alertKind').value,search:el('alertSearch').value.trim()});
    const result=await api('/api/operations/alerts?'+params);if(sequence!==alertSequence)return;
    alertPage=result.page;alertPages=result.totalPages;
    el('alertBadge').textContent=n(result.summary.critical+result.summary.warning);
    el('alertCritical').textContent=n(result.summary.critical);el('alertWarnings').textContent=n(result.summary.warning);el('alertOverdue').textContent=n(result.summary.overdue);
    el('alertCount').textContent=`${n(result.count)} matching alerts`;
    el('alertPageInfo').textContent=`Page ${alertPage} of ${alertPages}`;el('alertPrev').disabled=alertPage<=1;el('alertNext').disabled=alertPage>=alertPages;
    el('alertsList').innerHTML=result.data.length?result.data.map((r,index)=>`<article class="alert-card ${r.severity}"><div><span class="badge ${r.severity==='critical'?'badge-red':'badge-amber'}">${escape(r.status)}</span><h3>${escape(r.product_name||r.request_id)}</h3><p>${escape(r.branch_name)} · ${escape(r.message)}</p></div><button class="btn btn-secondary alert-action" data-index="${index}">${r.kind==='stock'?'Review product':'View transfer'}</button></article>`).join(''):'<div class="empty-state">No matching alerts.</div>';
    document.querySelectorAll('.alert-action').forEach(button=>button.addEventListener('click',()=>{
      const r=result.data[Number(button.dataset.index)];if(r.kind==='stock')openProductInsights(r.branch_id,r.product_id);else openTransferDetails(r.request_id);
    }));
  }
  async function loadPerformance() {
    const result=await api('/api/operations/metrics');
    el('metricAvailability').textContent=result.availability_pct==null?'—':`${n(result.availability_pct,1)}%`;
    el('metricDelivery').textContent=result.average_delivery_days==null?'—':`${n(result.average_delivery_days,1)} d`;
    el('metricOnTime').textContent=result.on_time_pct==null?'—':`${n(result.on_time_pct,1)}%`;
    el('metricOverdue').textContent=n(result.overdue.length);
    el('metricSample').textContent=`${n(result.measured_deliveries)} received transfers with valid timing, out of ${n(result.completed_transfers)} completed. Availability uses current on-hand stock across ${n(result.total_sku_locations)} SKU locations. No timing data is shown as —.`;
    el('metricsBranches').innerHTML=result.branches.map(b=>`<tr><td><strong>${escape(b.branch_name)}</strong><span class="route-note">${escape(b.branch_id)}</span></td><td>${n(b.in_stock)} / ${n(b.total)}</td><td><div class="availability-meter"><span style="width:${b.availability_pct}%"></span></div>${n(b.availability_pct,1)}%</td><td>${n(b.risk)}</td></tr>`).join('');
    el('metricsOverdue').innerHTML=result.overdue.length?result.overdue.map(t=>`<article class="alert-card warning"><div><h3>${escape(t.request_id)} · ${escape(t.branch_id)}</h3><p>${escape(t.status)} · ${n(t.age_days,1)} days open</p></div><button class="btn btn-secondary metric-transfer" data-id="${escape(t.request_id)}">View details</button></article>`).join(''):'<div class="empty-state">No overdue transfers.</div>';
    document.querySelectorAll('.metric-transfer').forEach(b=>b.addEventListener('click',()=>openTransferDetails(b.dataset.id)));
  }
  async function loadAccounts() {
    if(user?.role!=='admin')return;populateBranches();await loadSettings();const result=await api('/api/admin/users');
    el('accountsTable').innerHTML=result.data.map(u=>`<tr><td><strong>${escape(u.name)}</strong><span class="route-note">${escape(u.email)}</span></td><td>${escape(roles[u.role])}</td><td>${escape(u.branch_id||'—')}</td><td>${u.active?'Active':'Disabled'}</td><td><button class="action-link account-active" data-id="${escape(u.id)}" data-active="${u.active}" ${u.id===user.id?'disabled':''}>${u.active?'Disable':'Enable'}</button></td></tr>`).join('');
    document.querySelectorAll('.account-active').forEach(b=>b.addEventListener('click',async()=>{
      b.disabled=true;try{await api(`/api/admin/users/${b.dataset.id}`,{method:'PATCH',body:JSON.stringify({active:b.dataset.active!=='true'})});await loadAccounts();}
      catch(error){showToast(error.message,'error');b.disabled=false;}
    }));
  }
  async function loadView(view) {
    try{if(view==='alerts')await loadAlerts();if(view==='performance')await loadPerformance();if(view==='accounts')await loadAccounts();}
    catch(error){showToast(error.message,'error');const container=view==='alerts'?el('alertsList'):view==='performance'?el('metricsOverdue'):null;if(container)container.textContent=error.message;}
  }
  for(const id of ['alertBranch','alertSeverity','alertKind'])el(id).addEventListener('change',()=>{alertPage=1;loadView('alerts');});
  el('alertSearch').addEventListener('input',debounce(()=>{alertPage=1;loadView('alerts');}));
  el('alertPrev').addEventListener('click',()=>{if(alertPage>1){alertPage--;loadView('alerts');}});
  el('alertNext').addEventListener('click',()=>{if(alertPage<alertPages){alertPage++;loadView('alerts');}});
  el('accountRole').addEventListener('change',()=>{el('accountBranchLabel').hidden=el('accountRole').value!=='branch_manager';el('accountBranch').required=el('accountRole').value==='branch_manager';});
  el('transferPolicyForm').addEventListener('submit',async e=>{
    e.preventDefault();const button=e.currentTarget.querySelector('[type=submit]');button.disabled=true;el('transferPolicyMessage').textContent='';
    try{const data=await api('/api/operations/settings',{method:'PATCH',body:JSON.stringify({source_days:Number(el('sourceRetentionDays').value)})});sourceDays=data.source_days;el('transferPolicyMessage').textContent='Transfer policy saved.';}
    catch(error){el('transferPolicyMessage').textContent=error.message;}finally{button.disabled=false;}
  });
  el('accountForm').addEventListener('submit',async e=>{
    e.preventDefault();const button=e.currentTarget.querySelector('[type=submit]');if(button.disabled)return;button.disabled=true;el('accountFormMessage').textContent='';
    try{await api('/api/admin/users',{method:'POST',body:JSON.stringify({name:el('accountName').value,email:el('accountEmail').value,password:el('accountPassword').value,role:el('accountRole').value,branch_id:el('accountBranch').value})});
      el('accountPassword').value='';el('accountFormMessage').textContent='Account created.';await loadAccounts();}
    catch(error){el('accountFormMessage').textContent=error.message;}finally{button.disabled=false;}
  });
  return {start,lock,canCreate,prepareTransfer,recommendationMarkup,bindRecommendation,loadView};
})();
