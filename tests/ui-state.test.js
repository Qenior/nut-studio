// Logic checks in a minimal in-memory DOM. This is not a browser render test.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {browserContext}=require('./browser-context');
const root=path.resolve(__dirname,'../ui');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
const coreSource=fs.readFileSync(path.join(root,'core.js'),'utf8');
const seed=JSON.parse(fs.readFileSync(path.join(root,'seed.json'),'utf8'));
class Events {
  constructor(){this.listeners=new Map();}
  addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(listener);}
  removeEventListener(type,listener){this.listeners.get(type)?.delete(listener);}
  dispatch(type,event={}){for(const listener of this.listeners.get(type)||[])listener(event);}
}
class Element extends Events {
  constructor(doc,id=''){super();this.doc=doc;this.id=id;this.content=id==='token'?'preview':'';this.value='';this.hidden=false;this.disabled=false;this.open=false;this.dataset={};this.attributes={};this.writes=0;this._html='';this.textContent='';this.children=[];this.style={setProperty(){}};const set=new Set();this.classList={add:x=>set.add(x),remove:x=>set.delete(x),toggle:(x,v)=>{if(v??!set.has(x))set.add(x);else set.delete(x);},contains:x=>set.has(x)};}
  set innerHTML(value){this.writes++;this._html=value;this.children=[];for(const match of value.matchAll(/\bid="([^"]+)"/g)){if(!this.doc.ids.has(match[1]))this.doc.ids.set(match[1],new Element(this.doc,match[1]));}for(const match of value.matchAll(/<(?:i|button)\b([^>]*)>/g)){const e=new Element(this.doc);for(const cls of (match[1].match(/class="([^"]*)"/)?.[1]||'').split(/\s+/))if(cls)e.classList.add(cls);for(const m of match[1].matchAll(/data-([a-z]+)="([^"]*)"/g))e.dataset[m[1]]=m[2];this.children.push(e);}}
  get innerHTML(){return this._html;}
  setAttribute(k,v){this.attributes[k]=v;}removeAttribute(k){delete this.attributes[k];}focus(){}blur(){}remove(){}click(){this.onclick?.();}
  append(item){this.children.push(item);}showModal(){this.open=true;}close(){this.open=false;}
  querySelectorAll(selector){if(selector==='.keycap'||selector==='.strip-led')return this.children.filter(e=>e.classList.contains(selector.slice(1)));if(selector==='[data-effect]')return this.children.filter(e=>e.dataset.effect!==undefined);return [];}
}
function app({native=false,failConfigure=false}={}){
  const doc=Object.assign(new Events(),{ids:new Map(),hidden:false});
  for(const match of html.matchAll(/\bid="([^"]+)"/g))doc.ids.set(match[1],new Element(doc,match[1]));
  const nav=['keymap','lighting','features','profiles','tester'].map(page=>{const e=new Element(doc);e.dataset.page=page;return e;});
  const brand=new Element(doc),token=new Element(doc,'token');
  if(native)token.content='a'.repeat(64);
  doc.querySelector=q=>q.startsWith('#')?doc.ids.get(q.slice(1)):q==='.brand'?brand:q==='meta[name="nut-token"]'?token:null;
  doc.querySelectorAll=q=>q==='.nav-item'?nav:q==='.page'?['keymap','lighting','features','profiles','tester'].map(p=>doc.ids.get('page-'+p)):[];
  doc.createElement=()=>new Element(doc);doc.body=new Element(doc);
  const storage=new Map();const errors=[];
  const requests=[],waiting=[],server={enabled:false,registered:false,sequence:0,owner:'test',effect:1,mode:0};
  const response=data=>({ok:true,async json(){return {ok:true,data:JSON.parse(JSON.stringify(data))};}});
  const wake=()=>{for(const resolve of waiting.splice(0))resolve(response(server));};
  const fetch=async(path,options={})=>{
    if(!native)throw Error('Unexpected network operation in offline flow');
    const body=JSON.parse(options.body||'{}');requests.push({path,body});
    if(path==='api/profiles/read')return response([]);
    if(path==='api/shortcut/state')return response(server);
    if(path==='api/shortcut/configure'){
      if(failConfigure&&body.enabled)return {ok:true,async json(){return {ok:false,error:'F24 已被占用'};}};
      server.enabled=server.registered=body.enabled;server.owner+='x';wake();return response(server);
    }
    if(path==='api/shortcut/wait'){if(body.owner!==server.owner||body.after<server.sequence)return response(server);return new Promise((resolve,reject)=>{const done=value=>{options.signal?.removeEventListener('abort',abort);resolve(value);};const abort=()=>{const i=waiting.indexOf(done);if(i>=0)waiting.splice(i,1);reject(Object.assign(Error('Aborted'),{name:'AbortError'}));};options.signal?.addEventListener('abort',abort,{once:true});waiting.push(done);});}
    if(path==='api/shortcut/remember'){Object.assign(server,body);return response(server);}
    return response({});
  };
  const win=Object.assign(new Events(),{NUT_SEED:seed,close(){}}),hid=new Events(),motion=Object.assign(new Events(),{matches:false}),frames=new Map();let nextFrame=0;
  const {context,timers}=browserContext({document:doc,window:win,navigator:{hid},location:{hash:''},history:{replaceState(){}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},requestAnimationFrame(fn){const id=++nextFrame;frames.set(id,fn);return id;},cancelAnimationFrame(id){frames.delete(id);},matchMedia:()=>motion,AbortController,crypto:require('node:crypto').webcrypto,console:{log(){},error:e=>errors.push(e)},Blob,URL,fetch});
  vm.runInContext(coreSource,context,{filename:'core.js'});vm.runInContext(source,context,{filename:'app.js'});return {doc,win,hid,motion,frames,waiting,storage,errors,timers,requests,server,ready:vm.runInContext('appReady',context),frame(now){const current=[...frames];frames.clear();for(const [,fn] of current)fn(now);},async press(){server.sequence++;wake();await new Promise(setImmediate);},run:code=>vm.runInContext(code,context)};
}
test('HTML ids are unique and all fixed app selectors resolve',()=>{
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);
  const dynamic=[...source.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  for(const m of source.matchAll(/\$\('#([a-z][\w-]*)'\)/g))assert(ids.includes(m[1])||dynamic.includes(m[1]),m[1]);
});
test('offline startup loads five layers and all 67 keys without USB or network access',()=>{
  const a=app();assert.equal(a.run('state.layers.length'),5);assert.equal((a.doc.ids.get('keyboard').innerHTML.match(/data-index=/g)||[]).length,67);assert.equal(a.run('state.via'),null);assert.equal(a.doc.ids.get('apply-button').disabled,true);assert.equal(a.doc.ids.get('connection-notice').hidden,false);
});
test('key edit, chord assignment and undo preserve the untouched device',()=>{
  const a=app();a.run('setKey("LCTL(KC_C)")');assert.equal(a.run('state.layers[0][0]'),'LCTL(KC_C)');assert.equal(a.run('draftChanges().length'),1);assert.equal(a.doc.ids.get('apply-button').disabled,false);
  a.doc.ids.get('undo-key').onclick();assert.equal(a.run('draftChanges().length'),0);assert.equal(a.run('state.via'),null);
});
test('invalid custom codes leave the existing assignment intact',()=>{
  const a=app(),before=a.run('state.layers[0][0]');a.run('setKey("this-is-invalid")');assert.equal(a.run('state.layers[0][0]'),before);assert.equal(a.run('draftChanges().length'),0);assert(a.doc.ids.get('toasts').children.length);
});
test('switching lighting page stages parameters without writing to a device',()=>{
  const a=app();a.run('switchPage("lighting");lightChange({effect:5,brightness:90})');assert.equal(a.doc.ids.get('page-lighting').hidden,false);assert.equal(a.doc.ids.get('page-keymap').hidden,true);assert.equal(a.run('state.light.effect'),5);assert.equal(a.run('state.lightDirty'),true);assert.equal(a.run('state.via'),null);
});
test('saved plans persist locally and escape user-provided names',async()=>{
  const a=app();a.run('saveProfile()');a.doc.ids.get('profile-name').value='<img src=x onerror=alert(1)>';
  await a.doc.ids.get('save-confirm').onclick();assert.equal(a.run('state.profiles.length'),1);assert(a.storage.has('nutstudio.profiles'));const rendered=a.doc.ids.get('profile-grid').innerHTML;assert(rendered.includes('&lt;img'));assert(!rendered.includes('<img src=x'));
});
test('loading original backup is a preview operation and never writes macro data',()=>{
  const a=app();a.run('setKey("KC_A");loadProfile(state.seed)');assert.equal(a.run('state.layers[0][0]'),'KC_GESC');assert.equal(a.run('draftChanges().length'),0);const p=a.run('currentProfile()');assert.equal(p.nutStudio.scope,'keymap-lighting-device');assert.equal(p.macros,undefined);
});
test('CU lighting shows 80 front LEDs and never animates keycaps',()=>{
  const a=app();assert.equal((a.doc.ids.get('front-strip').innerHTML.match(/class="strip-led"/g)||[]).length,80);assert(a.doc.ids.get('effect-grid').innerHTML.includes('data-effect="36"'));assert(a.doc.ids.get('effect-grid').innerHTML.includes('data-effect="22"'));assert(!a.doc.ids.get('effect-grid').innerHTML.includes('data-effect="0"'));
  a.run('renderLightFrame(1000)');assert(!source.includes("setProperty('--key-hue'"));
});
test('device settings stage, export and restore the tagged CU scheme',()=>{
  const a=app();a.run('switchPage("features");settingsChange({workMinutes:35,stripMode:4})');assert.equal(a.doc.ids.get('page-features').hidden,false);assert.equal(a.run('state.settingsDirty'),true);assert.equal(a.doc.ids.get('apply-button').disabled,true);
  const p=a.run('currentProfile()');assert.equal(p.deviceSettings.workMinutes,35);assert.equal(p.nutStudio.firmwareProfile,'packortake-cu-v37');a.run('const saved=currentProfile();settingsChange({workMinutes:5});loadProfile(saved)');assert.equal(a.run('state.settings.workMinutes'),35);
});
test('untagged old lighting is not silently reinterpreted as CU effects',()=>{
  const a=app();a.run('const old={...state.seed,lighting:{effect:23,brightness:200,speed:100,hue:10,saturation:200},nutStudio:{format:1}};loadProfile(old)');assert.equal(a.run('state.light.effect'),36);assert.equal(a.run('state.lightDirty'),false);
});
test('unavailable extension controls cannot stage writes on factory firmware',()=>{
  const a=app();a.run('state.firmwareProfile=C.FACTORY_PROFILE;state.via={settings:null,lighting:state.light};renderFeatures();settingsChange({stripMode:4})');assert.equal(a.doc.ids.get('setting-stripMode').disabled,true);assert.equal(a.run('state.settingsDirty'),false);
});
test('turning off the front strip also leaves music mode for sync',()=>{
  const a=app();a.run('settingsChange({stripMode:1})');a.doc.ids.get('light-off').onclick();assert.equal(a.run('state.settings.stripMode'),0);assert.equal(a.run('state.light.effect'),22);assert.equal(a.run('state.settingsDirty'),true);
});
test('tester records and clears window events without claiming hardware latency',()=>{
  const a=app();a.run('switchPage("tester");startTest();onKey({code:"KeyA",key:"a",preventDefault(){}},true)');assert.equal(a.run('state.tested.size'),1);assert.equal(a.run('state.held.size'),1);assert.equal(a.doc.ids.get('last-test-key').textContent,'A');a.doc.ids.get('reset-test').onclick();assert.equal(a.run('state.tested.size'),0);assert.equal(a.doc.ids.get('held-count').textContent,0);
});
test('WebHID connection sends and receives 64-byte reports with nonzero ids',async()=>{
  const a=app();const result=await a.run(`(async()=>{
    const device={opened:false,collections:[{usagePage:0xff60,usage:0x61,inputReports:[{reportId:3,items:[{reportSize:8,reportCount:64}]}],outputReports:[{reportId:7,items:[{reportSize:8,reportCount:64}]}]}],
      async open(){this.opened=true;},addEventListener(name,fn){this.listener=fn;},removeEventListener(){},async close(){this.opened=false;},
      async sendReport(id,bytes){this.sentId=id;this.sentLength=bytes.length;this.sentCommand=bytes[0];const data=new Uint8Array(64);data.set([1,0,11]);this.listener({reportId:3,data:new DataView(data.buffer)});}};
    const t=new WebHidTransport(device);await t.open();const response=await t.exchange([1]);await t.close();
    return {id:device.sentId,length:device.sentLength,command:device.sentCommand,responseLength:response.length,version:response[2],closed:!device.opened};
  })()`);
  assert.equal(result.id,7);assert.equal(result.length,64);assert.equal(result.command,1);assert.equal(result.responseLength,32);assert.equal(result.version,11);assert.equal(result.closed,true);
});
function connectFake(a){a.run(`
  state.mode='modern';
  state.via={protocol:12,layerCount:5,mode:state.mode,firmwareProfile:C.CU_PROFILE,baseline:clone(state.layers),lighting:clone(state.light),settings:clone(state.settings),events:[],validateLive(){},
    async updateLive(light,settings,backup){await backup({vendorProductId:C.VPID,layers:state.layers,lighting:this.lighting,deviceSettings:this.settings});this.events.push('live');Object.assign(this.lighting,light||{});Object.assign(this.settings,settings||{});return {lighting:clone(this.lighting),settings:clone(this.settings),channels:[...(light?[3]:[]),...(settings?[0]:[])]};},
    async saveLive(channels){this.events.push('save');},plan(){return draftChanges();},
    async apply(layers,light,backup){if(light!==null)throw Error('key apply unexpectedly includes lighting');this.events.push('keys');this.baseline=layers.map(l=>l.slice(0,75).map(v=>C.encode(v,state.mode,state.layers.length)));return {keys:draftChanges().length};}};
  state.transport={closed:false,async close(){this.closed=true;}};state.originalLight=clone(state.light);state.originalSettings=clone(state.settings);startLiveSync();setConnected(true);
`);}
test('lighting slider and device dropdown synchronize without an apply click',async()=>{
  const a=app();connectFake(a);a.doc.ids.get('brightness').oninput({target:{value:'90'}});a.doc.ids.get('setting-workMinutes').onchange({target:{value:'35'}});await a.run('state.live.flush()');
  assert.equal(a.run('state.via.lighting.brightness'),90);assert.equal(a.run('state.via.settings.workMinutes'),35);assert.equal(a.doc.ids.get('apply-button').disabled,true);assert.equal(a.run('state.liveState'),'saved');assert.equal(a.doc.ids.get('modal').open,false);assert(a.doc.ids.get('lighting-status').textContent.includes('已实时同步'));assert(!a.run('state.via.events.includes("keys")'));
});

