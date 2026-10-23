// Model the browser timer receiver check; Node's native timers do not enforce it.
// This checks scheduling semantics, not browser rendering or physical USB access.
const vm=require('node:vm');

function browserContext(globals={}) {
  const context=vm.createContext(globals);
  vm.runInContext(`(() => {
    const window=globalThis,tasks=new Map();let nextId=0,now=0;
    function checkReceiver(receiver){if(receiver!==undefined&&receiver!==window)throw new TypeError('Illegal invocation');}
    globalThis.setTimeout=function setTimeout(fn,ms){'use strict';checkReceiver(this);const id=++nextId;tasks.set(id,{fn,at:now+Number(ms||0)});return id;};
    globalThis.clearTimeout=function clearTimeout(id){'use strict';checkReceiver(this);tasks.delete(id);};
    globalThis.testTimers={
      get size(){return tasks.size;},
      advance(ms){
        const until=now+ms;
        for(;;){
          const next=[...tasks].filter(([,task])=>task.at<=until).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
          if(!next)break;
          const [id,task]=next;tasks.delete(id);now=task.at;task.fn();
        }
        now=until;
      }
    };
  })()`,context,{filename:'browser-timer-model.js'});
  return {context,timers:context.testTimers};
}
module.exports={browserContext};
