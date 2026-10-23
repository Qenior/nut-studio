'use strict';
const C = NutCore;
const $ = (q) => document.querySelector(q);
const $$ = (q) => [...document.querySelectorAll(q)];
const clone = (x) => JSON.parse(JSON.stringify(x));
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const text = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const TOKEN = $('meta[name="nut-token"]').content;
const nativeAvailable = TOKEN.length === 64;
const geometry = C.layout();
const layerNames = ['WINDOWS · 基础层','WINDOWS · Fn 功能层','MAC · 基础层','MAC · Fn 功能层','扩展功能层'];
const state = {page:'keymap',seed:null,layers:[],original:[],layer:0,selected:0,category:'基本按键',mode:'legacy',firmwareProfile:C.CU_PROFILE,light:{effect:36,brightness:184,speed:128,hue:14,saturation:120},originalLight:null,lightDirty:false,settings:{sleepTimeout:4,workMinutes:25,breakMinutes:5,stripMode:0},originalSettings:null,settingsDirty:false,via:null,transport:null,live:null,liveState:'offline',busy:false,previewPaused:false,testActive:false,tested:new Set(),held:new Set(),logs:[],profiles:[]};
const keyLabel=id=>C.label(id,state.firmwareProfile);
Object.assign(state,{shortcutEnabled:false,shortcutEpoch:0,shortcutPending:0,stripResume:{effect:1,stripMode:0}});
let rememberShortcut=Promise.resolve();
let shortcutAbort=null,heartbeatAbort=null,heartbeatTimer=null,pageActive=true;
let connectionEpoch=0,connectingTransport=null;

function cancelShortcutWatch(){state.shortcutEpoch++;state.shortcutPending=0;if(shortcutAbort)shortcutAbort.abort();shortcutAbort=null;}
function checkConnection(epoch){if(!pageActive||epoch!==connectionEpoch)throw Object.assign(Error('连接操作已取消'),{cancelled:true});}
function cancelConnection(){connectionEpoch++;cancelShortcutWatch();const transport=connectingTransport;connectingTransport=null;if(transport instanceof WebHidTransport)transport.close().catch(()=>{});}

function usesStripShortcut(layers=state.layers){return layers.some(layer=>layer.includes('NUT_STRIP_TOGGLE'));}
function shortcutDirty(){return !!state.via&&usesStripShortcut()!==state.shortcutEnabled;}
function decodeDeviceLayers(via){return via.baseline.map(layer=>layer.map(value=>state.shortcutEnabled&&via.firmwareProfile===C.CU_PROFILE&&value===0x73?'NUT_STRIP_TOGGLE':C.decode(value,via.mode,via.layerCount)));}
async function configureStripShortcut(enabled,epoch=connectionEpoch){
  checkConnection(epoch);
  if(!nativeAvailable)throw Error('前灯带软件开关需要 Windows 版 NUT Studio');
  if(enabled&&!(state.transport instanceof NativeTransport))throw Error('前灯带软件开关需要 Windows 直接连接');
  cancelShortcutWatch();
  const result=await api('shortcut/configure',{enabled});checkConnection(epoch);state.shortcutEnabled=enabled;
  if(enabled)watchStripShortcut(result.sequence,state.shortcutEpoch,result.owner);
}
async function resumeStripShortcut(epoch=connectionEpoch){
  if(!nativeAvailable)return;
  const saved=await api('shortcut/state');checkConnection(epoch);state.shortcutEnabled=!!saved.enabled;
  if(C.cuEffects.some(e=>e.id===saved.effect)&&saved.effect!==0&&[0,1,3,4].includes(saved.mode))state.stripResume={effect:saved.effect,stripMode:saved.mode};
  if(state.shortcutEnabled&&state.via?.firmwareProfile===C.CU_PROFILE&&state.transport instanceof NativeTransport&&state.via.baseline.some(l=>l.includes(0x73)))await configureStripShortcut(true,epoch);
}
function deliverStripShortcut(){
  if(state.busy||!state.shortcutPending)return;
  const count=state.shortcutPending;state.shortcutPending=0;
  if(!state.shortcutEnabled||!(state.transport instanceof NativeTransport)||!state.live||state.via?.firmwareProfile!==C.CU_PROFILE||!state.via.baseline.some(l=>l.includes(0x73)))return;
  try{for(let i=0;i<count;i++)state.live.requestToggle();}catch(error){toast(error.message,true);}
}
async function watchStripShortcut(after,epoch,owner){
  const controller=new AbortController();shortcutAbort=controller;
  try{
    while(epoch===state.shortcutEpoch&&state.shortcutEnabled){
      const event=await api('shortcut/wait',{after,owner},controller.signal);if(epoch!==state.shortcutEpoch)return;
      if(!event.registered||event.owner!==owner)return;
      const count=event.sequence-after;after=event.sequence;
      if(count<0||count>64)throw Error('灯带开关事件积压，请重新连接');
      state.shortcutPending+=count;deliverStripShortcut();
    }
  }catch(error){if(epoch===state.shortcutEpoch&&!controller.signal.aborted){api('shortcut/suspend').catch(()=>{});toast('前灯带软件开关已暂停：'+error.message,true);}}
  finally{if(shortcutAbort===controller)shortcutAbort=null;}
}