test('automatic UI controls use browser default timers through to the saved state',async()=>{
  const a=app();connectFake(a);
  a.doc.ids.get('brightness').oninput({target:{value:'90'}});a.doc.ids.get('setting-workMinutes').onchange({target:{value:'30'}});
  a.timers.advance(79);assert.equal(a.run('state.via.events.length'),0);
  a.timers.advance(1);await a.run('state.live.running');
  assert.equal(a.run('state.via.lighting.brightness'),90);assert.equal(a.run('state.via.settings.workMinutes'),30);assert.equal(a.run('state.liveState'),'applied');
  a.timers.advance(1000);await a.run('state.live.running');
  assert.equal(a.run('state.via.events.join(",")'),'live,save');assert.equal(a.run('state.liveState'),'saved');assert.equal(a.doc.ids.get('apply-button').disabled,true);
  assert.equal(a.doc.ids.get('connection-state').classList.contains('online'),true);assert.equal(a.doc.ids.get('toasts').children.length,0);assert.equal(a.errors.length,0);
});
test('selecting an effect exits music mode and synchronizes both settings',async()=>{
  const a=app();connectFake(a);a.run('settingsChange({stripMode:1})');await a.run('state.live.flush()');a.run('lightChange({effect:23})');await a.run('state.live.flush()');assert.equal(a.run('state.via.lighting.effect'),23);assert.equal(a.run('state.via.settings.stripMode'),0);
});
test('ordinary live readback errors keep the device connected and allow retry',async()=>{
  const a=app();connectFake(a);a.run(`state.via.updateLive=async()=>{const e=Error('灯光校验失败');e.connectionLost=false;e.actualLighting=state.via.lighting;e.actualSettings=state.via.settings;throw e;};lightChange({effect:23})`);
  await assert.rejects(a.run('state.live.flush()'),/校验失败/);assert(a.run('state.via'));assert.equal(a.run('state.transport.closed'),false);assert.equal(a.run('state.liveState'),'error');assert.equal(a.run('state.light.effect'),36);assert.equal(a.doc.ids.get('connection-state').classList.contains('online'),true);
});
test('a real live transport failure cancels the queue and reports offline',async()=>{
  const a=app();connectFake(a);a.run(`state.via.updateLive=async()=>{const e=Error('USB disconnected');e.connectionLost=true;throw e;};lightChange({effect:23})`);await assert.rejects(a.run('state.live.flush()'),/USB disconnected/);assert.equal(a.run('state.via'),null);assert.equal(a.run('state.live'),null);assert.equal(a.doc.ids.get('connection-notice').hidden,false);
});
test('loading a matching profile syncs configuration but leaves key writes staged',async()=>{
  const a=app();connectFake(a);a.run('const p=currentProfile();p.lighting.effect=24;p.deviceSettings.stripMode=4;p.deviceSettings.workMinutes=35;p.layers[0][0]="KC_Z";loadProfile(p)');await a.run('state.live.flush()');assert.equal(a.run('state.via.lighting.effect'),24);assert.equal(a.run('state.via.settings.stripMode'),4);assert.equal(a.run('state.via.settings.workMinutes'),35);assert.equal(a.run('draftChanges().length'),1);assert(!a.run('state.via.events.includes("keys")'));assert.equal(a.doc.ids.get('apply-button').disabled,false);
});
test('key apply flushes pending live settings before writing keys',async()=>{
  const a=app();connectFake(a);a.run('lightChange({effect:23});setKey("KC_Z")');await a.run('applyChanges()');await a.doc.ids.get('modal-confirm').onclick();assert.equal(a.run('state.via.events.join(",")'),'live,save,keys');assert.equal(a.run('draftChanges().length'),0);assert.equal(a.run('state.lightDirty'),false);
});

