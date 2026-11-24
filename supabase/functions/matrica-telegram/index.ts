import {createClient} from 'npm:@supabase/supabase-js@2.49.8';
import {timingSafeEqual} from 'node:crypto';
import './task-core.js';
import {createBot,privateActor,taskButtons,HELP} from './bot.mjs';

const Core=(globalThis as any).MatricaCore;
const url=Deno.env.get('SUPABASE_URL')!;
const service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const checked=async(p:any)=>{const r=await p;if(r.error)throw new Error('Database operation failed');return r.data;};
const secretEqual=(a:string,b:string)=>{const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);return !!b&&x.length===y.length&&timingSafeEqual(x,y);};
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const random=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
const allowed=new Set(['https://antonantonov1371-ctrl.github.io','http://127.0.0.1:4173','http://127.0.0.1:4174','http://localhost:4173']);
async function telegram(token:string,method:string,body:any){
 const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
 const result=await response.json();
 if(!response.ok||!result.ok){const error:any=new Error('Telegram request failed');error.code=result.error_code||response.status;error.retryAfter=result.parameters?.retry_after;throw error;}
 return result.result;
}
const repo={
 tasks:async(owner:string)=>{
   const rows=[];for(let start=0;;start+=500){
     const page=await checked(service.from('tasks').select('*').eq('user_id',owner).order('id').range(start,start+499));
     rows.push(...page);if(page.length<500)return rows;
   }
 },
 task:(owner:string,id:string)=>checked(service.from('tasks').select('*').eq('user_id',owner).eq('id',id).maybeSingle()),
 link:(chat:number,user:number)=>checked(service.from('telegram_links').select('*').eq('chat_id',chat).eq('telegram_user_id',user).eq('enabled',true).maybeSingle()),
 zone:async(owner:string)=>(await checked(service.from('notification_preferences').select('time_zone').eq('user_id',owner).maybeSingle()))?.time_zone||'Europe/Moscow',
 consume:async(token:string,chat:number,user:number)=>checked(service.rpc('telegram_consume_link',{code_hash:await hash(token),chat,telegram_user:user,zone:'Europe/Moscow'})),
 claim:(update:number,chat:number)=>checked(service.rpc('telegram_claim_update',{update_number:update,chat})),
 finish:(update:number)=>checked(service.from('telegram_updates').update({finished:true}).eq('update_id',update)),
 release:(update:number)=>checked(service.from('telegram_updates').update({lease_until:new Date(0).toISOString()}).eq('update_id',update)),
 prompt:(owner:string,prompt:any)=>checked(service.from('telegram_links').update({prompt}).eq('user_id',owner)),
 create:(row:any)=>checked(service.from('tasks').upsert(row,{onConflict:'id',ignoreDuplicates:true})),
 edit:(owner:string,task:string,version:string,patch:any,next_task:any,operation:number)=>checked(service.rpc('telegram_edit_task',{owner,task,version,patch,next_task,operation})),
 disconnect:async(owner:string)=>{
   await checked(service.from('telegram_links').delete().eq('user_id',owner));
   await checked(service.from('telegram_link_codes').delete().eq('user_id',owner));
   await checked(service.from('telegram_reminders').delete().eq('user_id',owner));
 }
};
async function dispatch(token:string){
 await checked(service.from('telegram_settings').update({last_dispatch_at:new Date().toISOString()}).eq('singleton',true));
 await checked(service.from('telegram_updates').delete().lt('created_at',new Date(Date.now()-7*86400000).toISOString()).eq('finished',true));
 await checked(service.from('telegram_link_codes').delete().lt('expires_at',new Date().toISOString()));
 if(!token)return {claimed:0};
 const jobs=await checked(service.rpc('telegram_claim_reminders'));
 for(const job of jobs){
   let delivered=false,messageId=null,retryAfter=60;
   try{
     const row=await repo.task(job.user_id,job.task_id),link=await checked(service.from('telegram_links').select('*').eq('user_id',job.user_id).eq('enabled',true).maybeSingle());
     const task=row&&Core.decode(row);
     if(!task||task.done||task.deletedAt||task.isFolder||!link||row.task_date!==job.source_date||row.task_time!==job.source_time){delivered=true;continue;}
     const message=await telegram(token,'sendMessage',{chat_id:link.chat_id,text:'⏰ Матрица · Напоминание\n\n'+task.title+'\n'+task.date+' '+task.time,reply_markup:taskButtons(task.id)});
     delivered=true;messageId=message.message_id;
   }catch(error:any){
     retryAfter=Math.max(60,Math.min(86400,Number(error.retryAfter)||60));
     if(error.code===403){await checked(service.from('telegram_links').update({enabled:false}).eq('user_id',job.user_id));delivered=true;}
     console.error('Telegram reminder failed',Number(error.code)||'network');
   }finally{
     // A changed deadline/finished task removes or invalidates this lease: never acknowledge the replacement.
     await checked(service.from('telegram_reminders').update({delivered_at:delivered?new Date().toISOString():null,message_id:messageId,lease_token:null,lease_until:delivered?null:new Date(Date.now()+retryAfter*1000).toISOString()}).eq('task_id',job.task_id).eq('lease_token',job.lease_token));
   }
 }
 return {claimed:jobs.length};
}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('Origin');
 const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
 if(origin&&allowed.has(origin))headers['Access-Control-Allow-Origin']=origin;
 const respond=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!allowed.has(origin))return respond({error:'Origin not allowed'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return respond({error:'Method not allowed'},405);
 const action=new URL(req.url).searchParams.get('action');
 try{
   const credentials=await checked(service.rpc('telegram_credentials'));
   if(action==='dispatch'){
     if(!secretEqual(req.headers.get('Authorization')?.replace(/^Bearer /i,'')||'',credentials.scheduler||''))return respond({error:'Unauthorized'},401);
     return respond(await dispatch(credentials.token));
   }
   if(action==='webhook'){
     if(!credentials.token||!secretEqual(req.headers.get('X-Telegram-Bot-Api-Secret-Token')||'',credentials.webhook||''))return respond({error:'Unauthorized'},401);
     // Read at most 64 KiB, even when Content-Length is omitted.
     const reader=req.body?.getReader();let size=0,parts:Uint8Array[]=[];
     if(reader){for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();return respond({error:'Too large'},413);}parts.push(value);}}
     const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
     const update=JSON.parse(new TextDecoder().decode(bytes));
     if(!privateActor(update))return respond({ok:true});
     await createBot({repo,Core,call:(m:string,b:any)=>telegram(credentials.token,m,b)}).process(update);
     return respond({ok:true});
   }
   const bearer=req.headers.get('Authorization')?.replace(/^Bearer /i,'')||'';
   const {data:{user},error}=await service.auth.getUser(bearer);
   if(error||!user)return respond({error:'Войдите в аккаунт «Матрицы»'},401);
   const settings=await checked(service.from('telegram_settings').select('*').eq('singleton',true).maybeSingle());
   if(action==='status'){
     const link=await checked(service.from('telegram_links').select('enabled').eq('user_id',user.id).maybeSingle());
     const pending=await service.from('telegram_reminders').select('task_id',{count:'exact',head:true}).eq('user_id',user.id).is('delivered_at',null);
     if(pending.error)throw new Error('Database error');
     return respond({ready:!!credentials.token,username:settings?.bot_username||null,connected:!!link?.enabled,canConfigure:settings?.owner_id===user.id,timeZone:await repo.zone(user.id),upcoming:pending.count||0,schedulerActive:!!settings?.last_dispatch_at&&Date.now()-Date.parse(settings.last_dispatch_at)<180000});
   }
   const raw=await req.text();if(raw.length>12000)return respond({error:'Слишком большой запрос'},413);
   const body=JSON.parse(raw||'{}');
   if(action==='configure'){
     if(settings?.owner_id!==user.id)return respond({error:'Только владелец проекта может настроить бота'},403);
     if(!/^\d{5,20}:[\w-]{25,100}$/.test(body.token||''))return respond({error:'Проверьте токен, полученный от BotFather'},400);
     const me=await telegram(body.token,'getMe',{});
     if(!me.is_bot||!/^\w{5,32}$/.test(me.username||''))return respond({error:'Не удалось проверить бота'},400);
     if(settings.bot_username&&settings.bot_username!==me.username)return respond({error:'Этот проект уже связан с другим ботом. Сначала обратитесь к владельцу проекта.'},409);
     const webhook=credentials.webhook||random();
     await telegram(body.token,'setWebhook',{url:url+'/functions/v1/matrica-telegram?action=webhook',secret_token:webhook,allowed_updates:['message','callback_query'],max_connections:1,drop_pending_updates:false});
     await checked(service.rpc('telegram_store_credentials',{bot_token:body.token,webhook_secret:webhook,username:me.username}));
     await telegram(body.token,'setMyCommands',{commands:[{command:'start',description:'Меню «Матрицы»'},{command:'today',description:'Задачи на сегодня'},{command:'week',description:'Ближайшие 7 дней'},{command:'inbox',description:'Входящие'},{command:'matrix',description:'Четыре квадранта'},{command:'lists',description:'Мои списки'},{command:'search',description:'Поиск задач'},{command:'overdue',description:'Хвосты'},{command:'archive',description:'Выполненные задачи'},{command:'help',description:'Помощь'},{command:'cancel',description:'Отменить ввод'},{command:'disconnect',description:'Отключить Telegram'}]});
     return respond({ready:true,username:me.username});
   }
   if(action==='link'){
     if(!credentials.token||!settings?.bot_username)return respond({error:'Сначала настройте бота'},409);
     const zone=String(body.timeZone||'Europe/Moscow');try{new Intl.DateTimeFormat('en',{timeZone:zone}).format();}catch{return respond({error:'Неверный часовой пояс'},400);}
     const token=random();await checked(service.from('telegram_link_codes').upsert({user_id:user.id,token_hash:await hash(token),time_zone:zone,expires_at:new Date(Date.now()+600000).toISOString()}));
     return respond({url:'https://t.me/'+settings.bot_username+'?start='+token});
   }
   if(action==='disconnect'){await repo.disconnect(user.id);return respond({connected:false});}
   if(action==='test'){
     const link=await checked(service.from('telegram_links').update({last_test_at:new Date().toISOString()}).eq('user_id',user.id).eq('enabled',true).or('last_test_at.is.null,last_test_at.lt.'+new Date(Date.now()-30000).toISOString()).select('chat_id').maybeSingle());
     if(!link)return respond({error:'Подключите Telegram или подождите 30 секунд перед повторной проверкой'},429);
     await telegram(credentials.token,'sendMessage',{chat_id:link.chat_id,text:'Матрица · Проверка напоминаний\n\nTelegram подключён. Здесь будут приходить напоминания о ваших задачах.'});return respond({sent:true});
   }
   return respond({error:'Unknown action'},404);
 }catch(error){console.error('Telegram operation failed');return respond({error:'Не удалось выполнить действие Telegram. Попробуйте ещё раз.'},503);}
});
