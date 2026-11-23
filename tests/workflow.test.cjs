const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const C=require('../task-core.js');
const path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const source=[...app.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes("const KEY='matrica.tasks.v1'"));
const lists=fs.readFileSync(path.join(__dirname,'../planner-lists.js'),'utf8');
const offlineSource=fs.readFileSync(path.join(__dirname,'../offline.js'),'utf8');
const workflow=fs.readFileSync(path.join(__dirname,'../workflow.js'),'utf8').replace('bindTaskGestures();','').replace('render();cloudInit();','');
function harness(){const elements=new Map(),timers=new Map(),data=new Map();let timerId=0;
 const element=id=>{if(!elements.has(id))elements.set(id,{id,innerHTML:'',textContent:'',value:'',checked:false,children:[],classList:{add(){},remove(){},toggle(){}},style:{setProperty(){}},before(){},setAttribute(){},addEventListener(){},remove(){},matches(){return false},focus(){},querySelectorAll(){return[]}});return elements.get(id)};
 const document={createElement:()=>element("new-button"),baseURI:"https://example.test/",getElementById:element,querySelector(){return null},querySelectorAll(){return[]},addEventListener(){},activeElement:element('body'),documentElement:{dataset:{theme:'dark'},style:{setProperty(){}}},body:{classList:{toggle(){}}},visibilityState:'visible'};
 const ctx={console,Date,Intl,Math,JSON,Map,Set,URL,crypto:require('node:crypto').webcrypto,MatricaCore:C,document,location:{href:'https://example.test'},navigator:{},localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)},setTimeout(fn){timers.set(++timerId,fn);return timerId},clearTimeout:id=>timers.delete(id),setInterval(){},requestAnimationFrame(fn){fn()},taskPushState:{enabled:false,timeZone:'Europe/Moscow'},taskPushSignedOut(){},initTaskPush:async()=>{},openNotificationSettings(){},openPendingReminder(){},window:{addEventListener(){},innerHeight:852},history:{}};
 vm.createContext(ctx);vm.runInContext(source,ctx);vm.runInContext(lists,ctx);vm.runInContext(workflow,ctx);vm.runInContext(offlineSource,ctx);vm.runInContext("cloudUser={id:'test-user'};cloudCanSync=true;render=function(){};save=function(){};closeModal=function(){};toast=function(){}",ctx);
 return {ctx,element,data,run:s=>vm.runInContext(s,ctx),json:s=>JSON.parse(vm.runInContext('JSON.stringify('+s+')',ctx)),timers,async flushTimers(){const callbacks=[...timers.values()];timers.clear();for(const fn of callbacks)await fn()}};
}
function task(id='a'){return {id,title:'Задача',note:'Детали',date:'2026-11-20',time:'12:00',cat:1,done:false,folderId:'',createdAt:'2026-11-19T10:00:00Z',tags:['работа'],subtasks:[{id:'s',title:'Шаг',done:false}]}}
test('complete then undo before delay does not create a repeat',async()=>{const h=harness();h.run('tasks='+JSON.stringify([{...task(),repeat:{freq:'day',interval:1}}]));h.run("toggleTask('a');undoWorkflow()");await h.flushTimers();assert.equal(h.json('tasks').length,1);assert.equal(h.json('tasks')[0].done,false)});
test('a repeated completion produces exactly one future occurrence',async()=>{const h=harness();h.run('tasks='+JSON.stringify([{...task(),repeat:{freq:'day',interval:1}}]));h.run("toggleTask('a')");await h.flushTimers();h.run("finishOccurrence('a')");const out=h.json('tasks');assert.equal(out.length,2);assert.equal(out[0].done,true);assert.equal(out[1].done,false);assert.ok(out[1].date>out[0].date);assert.equal(out[1].subtasks[0].done,false)});
test('undo after repeat generation restores original and safely retires generated occurrence',async()=>{const h=harness();h.run('tasks='+JSON.stringify([{...task(),repeat:{freq:'day',interval:1}}]));h.run("toggleTask('a')");await h.flushTimers();h.run('undoWorkflow()');let out=h.json('tasks');assert.equal(out[0].done,false);assert.ok(out[1].deletedAt);h.run("toggleTask('a')");await h.flushTimers();out=h.json('tasks');assert.equal(out.length,2);assert.equal(out[1].deletedAt,null);assert.equal(out[1].done,false)});
test('soft deletion and restore never remove a task row',()=>{const h=harness();h.run('tasks='+JSON.stringify([task()]));h.run("trashTask('a')");assert.equal(h.json('tasks').length,1);assert.ok(h.json('tasks')[0].deletedAt);h.run("restoreTask('a')");const restored=h.json('tasks')[0];assert.equal(restored.deletedAt,null);assert.equal(restored.note,'Детали');assert.equal(restored.done,false);assert.equal(restored.subtasks.length,1)});
test('archive expiration never deletes existing completed records',()=>{const h=harness();assert.equal(h.run("archiveExpired({done:true,completedAt:'2020-01-01T00:00:00Z'})"),false)});
test('quick editing preserves remotely changed independent fields',()=>{const h=harness(),base=task();h.run('tasks='+JSON.stringify([{...base,note:'Правка с телефона'}])+';quickEditor='+JSON.stringify({id:'a',title:'Правка с Mac',note:base.note,date:base.date,time:base.time,cat:base.cat,folderId:'',original:base})+';');h.run('quickSave()');const result=h.json('tasks')[0];assert.equal(result.title,'Правка с Mac');assert.equal(result.note,'Правка с телефона');assert.deepEqual(result.tags,['работа'])});
test('bulk moving keeps tags, notes, subtasks and completion',()=>{const h=harness();h.run('tasks='+JSON.stringify([task('a'),{...task('b'),done:true}])+';');h.element('bulk-action').value='move';h.element('bulk-date').value='2026-11-25';h.element('bulk-folder').value='office';h.element('bulk-cat').value='2';h.run('applyBulk({preventDefault(){}},'+JSON.stringify(encodeURIComponent(JSON.stringify(['a','b'])))+')');const out=h.json('tasks');assert.ok(out.every(t=>t.date==='2026-11-25'&&t.folderId==='office'&&t.cat===2&&t.note==='Детали'&&t.subtasks.length===1));assert.equal(out[1].done,true)});
function connect(h,{rows=[],archive=[],write,error}={}){
 const calls=[];
 h.ctx.dbMock={
  from(table){
   return {select(){return {eq(){
    if(table==='matrica_months')return Promise.resolve({data:archive});
    calls.push('read');
    return {order(){return {limit:async()=>error?{error}:{data:rows}}}};
   }}},async upsert(values){calls.push(values);return {}}};
  },
  async rpc(name,args){
   assert.equal(name,'matrica_write_tasks');
   calls.push(args);
   return write?write(args):{data:true};
  },
  channel(){return {on(){return this},subscribe(){return this}}},
 };
 h.run('db=dbMock');
 return calls;
}
function rowsFor(...tasks){return tasks.map(t=>({...C.encode(t,'test-user'),created_at:t.createdAt,updated_at:'2026-11-20T12:00:00Z'}))}
function loadPending(h,pending,base=[]){
 h.run('tasks='+JSON.stringify(pending)+';cloudSnapshot=new Map('+JSON.stringify(base.map(t=>[t.id,JSON.stringify(C.encode(t,'test-user'))]))+')');
}
test('failed save retains pending state and reports an error',async()=>{
 const h=harness();
 loadPending(h,[task()]);
 connect(h,{write:()=>({error:new Error('offline')})});
 await assert.rejects(h.run('cloudSave()'),/offline/);
 assert.ok([...h.data.values()].some(value=>value.includes('Детали')));
 assert.match(h.element('cloudstatus').textContent,/синхронизация повторится/);
});
test('cloud save protects task rows from hard deletion while allowing explicit folder removal',async()=>{
 const h=harness(),old=task(),folder={id:'f',title:'Проект',isFolder:true};
 loadPending(h,[],[old,folder]);
 const calls=connect(h,{rows:rowsFor(old,folder)});
 await h.run('cloudSave()');
 assert.equal(h.json('tasks')[0].id,old.id);
 assert.deepEqual(JSON.parse(JSON.stringify(calls[1].p_deletions)),[{id:'f',revision:'2026-11-20T12:00:00Z'}]);
});
test('new repeat rows are marked for insert-on-conflict-do-nothing',async()=>{
 const h=harness(),repeat={...task(),generatedFrom:'source'};
 loadPending(h,[repeat]);
 const rows=[],calls=connect(h,{rows,write:()=>{rows.push(...rowsFor(repeat));return {data:true}}});
 await h.run('cloudSave()');
 assert.equal(calls[1].p_upserts[0].generated,true);
 assert.equal(calls[1].p_upserts[0].revision,null);
});
test('refresh preserves a remote task missing from an old local snapshot',async()=>{
 const h=harness(),old=task();
 loadPending(h,[],[old]);
 connect(h,{rows:rowsFor(old)});
 await h.run('cloudRefresh()');
 assert.equal(h.json('tasks')[0].id,old.id);
});
test('refresh retains local edits and independent remote changes',async()=>{
 const h=harness(),base=task();
 loadPending(h,[{...base,title:'Mac'}],[base]);
 const calls=connect(h,{rows:rowsFor({...base,note:'Телефон'})});
 await h.run('cloudRefresh()');
 const t=h.json('tasks')[0];
 assert.equal(t.title,'Mac');
 assert.equal(t.note,'Телефон');
 assert.equal(calls[1].p_upserts[0].revision,'2026-11-20T12:00:00Z');
});
test('a revision conflict fetches the winner and retries the merged edit',async()=>{
 const h=harness(),base=task();
 loadPending(h,[{...base,title:'Mac'}],[base]);
 const rows=rowsFor(base);
 let writes=0;
 const calls=connect(h,{rows,write(){
  if(++writes===1){
   rows[0]={...rowsFor({...base,note:'iPhone'})[0],updated_at:'2026-11-20T12:00:01Z'};
   return {data:false};
  }
  return {data:true};
 }});
 await h.run('cloudSave()');
 assert.equal(calls[3].p_upserts[0].revision,'2026-11-20T12:00:01Z');
 assert.equal(h.json('tasks')[0].title,'Mac');
 assert.equal(h.json('tasks')[0].note,'iPhone');
});
function gestures(){const h=harness(),contentHandlers={},docHandlers={},panel={hidden:true};const row={dataset:{taskId:'a'},style:{},classList:{add(){},remove(){}},querySelector(){return panel}};h.element('content').addEventListener=(n,fn)=>contentHandlers[n]=fn;h.ctx.document.addEventListener=(n,fn)=>docHandlers[n]=fn;h.ctx.document.removeEventListener=n=>delete docHandlers[n];h.ctx.gestureComplete=null;h.ctx.gestureMenu=null;h.run("toggleTask=function(id){gestureComplete=id};openTaskActions=function(id){gestureMenu=id};bindTaskGestures()");const target={closest(selector){if(selector==='[data-task-id]')return row;return null}};return {...h,contentHandlers,docHandlers,row,panel,target,begin(){contentHandlers.pointerdown({target,pointerType:'touch',button:0,clientX:100,clientY:100})},move(x,y=100){docHandlers.pointermove({clientX:x,clientY:y,preventDefault(){}})},end(x,y=100,type='pointerup'){docHandlers[type]({type,clientX:x,clientY:y,preventDefault(){}})}}}
test('touch swipe right completes, left reveals actions, vertical scroll does neither',()=>{const right=gestures();right.begin();right.move(190);right.end(190);assert.equal(right.run('gestureComplete'),'a');const left=gestures();left.begin();left.move(10);left.end(10);assert.equal(left.panel.hidden,false);const vertical=gestures();vertical.begin();vertical.move(110,180);vertical.end(110,180);assert.equal(vertical.panel.hidden,true);assert.equal(vertical.run('gestureComplete'),null)});
test('long press opens menu, cancellation leaves task unchanged',async()=>{const hold=gestures();hold.begin();await hold.flushTimers();assert.equal(hold.run('gestureMenu'),'a');hold.end(100);const cancel=gestures();cancel.begin();cancel.move(180);cancel.end(180,100,'pointercancel');assert.equal(cancel.run('gestureComplete'),null)});
function freezeClock(h,iso){const fixed=Date.parse(iso);h.ctx.Date=class extends Date{constructor(...args){super(...(args.length?args:[fixed]))}static now(){return fixed}}}

