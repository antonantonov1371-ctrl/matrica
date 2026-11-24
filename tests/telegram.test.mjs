import test from 'node:test';
import assert from 'node:assert/strict';
import Core from '../task-core.js';
import {createBot,privateActor,parseSchedule,zoned,taskButtons,menu} from '../supabase/functions/matrica-telegram/bot.mjs';
const owner='account-a',other='account-b',id='2e194f6d-21da-4542-a22c-77dc71c31cd5',folder='4e194f6d-21da-4542-a22c-77dc71c31cd5';
const instant=new Date('2026-11-24T20:55:00Z');
const task=(extra={})=>({id,title:'Тестовая задача',note:'Описание',date:'2026-11-24',time:'23:55',cat:0,done:false,folderId:'',tags:['работа'],subtasks:[{id:'s',title:'Пункт',done:false}],_meta:{matrica:2,unknown:'сохранить'},...extra});
function harness(initial=[task()]){
 const rows=new Map(initial.map(t=>[t.id,{...Core.encode(t,t.owner||owner),updated_at:'v1'}])),sent=[],effects=new Set(),updates=new Map();
 let prompt=null,linked=true,failSend=false,editConflict=false;
 const repo={
   tasks:async user=>[...rows.values()].filter(t=>t.user_id===user),
   task:async(user,key)=>rows.get(key)?.user_id===user?structuredClone(rows.get(key)):null,
   link:async()=>linked?{user_id:owner,prompt}:null,zone:async()=> 'Europe/Moscow',
   consume:async()=>{linked=true;return owner;},
   claim:async n=>updates.get(n)|| (updates.set(n,'busy'),'claimed'),
   finish:async n=>updates.set(n,'finished'),release:async n=>updates.delete(n),
   prompt:async(user,value)=>{prompt=value;},
   create:async row=>{if(!rows.has(row.id))rows.set(row.id,{...row,updated_at:'v1'});},
   edit:async(user,key,version,patch,next,operation)=>{
     if(effects.has(operation))return true;if(editConflict)return false;
     const row=rows.get(key);if(row?.user_id!==user||row.updated_at!==version)return false;
     rows.set(key,{...row,...patch,updated_at:'v'+operation});effects.add(operation);
     if(next&&!rows.has(next.id))rows.set(next.id,{...next,updated_at:'v1'});return true;
   },disconnect:async()=>{linked=false;}
 };
 const bot=createBot({repo,Core,now:()=>instant,call:async(method,body)=>{if(failSend&&method==='sendMessage'){failSend=false;throw new Error('network');}sent.push({method,...body});return {message_id:1};}});
 const message=(n,text)=>({update_id:n,message:{chat:{id:123,type:'private'},from:{id:123},text}});
 const callback=(n,data)=>({update_id:n,callback_query:{id:'cb'+n,from:{id:123},data,message:{chat:{id:123,type:'private'}}}});
 return {bot,rows,sent,repo,message,callback,updates,effects,setFail(){failSend=true;},setConflict(){editConflict=true;},setLinked(value){linked=value;}};
}
test('only matching private chat and sender can access a task',()=>{
 const h=harness(),u=h.message(1,'test');assert.equal(privateActor(u).user,123);
 u.message.chat.type='group';assert.equal(privateActor(u),null);
 u.message.chat.type='private';u.message.from.id=456;assert.equal(privateActor(u),null);
});
test('date input validates real calendar days and respects the account timezone',()=>{
 assert.deepEqual(parseSchedule('завтра 09:00','Europe/Moscow',instant),{date:'2026-11-25',time:'09:00'});
 assert.deepEqual(parseSchedule('2026-12-01 8:05','UTC',instant),{date:'2026-12-01',time:'08:05'});
 for(const text of ['2026-02-30 10:00','2026-11-24 25:00','завтра 09:99','foo'])assert.equal(parseSchedule(text,'UTC',instant),null);
 assert.deepEqual(parseSchedule('-','UTC',instant),{date:'',time:''});
 assert.equal(zoned(new Date('2026-11-24T23:55:00Z'),'Europe/Moscow').date,'2026-11-25');
});
test('unlinked Telegram users cannot read or create tasks',async()=>{
 const h=harness();h.setLinked(false);await h.bot.process(h.message(1,'секрет'));
 assert.equal(h.rows.size,1);assert.match(h.sent.at(-1).text,/Подключить/);
});
test('plain text creates an Inbox task once across Telegram retries',async()=>{
 const h=harness([]),u=h.message(1,'Купить молоко');await h.bot.process(u);await h.bot.process(u);
 assert.equal(h.rows.size,1);const row=[...h.rows.values()][0];assert.equal(row.title,'Купить молоко');assert.equal(row.task_date,null);assert.equal(row.user_id,owner);
});
test('send failure releases an update; retry never replaces an already created task',async()=>{
 const h=harness([]),u=h.message(1,'Первая версия');h.setFail();await assert.rejects(h.bot.process(u),/network/);
 const row=[...h.rows.values()][0];row.title='Правка в веб-версии';await h.bot.process(u);
 assert.equal(h.rows.size,1);assert.equal([...h.rows.values()][0].title,'Правка в веб-версии');assert.equal(h.updates.get(1),'finished');
});
test('busy updates return an error so Telegram retries instead of losing them',async()=>{
 const h=harness();h.updates.set(1,'busy');await assert.rejects(h.bot.process(h.message(1,'text')),/busy/);
});
test('foreign task IDs cannot be completed or read through callback data',async()=>{
 const h=harness([task({owner:other})]);await h.bot.process(h.callback(1,'done:'+id));await h.bot.process(h.callback(2,'task:'+id));
 assert.equal(h.rows.get(id).completed,false);assert.equal(h.sent.some(m=>m.text?.includes('Описание')),false);
});
test('completion generates exactly one recurring occurrence and preserves unknown metadata',async()=>{
 const h=harness([task({repeat:{freq:'day',interval:1}})]);await h.bot.process(h.callback(1,'done:'+id));await h.bot.process(h.callback(2,'done:'+id));
 assert.equal(h.rows.size,2);const original=Core.decode(h.rows.get(id));assert.equal(original.done,true);assert.equal(original._meta.unknown,'сохранить');
 const next=Core.decode([...h.rows.values()].find(r=>r.id!==id));assert.equal(next.date,'2026-11-25');assert.equal(next.done,false);assert.equal(next.subtasks[0].done,false);assert.equal(original.nextOccurrenceId,next.id);
});
test('snoozing uses the account timezone and preserves details',async()=>{
 const h=harness();await h.bot.process(h.callback(1,'s15:'+id));const t=Core.decode(h.rows.get(id));
 assert.equal(t.date,'2026-11-25');assert.equal(t.time,'00:10');assert.equal(t.note,'Описание');assert.equal(t._meta.unknown,'сохранить');
});
test('optimistic conflict does not overwrite a task changed on another device',async()=>{
 const h=harness();h.setConflict();await h.bot.process(h.callback(1,'done:'+id));assert.equal(h.rows.get(id).completed,false);assert.match(h.sent.at(-1).text,/другом устройстве/);
});
test('date prompt keeps a task ID and does not turn an invalid date into a new task',async()=>{
 const h=harness();await h.bot.process(h.callback(1,'date:'+id));await h.bot.process(h.message(2,'2026-02-30'));assert.equal(h.rows.size,1);
 await h.bot.process(h.message(3,'завтра 09:00'));assert.equal(h.rows.get(id).task_date,'2026-11-25');assert.equal(h.rows.get(id).task_time,'09:00');
});
test('undated Inbox tasks retain a selected quadrant without needing a folder',async()=>{
 const h=harness([task({date:'',time:'',cat:1})]);await h.bot.process(h.callback(1,'quadrant:'+id));await h.bot.process(h.callback(2,'pickquadrant:0'));
 assert.equal(Core.decode(h.rows.get(id)).cat,0);assert.equal(h.rows.get(id).task_date,null);
});
test('folder selection preserves the existing date and task metadata',async()=>{
 const h=harness([task(),task({id:folder,isFolder:true,title:'Офис',date:'',time:''})]);await h.bot.process(h.callback(1,'folder:'+id));await h.bot.process(h.callback(2,'pickfolder:'+folder));
 const t=Core.decode(h.rows.get(id));assert.equal(t.folderId,folder);assert.equal(t.date,'2026-11-24');assert.equal(t._meta.unknown,'сохранить');
});
test('list pages are bounded and page navigation exposes all tasks',async()=>{
 const items=Array.from({length:19},(_,i)=>task({id:Core.occurrenceId('page',String(i)),date:'',title:'Задача '+i})),h=harness(items);
 await h.bot.process(h.message(1,'/inbox'));const first=h.sent.at(-1);assert.match(first.text,/19/);assert.equal(first.reply_markup.inline_keyboard.filter(r=>r[0].callback_data?.startsWith('task:')).length,8);
 await h.bot.process(h.callback(2,'view:inbox:2'));assert.equal(h.sent.at(-1).reply_markup.inline_keyboard.filter(r=>r[0].callback_data?.startsWith('task:')).length,3);
});
test('every task action fits Telegram callback size and contains no user text',()=>{
 for(const markup of [taskButtons(id),menu()])for(const row of markup.inline_keyboard)for(const button of row)if(button.callback_data)assert.ok(Buffer.byteLength(button.callback_data)<=64);
});
test('bot card shows description, subtasks, tags and quadrant as plain text',async()=>{
 const h=harness();await h.bot.process(h.callback(1,'task:'+id));const m=h.sent.at(-1);for(const s of ['Описание','Пункт','#работа','Срочно и важно'])assert.ok(m.text.includes(s));assert.equal(m.parse_mode,undefined);
});
test('disconnecting preserves every task',async()=>{
 const h=harness(),before=JSON.stringify([...h.rows.values()]);await h.bot.process(h.message(1,'/disconnect'));assert.equal(JSON.stringify([...h.rows.values()]),before);
});
test('a snooze committed before a send failure is not applied twice on retry',async()=>{
 const h=harness(),u=h.callback(1,'s30:'+id);h.setFail();await assert.rejects(h.bot.process(u),/network/);
 const before=structuredClone(h.rows.get(id));await h.bot.process(u);assert.deepEqual(h.rows.get(id),before);assert.equal(h.effects.size,1);
});
test('month navigation filters task dates without including navigation records or other months',async()=>{
 const h=harness([task(),task({id:folder,date:'2026-12-01',title:'В декабре'})]);
 await h.bot.process(h.message(1,'/months'));assert.ok(h.sent.at(-1).reply_markup.inline_keyboard.some(r=>r[0].callback_data==='view:m2026-11:0'));
 await h.bot.process(h.callback(2,'view:m2026-11:0'));const m=h.sent.at(-1);assert.match(m.text,/1/);assert.equal(m.reply_markup.inline_keyboard.filter(r=>r[0].callback_data?.startsWith('task:')).length,1);
});