function toast(message,error=false) {
  const n=document.createElement('div');n.className=`toast${error?' error':''}`;
  n.innerHTML=icon(error?'info':'check');const span=document.createElement('span');span.textContent=message;n.append(span);$('#toasts').append(n);
  setTimeout(()=>n.remove(),error?8500:4200);
}
function showBusy(title,detail='请保持 USB 连接') {state.busy=true;$('#busy-title').textContent=title;$('#busy-detail').textContent=detail;$('#busy-progress').style.width='0%';$('#busy-overlay').hidden=false;updateActions();}
function progress(value){$('#busy-progress').style.width=`${Math.round(value*100)}%`;}
function hideBusy(){state.busy=false;$('#busy-overlay').hidden=true;updateActions();deliverStripShortcut();}
function modal(html) {if(state.held.size){state.held.clear();updateTestBoard();}$('#modal-content').innerHTML=html;if(!$('#modal').open)$('#modal').showModal();}
function closeModal(){$('#modal').close();}
function confirmAction(title,message,action,label='确认') {
  modal(`<h2>${text(title)}</h2><p>${text(message)}</p><div class="modal-actions"><button class="button" id="modal-cancel">取消</button><button class="button primary" id="modal-confirm">${text(label)}</button></div>`);
  $('#modal-cancel').onclick=closeModal;$('#modal-confirm').onclick=()=>{closeModal();return action();};
}
async function api(path,payload={},signal) {
  const response=await fetch(`api/${path}`,{method:'POST',headers:{'Content-Type':'application/json','X-Nut-Token':TOKEN},body:JSON.stringify(payload),signal});
  if(!response.ok)throw Error('本地设备服务无法访问，请重新启动 NUT Studio');
  const result=await response.json();if(!result.ok)throw Error(result.error);return result.data;
}
class NativeTransport {
  async open(){return api('connect');}
  async exchange(bytes){return api('exchange',{bytes});}
  async close(){await api('disconnect');}
}
class WebHidTransport {
  constructor(device){this.device=device;this.pending=null;this.queue=Promise.resolve();this.onInput=this.onInput.bind(this);this.failed=false;this.closed=false;this.closing=null;}
  async open(){
    if(this.closed)throw Error('USB 连接已关闭，请重新连接');
    try{
      if(!this.device.opened)await this.device.open();
      if(this.closed){if(this.device.opened)await this.device.close();throw Error('USB 连接已关闭，请重新连接');}
      this.reports=C.describeHidReports(this.device.collections);
      this.device.addEventListener('inputreport',this.onInput);
      if(nativeAvailable)await api('diagnostic',{message:'WebHID descriptor '+JSON.stringify({vendorId:this.device.vendorId,productId:this.device.productId,reports:this.reports})}).catch(()=>{});
      if(this.closed)throw Error('USB 连接已关闭，请重新连接');
    }catch(error){await this.close(error).catch(()=>{});throw error;}
  }
  settle(request,error,value){
    if(this.pending!==request)return;
    this.pending=null;clearTimeout(request.timer);
    if(error)request.reject(error);else request.resolve(value);
  }
  onInput(event) {
    const request=this.pending;if(!request||this.closed)return;
    let bytes;
    try{bytes=C.normalizeHidInput(new Uint8Array(event.data.buffer,event.data.byteOffset,event.data.byteLength),event.reportId,this.reports.input);}catch(e){this.close(e).catch(()=>{});return;}
    if(!bytes)return;
    if(bytes[0]===0xff){this.settle(request,Error('当前固件不支持此 VIA 指令'));return;}
    if(bytes[0]!==request.command)return;
    this.settle(request,null,bytes);
  }
  exchange(bytes) {const copy=Uint8Array.from(bytes);const job=this.queue.then(()=>this.send(copy));this.queue=job.catch(()=>{});return job;}
  async send(bytes) {
    if(this.closed||this.failed||!this.device.opened||!this.reports)throw Error('USB 连接已关闭，请重新连接');
    return new Promise((resolve,reject)=> {
      const request={command:bytes[0],resolve,reject,timer:null};this.pending=request;
      request.timer=setTimeout(()=>{if(this.pending===request)this.close(Error(`键盘响应超时（输出 ${this.reports.output.bytes} 字节 / 编号 ${this.reports.output.id}，输入 ${this.reports.input.bytes} 字节 / 编号 ${this.reports.input.id}），请关闭 VIA 后重新连接`)).catch(()=>{});},2300);
      try{
        const buffer=new Uint8Array(this.reports.output.bytes);buffer.set(bytes);
        Promise.resolve(this.device.sendReport(this.reports.output.id,buffer)).catch(e=>{if(this.pending===request)this.close(e).catch(()=>{});});
      }catch(e){this.close(e).catch(()=>{});}
    });
  }
  close(error=Error('连接已关闭')){
    if(this.closing)return this.closing;
    this.closed=this.failed=true;this.device.removeEventListener('inputreport',this.onInput);
    if(this.pending)this.settle(this.pending,error);
    this.closing=Promise.resolve().then(()=>{if(this.device.opened)return this.device.close();});return this.closing;
  }
}