test('CU physical off is displayed as closed with guidance and enabled controls',()=>{
  const a=app();connectFake(a);a.run('state.light.effect=22;state.via.lighting.effect=22;renderLighting()');
  assert.match(a.doc.ids.get('active-effect').textContent,/关闭/);assert.match(a.doc.ids.get('effects-note').textContent,/选择.*灯效.*开启/);
  assert(a.doc.ids.get('effect-grid').querySelectorAll('[data-effect]').find(e=>e.dataset.effect==='22').classList.contains('active'));
  assert(!a.doc.ids.get('effect-grid').innerHTML.includes('data-effect="0"'));assert.equal(a.doc.ids.get('brightness').disabled,false);
});

test('reported or newly pending nonfatal lighting errors do not block an independent key apply',async()=>{
  for(const previouslyReported of [true,false]){
    const a=app();connectFake(a);a.run(`state.via.updateLive=async()=>{const e=Error('模拟灯光校验失败');e.connectionLost=false;throw e;};lightChange({effect:23})`);
    if(previouslyReported)await assert.rejects(a.run('state.live.flush()'),/校验失败/);
    a.run('setKey("KC_Z")');await a.run('applyChanges()');await a.doc.ids.get('modal-confirm').onclick();
    assert(a.run('state.via.events.includes("keys")'));assert.equal(a.run('draftChanges().length'),0);
    assert.equal(a.run('state.transport.closed'),false);assert.equal(a.run('state.liveState'),'error');
    assert(a.doc.ids.get('toasts').children.some(e=>e.children.some(span=>/键位已保存/.test(span.textContent))));
  }
});

