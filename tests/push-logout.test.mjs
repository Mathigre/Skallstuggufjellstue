import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../admin/push.js',import.meta.url),'utf8');
let unsubscribe=0,permissionPrompts=0,actions=[];
const subscription={endpoint:'https://push.example/test',toJSON:()=>({endpoint:'https://push.example/test'}),unsubscribe:async()=>{unsubscribe++;return true;}};
function element(){return {hidden:false,disabled:false,textContent:'',setAttribute(){},addEventListener(){}};}
const elements={'#pushStatus':element(),'#pushEnable':element(),'#pushDisable':element()};
const context={CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},window:{dispatchEvent(){},adminReady:Promise.resolve({id:'admin'}),adminHeaders:async()=>({}),PushManager:{},Notification:{}},document:{createElement:()=>({...element(),querySelector:s=>elements[s]}),querySelector:()=>({after(){}}),body:{prepend(){}}},navigator:{userAgent:'test',platform:'test',serviceWorker:{register:async()=>({pushManager:{getSubscription:async()=>subscription}}),ready:Promise.resolve()}},Notification:{permission:'granted',requestPermission:async()=>{permissionPrompts++;return 'granted';}},matchMedia:()=>({matches:false}),AbortSignal,fetch:async(_,options)=>{const b=JSON.parse(options.body);actions.push(b.action);return {ok:true,json:async()=>({publicKey:'test'})};}};
await vm.runInNewContext(source,context);
assert.deepEqual(actions,['config','subscribe']);
await context.window.disableAdminPush({preserveSubscription:true});
assert.equal(unsubscribe,0);assert.equal(actions.at(-1),'unsubscribe');
await vm.runInNewContext(source,context);
assert.equal(actions.at(-1),'subscribe');assert.equal(permissionPrompts,0);
await context.window.disableAdminPush();
assert.equal(unsubscribe,1);
console.log('PASS: logout pauses server delivery, next login restores without permission prompt, explicit disable unsubscribes browser.');

