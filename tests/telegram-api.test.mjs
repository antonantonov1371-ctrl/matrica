import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {timingSafeEqual,webcrypto} from 'node:crypto';
import vm from 'node:vm';
import Core from '../task-core.js';
import {privateActor} from '../supabase/functions/matrica-telegram/bot.mjs';
const source=stripTypeScriptTypes(await readFile(new URL('../supabase/functions/matrica-telegram/index.ts',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
function harness({user=null}={}){
 let handler;const queries=[],credentials={token:'test-token',webhook:'webhook-secret',scheduler:'scheduler-secret'};
 const service={auth:{getUser:async()=>({data:{user},error:user?null:'auth'})},rpc:async name=>({data:name==='telegram_credentials'?credentials:null}),from(table){
   const filters=[],q={select(){return q},eq(key,value){filters.push([key,value]);return q},is(){return q},maybeSingle:async()=>({data:table==='telegram_settings'?{owner_id:'owner',bot_username:'MatricaTestBot',last_dispatch_at:new Date().toISOString()}:null}),then(resolve){queries.push({table,filters});resolve({data:[],count:0});}};return q;
 }};
 const context={URL,Request,Response,TextEncoder,TextDecoder,Uint8Array,Date,Intl,Number,JSON,Set,AbortSignal,console:{error(){}},crypto:webcrypto,timingSafeEqual,createClient:()=>service,privateActor,createBot:()=>{throw new Error('Unauthorized bot action');},taskButtons(){},HELP:'help',fetch:async()=>{throw new Error('Unexpected Telegram call');},Deno:{env:{get:name=>name==='SUPABASE_URL'?'https://example.supabase.co':'key'},serve:fn=>handler=fn}};
 vm.createContext(context);context.MatricaCore=Core;vm.runInContext(source,context);
 const request=(action,{headers={},body={}}={})=>handler(new Request('https://example.supabase.co/functions/v1/matrica-telegram?action='+action,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)}));
 return {request,queries};
}
test('anonymous requests cannot read status or generate link codes',async()=>{
 const h=harness();for(const action of ['status','link','configure','test','disconnect'])assert.equal((await h.request(action)).status,401);
});
test('webhook requires its own secret, not a user JWT or scheduler secret',async()=>{
 const h=harness({user:{id:'owner'}});for(const headers of [{},{Authorization:'Bearer scheduler-secret'},{'X-Telegram-Bot-Api-Secret-Token':'wrong'}])assert.equal((await h.request('webhook',{headers})).status,401);
 assert.equal((await h.request('webhook',{headers:{'X-Telegram-Bot-Api-Secret-Token':'webhook-secret'},body:{update_id:1,message:{chat:{id:-123,type:'group'},from:{id:123}}}})).status,200);
});
test('cron cannot be invoked using a browser account token',async()=>{
 const h=harness({user:{id:'owner'}});assert.equal((await h.request('dispatch',{headers:{Authorization:'Bearer user-jwt'}})).status,401);
});
test('only the preassigned project owner can configure the bot',async()=>{
 const h=harness({user:{id:'other-account'}});assert.equal((await h.request('configure',{body:{token:'123456:abcdefghijklmnopqrstuvwxyz123456'}})).status,403);
});
test('status never exposes bot secrets or another account identity',async()=>{
 const h=harness({user:{id:'other-account'}}),response=await h.request('status'),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.canConfigure,false);assert.equal(body.connected,false);
 const text=JSON.stringify(body);for(const secret of ['test-token','webhook-secret','scheduler-secret','owner_id'])assert.equal(text.includes(secret),false);
 assert.ok(h.queries.some(q=>q.table==='telegram_reminders'&&q.filters.some(([k,v])=>k==='user_id'&&v==='other-account')));
});
test('foreign browser origins cannot call any operation',async()=>{
 const h=harness({user:{id:'owner'}});assert.equal((await h.request('status',{headers:{Origin:'https://attacker.example'}})).status,403);
});