test('key apply still stops when flushing pending lighting detects a lost connection',async()=>{
  const a=app();connectFake(a);a.run(`const observedVia=state.via;state.via.updateLive=async()=>{const e=Error('USB disconnected');e.connectionLost=true;throw e;};lightChange({effect:23});setKey('KC_Z')`);
  await a.run('applyChanges()');await a.doc.ids.get('modal-confirm').onclick();
  assert.equal(a.run('observedVia.events.includes("keys")'),false);assert.equal(a.run('state.via'),null);assert.equal(a.run('draftChanges().length'),1);
});

test('software strip shortcut reserves F24 before saving keys and delivers native notifications',async()=>{
  const a=app({native:true});await a.ready;connectFake(a);
  a.run(`state.transport=new NativeTransport();state.via.toggleStrip=async function(backup){this.events.push('toggle');this.lighting.effect=this.lighting.effect===22?36:22;return {lighting:clone(this.lighting),settings:clone(this.settings),channels:[3]};};setKey('NUT_STRIP_TOGGLE')`);
  await a.run('applyChanges()');await a.doc.ids.get('modal-confirm').onclick();
  assert.equal(a.run('state.via.baseline[0][0]'),0x73);assert.equal(a.server.registered,true);assert.equal(a.run('state.shortcutEnabled'),true);
  assert(a.requests.some(r=>r.path==='api/shortcut/configure'&&r.body.enabled));
  await a.press();a.timers.advance(80);await a.run('state.live.running');assert.equal(a.run('state.via.lighting.effect'),22);
  await a.press();a.timers.advance(80);await a.run('state.live.running');assert.equal(a.run('state.via.lighting.effect'),36);
  a.timers.advance(1000);await a.run('state.live.running');assert.equal(a.run('state.liveState'),'saved');
});

