const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {browserContext}=require('./browser-context');
const C=require('../ui/core');
const seed=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../ui/seed.json'),'utf8'));
const copy=x=>JSON.parse(JSON.stringify(x));
class Keyboard {
  constructor({mode='modern',protocol=11,lighting=true,cu=false,quantized=false}={}) {
    this.protocol=protocol;this.mode=mode;this.supportsLighting=lighting;this.log=[];this.failWriteAt=0;this.writes=0;this.corruptRead=false;this.failLightOnce=false;
    this.keys=seed.layers.map(layer=>layer.slice(0,75).map(k=>C.encode(k,mode,5)));
    this.light={brightness:184,effect:13,speed:128,hue:14,saturation:120};
    this.cu=cu;this.quantized=quantized;this.settings={sleepTimeout:4,workMinutes:25,breakMinutes:5,stripMode:0};this.failSettingOnce=false;
  }
  async exchange(cmd) {
    this.log.push([...cmd]);const r=Array(32).fill(0);r.splice(0,cmd.length,...cmd);
    switch(cmd[0]) {
      case 1:r[1]=this.protocol>>8;r[2]=this.protocol&255;break;
      case 0x11:r[1]=this.keys.length;break;
      case 4:{const k=this.keys[cmd[1]][cmd[2]*15+cmd[3]];r[4]=k>>8;r[5]=k&255;if(this.corruptRead){r[5]^=1;this.corruptRead=false;}break;}
      case 5:{this.writes++;this.keys[cmd[1]][cmd[2]*15+cmd[3]]=cmd[4]*256+cmd[5];if(this.failWriteAt===this.writes)throw Error('模拟 USB 在写入后断开');break;}
      case 8:{if(cmd[1]===0){if(!this.cu)throw Error('当前固件不支持此 VIA 指令');r[3]=this.settings[C.settingDefinitions.find(d=>d.id===cmd[2]).name];break;}if(!this.supportsLighting)throw Error('当前固件不支持此 VIA 指令');const names={1:'brightness',2:'effect',3:'speed'};if(cmd[2]===4){r[3]=this.light.hue;r[4]=this.light.saturation;}else r[3]=this.light[names[cmd[2]]];break;}
      case 7:{if(cmd[1]===0){this.settings[C.settingDefinitions.find(d=>d.id===cmd[2]).name]=cmd[3];if(this.failSettingOnce){this.failSettingOnce=false;throw Error('设备功能写入后断线');}break;}if(this.failLightOnce){this.failLightOnce=false;throw Error('灯光通信中断');}const names={1:'brightness',2:'effect',3:'speed'};if(cmd[2]===4){this.light.hue=cmd[3];this.light.saturation=cmd[4];}else this.light[names[cmd[2]]]=this.quantized&&cmd[2]===1?Math.floor(Math.floor(cmd[3]*200/256)*255/200):cmd[3];break;}
      case 9:break;
      default:throw Error('Unsafe or unexpected opcode '+cmd[0]);
    }
    return r;
  }
}
async function setup(options){const keyboard=new Keyboard(options);const via=new C.ViaDevice(keyboard);await via.connect();keyboard.log=[];return {keyboard,via,layers:via.baseline.map(l=>l.map(v=>C.decode(v,via.mode,5)))};}
test('manufacturer layout has 67 unique physical keys inside 5 x 15',()=>{
  const layout=C.layout();assert.equal(layout.length,67);assert.equal(new Set(layout.map(k=>k.index)).size,67);assert(layout.every(k=>k.row>=0&&k.row<5&&k.col>=0&&k.col<15&&k.x+k.w<=16));assert(!layout.some(k=>k.index===42||k.index===46||k.index>=75));
});
test('accepts original padded export; rejects another device and invalid lighting',()=>{
  assert.equal(C.validateProfile(seed).layers[0].length,90);assert.throws(()=>C.validateProfile({...seed,vendorProductId:1}));assert.throws(()=>C.validateProfile({...seed,layers:[Array(74).fill('KC_A')]}));assert.throws(()=>C.validateProfile({...seed,lighting:{brightness:999,effect:1,speed:1,hue:1,saturation:1}}));
});
test('HID codes, legacy/new layer ranges, chords and raw codes round-trip',()=>{
  assert.equal(C.encode('KC_A'),4);assert.equal(C.encode('KC_F24'),0x73);assert.equal(C.encode('KC_VOLU'),0xa9);assert.equal(C.encode('MO(1)','modern'),0x5221);assert.equal(C.encode('MO(1)','legacy'),0x5101);assert.equal(C.encode('CUSTOM(16)','modern'),0x7e10);assert.equal(C.encode('LCTL(KC_C)'),0x106);assert.equal(C.encode(C.decode(0xabcd)),0xabcd);assert.throws(()=>C.encode('shell.exe'));assert.throws(()=>C.encode('0x12345'));
});
test('catalog caching separates generation, layers and firmware labels without rebuilding on hits',()=>{
  const legacy=C.catalog('legacy',5,C.FACTORY_PROFILE),modern=C.catalog('modern',5,C.FACTORY_PROFILE),cu=C.catalog('modern',5,C.CU_PROFILE),six=C.catalog('modern',6,C.CU_PROFILE);
  for(let i=0;i<667;i++)assert.equal(C.catalog('modern',5,C.CU_PROFILE),cu);
  assert.notEqual(legacy,modern);assert.notEqual(modern,cu);assert.notEqual(cu,six);
  assert.equal(legacy.find(k=>k.id==='RGB_TOG').value,0x5cc2);assert.equal(modern.find(k=>k.id==='RGB_TOG').value,0x7820);
  assert(!cu.some(k=>k.id==='MO(5)'));assert(six.some(k=>k.id==='MO(5)'));
  assert.equal(C.label('CUSTOM(7)',C.FACTORY_PROFILE),'指示灯开关');assert.equal(C.label('CUSTOM(7)',C.CU_PROFILE),'Win / Mac 切换');
  assert(!modern.some(k=>k.id==='NUT_STRIP_TOGGLE'));assert(cu.some(k=>k.id==='NUT_STRIP_TOGGLE'));
  // Unknown generations/profiles retain the existing factory/legacy fallback,
  // without allocating entries for every arbitrary string.
  assert.equal(C.catalog('unknown',5,'unknown'),legacy);
});
test('shared catalogs cannot be changed by callers or contaminate other profiles',()=>{
  const keys=C.catalog('legacy',5,C.CU_PROFILE),key=keys.find(k=>k.id==='CUSTOM(7)');
  assert(Object.isFrozen(keys));assert(keys.every(Object.isFrozen));
  assert.equal(Reflect.set(key,'label','changed'),false);assert.equal(Reflect.set(key,'value',0),false);
  assert.throws(()=>keys.push({id:'KC_FAKE',value:4}),TypeError);
  assert.equal(C.label('CUSTOM(7)',C.CU_PROFILE),'Win / Mac 切换');assert.equal(C.encode('CUSTOM(7)','legacy',5,C.CU_PROFILE),0x5f87);
  assert.equal(C.label('CUSTOM(7)',C.FACTORY_PROFILE),'指示灯开关');
});
test('catalogs retain at most sixteen recently used combinations and rebuild evicted entries',()=>{
  const first=C.catalog('legacy',1),second=C.catalog('legacy',2);
  for(let count=3;count<=16;count++)C.catalog('legacy',count);
  assert.equal(C.catalog('legacy',1),first); // Refresh the oldest entry.
  C.catalog('modern',1,C.CU_PROFILE);
  assert.equal(C.catalog('legacy',1),first);
  const rebuilt=C.catalog('legacy',2);assert.notEqual(rebuilt,second);assert.deepEqual(rebuilt,second);
  assert.equal(C.encode('TG(1)','legacy',2),0x5301);assert.equal(C.decode(0x5301,'legacy',2),'TG(1)');
});
test('indexed keycodes preserve all catalog values, hidden custom slots and F24 alias priority',()=>{
  for(const mode of ['legacy','modern'])for(const profile of [C.FACTORY_PROFILE,C.CU_PROFILE])for(const count of [1,5,16]){
    for(const key of C.catalog(mode,count,profile)){
      assert.equal(C.encode(key.id,mode,count,profile),key.value,key.id);
      assert.equal(C.encode(C.decode(key.value,mode,count,profile),mode,count,profile),key.value,key.id);
    }
    assert.equal(C.decode(0x73,mode,count,profile),'KC_F24');
    for(const slot of [24,31])assert.equal(C.decode(C.encode(`CUSTOM(${slot})`,mode,count,profile),mode,count,profile),`CUSTOM(${slot})`);
    assert.equal(C.encode('LCTL(KC_C)',mode,count,profile),0x106);
  }
  assert.equal(C.label('NUT_STRIP_TOGGLE',C.CU_PROFILE),'前灯带开 / 关（软件联动）');
  assert.equal(C.encode('MO(15)','modern',16),0x522f);assert.equal(C.decode(0x522f,'modern',16),'MO(15)');
  assert.throws(()=>C.encode('MO(16)','modern',16),/暂不支持/);assert.throws(()=>C.encode('CUSTOM(32)'),/暂不支持/);
  for(const value of [0,65535])assert.equal(C.encode(C.decode(value)),value);
});
test('catalog and decode reject invalid allocation sizes and non-keycode values',()=>{
  for(const count of [0,-1,17,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER,'5',null])assert.throws(()=>C.catalog('modern',count),/图层数/);
  for(const value of [-1,65536,NaN,Infinity,1.5,'4',null,undefined])assert.throws(()=>C.decode(value),/按键代码/);
  assert.equal(C.catalog('modern',16).filter(k=>/^MO\(/.test(k.id)).length,16);
});
test('original export resolves completely for protocol 11 keycodes',()=>{
  for(const l of seed.layers)for(const k of l)assert(Number.isInteger(C.encode(k,'modern',5)),k);
  assert.equal(C.encode('MAGIC_TOGGLE_GUI','modern'),0x700b);
});
test('connect reads coordinates, detects keycode generation, and reads lighting',async()=>{
  const k=new Keyboard(),v=new C.ViaDevice(k);await v.connect();assert.equal(v.mode,'modern');assert.equal(v.protocol,11);assert.equal(v.layerCount,5);assert.equal(k.log.filter(x=>x[0]===4).length,375);assert(k.log.filter(x=>x[0]===4).every(x=>x[2]<5));assert.deepEqual(v.lighting,k.light);
});
test('unsupported future protocol is stopped before reading or changing mappings',async()=>{
  const k=new Keyboard({protocol:13}),v=new C.ViaDevice(k);await assert.rejects(v.connect(),/协议 13/);assert.deepEqual(k.log,[[1]]);
});
test('missing lighting support does not block key remapping',async()=>{
  const {keyboard,via,layers}=await setup({lighting:false});assert.equal(via.lighting,null);layers[0][1]='KC_A';await via.apply(layers,null,async()=>{});assert.equal(keyboard.keys[0][1],4);assert.throws(()=>via.plan(layers,{brightness:1,effect:1,speed:1,hue:1,saturation:1}),/灯光通道/);
});
test('all validation and persistent backup occur before the first device write',async()=>{
  const {keyboard,via,layers}=await setup();layers[0][1]='KC_A';let backedUp=false;
  const exchange=keyboard.exchange.bind(keyboard);keyboard.exchange=async cmd=>{if(cmd[0]===5)assert(backedUp);return exchange(cmd);};
  await via.apply(layers,null,async p=>{assert.equal(p.vendorProductId,C.VPID);assert.equal(p.layers[0][1],'0x001e');backedUp=true;});
  assert.equal(keyboard.log.filter(x=>x[0]===5).length,1);assert.equal(keyboard.keys[0][1],4);assert.equal(via.baseline[0][1],4);
});
test('no-op plan ignores padded sixth row and unused switch positions',async()=>{
  const {via,layers}=await setup();layers.forEach(l=>l.push(...Array(15).fill('0x1234')));layers[0][42]='KC_A';assert.equal(via.plan(layers).length,0);
});
test('backup persistence failure produces no device mutations',async()=>{
  const {keyboard,via,layers}=await setup();layers[0][1]='KC_A';await assert.rejects(via.apply(layers,null,async()=>{throw Error('磁盘已满');}),/磁盘已满/);assert(!keyboard.log.some(x=>[5,7,9].includes(x[0])));assert.equal(via.busy,false);
});
test('unknown code in a later change is rejected before any writes',async()=>{
  const {keyboard,via,layers}=await setup();layers[0][1]='KC_A';layers[4][73]='invalid';await assert.rejects(via.apply(layers,null,async()=>{}),/暂不支持/);assert.equal(keyboard.log.length,0);
});
test('concurrent edits are detected before writing',async()=>{
  const {keyboard,via,layers}=await setup();layers[0][1]='KC_A';keyboard.keys[0][1]=99;await assert.rejects(via.apply(layers,null,async()=>{}),/其他程序/);assert(!keyboard.log.some(x=>x[0]===5));assert.equal(keyboard.keys[0][1],99);
});
test('a write that reaches hardware then reports failure is also rolled back',async()=>{
  const {keyboard,via,layers}=await setup(),before=copy(keyboard.keys);layers[0][1]='KC_A';layers[2][16]='KC_Z';keyboard.failWriteAt=2;
  await assert.rejects(via.apply(layers,null,async()=>{}),/已恢复/);assert.deepEqual(keyboard.keys,before);assert.deepEqual(via.baseline,before);assert.equal(via.busy,false);
});
test('readback verification prevents false success and restores the old key',async()=>{
  const {keyboard,via,layers}=await setup(),before=copy(keyboard.keys);layers[0][1]='KC_A';const exchange=keyboard.exchange.bind(keyboard);
  keyboard.exchange=async cmd=>{const r=await exchange(cmd);if(cmd[0]===5&&keyboard.writes===1)keyboard.corruptRead=true;return r;};
  await assert.rejects(via.apply(layers,null,async()=>{}),/校验失败/);assert.deepEqual(keyboard.keys,before);
});
test('failed rollback invalidates baseline and reports recovery requirement',async()=>{
  const {keyboard,via,layers}=await setup();layers[0][1]='KC_A';const exchange=keyboard.exchange.bind(keyboard);keyboard.exchange=async cmd=>{if(cmd[0]===5)throw Error('USB disconnected');return exchange(cmd);};
  await assert.rejects(via.apply(layers,null,async()=>{}),/恢复未能全部完成/);assert.equal(via.baseline,null);
});
test('lighting is read back before saving and uses only the documented channel',async()=>{
  const {keyboard,via,layers}=await setup(),light={brightness:100,effect:5,speed:47,hue:71,saturation:93};await via.apply(layers,light,async()=>{});
  assert.deepEqual(keyboard.light,light);assert.deepEqual(keyboard.log.filter(x=>x[0]===7),[[7,3,1,100],[7,3,2,5],[7,3,3,47],[7,3,4,71,93]]);assert.deepEqual(keyboard.log.at(-1),[9,3]);
});
test('lighting failure restores lighting and any modified keys',async()=>{
  const {keyboard,via,layers}=await setup(),before=copy(keyboard.keys),old=copy(keyboard.light);layers[0][1]='KC_A';keyboard.failLightOnce=true;
  await assert.rejects(via.apply(layers,{...old,effect:5},async()=>{}),/已恢复/);assert.deepEqual(keyboard.light,old);assert.deepEqual(keyboard.keys,before);
});
test('rejects values outside supported effects before issuing USB operations',async()=>{
  const {keyboard,via,layers}=await setup();await assert.rejects(via.apply(layers,{brightness:255,effect:46,speed:1,hue:0,saturation:0},async()=>{}),/超出范围/);assert.equal(keyboard.log.length,0);
});
test('never emits reset, bootloader, macro, buffer-write, or undocumented commands',async()=>{
  const {keyboard,via,layers}=await setup();layers[0][1]='KC_B';await via.apply(layers,{...keyboard.light,effect:1},async()=>{});assert(keyboard.log.every(x=>[1,4,5,7,8,9,0x11].includes(x[0])));
});
function reports(bytes,id=0){return [{usagePage:0xff60,usage:0x61,inputReports:[{reportId:id,items:[{reportSize:8,reportCount:bytes}]}],outputReports:[{reportId:id,items:[{reportSize:8,reportCount:bytes}]}]}];}
test('WebHID supports both 32-byte and 64-byte report descriptors',()=>{
  assert.deepEqual(C.describeHidReports(reports(32)),{input:{id:0,bytes:32},output:{id:0,bytes:32}});
  assert.deepEqual(C.describeHidReports(reports(64,7)),{input:{id:7,bytes:64},output:{id:7,bytes:64}});
});
test('report selection ignores unrelated keyboard and media collections',()=>{
  const other={usagePage:1,usage:6,inputReports:[{reportId:9,items:[{reportSize:8,reportCount:128}]}],outputReports:[]};
  const result=C.describeHidReports([other,{usagePage:0xff00,usage:1,children:reports(64,3)}]);assert.equal(result.input.id,3);assert.equal(result.output.bytes,64);
});
test('split report fields are counted, including trailing padding',()=>{
  const d=reports(64);d[0].outputReports[0].items=[{reportSize:8,reportCount:63},{reportSize:1,reportCount:8}];assert.equal(C.describeHidReports(d).output.bytes,64);
});
test('short and excessive descriptors fail without sending a USB command',()=>{
  assert.throws(()=>C.describeHidReports(reports(16)),/未找到可用/);assert.throws(()=>C.describeHidReports(reports(1024)),/未找到可用/);
});
test('64-byte input is accepted and unrelated report ids remain ignored',()=>{
  const data=new Uint8Array(64);data.set([1,0,11]);assert.deepEqual(C.normalizeHidInput(data,3,{id:3,bytes:64}),[1,0,11,...Array(29).fill(0)]);assert.equal(C.normalizeHidInput(data,7,{id:3,bytes:64}),null);
});
test('short or overlong WebHID responses cannot silently pass',()=>{
  assert.throws(()=>C.normalizeHidInput(new Uint8Array(31),0,{id:0,bytes:64}),/长度不正确/);assert.throws(()=>C.normalizeHidInput(new Uint8Array(65),0,{id:0,bytes:64}),/长度不正确/);
});
test('CU effect numbers exactly match the provided firmware definition, including missing 22',()=>{
  const definition=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../docs/reference/nut65-cu-v37.json'),'utf8'));
  const controls=definition.menus.flatMap(m=>m.content).flatMap(m=>m.content);
  const fx=controls.find(c=>c.content[0]==='id_qmk_rgb_matrix_effect');
  assert.deepEqual(C.cuEffects.map(e=>e.id),fx.options.map(o=>o[1]));assert.equal(C.cuEffects.filter(e=>e.strip).length,14);assert(!C.cuEffects.some(e=>e.id===22));
  for(const d of C.settingDefinitions){const c=controls.find(c=>c.content[1]===0&&c.content[2]===d.id);assert.deepEqual(d.values,c.options.map(o=>o[1]));}
});
test('CU probe is read-only, detects all four parameters and relabels dedicated key slots',async()=>{
  const k=new Keyboard({cu:true}),v=new C.ViaDevice(k);await v.connect();assert.equal(v.firmwareProfile,C.CU_PROFILE);assert.deepEqual(v.settings,k.settings);assert(!k.log.some(c=>[5,7,9].includes(c[0])));
  assert.equal(C.label('CUSTOM(7)',C.CU_PROFILE),'Win / Mac 切换');assert.equal(C.label('CUSTOM(14)',C.CU_PROFILE),'RGB 控制协议切换');
  assert.equal(C.catalog('modern',5,C.CU_PROFILE).filter(c=>c.group==='键盘专属').length,24);assert(!C.catalog('modern',5,C.CU_PROFILE).some(c=>c.id==='CUSTOM(24)'));assert.equal(C.decode(0x7e18,'modern'),'CUSTOM(24)');
});
test('echo-only custom replies do not unlock CU settings',async()=>{
  const k=new Keyboard(),original=k.exchange.bind(k);k.exchange=async c=>c[0]===8&&c[1]===0?[...c,...Array(32-c.length).fill(0)]:original(c);
  const v=new C.ViaDevice(k);await v.connect();assert.equal(v.settings,null);assert.equal(v.firmwareProfile,C.FACTORY_PROFILE);assert.throws(()=>v.plan(seed.layers,null,k.settings),/不支持/);
});
test('CU settings persist on channel zero after backup and independent readback',async()=>{
  const {keyboard,via,layers}=await setup({cu:true}),next={sleepTimeout:10,workMinutes:35,breakMinutes:10,stripMode:4};let snapshot;
  const result=await via.apply(layers,null,async p=>{snapshot=p;assert(!keyboard.log.some(c=>[5,7,9].includes(c[0])));},()=>{},next);
  assert.deepEqual(snapshot.deviceSettings,{sleepTimeout:4,workMinutes:25,breakMinutes:5,stripMode:0});assert.equal(snapshot.nutStudio.firmwareProfile,C.CU_PROFILE);assert.equal(result.settings,true);
  assert.deepEqual(keyboard.log.filter(c=>c[0]===7),[[7,0,1,10],[7,0,2,35],[7,0,3,10],[7,0,4,4]]);assert.deepEqual(keyboard.log.at(-1),[9,0]);assert.deepEqual(keyboard.settings,next);assert.deepEqual(via.settings,next);
});
test('CU rejects invalid effects, unavailable battery mode and unsupported durations before traffic',async()=>{
  const {keyboard,via,layers}=await setup({cu:true});
  for(const effect of [37,45,255])assert.throws(()=>via.plan(layers,{...keyboard.light,effect}),/超出范围/);
  for(const patch of [{stripMode:2},{workMinutes:40},{breakMinutes:15},{sleepTimeout:11}])assert.throws(()=>via.plan(layers,null,{...keyboard.settings,...patch}),/范围/);
  assert.equal(keyboard.log.length,0);
});
test('CU parameter failure rolls back settings, lighting and key changes together',async()=>{
  const {keyboard,via,layers}=await setup({cu:true}),oldKeys=copy(keyboard.keys),oldLight=copy(keyboard.light),oldSettings=copy(keyboard.settings);layers[0][1]='KC_Z';keyboard.failSettingOnce=true;
  await assert.rejects(via.apply(layers,{...oldLight,effect:36},async()=>{},()=>{},{...oldSettings,stripMode:1}),/已恢复/);
  assert.deepEqual(keyboard.keys,oldKeys);assert.deepEqual(keyboard.light,oldLight);assert.deepEqual(keyboard.settings,oldSettings);assert.deepEqual(via.settings,oldSettings);
});
test('external CU setting changes stop a combined apply before key writes',async()=>{
  const {keyboard,via,layers}=await setup({cu:true});layers[0][1]='KC_Z';keyboard.settings.workMinutes=30;
  await assert.rejects(via.apply(layers,null,async()=>{},()=>{},{...via.settings,stripMode:3}),/其他程序/);assert(!keyboard.log.some(c=>[5,7,9].includes(c[0])));
});
test('CU strip previews have 80 bounded samples, mode overrides and no fake telemetry',()=>{
  for(const e of C.cuEffects)for(const mode of [0,1,3,4]){const frame=C.stripFrame({effect:e.id,brightness:130,speed:180,hue:14,saturation:200},{stripMode:mode},1270);assert.equal(frame.length,80);assert(frame.every(p=>p.h>=0&&p.h<255&&p.s>=0&&p.s<=255&&p.v>=0&&p.v<=130));}
  const light={effect:0,brightness:255,speed:120,hue:50,saturation:200};assert(C.stripFrame(light,{stripMode:0}).every(p=>p.v===0));assert(C.stripFrame(light,{stripMode:1}).some(p=>p.v>0));
});
function clock(){let id=0;const tasks=new Map();return {tasks,set(fn,ms){tasks.set(++id,{fn,ms});return id;},clear(key){tasks.delete(key);},fire(ms){for(const [key,task]of [...tasks])if(task.ms===ms){tasks.delete(key);task.fn();}}};}
test('QMK brightness scaling no longer causes false rollback or disconnect',async()=>{
  const {keyboard,via,layers}=await setup({cu:true,quantized:true});
  await via.apply(layers,{...via.lighting,brightness:255},async()=>{});
  assert.equal(keyboard.light.brightness,253);assert.equal(via.lighting.brightness,253);assert(via.baseline);assert.deepEqual(keyboard.log.filter(c=>c[0]===7),[[7,3,1,255]]);assert.deepEqual(keyboard.log.at(-1),[9,3]);
});
test('effect-only live edits preserve external brightness and write only the effect',async()=>{
  const {keyboard,via}=await setup({cu:true,quantized:true});keyboard.light.brightness=213;
  const result=await via.updateLive({effect:23},null,async()=>{});assert.equal(result.lighting.brightness,213);assert.deepEqual(keyboard.log.filter(c=>c[0]===7),[[7,3,2,23]]);assert(!keyboard.log.some(c=>c[0]===9||c[0]===5));
});
test('real lighting mismatches are still rejected and keep a responsive connection',async()=>{
  const {keyboard,via}=await setup({cu:true});const original=keyboard.exchange.bind(keyboard);keyboard.exchange=async c=>{if(c[0]===7&&c[1]===3&&c[2]===2&&c[3]===23){keyboard.log.push(c);return [...c,...Array(32-c.length).fill(0)];}return original(c);};
  let error;try{await via.updateLive({effect:23},null,async()=>{});}catch(e){error=e;}
  assert.match(error.message,/校验失败/);assert.equal(error.connectionLost,false);assert(via.baseline);assert.equal(via.lighting.effect,13);
});
test('rounded brightness is also accepted when reverting a failed combined live change',async()=>{
  const {keyboard,via}=await setup({cu:true,quantized:true});keyboard.light.brightness=213;keyboard.failSettingOnce=true;
  await assert.rejects(via.updateLive({brightness:220},{workMinutes:30},async()=>{}),e=>e.connectionLost===false&&/已撤回/.test(e.message));
  assert(via.baseline);assert.equal(via.lighting.brightness,211);assert.equal(via.settings.workMinutes,25);
});
test('live controls coalesce rapid edits, back up once and defer durable saves',async()=>{
  const {keyboard,via}=await setup({cu:true});let backups=0;const timing=clock(),sync=new C.LiveSettingsSync(via,async()=>{backups++;assert(!keyboard.log.some(c=>c[0]===7));},{clock:timing});
  for(let i=0;i<100;i++)sync.request({brightness:50+i});
  assert(!keyboard.log.length);await sync.drain();assert.equal(backups,1);assert.deepEqual(keyboard.log.filter(c=>c[0]===7),[[7,3,1,149]]);assert(!keyboard.log.some(c=>c[0]===9));assert.equal(sync.status,'applied');
  sync.request(null,{workMinutes:35});await sync.drain();assert.equal(backups,1);assert.equal(via.settings.workMinutes,35);
  timing.fire(1000);await sync.flush();assert.deepEqual(keyboard.log.filter(c=>c[0]===9),[[9,3],[9,0]]);assert.equal(sync.status,'saved');sync.cancel();
});
test('live changes made during a slow USB write finish in order with the latest value',async()=>{
  const {keyboard,via}=await setup({cu:true});const original=keyboard.exchange.bind(keyboard);let release,entered;const waiting=new Promise(resolve=>entered=resolve),blocked=new Promise(resolve=>release=resolve);let first=true,active=0,maximum=0;const pending=[];
  keyboard.exchange=async c=>{active++;maximum=Math.max(maximum,active);try{if(c[0]===7&&first){first=false;entered();await blocked;}return await original(c);}finally{active--;}};
  const sync=new C.LiveSettingsSync(via,async()=>{},{clock:clock(),onApplied:(_,p)=>pending.push(p.pendingLight)});sync.request({brightness:80});const running=sync.drain();await waiting;sync.request({brightness:120});sync.request({brightness:190});release();await running;await sync.flush();
  assert.equal(via.lighting.brightness,190);assert.equal(maximum,1);assert.deepEqual(pending,[true,false]);assert.deepEqual(keyboard.log.filter(c=>c[0]===7),[[7,3,1,80],[7,3,1,190]]);assert.equal(keyboard.log.filter(c=>c[0]===9).length,1);sync.cancel();
});
test('a failed live backup prevents all mutations and reports an ordinary error',async()=>{
  const {keyboard,via}=await setup({cu:true});let error;const sync=new C.LiveSettingsSync(via,async()=>{throw Error('disk full');},{clock:clock(),onError:e=>error=e});sync.request({effect:23});await assert.rejects(sync.flush(),/disk full/);assert(!keyboard.log.some(c=>[5,7,9].includes(c[0])));assert.equal(error.connectionLost,false);assert(via.baseline);sync.cancel();
});
test('save failures retain the live connection and can be retried after another edit',async()=>{
  const {keyboard,via}=await setup({cu:true});const original=keyboard.exchange.bind(keyboard);let fail=true;keyboard.exchange=async c=>{if(c[0]===9&&fail){fail=false;throw Error('save busy');}return original(c);};
  const sync=new C.LiveSettingsSync(via,async()=>{},{clock:clock()});sync.request({effect:23});await assert.rejects(sync.flush(),e=>e.connectionLost===false&&/已实时生效/.test(e.message));assert.equal(via.lighting.effect,23);assert(via.baseline);
  sync.request({effect:24});await sync.flush();assert.equal(sync.status,'saved');assert.equal(via.lighting.effect,24);sync.cancel();
});
test('disconnect flushes the final pending edit and cancels future timer writes',async()=>{
  const {keyboard,via}=await setup({cu:true});const timing=clock(),sync=new C.LiveSettingsSync(via,async()=>{},{clock:timing});sync.request({speed:70}, {stripMode:1});await sync.close();assert.equal(via.lighting.speed,70);assert.equal(via.settings.stripMode,1);assert.equal(sync.closed,true);assert.equal(timing.tasks.size,0);assert.throws(()=>sync.request({speed:80}),/关闭/);assert.deepEqual(keyboard.log.filter(c=>c[0]===9),[[9,3],[9,0]]);
});
test('continuous slider events do not postpone the first live update indefinitely',async()=>{
  const {keyboard,via}=await setup({cu:true});const timing=clock(),sync=new C.LiveSettingsSync(via,async()=>{},{clock:timing});sync.request({brightness:100});const scheduled=sync.timer;
  for(let value=101;value<120;value++)sync.request({brightness:value});assert.equal(sync.timer,scheduled);timing.fire(80);await sync.drain();assert.equal(via.lighting.brightness,119);assert(keyboard.log.some(c=>c[0]===7));
  sync.request({brightness:140});await sync.close();assert.equal(via.lighting.brightness,140);
});

async function browserSetup(backup=async()=>{}) {
  const keyboard=new Keyboard({cu:true,quantized:true});
  const {context,timers}=browserContext();
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../ui/core.js'),'utf8'),context,{filename:'core.js'});
  const via=new context.NutCore.ViaDevice(keyboard);await via.connect();keyboard.log=[];
  const errors=[],sync=new context.NutCore.LiveSettingsSync(via,backup,{onError:error=>errors.push(error)});
  return {context,timers,keyboard,via,sync,errors};
}

test('browser default timers automatically write and save without a flush or apply click',async()=>{
  let backups=0;const {context,timers,keyboard,via,sync,errors}=await browserSetup(async()=>{backups++;assert(!keyboard.log.some(c=>c[0]===7));});
  assert.throws(()=>vm.runInContext('({set:setTimeout}).set(()=>{},80)',context),/Illegal invocation/);
  assert.throws(()=>vm.runInContext('({clear:clearTimeout}).clear(1)',context),/Illegal invocation/);
  for(let value=50;value<=149;value++)sync.request({brightness:value});
  timers.advance(79);assert.equal(keyboard.log.length,0);
  timers.advance(1);await sync.running;
  assert.equal(backups,1);assert.equal(sync.status,'applied');assert.equal(via.lighting.brightness,147);
  assert.deepEqual(keyboard.log.filter(c=>c[0]===7),[[7,3,1,149]]);assert(!keyboard.log.some(c=>c[0]===9));
  timers.advance(999);assert(!keyboard.log.some(c=>c[0]===9));
  timers.advance(1);await sync.running;
  assert.equal(sync.status,'saved');assert.deepEqual(keyboard.log.at(-1),[9,3]);assert.equal(timers.size,0);assert.equal(errors.length,0);
  sync.cancel();
});

test('browser default clearTimeout postpones saving until the latest setting is applied',async()=>{
  const {timers,keyboard,via,sync,errors}=await browserSetup();
  sync.request({effect:23});timers.advance(80);await sync.running;
  sync.request(null,{workMinutes:30});timers.advance(80);await sync.running;
  timers.advance(920);assert(!keyboard.log.some(c=>c[0]===9));
  timers.advance(80);await sync.running;
  assert.equal(via.lighting.effect,23);assert.equal(via.settings.workMinutes,30);assert.equal(sync.status,'saved');
  assert.deepEqual(keyboard.log.filter(c=>c[0]===9),[[9,3],[9,0]]);assert.equal(timers.size,0);assert.equal(errors.length,0);
  sync.cancel();
});

test('browser default timers clear on disconnect without delayed device writes',async()=>{
  const first=await browserSetup();first.sync.request({effect:23});first.sync.cancel();first.timers.advance(5000);assert.equal(first.keyboard.log.length,0);assert.equal(first.timers.size,0);
  const {timers,keyboard,via,sync}=await browserSetup();
  sync.request({effect:23});timers.advance(80);await sync.running;
  sync.request({speed:70},{stripMode:1});await sync.close();
  assert.equal(via.lighting.speed,70);assert.equal(via.settings.stripMode,1);assert.equal(sync.closed,true);assert.equal(timers.size,0);
  const count=keyboard.log.length;timers.advance(5000);assert.equal(keyboard.log.length,count);
  assert.deepEqual(keyboard.log.filter(c=>c[0]===9),[[9,3],[9,0]]);
});

test('CU connects read-only while the physical off shortcut reports effect 22',async()=>{
  const keyboard=new Keyboard({cu:true});keyboard.light.effect=22;
  const via=new C.ViaDevice(keyboard);await via.connect();
  assert.equal(via.lighting.effect,22);assert.equal(via.firmwareProfile,C.CU_PROFILE);
  assert(!keyboard.log.some(c=>[5,7,9].includes(c[0])));
  assert.equal(C.validateProfile(via.snapshot()).lighting.effect,22);
});

test('a live effect selection restores lighting after a physical off and preserves its backup',async()=>{
  const {keyboard,via}=await setup({cu:true});const effect=via.lighting.effect;keyboard.light.effect=22;
  let snapshot;const timing=clock(),sync=new C.LiveSettingsSync(via,async p=>{snapshot=p;assert(!keyboard.log.some(c=>c[0]===7));},{clock:timing});
  // Select the same effect still highlighted in the UI: compare against hardware,
  // not the stale on-screen value, so the SET must still be sent.
  sync.request({effect});timing.fire(80);await sync.running;
  assert.equal(snapshot.lighting.effect,22);C.validateProfile(snapshot);
  assert.equal(keyboard.light.effect,effect);assert.equal(via.lighting.effect,effect);
  assert.deepEqual(keyboard.log.filter(c=>c[0]===7),[[7,3,2,effect]]);
  timing.fire(1000);await sync.running;assert.equal(sync.status,'saved');assert.deepEqual(keyboard.log.at(-1),[9,3]);sync.cancel();
});

test('parameter edits preserve the physical off state until an effect is selected',async()=>{
  const {keyboard,via}=await setup({cu:true});keyboard.light.effect=22;
  const result=await via.updateLive({brightness:90,speed:70},null,async()=>{});
  assert.equal(result.lighting.effect,22);assert.equal(keyboard.light.effect,22);
  assert.deepEqual(keyboard.log.filter(c=>c[0]===7),[[7,3,1,90],[7,3,3,70]]);
});

test('failed combined live changes restore the actual CU physical off value',async()=>{
  const {keyboard,via}=await setup({cu:true});keyboard.light.effect=22;keyboard.failSettingOnce=true;
  await assert.rejects(via.updateLive({effect:23},{workMinutes:30},async()=>{}),error=>error.connectionLost===false&&/本次修改已撤回/.test(error.message));
  assert.equal(keyboard.light.effect,22);assert.equal(via.lighting.effect,22);assert.equal(via.settings.workMinutes,25);assert(via.baseline);
  assert(keyboard.log.some(c=>c[0]===7&&c[1]===3&&c[2]===2&&c[3]===22));
});

test('physical off profiles can be restored while other unknown CU effect values remain blocked',async()=>{
  const {keyboard,via,layers}=await setup({cu:true});const off={...via.lighting,effect:22};
  C.validateProfile({...via.snapshot(),lighting:off});
  await via.updateLive(off,null,async()=>{});assert.equal(via.lighting.effect,22);
  keyboard.log=[];
  for(const effect of [37,45,255])assert.throws(()=>via.plan(layers,{...off,effect}),/范围/);
  assert.equal(keyboard.log.length,0);
  keyboard.light.effect=37;await assert.rejects(via.readLighting(),/不支持.*37/);
});

test('physical off preview is dark only for CU and leaves factory effect 22 intact',()=>{
  const light={effect:22,brightness:100,speed:120,hue:30,saturation:200};
  assert(C.stripFrame(light,{stripMode:0},100,C.CU_PROFILE).every(p=>p.v===0));
  assert(C.stripFrame(light,null,100,C.FACTORY_PROFILE).some(p=>p.v>0));
  assert(!C.cuEffects.some(e=>e.id===22));
});

test('all CU source names and numbers match the actual VIA definition, not a conflicting manual table',()=>{
  const p=require('../docs/reference/nut65-cu-v37.json');const controls=p.menus.flatMap(m=>m.content).flatMap(m=>m.content);
  const options=controls.find(c=>c.content[0]==='id_qmk_rgb_matrix_effect').options;
  assert.deepEqual(C.cuEffects.map(e=>[e.sourceName,e.id]),options);
  assert.equal(C.cuEffects.find(e=>e.id===12).sourceName,'Rainbow Moving Chevron');assert.equal(C.cuEffects.find(e=>e.id===13).sourceName,'Cycle Out In Dual');
});

test('CU hue effects vary color without turning into a traveling brightness animation',()=>{
  for(const effect of [10,18,19]){
    const light={effect,brightness:150,speed:128,hue:40,saturation:200};const a=C.stripFrame(light,null,100),b=C.stripFrame(light,null,700);
    assert(a.every(p=>p.v===150));assert.equal(new Set(a.map(p=>p.h)).size,1);assert.notEqual(a[0].h,b[0].h);
  }
});

test('CU scanner, strobe and neon previews have their distinct spatial behavior',()=>{
  const light={brightness:100,speed:128,hue:40,saturation:200};
  const strobe=C.stripFrame({...light,effect:30},null,300);assert.equal(new Set(strobe.map(p=>p.v)).size,1);assert([0,100].includes(strobe[0].v));
  const neon=C.stripFrame({...light,effect:32},null,400);assert(neon[0].v>neon[40].v*5&&neon[79].v>neon[40].v*5);
  const single=C.stripFrame({...light,effect:24},null,0),dual=C.stripFrame({...light,effect:28},null,800);assert(single[39].v>single[0].v*10);assert(Math.abs(dual[0].v-dual[79].v)<1e-8);
});

test('all CU preview frames remain finite and bounded across effects and time',()=>{
  for(const {id:effect} of [...C.cuEffects,{id:22}])for(const time of [0,50,500,1700,5000,10000]){
    const f=C.stripFrame({effect,brightness:173,speed:255,hue:250,saturation:255},null,time);assert.equal(f.length,80);
    assert(f.every(p=>[p.h,p.s,p.v].every(Number.isFinite)&&p.h>=0&&p.h<255&&p.s>=0&&p.s<=255&&p.v>=0&&p.v<=173));
  }
});

test('dedicated strip toggle closes with 22 and restores the exact previous effect and music mode',async()=>{
  const {keyboard,via}=await setup({cu:true});keyboard.settings.stripMode=1;const before=copy(keyboard.light);
  const off=await via.toggleStrip(async()=>{});assert.equal(off.lighting.effect,22);assert.equal(off.settings.stripMode,0);
  const on=await via.toggleStrip(async()=>{});assert.deepEqual(on.lighting,before);assert.equal(on.settings.stripMode,1);
  assert(keyboard.log.filter(c=>c[0]===7).every(c=>c[1]===3&&c[2]===2||c[1]===0&&c[2]===4));assert(!keyboard.log.some(c=>c[0]===9));
});

test('strip toggle restores remembered settings from either global off or physical off',async()=>{
  for(const effect of [0,22]){
    const {keyboard,via}=await setup({cu:true});keyboard.light.effect=effect;via.rememberStrip(31,4);
    await via.toggleStrip(async()=>{});assert.equal(via.lighting.effect,31);assert.equal(via.settings.stripMode,4);
  }
  const {keyboard,via}=await setup({cu:true});keyboard.light.effect=22;await via.toggleStrip(async()=>{});assert.equal(via.lighting.effect,1);
});

test('strip toggle cannot write if its recovery backup fails',async()=>{
  const {keyboard,via}=await setup({cu:true});const before=copy(keyboard.light),resume=copy(via.stripResume);
  await assert.rejects(via.toggleStrip(async()=>{throw Error('disk full');}),/disk full/);
  assert.deepEqual(keyboard.light,before);assert.deepEqual(via.stripResume,resume);assert(!keyboard.log.some(c=>[7,9].includes(c[0])));
});

test('a failed strip toggle restores both the original mode and light state',async()=>{
  const {keyboard,via}=await setup({cu:true});keyboard.settings.stripMode=3;keyboard.failSettingOnce=true;const before=copy(keyboard.light);
  await assert.rejects(via.toggleStrip(async()=>{}),e=>e.connectionLost===false&&/撤回/.test(e.message));
  assert.deepEqual(keyboard.light,before);assert.equal(keyboard.settings.stripMode,3);assert.deepEqual(via.stripResume,{effect:1,stripMode:0});
});

test('live edits remain ordered on either side of a strip toggle barrier',async()=>{
  const {keyboard,via}=await setup({cu:true});const sync=new C.LiveSettingsSync(via,async()=>{},{clock:clock()});
  sync.request({effect:23});sync.requestToggle();sync.request({effect:24});await sync.flush();
  assert.deepEqual(keyboard.log.filter(c=>c[0]===7&&c[1]===3&&c[2]===2).map(c=>c[3]),[23,22,24]);assert.equal(via.lighting.effect,24);sync.cancel();
});

test('two rapid strip toggle presses do not collapse into a single close',async()=>{
  const {keyboard,via}=await setup({cu:true});const sync=new C.LiveSettingsSync(via,async()=>{},{clock:clock()});const before=via.lighting.effect;
  sync.requestToggle();sync.requestToggle();await sync.flush();
  assert.deepEqual(keyboard.log.filter(c=>c[0]===7&&c[1]===3&&c[2]===2).map(c=>c[3]),[22,before]);assert.equal(keyboard.log.filter(c=>c[0]===9).length,1);sync.cancel();
});

test('strip shortcut uses explicit F24 and preserves the existing firmware keycodes',async()=>{
  assert.equal(C.encode('NUT_STRIP_TOGGLE','modern'),0x73);assert.equal(C.encode('RGB_TOG','modern'),0x7820);assert.equal(C.encode('CUSTOM(16)','modern'),0x7e10);
  assert(C.catalog('modern',5,C.CU_PROFILE).some(k=>k.id==='NUT_STRIP_TOGGLE'&&/退出.*不生效/.test(k.hint)));
  assert(!C.catalog('modern',5,C.FACTORY_PROFILE).some(k=>k.id==='NUT_STRIP_TOGGLE'));
  const {via,layers}=await setup();layers[0][1]='NUT_STRIP_TOGGLE';assert.throws(()=>via.plan(layers),/仅支持 CU/);
});

test('canceling a pending strip toggle never writes after disconnect',async()=>{
  const {keyboard,via}=await setup({cu:true});const timing=clock(),sync=new C.LiveSettingsSync(via,async()=>{},{clock:timing});
  sync.requestToggle();sync.cancel();timing.fire(80);assert.equal(keyboard.log.length,0);assert.equal(sync.pending,false);assert.equal(timing.tasks.size,0);
});
