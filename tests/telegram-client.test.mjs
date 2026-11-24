import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../telegram-client.js',import.meta.url),'utf8');
function harness(){
 let section=null;const input={value:''},requests=[];
 const root={innerHTML:'',querySelector:()=>({}),insertBefore(node){section=node;},appendChild(node){section=node;}};
 const createSection=()=>({innerHTML:'',style:{},setAttribute(){},remove(){section=null;}});
 const ctx={Intl,JSON,Error,console,cloudUser:{id:'owner'},CLOUD_URL:'https://example.supabase.co',CLOUD_KEY:'public-key',
   db:{auth:{getSession:async()=>({data:{session:{access_token:'user-token'}}})}},
   esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
   toast(){},renderTaskPushSettings(){root.innerHTML='Browser push controls';},initTaskPush:async()=>{},taskPushSignedOut(){},
   localStorage:{setItem(){throw new Error('Credentials must not enter browser storage');}},
   document:{activeElement:null,getElementById:id=>id==='telegram-bot-token'?input:null,querySelector:s=>s==='[data-push-settings]'?root:s==='[data-telegram-settings]'?section:null,createElement:()=>createSection()},
   fetch:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>url.endsWith('action=link')?{url:'https://t.me/MatricaTestBot?start='+'a'.repeat(64)}:{ready:true,connected:false,canConfigure:true}};}
 };
 vm.createContext(ctx);vm.runInContext(source,ctx);
 return {ctx,input,requests,root,get section(){return section;},run:s=>vm.runInContext(s,ctx)};
}
test('Telegram settings coexist with existing push controls and escape server errors',()=>{
 const h=harness();h.run('renderTaskPushSettings();telegramState.checked=true;telegramState.error="<script>alert(1)</script>";renderTelegramSettings()');
 assert.equal(h.root.innerHTML,'Browser push controls');assert.match(h.section.innerHTML,/Telegram/);assert.ok(!h.section.innerHTML.includes('<script>'));assert.match(h.section.innerHTML,/&lt;script>/);
});
test('account linking shows a single expiring link without opening popups automatically',async()=>{
 const h=harness();h.run('renderTaskPushSettings()');await h.run('telegramAction("link")');
 assert.match(h.section.innerHTML,/https:\/\/t.me\/MatricaTestBot\?start=/);assert.match(h.section.innerHTML,/10 минут/);assert.equal(h.requests.length,1);
});
test('bot token is cleared from the input before transmission and never stored locally',async()=>{
 const h=harness();h.run('renderTaskPushSettings()');h.input.value='123456:private-test-token';await h.run('configureTelegramBot()');
 assert.equal(h.input.value,'');assert.equal(h.requests[0].body.token,'123456:private-test-token');assert.equal(h.run('JSON.stringify(telegramState)').includes('private-test-token'),false);
});
test('sign out immediately clears token and account-link state',()=>{
 const h=harness();h.input.value='secret';h.run('telegramState.link="private-link";taskPushSignedOut()');assert.equal(h.input.value,'');assert.equal(h.run('telegramState.link'),null);
});
test('late account-link response is discarded after account switching',async()=>{
 const h=harness();let respond,started;const fetching=new Promise(resolve=>started=resolve);h.ctx.fetch=async()=>new Promise(resolve=>{respond=resolve;started();});const pending=h.run('telegramAction("link")');
 await fetching;h.ctx.cloudUser={id:'other'};respond({ok:true,json:async()=>({url:'https://t.me/MatricaTestBot?start='+'a'.repeat(64)})});await pending;
 assert.equal(h.run('telegramState.link'),null);
});