test('an occupied F24 stops shortcut assignment before any key write',async()=>{
  const a=app({native:true,failConfigure:true});await a.ready;connectFake(a);a.run(`state.transport=new NativeTransport();setKey('NUT_STRIP_TOGGLE')`);
  await a.run('applyChanges()');await a.doc.ids.get('modal-confirm').onclick();
  assert(!a.run('state.via.events.includes("keys")'));assert.equal(a.run('state.shortcutEnabled'),false);assert.equal(a.run('draftChanges().length'),1);
});

test('failed key writes restore the previous shortcut preference and release F24',async()=>{
  const a=app({native:true});await a.ready;connectFake(a);a.run(`state.transport=new NativeTransport();state.via.apply=async()=>{throw Error('key verification failed');};setKey('NUT_STRIP_TOGGLE')`);
  await a.run('applyChanges()');await a.doc.ids.get('modal-confirm').onclick();
  assert.equal(a.server.enabled,false);assert.equal(a.server.registered,false);assert.equal(a.run('state.shortcutEnabled'),false);assert.equal(a.run('draftChanges().length'),1);
});

test('an existing F24 key can enable software linking without a redundant USB key write',async()=>{
  const a=app({native:true});await a.ready;connectFake(a);a.run(`state.transport=new NativeTransport();state.layers[0][0]=state.original[0][0]='KC_F24';state.via.baseline[0][0]=0x73;setKey('NUT_STRIP_TOGGLE')`);
  assert.equal(a.run('draftChanges().length'),0);assert.equal(a.doc.ids.get('apply-button').disabled,false);
  await a.run('applyChanges()');await a.doc.ids.get('modal-confirm').onclick();assert.equal(a.server.enabled,true);
});

