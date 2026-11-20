const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../sw.js'),'utf8');
function worker(){
 const handlers={},stores=new Map(),calls=[];let failInstall=false;
 const scope='https://example.test/matrica/';
 const caches={async open(key){if(!stores.has(key))stores.set(key,new Map());const store=stores.get(key);return {async addAll(requests){if(failInstall)throw Error('interrupted');for(const request of requests)store.set(request.url,new Response(request.url))},async match(request){return store.get(String(request))}}},async keys(){return [...stores.keys()]},async delete(key){return stores.delete(key)}};
 const ctx={URL,Request,Response,caches,fetch:async request=>{calls.push(String(request));throw Error('offline')},self:{registration:{scope},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>calls.push('activate'),clients:{claim:async()=>{}}}};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 return {handlers,stores,calls,set fail(value){failInstall=value},async event(name){let promise;handlers[name]({waitUntil:p=>promise=p});await promise},async fetch(url,mode='navigate',method='GET'){let result;handlers.fetch({request:{url,mode,method},respondWith:p=>result=p});return result}};
}
test('installed shell and all local dependencies load with the network disconnected',async()=>{
 const w=worker();await w.event('install');
 for(const [url,mode] of [['index.html?task=a','navigate'],['workflow.js?v=20261120-app','cors'],['offline.js?v=20261120-offline2','cors'],['vendor/supabase-2.49.8.js','cors']])assert.equal((await w.fetch('https://example.test/matrica/'+url,mode)).status,200);
 assert.deepEqual(w.calls,['activate']);
});
test('worker never intercepts account API requests or POST requests',async()=>{
 const w=worker();await w.event('install');
 assert.equal(await w.fetch('https://project.supabase.co/rest/v1/tasks','cors'),undefined);
 assert.equal(await w.fetch('https://example.test/matrica/index.html','cors','POST'),undefined);
 assert.equal(await w.fetch('https://example.test/matrica/private.json','cors'),undefined);
});
test('incomplete application download does not activate a new worker or remove old release',async()=>{
 const w=worker();w.stores.set('matrica-shell-old',new Map());w.fail=true;
 await assert.rejects(w.event('install'),/interrupted/);assert.ok(w.stores.has('matrica-shell-old'));assert.deepEqual(w.calls,[]);
});
test('activation removes only older Matrica shell caches',async()=>{
 const w=worker();w.stores.set('matrica-shell-old',new Map());w.stores.set('other-app',new Map());await w.event('install');await w.event('activate');assert.equal(w.stores.has('matrica-shell-old'),false);assert.ok(w.stores.has('other-app'));
});
