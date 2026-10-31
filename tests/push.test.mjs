import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const validation=stripTypeScriptTypes(await readFile(new URL('supabase/functions/matrica-push/validation.ts',root),'utf8')).replaceAll('export ','');
const validator=vm.createContext({URL,Intl,Uint8Array,atob});
vm.runInContext(validation,validator);
const validSubscription=vm.runInContext('validSubscription',validator);
const validTimeZone=vm.runInContext('validTimeZone',validator);
const keys={p256dh:Buffer.concat([Buffer.from([4]),Buffer.alloc(64)]).toString('base64url'),auth:Buffer.alloc(16).toString('base64url')};

test('only HTTPS subscriptions on real push providers are accepted',()=>{
  for(const endpoint of ['https://web.push.apple.com/test','https://fcm.googleapis.com/fcm/send/test','https://updates.push.services.mozilla.com/wpush/v2/test'])assert.equal(validSubscription({endpoint,keys}),true);
  for(const endpoint of ['http://web.push.apple.com/test','https://127.0.0.1/test','https://web.push.apple.com.evil.test/','https://web.push.apple.com:444/test','https://user:pass@web.push.apple.com/test'])assert.equal(validSubscription({endpoint,keys}),false);
  assert.equal(validSubscription({endpoint:'https://web.push.apple.com/test',keys:{p256dh:'bad',auth:'bad'}}),false);
});
test('invalid or missing time zones are rejected',()=>{
  assert.equal(validTimeZone('Europe/Moscow'),true);
  assert.equal(validTimeZone('UTC'),true);
  assert.equal(validTimeZone('invalid-zone'),false);
  assert.equal(validTimeZone(null),false);
});

async function workerHarness(){
  const handlers={},shown=[],messages=[];
  let focused=false,opened=null;
  const self={
    addEventListener:(name,handler)=>handlers[name]=handler,
    skipWaiting:async()=>{},
    registration:{scope:'https://example.test/matrica/',showNotification:async(title,options)=>shown.push({title,options})},
    clients:{claim:async()=>{},matchAll:async()=>[{url:'https://example.test/matrica/index.html',focus:async()=>{focused=true;},postMessage:data=>messages.push(data)}],openWindow:async url=>opened=url},
  };
  vm.runInNewContext(await readFile(new URL('sw.js',root),'utf8'),{self,URL});
  return {handlers,shown,messages,get focused(){return focused;},get opened(){return opened;},self};
}
test('push displays the task title, safe icon and task id',async()=>{
  const w=await workerHarness();let pending;
  w.handlers.push({data:{json:()=>({title:'Матрица',body:'Помыть машину',data:{taskId:'task'},tag:'task-tag'})},waitUntil:p=>pending=p});
  await pending;
  assert.equal(w.shown[0].options.body,'Помыть машину');
  assert.equal(w.shown[0].options.data.taskId,'task');
  assert.equal(w.shown[0].options.icon,'https://example.test/matrica/icons/icon-192.png');
});
test('malformed payload still displays a generic notification',async()=>{
  const w=await workerHarness();let pending;
  w.handlers.push({data:{json:()=>{throw Error('invalid payload');}},waitUntil:p=>pending=p});
  await pending;
  assert.equal(w.shown[0].title,'Матрица');
});
test('notification click focuses app and routes the task',async()=>{
  const w=await workerHarness();let pending,closed=false;
  w.handlers.notificationclick({notification:{data:{taskId:'task'},close:()=>closed=true},waitUntil:p=>pending=p});
  await pending;
  assert.equal(closed,true);assert.equal(w.focused,true);
  assert.equal(w.messages[0].taskId,'task');
});
test('notification click opens the scoped app when it is closed',async()=>{
  const w=await workerHarness();w.self.clients.matchAll=async()=>[];let pending;
  w.handlers.notificationclick({notification:{data:{taskId:'task'},close(){}},waitUntil:p=>pending=p});
  await pending;
  assert.equal(w.opened,'https://example.test/matrica/index.html?task=task');
});