function connectionLost(transport=state.transport){
  if(transport!==state.transport)return;
  cancelConnection();if(state.live)state.live.cancel();state.live=null;state.liveState='offline';state.via=null;state.transport=null;
  if(transport)transport.close().catch(()=>{});if(state.busy)hideBusy();setConnected(false);
}
function keyDirty(layer,index) {
  const a=state.layers[layer]?.[index],b=state.original[layer]?.[index];
  try{return C.encode(a,state.mode,state.layers.length)!==C.encode(b,state.mode,state.layers.length);}catch{return a!==b;}
}
function draftChanges() {
  const changes=[];
  state.layers.forEach((l,li)=>geometry.forEach(k=>{if(keyDirty(li,k.index))changes.push({layer:li,index:k.index,value:l[k.index]});}));return changes;
}
function updateActions() {
  const count=draftChanges().length;
  const dirty=count>0||shortcutDirty();
  $('#pending-label').textContent=dirty?`${count} 个键位待应用`:state.via?'键位已同步 · 灯光实时控制':'离线预览 · 连接后实时调节灯光';
  $('#pending-label').classList.toggle('dirty',dirty);
  $('#apply-button').disabled=state.busy||!dirty;
  $('#read-button').disabled=state.busy||!state.via;
}
function setConnected(connected) {
  $('#connection-state').classList.toggle('online',connected);
  $('#connection-state').innerHTML=`<i></i>${connected?'USB 已连接':'离线预览'}`;
  $('#side-status').textContent=connected?'有线连接 · 已同步':'等待连接';
  $('#side-dot').classList.toggle('online',connected);
  $('#connect-button').innerHTML=icon('usb')+(connected?'连接管理':'连接键盘');
  $('#connection-notice').hidden=connected;
  $('#layer-count').textContent=`${state.layers.length} 个图层`;
  $('#lighting-status').textContent=connected?(state.via.lighting?'已读取前灯带配置':'固件灯光通道不可用'):'连接后读取键盘当前灯光';
  renderFeatures();
  renderLiveStatus();
  updateActions();
}
function connectDialog(error='') {
  if(state.busy)return;
  if(state.via) {
    modal(`<h2>键盘已连接</h2><p>NUT65 CU · VIA 协议 ${state.via.protocol}<br>${state.transport instanceof NativeTransport?'Windows HID':'浏览器 USB'} · ${state.via.layerCount} 个图层<br>键码：${state.mode==='modern'?'新版 QMK':'兼容 VIA'}</p><div class="modal-actions"><button class="button" id="disconnect-button">断开连接</button><button class="button primary" id="manage-done">完成</button></div>`);
    $('#disconnect-button').onclick=async()=>{closeModal();await disconnect();};$('#manage-done').onclick=closeModal;return;
  }
  modal(`<h2>连接你的 NUT65 CU</h2><p>使用 USB 数据线连接，并将键盘切换为有线模式。请先关闭 VIA 及其他键盘控制软件。</p>${error?`<p class="danger-text">${text(error)}</p>`:''}${nativeAvailable?`<button class="dialog-option" id="native-connect"><div><b>Windows 直接连接</b><small>推荐 · 自动查找 NUT65 CU</small></div>${icon('arrow')}</button>`:''}<button class="dialog-option" id="web-connect"><div><b>浏览器 USB 连接</b><small>在系统选择框中选择 NUT65 CU</small></div>${icon('arrow')}</button><p class="field-help">连接时读取设备当前设置。连接后，灯光与设备功能调整实时生效；键位修改通过“应用键位”保存。</p>`);
  if(error&&nativeAvailable){const b=document.createElement('button');b.className='button full';b.textContent='导出连接诊断';b.onclick=exportDiagnostics;$('#modal-content').append(b);}
  if($('#native-connect'))$('#native-connect').onclick=()=>connect('native');
  $('#web-connect').onclick=()=>connect('web');
}
async function connect(kind) {
  if(state.busy||!pageActive)return;
  const epoch=++connectionEpoch;let transport;
  try {
    if(kind==='web') {
      if(!navigator.hid)throw Error('此浏览器不支持 USB HID，请使用 Microsoft Edge 或 Chrome 打开软件');
      // Must run directly inside the click gesture for the system device chooser.
      const devices=await navigator.hid.requestDevice({filters:[{vendorId:C.VID,productId:C.PID,usagePage:0xff60,usage:0x61}]});
      checkConnection(epoch);
      if(!devices.length)return;transport=new WebHidTransport(devices[0]);
    }else transport=new NativeTransport();
    connectingTransport=transport;closeModal();showBusy('正在连接 NUT65 CU','读取配置，不会改动你的键盘');
    const changes=draftChanges(),draftProfile=state.firmwareProfile,draftMode=state.mode;
    await transport.open();checkConnection(epoch);const via=new C.ViaDevice(transport);await via.connect(progress);checkConnection(epoch);
    state.transport=transport;state.via=via;state.mode=via.mode;state.firmwareProfile=via.firmwareProfile;
    await resumeStripShortcut(epoch);checkConnection(epoch);state.layers=decodeDeviceLayers(via);state.original=clone(state.layers);
    let skippedKeys=0;
    changes.forEach(c=>{if((draftProfile!==state.firmwareProfile&&(/^CUSTOM\(/.test(String(c.value))||c.value==='NUT_STRIP_TOGGLE'))||((draftMode!==state.mode||draftProfile!==state.firmwareProfile)&&(/^0x/i.test(String(c.value))||typeof c.value==='number')&&C.encode(c.value)>255)){skippedKeys++;return;}if(state.layers[c.layer])state.layers[c.layer][c.index]=c.value;});
    state.originalLight=via.lighting?clone(via.lighting):null;
    state.lightDirty=false;state.settingsDirty=false;
    if(via.lighting)state.light=clone(via.lighting);
    state.originalSettings=via.settings?clone(via.settings):null;
    if(via.settings)state.settings=clone(via.settings);
    if(skippedKeys)toast('检测到不同固件，部分专属或原始键码未沿用，请重新分配');
    if(nativeAvailable)await api('diagnostic',{message:'Firmware '+via.firmwareProfile+' protocol='+via.protocol+' keycodes='+via.mode+' settings='+JSON.stringify(via.settings)+' lighting='+JSON.stringify(via.lighting)}).catch(()=>{});
    checkConnection(epoch);
    startLiveSync();state.layer=Math.min(state.layer,state.layers.length-1);renderAll();setConnected(true);hideBusy();toast('已读取设备设置。灯光与设备功能现在可以实时调节。');
  } catch(e) {
    if(e.cancelled||!pageActive||epoch!==connectionEpoch){if(transport instanceof WebHidTransport)await transport.close().catch(()=>{});return;}
    if(nativeAvailable)await api('diagnostic',{message:`Connect ${kind} failed: ${e.message}`}).catch(()=>{});
    if(!pageActive||epoch!==connectionEpoch){if(transport instanceof WebHidTransport)await transport.close().catch(()=>{});return;}
    cancelShortcutWatch();if(state.live)state.live.cancel();state.live=null;
    if(transport)await transport.close().catch(()=>{});state.via=null;state.transport=null;hideBusy();setConnected(false);
    if(e.name!=='NotFoundError')connectDialog(e.message);
  }finally{if(connectingTransport===transport)connectingTransport=null;}
}
async function exportDiagnostics() {
  try {
    const report=await api('diagnostics/read'),url=URL.createObjectURL(new Blob([report],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='NUT-Studio-connection-v1.1.5.txt';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
  }catch(e){toast(e.message,true);}
}
async function disconnect() {cancelConnection();await stopLiveSync();await rememberShortcut.catch(()=>{});if(state.transport)await state.transport.close().catch(()=>{});state.via=null;state.transport=null;renderLighting();setConnected(false);toast('已断开设备连接，当前预览仍保留');}
async function readKeyboard() {
  if(!state.via)return connectDialog();
  const action=async()=> {
    const transport=state.transport,epoch=++connectionEpoch;
    try {
      showBusy('正在重新读取键盘');cancelShortcutWatch();await stopLiveSync();checkConnection(epoch);const via=new C.ViaDevice(transport);await via.connect(progress);checkConnection(epoch);state.via=via;state.mode=via.mode;state.firmwareProfile=via.firmwareProfile;state.settingsDirty=false;state.originalSettings=via.settings?clone(via.settings):null;if(via.settings)state.settings=clone(via.settings);
      await resumeStripShortcut(epoch);checkConnection(epoch);state.layers=decodeDeviceLayers(via);state.original=clone(state.layers);state.lightDirty=false;
      state.originalLight=via.lighting?clone(via.lighting):null;if(via.lighting)state.light=clone(via.lighting);startLiveSync();state.layer=Math.min(state.layer,state.layers.length-1);renderAll();setConnected(true);toast('已重新读取设备设置');
    }catch(e){if(!e.cancelled&&pageActive&&epoch===connectionEpoch){await disconnect();hideBusy();toast(e.message,true);}}finally{if(pageActive&&epoch===connectionEpoch)hideBusy();}
  };
  if(draftChanges().length)confirmAction('重新读取键盘？','这会用键盘上的配置替换尚未应用的键位修改。灯光和设备功能已实时同步。',action,'重新读取');else await action();
}
async function backupDevice(profile) {
  if(profile.nutStudio?.firmwareProfile===C.CU_PROFILE)profile={...profile,nutStudio:{...profile.nutStudio,frontStripSoftwareShortcut:usesStripShortcut(state.original)}};
  if(nativeAvailable) {
    try {return await api('backup',{profile});}catch(e){throw Error(`自动备份未保存，已停止写入：${e.message}`);}
  }
  // The browser-only route must also persist before writes, not merely download.
  const key=`nutstudio.recovery.${Date.now()}`;
  try {localStorage.setItem(key,JSON.stringify(profile));if(!localStorage.getItem(key))throw Error('备份未保存');}catch(e){throw Error('无法保存本地备份，请检查浏览器存储空间');}
}
function renderLiveStatus() {
  const messages={queued:'正在同步…',applying:'正在实时应用…',applied:'已生效 · 等待自动保存',saving:'正在自动保存…',saved:'已实时同步并保存',error:'同步失败 · 可调整重试或重新读取'};
  const message=state.via?(messages[state.liveState]||'实时控制已就绪'):'未连接 · 当前仅预览';
  $('#lighting-status').textContent=state.via&&!state.via.lighting?'固件灯光通道不可用':message;
  $('#lighting-status').dataset.state=state.via?state.liveState:'offline';
  if(!state.via||state.via.settings)$('#features-status').textContent=`${message}。${state.via?'调整实时生效，停止操作约 1 秒后自动保存。':'连接时将读取设备的实际设置。'}`;
  $('#features-status').dataset.state=state.via?state.liveState:'offline';
}
function startLiveSync() {
  if(state.live)state.live.cancel();
  if(state.via.firmwareProfile===C.CU_PROFILE&&state.via.lighting&&!C.isLightingOff(state.via.lighting.effect,C.CU_PROFILE)&&[0,1,3,4].includes(state.via.settings?.stripMode))state.stripResume={effect:state.via.lighting.effect,stripMode:state.via.settings.stripMode};
  if(state.via.rememberStrip)state.via.rememberStrip(state.stripResume.effect,state.stripResume.stripMode);
  const sync=new C.LiveSettingsSync(state.via,backupDevice,{
    onState:status=>{if(state.live===sync){state.liveState=status;renderLiveStatus();}},
    onApplied:(result,pending)=>{
      if(state.live!==sync)return;
      if(result.lighting){state.originalLight=clone(result.lighting);if(!pending.pendingLight)state.light=clone(result.lighting);}
      if(result.settings){state.originalSettings=clone(result.settings);if(!pending.pendingSettings)state.settings=clone(result.settings);}
      if(result.stripResume){state.stripResume=clone(result.stripResume);if(nativeAvailable&&state.shortcutEnabled){const resume=clone(result.stripResume),epoch=state.shortcutEpoch;rememberShortcut=rememberShortcut.catch(()=>{}).then(()=>{if(pageActive&&epoch===state.shortcutEpoch&&state.shortcutEnabled)return api('shortcut/remember',{effect:resume.effect,mode:resume.stripMode});}).catch(error=>toast('灯带已生效，但恢复偏好未保存：'+error.message,true));}}
      state.lightDirty=pending.pendingLight;state.settingsDirty=pending.pendingSettings;
      renderLighting();renderFeatures();renderLiveStatus();updateActions();
    },
    onError:error=>{
      if(state.live!==sync)return;
      if(nativeAvailable)api('diagnostic',{message:'Live settings failed: '+error.message+' actualLighting='+JSON.stringify(error.actualLighting)+' actualSettings='+JSON.stringify(error.actualSettings)}).catch(()=>{});
      if(error.actualLighting){state.light=clone(error.actualLighting);state.originalLight=clone(error.actualLighting);}
      if(error.actualSettings){state.settings=clone(error.actualSettings);state.originalSettings=clone(error.actualSettings);}
      state.lightDirty=false;state.settingsDirty=false;
      if(error.connectionLost)connectionLost();
      renderLighting();renderFeatures();renderLiveStatus();updateActions();toast(error.message,true);
    }
  });
  state.live=sync;state.liveState='saved';
}
function requestLive(light=null,settings=null) {
  if(!state.via||!state.live||(!light&&!settings))return;
  try{state.live.request(light,settings);}catch(e){toast(e.message,true);}
}
async function stopLiveSync() {
  const sync=state.live;if(!sync)return;state.live=null;
  try{await sync.close();}catch(e){sync.cancel();toast(e.message,true);}state.liveState='offline';
}
async function applyChanges() {
  if(!state.via){connectDialog();return;}
  let changes;
  try {changes=state.via.plan(state.layers);}catch(e){toast(e.message,true);return;}
  if(!changes.length&&!shortcutDirty()){toast('当前键位已同步');return;}
  const previousShortcut=state.shortcutEnabled,wantedShortcut=usesStripShortcut();
  confirmAction('应用键位',`将保存 ${changes.length} 个键位修改。写入前会自动备份，写入后逐项读取校验。${wantedShortcut?' 前灯带开关使用专用 F24，需软件窗口运行（可最小化），退出后不生效。':''}`,async()=> {
    let shortcutChanged=false,keyWriteSucceeded=false;
    try {
      showBusy('正在保存到键盘','正在备份并校验设置，请勿拔出数据线');
      if(previousShortcut!==wantedShortcut){await configureStripShortcut(wantedShortcut);shortcutChanged=true;}
      let liveWarning=false;
      if(state.live)try{await state.live.flush();}catch(error){
        // A reported configuration failure must not block independent key writes.
        // Transport loss or an invalid key baseline still stops the operation.
        if(error.connectionLost!==false||!state.via||!state.via.baseline)throw error;
        liveWarning=true;
      }
      const result=await state.via.apply(state.layers,null,backupDevice,progress);
      keyWriteSucceeded=true;
      state.original=clone(state.layers);renderAll();toast(liveWarning?`键位已保存并校验 ${result.keys} 项；灯光或设备功能尚未同步，请重新调整或读取。`:`已保存并校验 ${result.keys} 个键位`);
    } catch(e) {if(shortcutChanged&&!keyWriteSucceeded)try{await configureStripShortcut(previousShortcut);}catch{toast('键位写入失败，快捷键偏好恢复未完成，请重新连接',true);}toast(e.message,true);if(state.via&&!state.via.baseline)await disconnect();}
    finally{hideBusy();}
  },'应用并保存');
}
function switchPage(page) {
  if(state.busy)return;
  if(state.page==='tester'&&page!=='tester')stopTest();
  state.page=page;$$('.page').forEach(e=>{const active=e.id===`page-${page}`;e.hidden=!active;e.classList.toggle('active',active);});
  $$('.nav-item').forEach(e=>{const active=e.dataset.page===page;e.classList.toggle('active',active);if(active)e.setAttribute('aria-current','page');else e.removeAttribute('aria-current');});
  history.replaceState(null,'',`#${page}`);if(page==='profiles')renderProfiles();syncPreview();
}
function renderLayers() {
  $('#layers').innerHTML=state.layers.map((_,i)=>`<button class="layer-button ${state.layer===i?'active':''}" data-layer="${i}" title="${layerNames[i]||`图层 ${i}`}" aria-label="图层 ${i}" aria-pressed="${state.layer===i}">${String(i).padStart(2,'0')}</button>`).join('');
  $('#board-layer-name').textContent=layerNames[state.layer]||`图层 ${state.layer}`;
}
function createBoard(container,mode) {
  container.innerHTML=geometry.map(k=> {
    const id=state.layers[mode==='test'?0:state.layer]?.[k.index]||'KC_NO';
    const label=keyLabel(id);let cls='keycap';
    if(k.w>1.2||k.col===14||k.row===4||k.index===0)cls+=' mod-key';
    if(mode==='edit'&&k.index===state.selected)cls+=' selected';
    if(mode==='edit'&&keyDirty(state.layer,k.index))cls+=' changed';
    return `<button class="${cls}" style="left:calc(${k.x/16*100}% + 2px);top:calc(${k.y/5*100}% + 2px);width:calc(${k.w/16*100}% - 4px);height:calc(20% - 4px)" data-index="${k.index}" title="${text(id)} · R${k.row} C${k.col}" aria-label="${text(label)}，行 ${k.row} 列 ${k.col}" ${mode==='edit'?`aria-pressed="${k.index===state.selected}"`:'tabindex="-1"'}>${text(label==='Space'?'':label)}</button>`;
  }).join('');
}
function renderSelection() {
  const id=state.layers[state.layer]?.[state.selected]||'KC_NO',label=keyLabel(id);
  $('#selected-key').textContent=label;$('#selected-name').textContent=label;$('#selected-code').textContent=id;
  $('#selected-coord').textContent=`R${Math.floor(state.selected/15)} · C${state.selected%15}`;
  $('#custom-key').value=id;
  $('#key-help').textContent=C.catalog(state.mode,state.layers.length,state.firmwareProfile).find(x=>x.id===id)?.hint||'从按键库选择，或输入 QMK 键码。';
  $('#undo-key').disabled=!keyDirty(state.layer,state.selected);
}
function renderKeymap() {renderLayers();createBoard($('#keyboard'),'edit');renderSelection();renderLibrary();updateActions();}
function renderLibrary() {
  const catalog=C.catalog(state.mode,state.layers.length,state.firmwareProfile),groups=[...new Set(catalog.map(k=>k.group))];
  $('#key-categories').innerHTML=groups.map(g=>`<button class="library-tab ${g===state.category?'active':''}" data-category="${g}">${g}</button>`).join('');
  const query=$('#key-search').value.toLowerCase().trim();
  const choices=catalog.filter(k=>(query||k.group===state.category)&&(!query||[k.id,k.label,k.hint].join(' ').toLowerCase().includes(query)));
  $('#key-options').innerHTML=choices.length?choices.map(k=>`<button class="key-option ${k.id===state.layers[state.layer][state.selected]?'active':''}" data-code="${text(k.id)}" title="${text(k.id+(k.hint?' · '+k.hint:''))}">${text(k.label)}</button>`).join(''):'<p class="empty-message">没有找到对应按键，试试 QMK 键码。</p>';
}
function setKey(code) {
  try {
    if(code==='NUT_STRIP_TOGGLE'&&(!nativeAvailable||state.firmwareProfile!==C.CU_PROFILE))throw Error('前灯带开关需使用 Windows 版并连接 CU 固件');
    const value=C.encode(code,state.mode,state.layers.length);
    // Boot/reset assignments are intentionally only preserved from backups.
    if([0x5c00,0x5cdf,0x7c00,0x7c03].includes(value))throw Error('此键码涉及固件重置，本版本不提供新增此类按键的功能');
    state.layers[state.layer][state.selected]=code;renderKeymap();
  }catch(e){toast(e.message,true);}
}
function restoreLayer() {confirmAction('恢复当前图层？','将撤销当前图层尚未应用的修改，其他图层保持当前预览。',()=>{state.layers[state.layer]=clone(state.original[state.layer]);renderKeymap();toast('已撤销当前图层的修改');},'恢复本层');}
function hsvToHex(h,s,v=255) {
  h=h/255*6;s=s/255;v=v/255;const c=v*s,x=c*(1-Math.abs(h%2-1)),m=v-c;
  const rgb=h<1?[c,x,0]:h<2?[x,c,0]:h<3?[0,c,x]:h<4?[0,x,c]:h<5?[x,0,c]:[c,0,x];return '#'+rgb.map(n=>Math.round((n+m)*255).toString(16).padStart(2,'0')).join('');
}
function hexToHsv(hex) {
  const r=parseInt(hex.slice(1,3),16)/255,g=parseInt(hex.slice(3,5),16)/255,b=parseInt(hex.slice(5,7),16)/255;
  const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;let h=d===0?0:max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4;h=((h*60)+360)%360;
  return {hue:Math.round(h/360*255),saturation:Math.round((max===0?0:d/max)*255)};
}
let effectsSignature='',effectCards=[],lightBoardSignature='',stripLeds=[];
function renderEffects() {
  const q=$('#effect-search').value.trim().toLowerCase();
  const cu=state.firmwareProfile===C.CU_PROFILE;
  const options=C.getEffects(state.firmwareProfile).map(e=>cu&&e.id===0?{...e,id:C.CU_SHORTCUT_OFF,label:'关闭前灯带',sourceName:'CU Front Strip Off (indicators preserved)'}:e);
  const selected=cu&&C.isLightingOff(state.light.effect,state.firmwareProfile)?C.CU_SHORTCUT_OFF:state.light.effect;
  $('#effect-count').textContent=cu?'35 种灯效 + 关闭':'原厂兼容灯效';
  const signature=JSON.stringify([state.firmwareProfile,q,state.light.brightness,state.light.speed,state.light.hue,state.light.saturation]);
  if(signature===effectsSignature){
    effectCards.forEach(card=>{const active=+card.dataset.effect===selected;card.classList.toggle('active',active);card.setAttribute('aria-pressed',String(active));});return;
  }
  const ordered=cu?[...options.filter(e=>e.strip),...options.filter(e=>!e.strip)]:options;
  $('#effect-grid').innerHTML=ordered.filter(e=>[e.label,e.sourceName||''].join(' ').toLowerCase().includes(q)||String(e.id)===q).map(e=>{
    const frame=C.stripFrame({...state.light,effect:e.id},{stripMode:0},1200,state.firmwareProfile);
    const art=[0,1,2,3,4,5,6].map(j=>{const p=frame[Math.round(j*79/6)];return `<i style="background:${hsvToHex(p.h,p.s,p.v)};opacity:${.1+.9*p.v/255}"></i>`;}).join('');
    return `<button class="effect-card ${selected===e.id?'active':''}" data-effect="${e.id}" aria-pressed="${selected===e.id}" title="${text((e.sourceName||e.label)+' · #'+e.id)}"><div class="effect-art">${art}</div><span>${e.label}</span><small>${e.strip?'CU · ':''}${String(e.id).padStart(2,'0')}</small></button>`;
  }).join('')||'<p class="empty-message">没有找到对应灯效</p>';
  effectsSignature=signature;effectCards=[...$('#effect-grid').querySelectorAll('[data-effect]')];
}
function renderLighting() {
  const boardSignature=JSON.stringify([state.firmwareProfile,state.layers[state.layer]]);
  if(boardSignature!==lightBoardSignature){createBoard($('#light-keyboard'),'light');lightBoardSignature=boardSignature;}renderEffects();
  const cu=state.firmwareProfile===C.CU_PROFILE,mode=cu?state.settings.stripMode:0;
  const shortcutOff=cu&&state.light.effect===C.CU_SHORTCUT_OFF;
  if(stripLeds.length!==80){$('#front-strip').innerHTML=Array.from({length:80},()=>'<i class="strip-led"></i>').join('');stripLeds=[...$('#front-strip').querySelectorAll('.strip-led')];}
  $('#active-effect').textContent=shortcutOff?'前灯带已关闭 · 保留状态指示灯':C.getEffects(state.firmwareProfile).find(e=>e.id===state.light.effect)?.label||`未识别灯效 #${state.light.effect}`;
  for(const name of ['brightness','speed']){$(`#${name}`).value=state.light[name];$(`#${name}-value`).textContent=`${Math.round(state.light[name]/255*100)}%`;}
  const color=hsvToHex(state.light.hue,state.light.saturation);$('#light-color').value=color;$('#color-hex').textContent=color.toUpperCase();
  $('#speed').disabled=state.via&&!state.via.lighting;
  $('#light-color').disabled=state.via&&!state.via.lighting;
  $('#brightness').disabled=state.via&&!state.via.lighting;
  $('#light-off').disabled=state.via&&!state.via.lighting;
  $('#strip-modes').innerHTML=[[0,'同步灯效','SYNC'],[1,'音乐律动','MUSIC'],[3,'打字速度','SPEED'],[4,'番茄钟','POMODORO']].map(([id,label,sub])=>`<button class="strip-mode ${mode===id?'active':''}" data-strip-mode="${id}" aria-pressed="${mode===id}" ${!cu||(state.via&&!state.via.settings)?'disabled':''}><small>${sub}</small><b>${label}</b></button>`).join('');
  const names={0:'前灯带灯效示意',1:'音乐律动示意 · 声音由键盘内置麦克风采集',2:'无线电量模式 · USB 不提供电量数据',3:'打字速度示意 · 实际速度由键盘计算',4:'番茄钟示意 · 通过专用按键启动 / 切换阶段'};
  $('#strip-caption').textContent=names[mode]||names[0];
  $('#effects-note').textContent=shortcutOff?'前灯带已关闭，选择任意灯效可重新开启；也可使用已分配的软件联动开关。':mode!==0?'当前功能模式会接管灯带显示；基础灯效在“同步灯效”模式中显示。':cu?'编号与 CU VIA 定义一致；悬停可查看英文原名。预览为效果示意。':'当前为原厂兼容列表；实际支持效果以设备为准。';
  $('#pause-preview').textContent=state.previewPaused?'继续动画':'暂停动画';
  renderLightFrame(previewTime);
}
function lightChange(patch) {
  if(state.via&&!state.via.lighting)return toast('当前固件没有提供可用的灯光通道',true);
  if(patch.effect!==undefined&&state.firmwareProfile===C.CU_PROFILE&&state.settings.stripMode!==0&&(!state.via||state.via.settings))settingsChange({stripMode:0});
  Object.assign(state.light,patch);state.lightDirty=!state.originalLight||Object.keys(state.light).some(k=>state.light[k]!==state.originalLight[k]);renderLighting();requestLive(patch);renderLiveStatus();updateActions();
}
function settingsChange(patch) {
  if(state.firmwareProfile!==C.CU_PROFILE||(state.via&&!state.via.settings))return toast('当前固件没有提供 CU 设备功能通道',true);
  const next={...state.settings,...patch};try{if(patch.stripMode===2)throw Error('USB 不支持设置电量模式');C.validateSettings(next,true);}catch(e){return toast(e.message,true);}
  state.settings=next;state.settingsDirty=!state.originalSettings||C.settingDefinitions.some(d=>next[d.name]!==state.originalSettings[d.name]);renderLighting();renderFeatures();requestLive(null,patch);renderLiveStatus();updateActions();
}
function shortcutLocations(id) {
  const value=C.encode(`CUSTOM(${id})`,state.mode),locations=[];
  state.layers.forEach((layer,l)=>geometry.forEach(k=>{try{if(C.encode(layer[k.index],state.mode)===value)locations.push(`层 ${l} · R${k.row} C${k.col}`);}catch{}}));
  return locations.slice(0,3).join(' / ')||'尚未分配';
}
function renderFeatures() {
  const cu=state.firmwareProfile===C.CU_PROFILE,available=cu&&(!state.via||!!state.via.settings);
  $('#firmware-badge').textContent=state.via?(cu?'CU 扩展参数已识别':'原厂兼容模式'):(cu?'CU V37 · 离线预览':'原厂兼容 · 离线预览');
  $('#features-status').textContent=state.via?(available?'已读取固件设置。调整实时生效，停止操作后自动保存。':'未识别到 CU 扩展参数。此设备仅开放兼容改键与灯光通道。'):'连接后自动识别扩展参数；当前可以预览并保存方案。';
  for(const d of C.settingDefinitions){const control=$(`#setting-${d.name}`);control.value=state.settings[d.name];control.disabled=!available;}
  $('#timer-summary').textContent=`${state.settings.workMinutes} 分钟专注 / ${state.settings.breakMinutes} 分钟休息`;
  $('#shortcut-grid').innerHTML=cu?[9,10,11,8,12,13,14,15,6,7,16,5].map(id=>`<div class="shortcut-row"><div><b>${text(C.label(`CUSTOM(${id})`,C.CU_PROFILE))}</b><small>${text(shortcutLocations(id))}</small></div><button class="text-button" data-shortcut="${id}">选择按键 ↗</button></div>`).join(''):'<p class="field-help">专属键码会根据连接到的固件自动切换，可在“键位设置”中查看。</p>';
}
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');let lastFrame=null,previewTime=0,previewFrame=null;
function shouldAnimate(){return pageActive&&state.page==='lighting'&&!document.hidden&&!state.previewPaused&&!reducedMotion.matches;}
function syncPreview(){
  if(shouldAnimate()){if(previewFrame===null){lastFrame=null;previewFrame=requestAnimationFrame(animate);}}
  else if(previewFrame!==null){cancelAnimationFrame(previewFrame);previewFrame=null;lastFrame=null;}
}
function renderLightFrame(time) {
  if(!state.layers.length)return;
  const frame=C.stripFrame(state.light,state.firmwareProfile===C.CU_PROFILE?state.settings:null,time,state.firmwareProfile);
  stripLeds.forEach((led,i)=>{const p=frame[i],color=hsvToHex(p.h,p.s,p.v);led.style.backgroundColor=color;led.style.boxShadow=`0 2px 10px ${color}88`;});
}
function animate(now) {
  previewFrame=null;if(!shouldAnimate())return;
  if(lastFrame!==null)previewTime+=Math.min(Math.max(now-lastFrame,0),80);
  lastFrame=now;renderLightFrame(previewTime);previewFrame=requestAnimationFrame(animate);
}
function currentProfile() {return {name:'NUT65 CU',vendorProductId:C.VPID,layers:clone(state.layers),lighting:(!state.via||state.via.lighting)?clone(state.light):null,deviceSettings:state.firmwareProfile===C.CU_PROFILE?clone(state.settings):null,nutStudio:{format:2,firmwareProfile:state.firmwareProfile,keycodeMode:state.mode,scope:'keymap-lighting-device',savedAt:new Date().toISOString()}};}
function downloadProfile(profile,name) {const data=new Blob([JSON.stringify(profile,null,2)],{type:'application/json'}),url=URL.createObjectURL(data),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
function exportProfile(){downloadProfile(currentProfile(),`NUT65CU-${new Date().toISOString().slice(0,10)}.json`);toast('已导出当前预览配置');}
function loadProfile(p) {
  C.validateProfile(p);
  if(state.via&&p.layers.length!==state.via.layerCount)throw Error(`此方案有 ${p.layers.length} 个图层，键盘当前有 ${state.via.layerCount} 个图层`);
  const sourceMode=p.nutStudio?.keycodeMode;
  if(state.via&&sourceMode&&sourceMode!==state.mode&&p.layers.flat().some(v=>/^0x/i.test(v)&&parseInt(v,16)>255))throw Error('配置中的原始键码来自不同版本的固件，请先核对键码后再导入');
  state.layers=clone(p.layers);
  if(p.nutStudio?.firmwareProfile===C.CU_PROFILE&&p.nutStudio.frontStripSoftwareShortcut)state.layers=state.layers.map(layer=>layer.map(key=>(key==='KC_F24'||key===0x73||typeof key==='string'&&/^0x[0-9a-f]{1,4}$/i.test(key)&&parseInt(key,16)===0x73)?'NUT_STRIP_TOGGLE':key));
  state.layer=Math.min(state.layer,state.layers.length-1);
  if(!state.via&&sourceMode)state.mode=sourceMode;
  if(!state.via&&[C.CU_PROFILE,C.FACTORY_PROFILE].includes(p.nutStudio?.firmwareProfile))state.firmwareProfile=p.nutStudio.firmwareProfile;
  const compatible=p.nutStudio?.firmwareProfile===state.firmwareProfile;
  if(p.lighting&&compatible){state.light=clone(p.lighting);state.lightDirty=!state.originalLight||Object.keys(state.light).some(k=>state.light[k]!==state.originalLight[k]);}
  if(p.deviceSettings&&compatible&&(!state.via||state.via.settings)){state.settings=clone(p.deviceSettings);state.settingsDirty=!state.originalSettings||C.settingDefinitions.some(d=>state.settings[d.name]!==state.originalSettings[d.name]);}
  if(state.via){const devicePatch=p.deviceSettings&&compatible&&state.via.settings?clone(p.deviceSettings):null;if(devicePatch?.stripMode===2)delete devicePatch.stripMode;requestLive(p.lighting&&compatible&&state.via.lighting?clone(p.lighting):null,devicePatch);}
  renderAll();toast(p.lighting&&!compatible?'已载入键位。旧版或不同固件的灯效编号未导入，请重新选择灯效。':state.via?'已载入方案。灯光与设备功能将实时同步，键位通过“应用键位”保存。':'已载入离线预览；连接后可实时调节灯光');
}
function renderProfiles() {
  const profiles=[{id:'original',name:'原始 VIA 备份',description:'你提供的 5 层配置 · 仅键位',builtin:true},...state.profiles];
  $('#profile-grid').innerHTML=profiles.map(p=>`<article class="profile-card"><div class="profile-visual">${icon('keyboard')}</div><div class="profile-card-body"><h3>${text(p.name)}</h3><p>${text(p.builtin?p.description:`${p.profile.layers.length} 个图层 · ${new Date(p.createdAt).toLocaleDateString('zh-CN')}`)}</p><div class="profile-card-actions"><button class="button" data-load-profile="${text(p.id)}">载入方案 ${icon('arrow')}</button>${p.builtin?'<span class="profile-badge">原始备份</span>':`<button class="text-button" data-delete-profile="${text(p.id)}">删除</button>`}</div></div></article>`).join('');
}
function saveProfile() {
  modal('<h2>保存当前方案</h2><p>保存当前预览的全部图层与灯光，之后可以随时载入。</p><input class="modal-field" id="profile-name" placeholder="给方案起个名字，如：日常办公" maxlength="40" aria-label="方案名称"><div class="modal-actions"><button class="button" id="save-cancel">取消</button><button class="button primary" id="save-confirm">保存方案</button></div>');
  $('#profile-name').focus();$('#save-cancel').onclick=closeModal;
  $('#save-confirm').onclick=async()=>{const name=$('#profile-name').value.trim()||'我的方案';const p={id:crypto.randomUUID(),name,createdAt:new Date().toISOString(),profile:currentProfile()};
    try{const all=[...state.profiles,p];await persistProfiles(all);state.profiles=all;closeModal();renderProfiles();toast('方案已保存到本机');}catch{toast('方案保存失败，请导出 JSON 保存',true);}
  };
}
async function persistProfiles(profiles) {if(nativeAvailable)await api('profiles/write',{profiles});else localStorage.setItem('nutstudio.profiles',JSON.stringify(profiles));}
function startTest(){state.testActive=true;$('#toggle-test').textContent='停止测试';$('#tester-state').innerHTML='<i class="status-dot online"></i>正在测试 · 请按下键盘';$('#toggle-test').blur();}
function stopTest(){state.testActive=false;state.held.clear();$('#toggle-test').textContent='开始测试';$('#tester-state').innerHTML='<i class="status-dot"></i>测试已暂停';updateTestBoard();}
function eventKey(code) {
  if(/^Key[A-Z]$/.test(code))return `KC_${code.slice(3)}`;if(/^Digit\d$/.test(code))return `KC_${code.slice(5)}`;if(/^F\d+$/.test(code))return `KC_${code}`;
  return {Escape:'KC_GESC',Backspace:'KC_BSPC',Tab:'KC_TAB',CapsLock:'KC_CAPS',Enter:'KC_ENT',Space:'KC_SPC',ShiftLeft:'KC_LSFT',ShiftRight:'KC_RSFT',ControlLeft:'KC_LCTL',ControlRight:'KC_RCTL',AltLeft:'KC_LALT',AltRight:'KC_RALT',MetaLeft:'KC_LGUI',MetaRight:'KC_RGUI',Minus:'KC_MINS',Equal:'KC_EQL',BracketLeft:'KC_LBRC',BracketRight:'KC_RBRC',Backslash:'KC_BSLS',Semicolon:'KC_SCLN',Quote:'KC_QUOT',Backquote:'KC_GRV',Comma:'KC_COMM',Period:'KC_DOT',Slash:'KC_SLSH',ArrowLeft:'KC_LEFT',ArrowRight:'KC_RGHT',ArrowUp:'KC_UP',ArrowDown:'KC_DOWN',Home:'KC_HOME',End:'KC_END',Insert:'KC_INS',Delete:'KC_DEL',PageUp:'KC_PGUP',PageDown:'KC_PGDN',PrintScreen:'KC_PSCR',NumpadMultiply:'KC_PAST',NumpadDivide:'KC_PSLS',AudioVolumeUp:'KC_VOLU',AudioVolumeDown:'KC_VOLD',AudioVolumeMute:'KC_MUTE'}[code]||null;
}
function updateTestBoard() {
  $('#tested-count').textContent=state.tested.size;$('#held-count').textContent=state.held.size;
  $('#test-keyboard').querySelectorAll('.keycap').forEach(k=>{const value=state.layers[0][+k.dataset.index];let id=value;try{id=C.decode(C.encode(value,state.mode),state.mode);}catch{}k.classList.toggle('key-tested',state.tested.has(id));k.classList.toggle('key-held',state.held.has(id));});
}
function onKey(event,down) {
  if(!state.testActive||state.page!=='tester'||$('#modal').open)return;
  if(event.key==='Escape'&&event.shiftKey){stopTest();return;}
  if(!event.metaKey&&!event.ctrlKey&&!event.altKey)event.preventDefault();
  const id=eventKey(event.code)||event.code;
  if(down){state.held.add(id);state.tested.add(id);$('#last-test-key').textContent=C.label(id);if(!event.repeat){state.logs.unshift({code:event.code});state.logs=state.logs.slice(0,35);$('#test-log').innerHTML=state.logs.map(k=>`<code>${text(k.code)}</code>`).join('');}}
  else state.held.delete(id);updateTestBoard();
}
function renderAll(){renderKeymap();renderLighting();renderFeatures();createBoard($('#test-keyboard'),'test');renderProfiles();$('#layer-count').textContent=`${state.layers.length} 个图层`;renderLiveStatus();updateActions();}

async function init() {
  try {
    let seed=window.NUT_SEED;
    if(!seed){const response=await fetch('seed.json');if(!response.ok)throw Error('键位备份载入失败');seed=await response.json();}
    state.seed=C.validateProfile(seed);state.layers=clone(state.seed.layers);state.original=clone(state.layers);
    try{const stored=nativeAvailable?await api('profiles/read'):JSON.parse(localStorage.getItem('nutstudio.profiles')||'[]');state.profiles=Array.isArray(stored)?stored.filter(p=>p.id&&p.name&&C.validateProfile(p.profile)):[];}catch{state.profiles=[];}
    if(nativeAvailable){try{const saved=await api('shortcut/state');state.shortcutEnabled=!!saved.enabled;}catch{}}
    renderAll();setConnected(false);
    const hash=location.hash.slice(1);if(['keymap','lighting','features','profiles','tester'].includes(hash))switchPage(hash);
    syncPreview();
  }catch(e){modal(`<h2>载入失败</h2><p>${text(e.message)}。请重新启动软件。</p>`);return;}
  $$('.nav-item').forEach(b=>b.onclick=()=>switchPage(b.dataset.page));$('.brand').onclick=e=>{e.preventDefault();switchPage('keymap');};
  $('#connect-button').onclick=()=>connectDialog();$('#notice-connect').onclick=()=>connectDialog();$('#read-button').onclick=readKeyboard;$('#apply-button').onclick=applyChanges;
  $('#layers').onclick=e=>{const b=e.target.closest('[data-layer]');if(b){state.layer=+b.dataset.layer;renderKeymap();}};
  $('#keyboard').onclick=e=>{const b=e.target.closest('[data-index]');if(b){state.selected=+b.dataset.index;renderKeymap();}};
  $('#key-categories').onclick=e=>{const b=e.target.closest('[data-category]');if(b){state.category=b.dataset.category;$('#key-search').value='';renderLibrary();}};
  $('#key-search').oninput=renderLibrary;$('#key-options').onclick=e=>{const b=e.target.closest('[data-code]');if(b)setKey(b.dataset.code);};
  $('#set-custom').onclick=()=>setKey($('#custom-key').value.trim());$('#custom-key').onkeydown=e=>{if(e.key==='Enter')setKey(e.target.value.trim());};
  $('#undo-key').onclick=()=>{state.layers[state.layer][state.selected]=state.original[state.layer][state.selected];renderKeymap();};$('#revert-layer').onclick=restoreLayer;
  $('#effect-search').oninput=renderEffects;$('#effect-grid').onclick=e=>{const b=e.target.closest('[data-effect]');if(b)lightChange({effect:+b.dataset.effect});};
  $('#strip-modes').onclick=e=>{const b=e.target.closest('[data-strip-mode]');if(b&&!b.disabled)settingsChange({stripMode:+b.dataset.stripMode});};
  for(const d of C.settingDefinitions)$(`#setting-${d.name}`).onchange=e=>settingsChange({[d.name]:+e.target.value});
  $('#shortcut-grid').onclick=e=>{const b=e.target.closest('[data-shortcut]');if(b){state.category='键盘专属';$('#key-search').value=`CUSTOM(${b.dataset.shortcut})`;switchPage('keymap');renderLibrary();toast('选中要使用的键帽，再点击下方专用功能进行分配');}};
  $('#open-features').onclick=()=>switchPage('features');
  for(const name of ['brightness','speed'])$(`#${name}`).oninput=e=>{state.light[name]=+e.target.value;state.lightDirty=!state.originalLight||Object.keys(state.light).some(k=>state.light[k]!==state.originalLight[k]);$(`#${name}-value`).textContent=`${Math.round(state.light[name]/255*100)}%`;renderLightFrame(previewTime);requestLive({[name]:state.light[name]});renderLiveStatus();updateActions();};
  $('#light-color').oninput=e=>lightChange(hexToHsv(e.target.value));$('#light-off').onclick=()=>{if(state.firmwareProfile===C.CU_PROFILE&&(!state.via||state.via.settings))settingsChange({stripMode:0});lightChange({effect:state.firmwareProfile===C.CU_PROFILE?C.CU_SHORTCUT_OFF:0});};$('#pause-preview').onclick=()=>{state.previewPaused=!state.previewPaused;$('#pause-preview').textContent=state.previewPaused?'继续动画':'暂停动画';syncPreview();};
  $('#color-swatches').innerHTML=['#e8a07c','#f1d99a','#94c5a6','#80b8d9','#a795dd','#db8faf','#eeeeee'].map(c=>`<button class="color-swatch" style="background:${c}" data-color="${c}" aria-label="选择颜色 ${c}"></button>`).join('');
  $('#color-swatches').onclick=e=>{const b=e.target.closest('[data-color]');if(b)lightChange(hexToHsv(b.dataset.color));};
  $('#save-profile').onclick=saveProfile;$('#export-profile').onclick=exportProfile;$('#import-profile').onclick=()=>$('#file-input').click();
  $('#file-input').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>262144)throw Error('JSON 文件超过 256 KB');const p=C.validateProfile(JSON.parse(await file.text()));confirmAction('载入此配置？',`即将载入 ${p.layers.length} 个图层。连接时，匹配的灯光与设备功能会实时同步；键位通过“应用键位”保存。`,()=>{try{loadProfile(p);}catch(err){toast(err.message,true);}},'载入配置');}catch(err){toast(err.message,true);}e.target.value='';};
  $('#profile-grid').onclick=e=>{const load=e.target.closest('[data-load-profile]'),del=e.target.closest('[data-delete-profile]');if(load){const p=load.dataset.loadProfile==='original'?state.seed:state.profiles.find(x=>x.id===load.dataset.loadProfile)?.profile;if(p)confirmAction('载入方案？','将替换当前预览。连接时，匹配的灯光与设备功能会实时同步；键位通过“应用键位”保存。',()=>{try{loadProfile(p);}catch(err){toast(err.message,true);}},'载入配置');}if(del)confirmAction('删除这个本地方案？','导出的文件和键盘当前设置不会受影响。',async()=>{try{const next=state.profiles.filter(p=>p.id!==del.dataset.deleteProfile);await persistProfiles(next);state.profiles=next;renderProfiles();}catch{toast('方案删除失败',true);}},'删除方案');};
  $('#toggle-test').onclick=()=>state.testActive?stopTest():startTest();$('#reset-test').onclick=()=>{state.tested.clear();state.held.clear();state.logs=[];$('#test-log').textContent='按键记录会显示在这里。';$('#last-test-key').textContent='—';updateTestBoard();};
  window.addEventListener('keydown',e=>onKey(e,true));window.addEventListener('keyup',e=>onKey(e,false));window.addEventListener('blur',()=>{state.held.clear();updateTestBoard();});
  if(navigator.hid)navigator.hid.addEventListener('disconnect',e=>{if(state.transport instanceof WebHidTransport&&e.device===state.transport.device){connectionLost();toast('键盘已断开，请重新连接',true);}});
  $('#help-button').onclick=()=>{modal(`<h2>设置你的 NUT65 CU</h2><p>1. 用 USB 数据线连接，切换有线模式，关闭其他改键和 RGB 软件。<br>2. 点击“连接键盘 → Windows 直接连接”，等待读取。<br>3. 在灯光效果页设置前灯带；设备功能页设置休眠和番茄钟。<br>4. 灯光与设备功能调整实时生效，停止操作约 1 秒后自动保存；键位通过“应用键位”保存。<br><br>CU 的发光部位是前灯带和少量状态指示灯。预览为示意，没有读取实时音频、WPM、番茄钟进度或电量。音乐使用键盘内置麦克风；番茄钟启动和音乐校准需分配并按下专用功能键。<br><br>使用第三方固件时，请通过 RGB 协议切换键（默认 Fn + Y）选择 VIA，红色反馈表示 VIA。详细说明见“设备功能”。<br><br>图层 0/1 通常用于 Windows，2/3 用于 Mac，具体由固件决定。更改 Fn 后需保留进入功能层的方式。<br><br>备份在程序旁的 data/backups 文件夹，通过“配置方案 → 导入 JSON”恢复。宏和旋钮数据不会被写入。没有固件标记的旧方案只载入键位，请重新选择灯效。</p><div class="modal-actions"><button class="button" id="quit-button">退出软件</button><button class="button primary" id="help-done">知道了</button></div>`);$('#help-done').onclick=closeModal;$('#quit-button').onclick=async()=>{closeModal();await disconnect();if(nativeAvailable){await api('quit');window.close();}else toast('可以关闭当前窗口');};};
  $('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeModal();}});
  document.addEventListener('visibilitychange',syncPreview);
  reducedMotion.addEventListener('change',()=>{renderLightFrame(previewTime);syncPreview();});
  window.addEventListener('pagehide',()=>{
    pageActive=false;syncPreview();clearTimeout(heartbeatTimer);heartbeatTimer=null;if(heartbeatAbort)heartbeatAbort.abort();heartbeatAbort=null;
    cancelConnection();if(state.live)state.live.cancel();state.live=null;state.via=null;state.liveState='offline';
    const transport=state.transport;state.transport=null;if(transport instanceof WebHidTransport)transport.close().catch(()=>{});
    if(nativeAvailable)fetch('api/disconnect',{method:'POST',headers:{'Content-Type':'application/json','X-Nut-Token':TOKEN},body:'{}',keepalive:true}).catch(()=>{});
  });
  window.addEventListener('pageshow',()=>{if(!pageActive){pageActive=true;hideBusy();setConnected(false);syncPreview();startHeartbeat();}});
  startHeartbeat();
}
function startHeartbeat(){
  if(!nativeAvailable||!pageActive||heartbeatTimer!==null||heartbeatAbort)return;
  heartbeatTimer=setTimeout(async()=>{
    heartbeatTimer=null;const controller=new AbortController();heartbeatAbort=controller;
    try{await api('ping',{},controller.signal);}catch{}finally{if(heartbeatAbort===controller){heartbeatAbort=null;startHeartbeat();}}
  },20000);
}
const appReady=init();