test('standalone browser preview cannot claim an active native strip shortcut',()=>{
  const a=app(),before=a.run('state.layers[0][0]');a.run(`setKey('NUT_STRIP_TOGGLE')`);assert.equal(a.run('state.layers[0][0]'),before);assert.equal(a.run('draftChanges().length'),0);
});

test('device F24 is relabeled only while the explicit strip preference is enabled',()=>{
  const a=app();connectFake(a);a.run(`state.via.baseline=[[0x73]];state.shortcutEnabled=true`);assert.equal(a.run('decodeDeviceLayers(state.via)[0][0]'),'NUT_STRIP_TOGGLE');
  a.run('state.shortcutEnabled=false');assert.equal(a.run('decodeDeviceLayers(state.via)[0][0]'),'KC_F24');
});

test('CU effect search exposes original English names and preserves the corresponding hardware IDs',()=>{
  const a=app();a.doc.ids.get('effect-search').value='Knight Rider';a.run('renderEffects()');assert.match(a.doc.ids.get('effect-grid').innerHTML,/data-effect="24"/);assert(!a.doc.ids.get('effect-grid').innerHTML.includes('data-effect="23"'));
  a.doc.ids.get('effect-search').value='Rainbow Moving Chevron';a.run('renderEffects()');assert.match(a.doc.ids.get('effect-grid').innerHTML,/data-effect="12"/);
});

test('game mode guidance acknowledges unknown firmware behavior rather than promising performance',()=>{
  const a=app();a.run(`state.layers[0][0]='CUSTOM(15)';renderSelection()`);assert.match(a.doc.ids.get('key-help').textContent,/未说明/);assert.match(a.doc.ids.get('key-help').textContent,/不等同.*Windows/);
});

test('recovery snapshots preserve the committed software role and restore raw F24 with that role',async()=>{
  const a=app({native:true});await a.ready;connectFake(a);
  a.run(`state.layers[0][0]='NUT_STRIP_TOGGLE';const recovery={...state.seed,layers:clone(state.seed.layers),nutStudio:{firmwareProfile:C.CU_PROFILE,frontStripSoftwareShortcut:true}};recovery.layers[0][0]='0x0073';`);
  await a.run('backupDevice(recovery)');assert.equal(a.requests.filter(r=>r.path==='api/backup').at(-1).body.profile.nutStudio.frontStripSoftwareShortcut,false);
  a.run('state.original=clone(state.layers)');await a.run('backupDevice(recovery)');assert.equal(a.requests.filter(r=>r.path==='api/backup').at(-1).body.profile.nutStudio.frontStripSoftwareShortcut,true);
  a.run('loadProfile(recovery)');assert.equal(a.run('state.layers[0][0]'),'NUT_STRIP_TOGGLE');
  const preview=app();preview.run(`const recovery={...state.seed,layers:clone(state.seed.layers),nutStudio:{firmwareProfile:C.CU_PROFILE,keycodeMode:'modern',frontStripSoftwareShortcut:true}};recovery.layers[0][0]='0x0073';loadProfile(recovery)`);assert.equal(preview.run('state.layers[0][0]'),'NUT_STRIP_TOGGLE');assert.equal(preview.run('state.mode'),'modern');
});

const turn=()=>new Promise(setImmediate);
function hidDevice(){
  return Object.assign(new Events(),{opened:false,closes:0,sends:0,collections:[{usagePage:0xff60,usage:0x61,inputReports:[{reportId:0,items:[{reportSize:8,reportCount:32}]}],outputReports:[{reportId:0,items:[{reportSize:8,reportCount:32}]}]}],async open(){this.opened=true;},async close(){this.opened=false;this.closes++;},async sendReport(){this.sends++;},reply(command){const bytes=new Uint8Array(32);bytes[0]=command;this.dispatch('inputreport',{reportId:0,data:new DataView(bytes.buffer)});}});
}
async function transport(a,device=hidDevice()){
  const t=a.run('new WebHidTransport(null)');t.device=device;await t.open();return {t,device};
}

