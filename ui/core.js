/* NUT Studio: device-independent keycodes and transactional VIA protocol. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NutCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VID = 0x342d, PID = 0xe545, VPID = 875423045, ROWS = 5, COLS = 15;
  const definitions = [];
  const add = (id, value, label, group = '基本按键', hint = '') => definitions.push({ id, value, label, group, hint });
  add('KC_NO', 0, '禁用', '特殊功能', '此位置不输出按键');
  add('KC_TRNS', 1, '透明', '图层控制', '沿用下方图层的按键');
  for (let i = 0; i < 26; i++) add(`KC_${String.fromCharCode(65+i)}`, 4+i, String.fromCharCode(65+i));
  '1234567890'.split('').forEach((c,i) => add(`KC_${c}`, 30+i, c));
  [ ['ENT',40,'Enter'],['ESC',41,'Esc'],['BSPC',42,'Backspace'],['TAB',43,'Tab'],['SPC',44,'Space'],['MINS',45,'−'],['EQL',46,'='],['LBRC',47,'['],['RBRC',48,']'],['BSLS',49,'\\'],['NUHS',50,'#'],['SCLN',51,';'],['QUOT',52,"'"],['GRV',53,'`'],['COMM',54,','],['DOT',55,'.'],['SLSH',56,'/'],['CAPS',57,'Caps'],['PSCR',70,'PrtSc'],['SLCK',71,'ScrLk'],['PAUS',72,'Pause'],['INS',73,'Insert'],['HOME',74,'Home'],['PGUP',75,'PgUp'],['DEL',76,'Delete'],['END',77,'End'],['PGDN',78,'PgDn'],['RGHT',79,'→'],['LEFT',80,'←'],['DOWN',81,'↓'],['UP',82,'↑'],['NLCK',83,'Num'],['PSLS',84,'Num /'],['PAST',85,'Num *'],['PMNS',86,'Num −'],['PPLS',87,'Num +'],['PENT',88,'Num ↵'],['P0',98,'Num 0'],['PDOT',99,'Num .'],['APP',101,'Menu'] ].forEach(([id,v,l]) => add(`KC_${id}`,v,l));
  for (let i=1;i<=9;i++) add(`KC_P${i}`,88+i,`Num ${i}`);
  for (let i=1;i<=24;i++) add(`KC_F${i}`,i<=12?57+i:91+i,`F${i}`,'功能按键');
  [ ['LCTL',224,'Ctrl'],['LSFT',225,'Shift'],['LALT',226,'Alt'],['LGUI',227,'Win'],['RCTL',228,'R Ctrl'],['RSFT',229,'R Shift'],['RALT',230,'R Alt'],['RGUI',231,'R Win'] ].forEach(([id,v,l])=>add(`KC_${id}`,v,l));
  [ ['MUTE',168,'静音'],['VOLU',169,'音量 +'],['VOLD',170,'音量 −'],['MNXT',171,'下一曲'],['MPRV',172,'上一曲'],['MSTP',173,'停止'],['MPLY',174,'播放 / 暂停'],['MAIL',177,'邮件'],['CALC',178,'计算器'],['MYCM',179,'此电脑'],['BRIU',189,'屏幕亮度 +'],['BRID',190,'屏幕亮度 −'],['MCTL',193,'Mission'],['LPAD',194,'Launchpad'] ].forEach(([id,v,l])=>add(`KC_${id}`,v,l,'媒体控制'));
  const customNames = ['蓝牙 1','蓝牙 2','蓝牙 3','2.4 GHz','USB 有线','电量查询','灯光开关','指示灯开关','延迟模式切换','白光测试','Win / Mac 切换','侧灯模式','音乐模式','音乐校准','频率测试','蓝牙测试','侧灯亮度 +','侧灯亮度 −'];
  const CU_PROFILE='packortake-cu-v37', FACTORY_PROFILE='factory', CU_SHORTCUT_OFF=22;
  const cuCustomNames=['蓝牙 1','蓝牙 2','蓝牙 3','2.4 GHz','USB 有线','电量显示','充电指示灯','Win / Mac 切换','按住显示仪表盘','音乐律动开关','音乐校准','番茄钟开始 / 切换阶段','打字速度模式','番茄钟模式','RGB 控制协议切换','游戏模式','关闭前灯带','打开 VIA 网页','Mac 搜索','Mac 语音','Mac 勿扰','Mac 全屏截图','Mac 区域截图','Mac 截图选项'];
  const cuCustomHints={5:'无线模式下短按显示电量，长按切换持续显示；USB 不提供电量数据',8:'按住显示灯带仪表盘，松开恢复',9:'切换键盘内置麦克风音乐律动',10:'校准键盘内置麦克风，按固件说明在安静环境操作',11:'启动或暂停番茄钟；阶段切换以固件行为为准',14:'循环切换 VIA / OpenRGB / SignalRGB；使用本软件时选择 VIA（红色反馈）',15:'固件自定义键 KC_GME；公开文档未说明实际行为，不等同于 Windows 游戏模式或 Win 键锁定，也没有已确认的性能提升',16:'固件 RL_OFF：只关闭前灯带，不是双向开关；需双向切换请选择“前灯带开 / 关（软件联动）”',17:'由键盘输入 VIA 网址；请在合适的输入窗口使用'};
  const rgbNames = ['灯光开关','下个灯效','上个灯效','色相 +','色相 −','饱和度 +','饱和度 −','亮度 +','亮度 −','速度 +','速度 −'];
  cuCustomNames[11]='番茄钟启动 / 暂停';cuCustomNames[15]='游戏模式（固件未说明）';
  const rgbIds = ['RGB_TOG','RGB_MOD','RGB_RMOD','RGB_HUI','RGB_HUD','RGB_SAI','RGB_SAD','RGB_VAI','RGB_VAD','RGB_SPI','RGB_SPD'];
  // Entries are shared with callers, so neither the list nor its items may change.
  definitions.forEach(Object.freeze);
  const catalogCache=new Map(), CATALOG_CACHE_LIMIT=16;
  function catalogEntry(mode,layerCount,profile) {
    if(!Number.isInteger(layerCount)||layerCount<1||layerCount>16)throw Error('图层数应为 1 到 16 的整数');
    mode=mode==='modern'?'modern':'legacy';
    profile=profile===CU_PROFILE?CU_PROFILE:FACTORY_PROFILE;
    const key=`${mode}:${layerCount}:${profile}`;
    if(catalogCache.has(key)) {
      const entry=catalogCache.get(key);catalogCache.delete(key);catalogCache.set(key,entry);return entry;
    }
    const a = definitions.slice();
    const modern=mode==='modern';
    a.push({id:'KC_GESC',value:modern?0x7c16:0x5c16,label:'Esc / ~',group:'特殊功能',hint:'按下 Esc；配合 Shift 输出 ~'});
    rgbIds.forEach((id,i)=>a.push({id,value:(modern?0x7820:0x5cc2)+i,label:profile===CU_PROFILE&&i===0?'全局 RGB 开关（固件）':rgbNames[i],group:'灯光快捷键',hint:profile===CU_PROFILE&&i===0?'固件通用 RGB 开关，可能影响状态指示灯；仅控制前灯带请选择软件联动开关':''}));
    if(profile===CU_PROFILE)a.push({id:'NUT_STRIP_TOGGLE',value:0x73,label:'前灯带开 / 关（软件联动）',group:'灯光快捷键',hint:'按一次关闭、再按一次恢复上次灯效和模式。使用专用 F24，需 Windows 直接连接且 NUT Studio 窗口运行，可最小化；退出软件后不生效。'});
    (profile===CU_PROFILE?cuCustomNames:customNames).forEach((label,i)=>a.push({id:`CUSTOM(${i})`,value:(modern?0x7e00:0x5f80)+i,label,group:'键盘专属',hint:profile===CU_PROFILE?(cuCustomHints[i]||'第三方 CU 固件专用；应用后通过此按键触发'):''}));
    for (let l=0;l<layerCount;l++) {
      for (const [kind,base,old,label] of [['MO',0x5220,0x5100,'按住切换'],['TG',0x5260,0x5300,'开关图层']])
        a.push({id:`${kind}(${l})`,value:(modern?base:old)+l,label:`${kind} ${l}`,group:'图层控制',hint:`${label}到图层 ${l}`});
    }
    const byId=new Map(),byValue=new Map();
    for(const item of a) {
      Object.freeze(item);byId.set(item.id,item);
      // F24 and the optional CU software toggle share a code. Keep F24 as the
      // default decode; the UI opts into the toggle using its saved preference.
      if(!byValue.has(item.value))byValue.set(item.value,item);
    }
    const entry={items:Object.freeze(a),byId,byValue};
    if(catalogCache.size>=CATALOG_CACHE_LIMIT)catalogCache.delete(catalogCache.keys().next().value);
    catalogCache.set(key,entry);return entry;
  }
  function catalog(mode='legacy', layerCount=5, profile=FACTORY_PROFILE) {
    return catalogEntry(mode,layerCount,profile).items;
  }
  function encode(id, mode='legacy', layerCount=5, profile=FACTORY_PROFILE) {
    if (Number.isInteger(id) && id>=0 && id<=65535) return id;
    if (typeof id !== 'string') throw Error('按键代码格式不正确');
    if (/^0x[0-9a-f]{1,4}$/i.test(id)) return parseInt(id,16);
    if(id==='NUT_STRIP_TOGGLE')return 0x73;
    const e=catalogEntry(mode,layerCount,profile).byId.get(id);
    if (e) return e.value;
    const c=/^CUSTOM\((\d+)\)$/.exec(id);
    if(c && +c[1]<32) return (mode==='modern'?0x7e00:0x5f80)+ +c[1];
    // Preserve old saved tokens; these are never exposed as convenient actions.
    if (id==='RESET'||id==='QK_BOOTLOADER') return mode==='modern'?0x7c00:0x5c00;
    if (id==='QK_CLEAR_EEPROM') return mode==='modern'?0x7c03:0x5cdf;
    if (id==='MAGIC_TOGGLE_GUI') { if(mode!=='modern')throw Error('旧版固件的 Win 锁键码需要从设备读取，或使用原始十六进制键码'); return 0x700b; }
    const chord=/^(LCTL|LSFT|LALT|LGUI)\((KC_[A-Z0-9_]+)\)$/.exec(id);
    if(chord) { const v=encode(chord[2],mode,layerCount,profile); if(v>255) throw Error('组合键只支持基本按键'); return ({LCTL:0x100,LSFT:0x200,LALT:0x400,LGUI:0x800}[chord[1]])|v; }
    throw Error(`暂不支持解析 ${id}；可使用 0x0000 格式保留原始键码`);
  }
  function decode(value, mode='legacy', layerCount=5, profile=FACTORY_PROFILE) {
    if(!Number.isInteger(value)||value<0||value>65535)throw Error('按键代码应为 0 到 65535 的整数');
    const base=mode==='modern'?0x7e00:0x5f80;
    if(value>=base&&value<base+32)return `CUSTOM(${value-base})`;
    return catalogEntry(mode,layerCount,profile).byValue.get(value)?.id || `0x${value.toString(16).padStart(4,'0')}`;
  }
  function label(id,profile=FACTORY_PROFILE) {
    if(typeof id==='number')id=decode(id);
    return catalogEntry('legacy',16,profile).byId.get(id)?.label || ({RESET:'Boot',QK_CLEAR_EEPROM:'重置',MAGIC_TOGGLE_GUI:'Win 锁'}[id]) || id.replace(/^KC_/,'').replace('CUSTOM','自定义');
  }
  function layout() {
    const rows = [
      [...Array(15)].map((_,c)=>[c,c===13?2:1,0]),
      [...Array(15)].map((_,c)=>[c,c===0||c===13?1.5:1,0]),
      [...Array(15)].map((_,c)=>[c,c===0?1.75:c===13?2.25:1,0]).filter(x=>x[0]!==12),
      [...Array(15)].map((_,c)=>[c,c===0?2.25:c===12?1.75:1,0]).filter(x=>x[0]!==1),
      [[0,1.25,0],[1,1.25,0],[2,1.25,0],[5,6.25,0],[10,1.25,0],[11,1.25,0],[12,1,0.5],[13,1,0],[14,1,0]]
    ];
    return rows.flatMap((row,r)=> {let x=0; return row.map(([c,w,gap])=> {x+=gap; const k={row:r,col:c,index:r*COLS+c,x,y:r,w};x+=w;return k;});});
  }
  const effects = ['关闭灯光','常亮','字母 / 修饰键','纵向渐变','横向渐变','呼吸','色带 · 饱和度','色带 · 亮度','风车色带 · 饱和度','风车色带 · 亮度','螺旋色带 · 饱和度','螺旋色带 · 亮度','全键变色','彩虹流光','垂直流光','彩虹波纹','向心流光','双向向心','风车循环','螺旋循环','双信标','彩虹信标','彩虹风车','雨滴','缤纷雨滴','色相呼吸','色相钟摆','色相波浪','像素雨','像素流','像素分形','输入热力图','数字雨','触发 · 简洁','触发 · 常规','触发 · 扩散','触发 · 多重扩散','触发 · 十字','触发 · 多重十字','触发 · 星环','触发 · 多重星环','涟漪','多重涟漪','单色涟漪','多重单色涟漪','全部关闭'];
  // IDs are taken from cu/NUT65 CU.json at 8427691, not the standard board.
  const cuEffects=['关闭灯带','常亮','左右渐变','呼吸','色带 · 饱和度','色带 · 明度','风车色带 · 饱和度','风车色带 · 明度','螺旋色带 · 饱和度','螺旋色带 · 明度','全带变色','左右循环','彩虹人字波','双向向心','风车循环','螺旋循环','彩虹信标','彩虹风车','色相呼吸','色相钟摆','色相波浪','流水',null,'灯带 · 波浪','灯带 · 跑马','灯带 · 脉冲','灯带 · 闪电','灯带 · 迪斯科','灯带 · 双扫描','灯带 · 星光','灯带 · 频闪','灯带 · 极光','灯带 · 霓虹','灯带 · 激光','灯带 · 心跳','灯带 · 烟花','灯带 · 彩虹追逐'].flatMap((label,id)=>label?[{id,label,strip:id>=23}]:[]);
  const settingDefinitions=[{name:'sleepTimeout',id:1,values:[0,1,2,3,4,5,6,7,8,9,10]},{name:'workMinutes',id:2,values:[5,10,15,20,25,30,35]},{name:'breakMinutes',id:3,values:[5,10]},{name:'stripMode',id:4,values:[0,1,3,4]}];
  function getEffects(profile){return profile===CU_PROFILE?cuEffects:effects.map((label,id)=>({id,label,strip:false}));}
  const cuEffectSource=['All Off','Solid Color','Gradient Left Right','Breathing','Band Sat','Band Val','Band Pinwheel Sat','Band Pinwheel Val','Band Spiral Sat','Band Spiral Val','Cycle All','Cycle Left Right','Rainbow Moving Chevron','Cycle Out In Dual','Cycle Pinwheel','Cycle Spiral','Rainbow Beacon','Rainbow Pinwheels','Hue Breathing','Hue Pendulum','Hue Wave','Riverflow',null,'Strip Wave','Strip Knight Rider','Strip Pulse','Strip Lightning','Strip Disco','Strip Scanner','Strip Sparkle','Strip Strobe','Strip Aurora','Strip Neon','Strip Laser','Strip Heartbeat','Strip Fireworks','Strip Rainbow Chase'];
  cuEffects.forEach(e=>{e.sourceName=cuEffectSource[e.id];if(e.id===24)e.label='灯带 · 往返扫描';if(e.id===28)e.label='灯带 · 双向扫描';if(e.id===29)e.label='灯带 · 星光闪烁';});
  // CU physical off returns 22 (observed GET 08-03-02-16), although the
  // published VIA menu omits it. Preserve it in reads, backups and rollback.
  function supportsLightingEffect(effect,profile){return (profile===CU_PROFILE&&effect===CU_SHORTCUT_OFF)||getEffects(profile).some(e=>e.id===effect);}
  function isLightingOff(effect,profile){return effect===0||(profile===CU_PROFILE?effect===CU_SHORTCUT_OFF:effect===45);}
  function validateSettings(settings,allowBattery=false) {
    if(!settings||settingDefinitions.some(d=>!d.values.includes(settings[d.name])&&!(allowBattery&&d.name==='stripMode'&&settings[d.name]===2)))throw Error('设备功能参数不在 CU 固件支持范围内');
    return settings;
  }
  const lightFields=['brightness','effect','speed','hue','saturation'];
  function validateLighting(light,profile) {
    if(!light||lightFields.some(k=>!Number.isInteger(light[k])||light[k]<0||light[k]>255)||!supportsLightingEffect(light.effect,profile))throw Error('灯光参数或灯效编号超出范围');
  }
  function lightingDelta(before,after){return [1,2,3,4].filter(id=>id===4?before.hue!==after.hue||before.saturation!==after.saturation:before[lightFields[id-1]]!==after[lightFields[id-1]]);}
  function verifyLighting(actual,wanted,ids) {
    // QMK scales the 0..255 VIA brightness into a smaller integer range and
    // scales it back on GET. A small downward rounding difference is expected.
    const names=ids.flatMap(id=>id===4?['hue','saturation']:[lightFields[id-1]]);
    const wrong=names.filter(k=>k==='brightness'?!((wanted[k]-actual[k])>=0&&(wanted[k]-actual[k])<=3):actual[k]!==wanted[k]);
    const labels={brightness:'亮度',effect:'灯效',speed:'速度',hue:'色相',saturation:'饱和度'};
    if(wrong.length)throw Error('灯光写入后校验失败：'+wrong.map(k=>`${labels[k]} 请求 ${wanted[k]} / 回读 ${actual[k]}`).join('，'));
  }
  // A visual illustration only: no microphone, WPM or timer telemetry is read.
  function cuStripFrame(light,time){
    const e=light.effect,t=time/1000*(.3+light.speed/90),tau=Math.PI*2;
    const wave=x=>(1+Math.sin(x))/2,wrap=x=>((x%1)+1)%1;
    const noise=x=>wrap(Math.sin(x*12.9898+78.233)*43758.5453);
    return Array.from({length:80},(_,i)=>{
      const x=i/79,center=Math.abs(x-.5)*2;let h=light.hue,s=light.saturation,v=1;
      switch(e){
        case 0:case 22:v=0;break;
        case 1:break;
        case 2:h+=x*(30+light.speed*.7);break;
        case 3:v=wave(t*2);break;
        case 4:s*=Math.max(0,1-Math.abs(wrap(x-t*.15)-.5)*2);break;
        case 5:v=Math.max(0,1-Math.abs(wrap(x-t*.15)-.5)*2);break;
        case 6:s*=wave(x*tau*3-t);break;
        case 7:v=wave(x*tau*3-t);break;
        case 8:s*=wave(center*tau*2-t);break;
        case 9:v=wave(center*tau*2-t);break;
        case 10:h+=t*35;break;
        case 11:h+=x*255-t*35;break;
        case 12:h+=center*255-t*35;break;
        case 13:h+=wrap(center-t*.18)*255;v=.25+.75*wave(center*tau-t*2);break;
        case 14:h+=x*255-t*45;break;
        case 15:h+=center*center*255-t*45;break;
        case 16:h+=x*255+t*25;v=.2+.8*Math.pow(wave(x*tau*2-t),2);break;
        case 17:h+=wrap(x*3-t*.18)*255;break;
        case 18:h+=wave(t)*120;break;
        case 19:h+=Math.sin(t)*80;break;
        case 20:h+=Math.sin(x*tau-t)*80;break;
        case 21:h+=x*255-t*50;v=.25+.75*wave(x*tau*5-t*2);break;
        case 23:h+=x*255-t*28;v=.15+.85*wave(x*tau*2-t*2);break;
        case 24:{const p=wave(t);v=Math.exp(-Math.abs(x-p)*22);break;}
        case 25:v=Math.pow(wave(t*2),2);break;
        case 26:{const period=Math.floor(t/2),phase=wrap(t/2);v=(phase<.04||phase>.08&&phase<.1)?1:Math.max(0,.2-Math.abs(x-noise(period))*2);s*=.15;break;}
        case 27:h=noise(Math.floor(i/5)+Math.floor(t*4)*31)*255;v=noise(Math.floor(i/5)*17+Math.floor(t*4))>.3?1:.04;break;
        case 28:{const p=wave(t);v=Math.max(Math.exp(-Math.abs(x-p)*18),Math.exp(-Math.abs(x-(1-p))*18));break;}
        case 29:v=Math.pow(noise(i+Math.floor(t*5)*79),14);break;
        case 30:v=wrap(t*3)<.22?1:0;break;
        case 31:h=105+wave(x*7+t)*45;v=.1+.9*wave(x*6-t)*wave(x*2+t*.5);break;
        case 32:h+=t*12;v=(.05+.95*Math.pow(center,3))*(.6+.4*wave(t));break;
        case 33:{const p=wrap(t*.28);v=Math.exp(-Math.abs(x-p)*65);break;}
        case 34:{const p=wrap(t*.7);v=Math.min(1,Math.exp(-Math.pow((p-.16)/.055,2))+.7*Math.exp(-Math.pow((p-.34)/.065,2)));break;}
        case 35:{const cycle=Math.floor(t*.5),phase=wrap(t*.5),origin=.2+noise(cycle)*.6;h=noise(cycle+7)*255;v=Math.exp(-Math.abs(Math.abs(x-origin)-phase*.65)*28)*(1-phase)*(.5+.5*noise(i+cycle*80));break;}
        case 36:{const segment=wrap(x*8-t);h+=Math.floor(x*8-t)*37+t*12;v=segment<.6?1:.02;break;}
        default:v=0;
      }
      return {h:((h%255)+255)%255,s:Math.max(0,Math.min(255,s)),v:Math.max(0,Math.min(light.brightness,v*light.brightness))};
    });
  }
  function stripFrame(light,settings,time=0,profile=CU_PROFILE) {
    if(profile===CU_PROFILE&&!(settings?.stripMode))return cuStripFrame(light,time);
    const e=light.effect,t=time/1000*(.3+light.speed/90),mode=settings?.stripMode||0;
    return Array.from({length:80},(_,i)=>{
      const x=i/79;let h=light.hue,s=light.saturation,v=light.brightness;
      if(mode===1){h+=x*100;v*=.15+.85*Math.abs(Math.sin(i*.36+t*3)*Math.cos(t*.7+x*4));}
      else if(mode===2){h=72;v*=x<.68?1:.02;}
      else if(mode===3){h=135+x*65;v*=x<.58?.85:.03;}
      else if(mode===4){h=15;v*=x<.64?.9:.025;}
      else if(isLightingOff(e,profile))v=0;
      else if(e===1){}
      else if([3,18,25,34].includes(e)){v*=.15+.85*Math.pow((1+Math.sin(t*2))/2,e===34?5:1);if(e===18)h+=t*18;}
      else if([24,28,33].includes(e)){const p=(Math.sin(t)+1)/2;v*=Math.max(.025,1-Math.abs(x-p)*(e===33?28:9));if(e===28)v=Math.max(v,light.brightness*Math.max(.025,1-Math.abs(x-(1-p))*9));}
      else if([26,27,29,30,35].includes(e)){v*=Math.pow(Math.max(0,Math.sin(i*12.17+Math.floor(t*5)*7.13)),e===30?1:9);if([27,35].includes(e))h+=i*23+t*35;}
      else if(e===2)h+=x*90;
      else if(e===10)h+=t*30;
      else {h+=x*255-t*32;if([4,6,8].includes(e))s*=.2+.8*(1+Math.sin(x*15-t))/2;if([5,7,9,21,23,31,32,36].includes(e))v*=.18+.82*(1+Math.sin(x*(e===36?50:12)-t*3))/2;}
      return {h:((h%255)+255)%255,s,v:Math.max(0,Math.min(255,v))};
    });
  }
  function validateProfile(p) {
    if(!p || p.vendorProductId!==VPID || !Array.isArray(p.layers) || !p.layers.length || p.layers.length>16) throw Error('请选择 NUT65 CU 的 VIA 键位备份（VID 342D / PID E545）。');
    if(p.layers.some(l=>!Array.isArray(l)||![75,90].includes(l.length)||l.some(k=>typeof k==='string'?(k.length<1||k.length>80):(!Number.isInteger(k)||k<0||k>65535)))) throw Error('每层应包含 75 或 90 个合法键码。');
    if (p.lighting) for (const [name,max] of [['effect',45],['brightness',255],['speed',255],['hue',255],['saturation',255]]) {
      if(!Number.isInteger(p.lighting[name])||p.lighting[name]<0||p.lighting[name]>max)throw Error(`灯光参数 ${name} 不正确。`);
    }
    if(p.nutStudio?.firmwareProfile===CU_PROFILE&&p.lighting&&!supportsLightingEffect(p.lighting.effect,CU_PROFILE))throw Error('此方案的 CU 灯效编号不受支持');
    if(p.deviceSettings)validateSettings(p.deviceSettings,true);
    return p;
  }
  function describeHidReports(collections) {
    const groups=[];
    function find(nodes){for(const c of nodes||[]){if(c.usagePage===0xff60&&c.usage===0x61)groups.push(c);find(c.children);}}
    find(collections);
    const reports={input:[],output:[]};
    function collect(c) {
      for(const [kind,field]of [['input','inputReports'],['output','outputReports']])for(const r of c[field]||[]) {
        const bits=(r.items||[]).reduce((n,item)=>n+item.reportSize*item.reportCount,0),bytes=Math.ceil(bits/8);
        if(Number.isInteger(r.reportId)&&r.reportId>=0&&r.reportId<=255&&bytes>=32&&bytes<=512)reports[kind].push({id:r.reportId,bytes});
      }
      for(const child of c.children||[])collect(child);
    }
    groups.forEach(collect);
    for(const kind of ['input','output']) {
      reports[kind].sort((a,b)=>b.bytes-a.bytes||(a.id===0?-1:b.id===0?1:a.id-b.id));
      reports[kind]=reports[kind][0];
      if(!reports[kind])throw Error(`未找到可用的 VIA ${kind==='input'?'输入':'输出'}报告。请导出连接诊断。`);
    }
    return reports;
  }
  function normalizeHidInput(bytes,reportId,expected) {
    if(reportId!==expected.id)return null;
    if(bytes.length<32||bytes.length>expected.bytes)throw Error(`USB 输入长度不正确：收到 ${bytes.length} 字节，设备声明 ${expected.bytes} 字节`);
    return Array.from(bytes).slice(0,32);
  }
  class ViaDevice {
    constructor(transport) {this.transport=transport;this.protocol=0;this.layerCount=0;this.mode='legacy';this.firmwareProfile=FACTORY_PROFILE;this.baseline=null;this.lighting=null;this.settings=null;this.busy=false;this.stripResume={effect:1,stripMode:0};}
    async command(...bytes) {const r=await this.transport.exchange(bytes);if(r.length!==32||r[0]!==bytes[0])throw Error('键盘返回的指令不匹配');return r;}
    async getKey(l,r,c) {const a=await this.command(4,l,r,c);if(a[1]!==l||a[2]!==r||a[3]!==c)throw Error('键盘返回的键位坐标不匹配');return a[4]*256+a[5];}
    async connect(progress=()=>{}) {
      const v=await this.command(1);this.protocol=v[1]*256+v[2];
      if(this.protocol<7 || this.protocol>12) throw Error(`检测到 VIA 协议 ${this.protocol}；当前版本支持 7–12，已停止写入。`);
      const count=await this.command(0x11);this.layerCount=count[1];
      if(this.layerCount<1||this.layerCount>16)throw Error('键盘返回的图层数不正确');
      this.baseline=[];
      // Query coordinates directly: the user's export has a padded sixth row,
      // whereas the manufacturer's definition is 5×15. Never guess buffer stride.
      for(let l=0;l<this.layerCount;l++) {
        const layer=[];
        for(let i=0;i<75;i++){layer.push(await this.getKey(l,Math.floor(i/15),i%15));if(i%15===14)progress((l*75+i+1)/(this.layerCount*75));}
        this.baseline.push(layer);
      }
      const fn=this.baseline[0][71];
      if((fn>=0x5220&&fn<=0x523f)||this.baseline[0][0]===0x7c16)this.mode='modern';
      if(this.protocol>=11)try{this.settings=await this.readSettings();this.firmwareProfile=CU_PROFILE;}catch(e){if(!e.message.includes('不支持'))throw e;this.settings=null;}
      try {this.lighting=await this.readLighting();} catch(e) {if(!e.message.includes('不支持'))throw e;this.lighting=null;}
      return this;
    }
    async readSettings() {
      const result={};
      for(const d of settingDefinitions){const a=await this.command(8,0,d.id);if(a[1]!==0||a[2]!==d.id)throw Error('不支持 CU 设备功能通道');result[d.name]=a[3];}
      try{return validateSettings(result,true);}catch{throw Error('不支持 CU 设备功能通道，继续使用兼容模式');}
    }
    async readLighting() {
      if(this.protocol<11)throw Error('当前固件不支持官方 V3 灯光通道');
      const result={};
      for(const [name,id] of [['brightness',1],['effect',2],['speed',3],['color',4]]) {
        const a=await this.command(8,3,id);if(a[1]!==3||a[2]!==id)throw Error('灯光参数返回不正确');
        if(name==='color'){result.hue=a[3];result.saturation=a[4];}else result[name]=a[3];
      }
      if(!supportsLightingEffect(result.effect,this.firmwareProfile))throw Error(`不支持此固件的灯效编号 ${result.effect}，已停止灯光写入`);return result;
    }
    plan(layers,light=null,settings=null) {
      if(!this.baseline)throw Error('请先连接并读取键盘');
      if(this.firmwareProfile!==CU_PROFILE&&layers.some(l=>l.includes('NUT_STRIP_TOGGLE')))throw Error('前灯带软件开关仅支持 CU 固件');
      if(layers.length!==this.layerCount)throw Error(`当前键盘有 ${this.layerCount} 层，配置有 ${layers.length} 层。`);
      const changes=[];
      for(let l=0;l<layers.length;l++)for(const k of layout()) {
        const next=encode(layers[l][k.index],this.mode,this.layerCount);
        if(next!==this.baseline[l][k.index])changes.push({layer:l,row:k.row,col:k.col,index:k.index,before:this.baseline[l][k.index],after:next});
      }
      if(light) {
        if(!this.lighting)throw Error('当前固件没有提供可用的灯光通道');
        validateLighting(light,this.firmwareProfile);
      }
      if(settings){if(!this.settings||this.firmwareProfile!==CU_PROFILE)throw Error('当前固件不支持 CU 设备功能设置');validateSettings(settings);}
      return changes;
    }
    async writeKey(k,v) {await this.command(5,k.layer,k.row,k.col,v>>8,v&255);if(await this.getKey(k.layer,k.row,k.col)!==v)throw Error(`图层 ${k.layer} (${k.row},${k.col}) 写入后校验失败`);}
    async writeLighting(light,{base=this.lighting,fields=null,save=true}={}) {
      validateLighting(light,this.firmwareProfile);
      const ids=fields||lightingDelta(base,light),values={1:[light.brightness],2:[light.effect],3:[light.speed],4:[light.hue,light.saturation]};
      for(const id of ids)await this.command(7,3,id,...values[id]);
      const actual=await this.readLighting();
      verifyLighting(actual,light,ids);this.lighting={...actual};
      if(save&&ids.length)await this.command(9,3);
      return actual;
    }
    async writeSettings(settings,{base=this.settings,fields=null,save=true}={}) {
      validateSettings(settings,true);
      const changed=fields||settingDefinitions.filter(d=>base[d.name]!==settings[d.name]).map(d=>d.id);
      for(const d of settingDefinitions.filter(d=>changed.includes(d.id)))await this.command(7,0,d.id,settings[d.name]);
      const actual=await this.readSettings();
      if(settingDefinitions.some(d=>changed.includes(d.id)&&actual[d.name]!==settings[d.name]))throw Error('设备功能写入后校验失败');
      this.settings={...actual};if(save&&changed.length)await this.command(9,0);
      return actual;
    }
    snapshot() {
      return {name:'NUT65 CU',vendorProductId:VPID,layers:this.baseline.map(l=>l.map(v=>`0x${v.toString(16).padStart(4,'0')}`)),lighting:this.lighting?{...this.lighting}:null,deviceSettings:this.settings?{...this.settings}:null,nutStudio:{format:2,firmwareProfile:this.firmwareProfile,protocol:this.protocol,keycodeMode:this.mode,savedAt:new Date().toISOString()}};
    }
    validateLive(light,settings) {
      if(!this.baseline)throw Error('请先连接并读取键盘');
      if(light){if(!this.lighting)throw Error('当前固件没有提供可用的灯光通道');if(Object.keys(light).some(k=>!lightFields.includes(k)))throw Error('未知灯光参数');validateLighting({...this.lighting,...light},this.firmwareProfile);}
      if(settings){if(!this.settings||this.firmwareProfile!==CU_PROFILE)throw Error('当前固件不支持 CU 设备功能设置');if(Object.keys(settings).some(k=>!settingDefinitions.some(d=>d.name===k))||settings.stripMode===2)throw Error('设备功能参数不在 CU 固件支持范围内');validateSettings({...this.settings,...settings},true);}
    }
    async responsive(){try{await this.getKey(0,0,0);return true;}catch{return false;}}
    rememberStrip(effect,stripMode){
      if(!supportsLightingEffect(effect,CU_PROFILE)||isLightingOff(effect,CU_PROFILE)||![0,1,3,4].includes(stripMode))throw Error('前灯带恢复参数不受支持');
      this.stripResume={effect,stripMode};
    }
    async toggleStrip(backup){
      if(this.firmwareProfile!==CU_PROFILE||!this.settings||!this.lighting)throw Error('前灯带开关需要可用的 CU 灯光和设备功能通道');
      return this.updateLive({}, {},backup,{toggleStrip:true});
    }
    async updateLive(light,settings,backup,{toggleStrip=false}={}) {
      this.validateLive(light,settings);if(this.busy)throw Error('请等待当前操作完成');this.busy=true;
      let beforeLight=null,beforeSettings=null,lightIds=[],settingIds=[],lightAttempted=false,settingsAttempted=false;
      try {
        if(light){beforeLight=await this.readLighting();this.lighting={...beforeLight};}
        if(settings){beforeSettings=await this.readSettings();this.settings={...beforeSettings};}
        let resume=null;
        if(toggleStrip){
          const on=beforeSettings.stripMode!==0||!isLightingOff(beforeLight.effect,CU_PROFILE);
          if(on){resume={effect:isLightingOff(beforeLight.effect,CU_PROFILE)?this.stripResume.effect:beforeLight.effect,stripMode:[0,1,3,4].includes(beforeSettings.stripMode)?beforeSettings.stripMode:0};light={effect:CU_SHORTCUT_OFF};settings={stripMode:0};}
          else{light={effect:this.stripResume.effect};settings={stripMode:this.stripResume.stripMode};}
        }
        const targetLight=light?{...beforeLight,...light}:null,targetSettings=settings?{...beforeSettings,...settings}:null;
        this.validateLive(light,settings);
        if(light)lightIds=lightingDelta(beforeLight,targetLight);
        if(settings)settingIds=settingDefinitions.filter(d=>beforeSettings[d.name]!==targetSettings[d.name]).map(d=>d.id);
        if(lightIds.length||settingIds.length)await backup(this.snapshot());
        if(lightIds.length){lightAttempted=true;await this.writeLighting(targetLight,{base:beforeLight,fields:lightIds,save:false});}
        if(settingIds.length){settingsAttempted=true;await this.writeSettings(targetSettings,{base:beforeSettings,fields:settingIds,save:false});}
        if(resume)this.stripResume=resume;
        else if(this.firmwareProfile===CU_PROFILE&&this.lighting&&!isLightingOff(this.lighting.effect,CU_PROFILE)&&this.settings&&[0,1,3,4].includes(this.settings.stripMode))this.rememberStrip(this.lighting.effect,this.settings.stripMode);
        return {lighting:this.lighting?{...this.lighting}:null,settings:this.settings?{...this.settings}:null,stripResume:{...this.stripResume},channels:[...(lightIds.length?[3]:[]),...(settingIds.length?[0]:[])]};
      }catch(error){
        let restored=true;
        if(settingsAttempted)try{await this.writeSettings(beforeSettings,{fields:settingIds,save:false});}catch{restored=false;}
        if(lightAttempted)try{await this.writeLighting(beforeLight,{fields:lightIds,save:false});}catch{restored=false;}
        const healthy=await this.responsive();
        if(healthy){if(light)try{this.lighting=await this.readLighting();}catch{}if(settings)try{this.settings=await this.readSettings();}catch{}}
        const result=Error(`${error.message}。${restored?'本次修改已撤回。':'恢复未能全部完成，请重新读取设备设置。'}`);
        result.connectionLost=!healthy;result.actualLighting=this.lighting;result.actualSettings=this.settings;
        if(!healthy)this.baseline=null;throw result;
      }finally{this.busy=false;}
    }
    async saveLive(channels) {
      if(this.busy)throw Error('请等待当前操作完成');this.busy=true;
      try{for(const channel of channels){if(channel!==3&&channel!==0)throw Error('无效保存通道');await this.command(9,channel);}}
      catch(error){const failure=Error(`设置已实时生效，但自动保存失败：${error.message}`);failure.connectionLost=!await this.responsive();throw failure;}
      finally{this.busy=false;}
    }
    async apply(layers,light,backup,progress=()=>{},settings=null) {
      if(this.busy)throw Error('请等待当前操作完成');
      const changes=this.plan(layers,light,settings);this.busy=true;
      const completed=[],oldLight=this.lighting?{...this.lighting}:null,oldSettings=this.settings?{...this.settings}:null;let lightAttempted=false,settingsAttempted=false;
      try {
        // Persist a recoverable snapshot BEFORE sending any state-changing command.
        await backup({name:'NUT65 CU',vendorProductId:VPID,layers:this.baseline.map(l=>l.map(v=>`0x${v.toString(16).padStart(4,'0')}`)),lighting:oldLight,deviceSettings:oldSettings,nutStudio:{format:2,firmwareProfile:this.firmwareProfile,protocol:this.protocol,keycodeMode:this.mode,savedAt:new Date().toISOString()}});
        for(const k of changes){
          if(await this.getKey(k.layer,k.row,k.col)!==k.before)throw Error('键位已被其他程序修改，请重新读取键盘后再应用');
        }
        if(light&&JSON.stringify(await this.readLighting())!==JSON.stringify(oldLight))throw Error('灯光已被其他程序修改，请重新读取键盘后再应用');
        if(settings&&JSON.stringify(await this.readSettings())!==JSON.stringify(oldSettings))throw Error('设备功能已被其他程序修改，请重新读取键盘后再应用');
        const total=changes.length+(light?1:0)+(settings?1:0);let done=0;
        for(const k of changes){completed.push(k);await this.writeKey(k,k.after);progress(++done/total);}
        if(light){lightAttempted=true;await this.writeLighting(light);}
        if(light)progress(++done/total);
        if(settings){settingsAttempted=true;await this.writeSettings(settings);progress(++done/total);}
        changes.forEach(k=>{this.baseline[k.layer][k.index]=k.after;});
        return {keys:changes.length,lighting:!!light,settings:!!settings};
      } catch(e) {
        let rollbackFailed=false;
        if(settingsAttempted&&oldSettings)try{await this.writeSettings(oldSettings,{fields:settingDefinitions.filter(d=>settings[d.name]!==oldSettings[d.name]).map(d=>d.id)});}catch{rollbackFailed=true;}
        if(lightAttempted&&oldLight)try{await this.writeLighting(oldLight,{fields:lightingDelta(oldLight,light)});}catch{rollbackFailed=true;}
        for(const k of completed.reverse())try{await this.writeKey(k,k.before);}catch{rollbackFailed=true;}
        if(rollbackFailed){this.baseline=null;throw Error(`${e.message}。恢复未能全部完成，请重新连接后导入自动备份。`);}
        throw Error(`${e.message}。已恢复本次操作前的设置。`);
      }finally{this.busy=false;}
    }
  }
  class LiveSettingsSync {
    // Browser timers require the Window receiver, even when called via clock.
    constructor(device,backup,{onState=()=>{},onApplied=()=>{},onError=()=>{},delay=80,saveDelay=1000,clock={set:(fn,ms)=>globalThis.setTimeout(fn,ms),clear:id=>globalThis.clearTimeout(id)}}={}) {
      this.device=device;this.backup=backup;this.onState=onState;this.onApplied=onApplied;this.onError=onError;this.delay=delay;this.saveDelay=saveDelay;this.clock=clock;
      this.light={};this.settings={};this.jobs=[];this.channels=new Set();this.timer=null;this.saveTimer=null;this.running=null;this.backedUp=false;this.closed=false;this.error=null;this.status='saved';
    }
    get pendingLight(){return Object.keys(this.light).length>0||this.jobs.some(j=>j.toggle||!!j.light);}
    get pendingSettings(){return Object.keys(this.settings).length>0||this.jobs.some(j=>j.toggle||!!j.settings);}
    get pending(){return this.pendingLight||this.pendingSettings;}
    statusChanged(status){this.status=status;this.onState(status);}
    clearTimers(){if(this.timer!==null)this.clock.clear(this.timer);if(this.saveTimer!==null)this.clock.clear(this.saveTimer);this.timer=this.saveTimer=null;}
    request(light=null,settings=null) {
      if(this.closed)throw Error('实时连接已关闭，请重新连接');this.device.validateLive(light,settings);
      Object.assign(this.light,light||{});Object.assign(this.settings,settings||{});this.error=null;
      if(this.saveTimer!==null){this.clock.clear(this.saveTimer);this.saveTimer=null;}this.statusChanged('queued');
      // Throttle from the first input: continuous dragging must still update
      // the keyboard, instead of waiting until the pointer stops moving.
      if(this.timer===null&&!this.running)this.timer=this.clock.set(()=>{this.timer=null;this.drain().catch(()=>{});},this.delay);
    }
    requestToggle(){
      if(this.closed)throw Error('实时连接已关闭，请重新连接');
      if(this.device.firmwareProfile!==CU_PROFILE||!this.device.settings||!this.device.lighting)throw Error('前灯带开关需要 CU 固件');
      if(this.jobs.length>=64)throw Error('前灯带切换操作过快，请稍后重试');
      // A toggle is an ordering barrier: edits before and after it stay ordered.
      if(Object.keys(this.light).length||Object.keys(this.settings).length){this.jobs.push({light:Object.keys(this.light).length?this.light:null,settings:Object.keys(this.settings).length?this.settings:null});this.light={};this.settings={};}
      this.jobs.push({toggle:true});this.request();
    }
    async drain(save=false) {
      if(this.closed)return;
      if(this.timer!==null){this.clock.clear(this.timer);this.timer=null;}
      if(this.running){await this.running;return this.drain(save);}
      if(this.error&&!this.pending)throw this.error;
      const work=(async()=>{
        while(this.pending&&!this.closed){
          let job;
          if(this.jobs.length)job=this.jobs.shift();
          else{job={light:Object.keys(this.light).length?{...this.light}:null,settings:Object.keys(this.settings).length?{...this.settings}:null};this.light={};this.settings={};}
          this.statusChanged('applying');
          const persist=async snapshot=>{if(!this.backedUp){await this.backup(snapshot);this.backedUp=true;}};
          const result=job.toggle?await this.device.toggleStrip(persist):await this.device.updateLive(job.light,job.settings,persist);
          result.channels.forEach(c=>this.channels.add(c));
          if(!this.closed)this.onApplied(result,{pendingLight:this.pendingLight,pendingSettings:this.pendingSettings});
        }
        if(save&&this.channels.size&&!this.closed){
          const channels=[...this.channels];this.statusChanged('saving');await this.device.saveLive(channels);channels.forEach(c=>this.channels.delete(c));
        }
      })();
      this.running=work;
      try{await work;}
      catch(error){this.error=error;this.light={};this.settings={};this.jobs=[];this.clearTimers();this.statusChanged('error');this.onError(error);throw error;}
      finally{this.running=null;}
      if(this.closed)return;
      if(this.pending)return this.drain(save);
      if(save&&this.channels.size)return this.drain(true);
      if(this.channels.size){this.statusChanged('applied');if(this.saveTimer!==null)this.clock.clear(this.saveTimer);this.saveTimer=this.clock.set(()=>{this.saveTimer=null;this.drain(true).catch(()=>{});},this.saveDelay);}
      else this.statusChanged('saved');
    }
    async flush(){this.clearTimers();await this.drain(true);}
    cancel(){this.closed=true;this.clearTimers();this.light={};this.settings={};this.jobs=[];}
    async close({save=true}={}){try{if(save)await this.flush();else if(this.running)await this.running;}finally{this.cancel();}}
  }
  return {VID,PID,VPID,ROWS,COLS,CU_PROFILE,FACTORY_PROFILE,CU_SHORTCUT_OFF,catalog,encode,decode,label,layout,effects,cuEffects,getEffects,isLightingOff,settingDefinitions,validateSettings,stripFrame,validateProfile,describeHidReports,normalizeHidInput,ViaDevice,LiveSettingsSync};
});