test('offline edits survive restarting the application without making requests',async()=>{
 const h=harness();h.ctx.navigator.onLine=false;
 h.run('tasks='+JSON.stringify([task()])+';cloudUser={id:"test-user",email:"anton@example.test"};localStorage.setItem(offlineAccountKey,JSON.stringify(cloudUser));tasks[0].title="Без сети"');
 await h.run('cloudSave()');h.run('tasks=[];cloudUser=null;cloudSnapshot.clear()');
 assert.equal(h.run('restoreOfflineAccount()'),true);assert.equal(h.json('tasks')[0].title,'Без сети');
 assert.match(h.element('cloudstatus').textContent,/Локальная копия/);
});
test('reconnection fetches and merges remote edits before uploading offline edits',async()=>{
 const h=harness(),base=task();
 loadPending(h,[{...base,title:'Offline Mac'}],[base]);
 const calls=connect(h,{rows:rowsFor({...base,note:'iPhone'})});
 h.ctx.navigator.onLine=false;
 await h.run('cloudSave()');
 assert.equal(calls.length,0);
 h.ctx.navigator.onLine=true;
 await h.run('cloudSave()');
 assert.equal(calls[0],'read');
 assert.equal(calls[1].p_upserts[0].title,'Offline Mac');
 assert.equal(h.json('tasks')[0].note,'iPhone');
});
test('failed reconnect keeps offline edits and the original merge baseline',async()=>{
 const h=harness();
 loadPending(h,[{...task(),title:'Offline'}],[task()]);
 connect(h,{error:new Error('network down')});
 await assert.rejects(h.run('cloudSave()'),/network down/);
 const pending=JSON.parse(h.data.get('matrica.pending.v2.test-user'));
 assert.equal(pending.tasks[0].title,'Offline');
 assert.equal(JSON.parse(pending.snapshot[0][1]).title,task().title);
});
test('refresh restores the stored session and reloads the same account tasks',async()=>{
 const h=harness(),user={id:'test-user',email:'owner@example.test'};
 connect(h,{rows:rowsFor(task())});
 h.ctx.window.supabase={createClient(){return {...h.ctx.dbMock,auth:{
  onAuthStateChange(){},getSession:async()=>({data:{session:{user}}}),
 }}}};
 h.run('cloudUser=null;cloudCanSync=false');
 await h.run('cloudInit()');
 assert.equal(h.run('cloudUser.id'),user.id);
 assert.equal(h.element('authroot').innerHTML,'');
 assert.equal(h.json('tasks')[0].title,task().title);
});
test('a definite loss of session hides task data but preserves the outbox',async()=>{
 const h=harness();
 loadPending(h,[task()]);
 h.run('db={auth:{getSession:async()=>({data:{session:null}})}};localStorage.setItem(offlineAccountKey,JSON.stringify(cloudUser))');
 await h.run('recoverOnlineSession()');
 assert.deepEqual(h.json('tasks'),[]);
 assert.equal(h.run('restoreOfflineAccount()'),false);
 assert.equal(JSON.parse(h.data.get('matrica.pending.v2.test-user')).tasks.length,1);
});
test('archive and restore a month without moving the tasks',async()=>{
 const h=harness(),original=task();
 freezeClock(h,'2026-11-23T12:00:00Z');
 loadPending(h,[original],[original]);
 const calls=connect(h,{rows:rowsFor(original)});
 h.run("setMonthArchived('2026-11-01',true)");
 await h.run('cloudSave()');
 assert.equal(h.run("plannerMonthKeys().includes('2026-11-01')"),false);
 assert.match(h.run('archivedMonthList()'),/Ноябрь 2026/);
 assert.equal(h.json('tasks')[0].date,original.date);
 assert.equal(calls[1][0].archived,true);
 h.run("setMonthArchived('2026-11-01',false)");
 assert.equal(h.run("plannerMonthKeys().includes('2026-11-01')"),true);
});
test('a funnel shows its tasks with and without a date',()=>{
 const h=harness(),folder={id:'f',title:'Сделки',isFolder:true};
 loadPending(h,[folder,{...task(),title:'Задача с датой',folderId:'f'},{...task('b'),title:'Задача без даты',date:'',folderId:'f'},task('other')]);
 h.run("openFunnel('f')");
 const html=h.run('funnelHtml()');
 assert.match(html,/Задача с датой/);
 assert.match(html,/Задача без даты/);
 assert.doesNotMatch(html,/data-task-id="other"/);
});
test('offline first launch explains that the first sign-in requires internet',async()=>{
 const h=harness();h.ctx.navigator.onLine=false;h.ctx.window.supabase={createClient(){return {auth:{onAuthStateChange(){}}}}};h.run('cloudUser=null');
 await h.run('cloudInit()');assert.match(h.element('authroot').innerHTML,/Для первого входа нужен интернет/);assert.equal(h.run('cloudUser'),null);
});
test('local copy is never restored without a remembered signed-in account',()=>{
 const h=harness();h.data.set('matrica.pending.v2.test-user',JSON.stringify({tasks:[task()],snapshot:[]}));assert.equal(h.run('restoreOfflineAccount()'),false);
});
test('day and week calendars collapse independently and retain selected date',()=>{
 const h=harness();h.run('selected="2026-11-20";view="day";toggleCalendar()');assert.equal(h.run('calendarPanel()'),'');assert.equal(h.run('selected'),'2026-11-20');
 h.run('view="week"');assert.match(h.run('calendarPanel()'),/cal-grid/);h.run('toggleCalendar()');assert.equal(h.run('calendarPanel()'),'');
 assert.deepEqual(JSON.parse(h.data.get('matrica.calendar-panels.v1')),{day:false,week:false});h.run('view="day";toggleCalendar()');assert.match(h.run('calendarPanel()'),/cal-grid/);
});
test('choosing a calendar date in week keeps the feed open',()=>{
 const h=harness();h.run('view="week";selectDate("2026-12-15")');assert.equal(h.run('view'),'week');assert.equal(h.run('selected'),'2026-12-15');assert.equal(h.run('monthDate.getMonth()'),11);
});
test('explicit offline sign out closes local account access without deleting pending edits',async()=>{
 const h=harness();h.ctx.navigator.onLine=false;h.ctx.confirm=()=>true;
 h.run('tasks='+JSON.stringify([task()])+';localStorage.setItem(offlineAccountKey,JSON.stringify(cloudUser));db={auth:{signOut:async()=>({})}}');
 await h.run('cloudSignOut()');assert.equal(h.run('cloudUser'),null);assert.equal(h.run('restoreOfflineAccount()'),false);assert.equal(JSON.parse(h.data.get('matrica.pending.v2.test-user')).tasks.length,1);
});
test('15, 30 and 60 minute reminders cross midnight in the account timezone without losing task fields',()=>{for(const [minutes,time] of [[15,'00:00'],[30,'00:15'],[60,'00:45']]){const h=harness(),original={...task(),flagged:true,repeat:{freq:'day',interval:1}};h.run('tasks='+JSON.stringify([original]));freezeClock(h,'2026-11-20T20:45:00Z');h.run(`snoozeTask('a',${minutes})`);const changed=h.json('tasks')[0];assert.equal(changed.date,'2026-11-21');assert.equal(changed.time,time);assert.deepEqual(changed.tags,original.tags);assert.deepEqual(changed.subtasks,original.subtasks);assert.deepEqual(changed.repeat,original.repeat);assert.equal(changed.flagged,true);assert.equal(changed.note,original.note)}});
test('tomorrow at 09:00 uses the account calendar day, including a year boundary',()=>{const h=harness();h.run('tasks='+JSON.stringify([task()]));freezeClock(h,'2026-12-31T22:30:00Z');h.run("snoozeTomorrow('a')");const changed=h.json('tasks')[0];assert.equal(changed.date,'2027-01-02');assert.equal(changed.time,'09:00');assert.equal(changed.id,'a')});
test('quick transfer only changes date, folder and quadrant',()=>{const h=harness(),original={...task(),flagged:true,repeat:{freq:'month',interval:2}};h.run('tasks='+JSON.stringify([original]));h.element('move-date').value='2026-12-25';h.element('move-folder').value='office';h.element('move-cat').value='3';h.run("applyTaskMove({preventDefault(){}},'a')");assert.deepEqual(h.json('tasks')[0],{...original,date:'2026-12-25',folderId:'office',cat:3})});