test('repeated WebHID unplug and reconnect removes all listeners and pending requests',async()=>{
  const a=app();await a.ready;const device=hidDevice();
  for(let i=0;i<20;i++){
    const {t}=await transport(a,device);a.run('state.transport=null');const state=a.run('state');state.transport=t;
    const pending=t.exchange([1]);const rejected=assert.rejects(pending,/关闭/);await turn();
    a.hid.dispatch('disconnect',{device});await rejected;await t.close();
    assert.equal(device.listeners.get('inputreport').size,0);assert.equal(t.pending,null);assert.equal(a.run('state.transport'),null);
  }
  assert.equal(device.closes,20);
});

test('WebHID close rejects queued sends and is idempotent while a request waits',async()=>{
  const a=app(),{t,device}=await transport(a);const first=t.exchange([1]),next=t.exchange([2]);
  const rejected=Promise.all([assert.rejects(first,/关闭/),assert.rejects(next,/关闭/)]);await turn();
  const close=t.close();assert.equal(t.close(),close);await close;await rejected;
  assert.equal(device.sends,1);assert.equal(device.closes,1);assert.equal(t.pending,null);assert.equal(a.timers.size,0);
});

test('WebHID timeout and synchronous or asynchronous send failures share complete cleanup',async()=>{
  for(const failure of ['timeout','throw','reject']){
    const a=app(),{t,device}=await transport(a);
    if(failure==='throw')device.sendReport=()=>{throw Error('send failed');};
    if(failure==='reject')device.sendReport=()=>Promise.reject(Error('send failed'));
    const job=t.exchange([1]),rejected=assert.rejects(job,failure==='timeout'?/超时/:/send failed/);await turn();
    if(failure==='timeout')a.timers.advance(2300);await rejected;await t.close();
    assert.equal(device.listeners.get('inputreport').size,0);assert.equal(t.pending,null);assert.equal(device.opened,false);assert.equal(a.timers.size,0);
    await assert.rejects(t.exchange([2]),/关闭/);
  }
});

test('a late send rejection cannot clear the next WebHID request and unsupported probes remain recoverable',async()=>{
  const a=app(),{t,device}=await transport(a);let lateReject;
  device.sendReport=()=>new Promise((resolve,reject)=>{lateReject=reject;});
  const first=t.exchange([1]);await turn();device.reply(1);await first;
  device.sendReport=async()=>{};const second=t.exchange([2]);await turn();const active=t.pending;
  lateReject(Error('late failure'));await turn();assert.equal(t.pending,active);assert.equal(t.closed,false);
  device.reply(2);await second;
  const probe=t.exchange([3]),unsupported=assert.rejects(probe,/不支持/);await turn();device.reply(255);await unsupported;
  assert.equal(t.closed,false);const recovery=t.exchange([4]);await turn();device.reply(4);await recovery;await t.close();
});

test('WebHID descriptor failure, malformed input and close during open all release the device',async()=>{
  const a=app(),bad=hidDevice();bad.collections=[];const invalid=a.run('new WebHidTransport(null)');invalid.device=bad;
  await assert.rejects(invalid.open());assert.equal(bad.opened,false);
  const {t,device}=await transport(a);const job=t.exchange([1]),rejected=assert.rejects(job);await turn();device.dispatch('inputreport',{reportId:0,data:new DataView(new ArrayBuffer(1))});await rejected;await t.close();assert.equal(device.listeners.get('inputreport').size,0);
  const opening=hidDevice();let finishOpen;opening.open=()=>new Promise(resolve=>{finishOpen=()=>{opening.opened=true;resolve();};});
  const late=a.run('new WebHidTransport(null)');late.device=opening;const started=late.open(),closed=assert.rejects(started,/关闭/);await late.close();finishOpen();await closed;assert.equal(opening.opened,false);assert.equal(opening.listeners.get('inputreport')?.size||0,0);
});

test('identical lighting renders and selection changes reuse LEDs, board and effect cards',()=>{
  const a=app(),strip=a.doc.ids.get('front-strip'),grid=a.doc.ids.get('effect-grid'),board=a.doc.ids.get('light-keyboard');
  const leds=[...strip.children],cards=grid.querySelectorAll('[data-effect]'),writes=[strip.writes,grid.writes,board.writes];
  a.run('renderLighting();renderLighting();renderLighting();state.light.effect=23;renderLighting()');
  assert.deepEqual([strip.writes,grid.writes,board.writes],writes);assert.equal(strip.children[0],leds[0]);assert.equal(grid.querySelectorAll('[data-effect]')[0],cards[0]);
  assert(cards.find(e=>e.dataset.effect==='23').classList.contains('active'));assert.equal(cards.find(e=>e.dataset.effect==='23').attributes['aria-pressed'],'true');
  a.doc.ids.get('effect-search').value='Knight Rider';a.run('renderEffects()');assert.equal(grid.writes,writes[1]+1);
  a.run(`state.firmwareProfile='factory';renderLighting()`);assert.equal(grid.writes,writes[1]+2);assert.equal(strip.children[0],leds[0]);
});

test('preview schedules frames only for a visible active unpaused lighting page',async()=>{
  const a=app();await a.ready;assert.equal(a.frames.size,0);a.run('switchPage("lighting")');assert.equal(a.frames.size,1);
  a.frame(100);a.frame(116);assert.equal(a.frames.size,1);assert.equal(a.run('previewTime'),16);
  a.doc.hidden=true;a.doc.dispatch('visibilitychange');assert.equal(a.frames.size,0);
  a.doc.hidden=false;a.doc.dispatch('visibilitychange');assert.equal(a.frames.size,1);
  a.doc.ids.get('pause-preview').onclick();assert.equal(a.frames.size,0);a.doc.ids.get('pause-preview').onclick();assert.equal(a.frames.size,1);
  a.motion.matches=true;a.motion.dispatch('change');assert.equal(a.frames.size,0);a.motion.matches=false;a.motion.dispatch('change');assert.equal(a.frames.size,1);
  a.run('switchPage("keymap")');assert.equal(a.frames.size,0);a.run('switchPage("lighting")');a.win.dispatch('pagehide');assert.equal(a.frames.size,0);
  a.win.dispatch('pageshow');assert.equal(a.frames.size,1);
});

test('page exit aborts shortcut polling, heartbeat and pending live timers',async()=>{
  const a=app({native:true});await a.ready;connectFake(a);a.run('state.transport=new NativeTransport()');await a.run('configureStripShortcut(true)');
  assert.equal(a.waiting.length,1);a.run('lightChange({effect:23});switchPage("lighting")');
  a.win.dispatch('pagehide');await turn();assert.equal(a.waiting.length,0);assert.equal(a.frames.size,0);assert.equal(a.timers.size,0);assert.equal(a.run('state.live'),null);
  const count=a.requests.length;a.timers.advance(60000);await turn();assert.equal(a.requests.length,count);
  a.win.dispatch('pageshow');a.timers.advance(20000);await turn();assert.equal(a.requests.filter(r=>r.path==='api/ping').length,1);a.win.dispatch('pagehide');
});

test('tester retains only physical codes and ignores modal, inactive and unfocused key state',async()=>{
  const a=app();await a.ready;a.run('switchPage("tester");startTest();onKey({code:"KeyA",key:"私",preventDefault(){}},true)');
  assert.deepEqual(Object.keys(a.run('state.logs[0]')),['code']);assert.equal(a.run('state.held.size'),1);
  a.win.dispatch('blur');assert.equal(a.run('state.held.size'),0);
  a.run('modal("test");onKey({code:"KeyB",key:"密",preventDefault(){}},true)');assert.equal(a.run('state.logs.length'),1);
  a.run('closeModal();switchPage("keymap");onKey({code:"KeyC",key:"字",preventDefault(){}},true)');assert.equal(a.run('state.logs.length'),1);assert.equal(a.run('state.testActive'),false);
});

test('connect and reread completions after page exit cannot revive a device session',async()=>{
  for(const reread of [false,true]){
    const a=app({native:true});await a.ready;if(reread)connectFake(a);
    a.run(`C.ViaDevice=class {async connect(){await new Promise(resolve=>{globalThis.completeRead=resolve;});}};`);
    const operation=a.run(reread?'readKeyboard()':'connect("native")');await turn();assert.equal(a.run('typeof completeRead'),'function');
    a.win.dispatch('pagehide');a.run('completeRead()');await operation;await turn();
    assert.equal(a.run('state.transport'),null);assert.equal(a.run('state.via'),null);assert.equal(a.run('state.live'),null);assert.equal(a.waiting.length,0);assert.equal(a.timers.size,0);
    a.win.dispatch('pageshow');assert.equal(a.run('state.busy'),false);a.win.dispatch('pagehide');
  }
});

test('a late shortcut configure result after page exit cannot restart its poll',async()=>{
  const a=app({native:true});await a.ready;connectFake(a);
  a.run(`state.transport=new NativeTransport();const originalFetch=fetch;let completeConfigure;fetch=async(path,options)=>{const result=await originalFetch(path,options);if(path==='api/shortcut/configure')await new Promise(resolve=>{completeConfigure=resolve;});return result;};`);
  const operation=a.run('configureStripShortcut(true)'),rejected=assert.rejects(operation,/取消/);await turn();a.win.dispatch('pagehide');a.run('completeConfigure()');await rejected;
  assert.equal(a.waiting.length,0);assert.equal(a.run('state.shortcutEnabled'),false);assert.equal(a.timers.size,0);
});
