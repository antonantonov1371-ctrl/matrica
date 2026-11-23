const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const C=require('../task-core.js');
const path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const source=[...app.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes("const KEY='matrica.tasks.v1'"));
const workflow=fs.readFileSync(path.join(__dirname,'../workflow.js'),'utf8').replace('bindTaskGestures();','').replace('render();cloudInit();','');
function harness(){const elements=new Map(),timers=new Map(),data=new Map();let timerId=0;
 const element=id=>{if(!elements.has(id))elements.set(id,{id,innerHTML:'',textContent:'',value:'',checked:false,children:[],classList:{add(){},remove(){},toggle(){}},style:{setProperty(){}},before(){},setAttribute(){},addEventListener(){},remove(){},matches(){return false},focus(){},querySelectorAll(){return[]}});return elements.get(id)};
 const document={createElement:()=>element("new-button"),baseURI:"https://example.test/",getElementById:element,querySelector(){return null},querySelectorAll(){return[]},addEventListener(){},activeElement:element('body'),documentElement:{dataset:{theme:'dark'},style:{setProperty(){}}},body:{classList:{toggle(){}}},visibilityState:'visible'};
 const ctx={console,Date,Intl,Math,JSON,Map,Set,URL,crypto:require('node:crypto').webcrypto,MatricaCore:C,document,location:{href:'https://example.test'},navigator:{},localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)},setTimeout(fn){timers.set(++timerId,fn);return timerId},clearTimeout:id=>timers.delete(id),setInterval(){},requestAnimationFrame(fn){fn()},taskPushState:{enabled:false,timeZone:'Europe/Moscow'},taskPushSignedOut(){},initTaskPush:async()=>{},openNotificationSettings(){},window:{addEventListener(){},innerHeight:852},history:{}};
 vm.createContext(ctx);vm.runInContext(source,ctx);vm.runInContext(workflow,ctx);vm.runInContext("var workflowRenderForTest=render;cloudUser={id:'test-user'};render=function(){};save=function(){};closeModal=function(){};toast=function(){}",ctx);
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
test('failed save retains pending state and reports an error',async()=>{const h=harness();h.run('tasks='+JSON.stringify([task()])+';db={from(){return {upsert:async()=>({error:new Error("offline")})}}};');h.run('persistPending()');await assert.rejects(h.run('cloudSave()'),/offline/);assert.ok([...h.data.values()].some(v=>v.includes('Детали')));assert.match(h.element('cloudstatus').textContent,/Ошибка сохранения/)});
test('cloud save protects task rows from hard deletion while allowing explicit folder removal',async()=>{const h=harness(),calls=[];const old=task();h.ctx.calls=calls;h.run('tasks=[];cloudSnapshot=new Map([['+JSON.stringify(old.id)+',JSON.stringify(toRow('+JSON.stringify(old)+'))]]);db={from(){return {upsert:async()=>({}),delete(){calls.push("delete");return {in(){return {eq:async()=>({})}}}}}}};');await h.run('cloudSave()');assert.deepEqual(calls,[])});
test('new repeat rows use insert-on-conflict-do-nothing',async()=>{const h=harness(),options=[];h.ctx.options=options;h.run('tasks='+JSON.stringify([{...task(),generatedFrom:'source'}])+';db={from(){return {upsert:async(rows,opts)=>{options.push(opts);return {}}}}};needsRefresh=false;cloudRefresh=async function(){needsRefresh=false};');await h.run('cloudSave()');assert.equal(options[0].ignoreDuplicates,true)});
test('refresh preserves a remote task missing from an old local snapshot',async()=>{const h=harness(),remote=C.encode(task(),'test-user');h.ctx.remote=[remote];h.run('tasks=[];cloudSnapshot=new Map([['+JSON.stringify(remote.id)+','+JSON.stringify(JSON.stringify(remote))+']]);db={from(){return {select(){return {eq(){return {order:async()=>({data:remote,error:null})}}}},upsert:async()=>({})}}};');await h.run('cloudRefresh()');assert.equal(h.json('tasks')[0].id,remote.id)});
test('refresh retains local edits and independent remote changes',async()=>{const h=harness(),base=task(),remote=C.encode({...base,note:'Телефон'},'test-user');h.ctx.remote=[remote];h.run('tasks='+JSON.stringify([{...base,title:'Mac'}])+';cloudSnapshot=new Map([['+JSON.stringify(base.id)+','+JSON.stringify(JSON.stringify(C.encode(base,'test-user')))+']]);db={from(){return {select(){return {eq(){return {order:async()=>({data:remote,error:null})}}}},upsert:async()=>({})}}};');await h.run('cloudRefresh()');const t=h.json('tasks')[0];assert.equal(t.title,'Mac');assert.equal(t.note,'Телефон')});
function gestures(){const h=harness(),contentHandlers={},docHandlers={},panel={hidden:true};const row={dataset:{taskId:'a'},style:{},classList:{add(){},remove(){}},querySelector(){return panel}};h.element('content').addEventListener=(n,fn)=>contentHandlers[n]=fn;h.ctx.document.addEventListener=(n,fn)=>docHandlers[n]=fn;h.ctx.document.removeEventListener=n=>delete docHandlers[n];h.ctx.gestureComplete=null;h.ctx.gestureMenu=null;h.run("toggleTask=function(id){gestureComplete=id};openTaskActions=function(id){gestureMenu=id};bindTaskGestures()");const target={closest(selector){if(selector==='[data-task-id]')return row;return null}};return {...h,contentHandlers,docHandlers,row,panel,target,begin(){contentHandlers.pointerdown({target,pointerType:'touch',button:0,clientX:100,clientY:100})},move(x,y=100){docHandlers.pointermove({clientX:x,clientY:y,preventDefault(){}})},end(x,y=100,type='pointerup'){docHandlers[type]({type,clientX:x,clientY:y,preventDefault(){}})}}}
test('touch swipe right completes, left reveals actions, vertical scroll does neither',()=>{const right=gestures();right.begin();right.move(190);right.end(190);assert.equal(right.run('gestureComplete'),'a');const left=gestures();left.begin();left.move(10);left.end(10);assert.equal(left.panel.hidden,false);const vertical=gestures();vertical.begin();vertical.move(110,180);vertical.end(110,180);assert.equal(vertical.panel.hidden,true);assert.equal(vertical.run('gestureComplete'),null)});
test('long press opens menu, cancellation leaves task unchanged',async()=>{const hold=gestures();hold.begin();await hold.flushTimers();assert.equal(hold.run('gestureMenu'),'a');hold.end(100);const cancel=gestures();cancel.begin();cancel.move(180);cancel.end(180,100,'pointercancel');assert.equal(cancel.run('gestureComplete'),null)});
function freezeClock(h,iso){const fixed=Date.parse(iso);h.ctx.Date=class extends Date{constructor(...args){super(...(args.length?args:[fixed]))}static now(){return fixed}}}
const offlineSource=fs.readFileSync(path.join(__dirname,'../offline.js'),'utf8');
function offlineHarness(){const h=harness();h.run(offlineSource);return h}
test('offline edits survive restarting the application without making requests',async()=>{
 const h=offlineHarness();h.ctx.navigator.onLine=false;
 h.run('tasks='+JSON.stringify([task()])+';cloudUser={id:"test-user",email:"anton@example.test"};rememberOfflineAccount(cloudUser);tasks[0].title="Без сети"');
 await h.run('cloudSave()');h.run('tasks=[];cloudUser=null;cloudSnapshot.clear()');
 assert.equal(h.run('restoreOfflineAccount()'),true);assert.equal(h.json('tasks')[0].title,'Без сети');
 assert.match(h.element('cloudstatus').textContent,/сохранены на устройстве/);
});
test('reconnection fetches and merges remote edits before uploading offline edits',async()=>{
 const h=offlineHarness(),base=task(),calls=[];h.ctx.calls=calls;h.ctx.remote=[C.encode({...base,note:'iPhone'},'test-user')];
 h.run('tasks='+JSON.stringify([{...base,title:'Offline Mac'}])+';cloudSnapshot=new Map([["a",'+JSON.stringify(JSON.stringify(C.encode(base,'test-user')))+']]);db={from(){return {select(){calls.push("read");return {eq(){return {order:async()=>({data:remote,error:null})}}}},upsert:async(rows)=>{calls.push("write");return {}}}}};');
 await h.run('cloudSave()');assert.deepEqual(calls,['read','write']);assert.equal(h.json('tasks')[0].title,'Offline Mac');assert.equal(h.json('tasks')[0].note,'iPhone');
});
test('failed reconnect keeps offline edits and the original merge baseline',async()=>{
 const h=offlineHarness();h.run('tasks='+JSON.stringify([task()])+';db={from(){return {select(){return {eq(){return {order:async()=>({error:new Error("network down")})}}}}}}};');
 await assert.rejects(h.run('cloudSave()'),/network down/);assert.equal(h.json('tasks')[0].note,'Детали');assert.equal(h.run('rebaseNeeded'),true);
 assert.equal(JSON.parse(h.data.get('matrica.pending.v2.test-user')).tasks.length,1);
});
test('offline first launch explains that the first sign-in requires internet',async()=>{
 const h=offlineHarness();h.ctx.navigator.onLine=false;h.ctx.window.supabase={createClient(){return {auth:{onAuthStateChange(){}}}}};h.run('cloudUser=null');
 await h.run('cloudInit()');assert.match(h.element('authroot').innerHTML,/Для первого входа нужен интернет/);assert.equal(h.run('cloudUser'),null);
});
test('local copy is never restored without a remembered signed-in account',()=>{
 const h=offlineHarness();h.data.set('matrica.pending.v2.test-user',JSON.stringify({tasks:[task()],snapshot:[]}));assert.equal(h.run('restoreOfflineAccount()'),false);
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
 const h=offlineHarness();h.ctx.navigator.onLine=false;h.ctx.confirm=()=>true;
 h.run('tasks='+JSON.stringify([task()])+';rememberOfflineAccount(cloudUser);db={auth:{signOut:async()=>({})}}');
 await h.run('cloudSignOut()');assert.equal(h.run('cloudUser'),null);assert.equal(h.run('restoreOfflineAccount()'),false);assert.equal(JSON.parse(h.data.get('matrica.pending.v2.test-user')).tasks.length,1);
});
test('15, 30 and 60 minute reminders cross midnight in the account timezone without losing task fields',()=>{for(const [minutes,time] of [[15,'00:00'],[30,'00:15'],[60,'00:45']]){const h=harness(),original={...task(),flagged:true,repeat:{freq:'day',interval:1}};h.run('tasks='+JSON.stringify([original]));freezeClock(h,'2026-11-20T20:45:00Z');h.run(`snoozeTask('a',${minutes})`);const changed=h.json('tasks')[0];assert.equal(changed.date,'2026-11-21');assert.equal(changed.time,time);assert.deepEqual(changed.tags,original.tags);assert.deepEqual(changed.subtasks,original.subtasks);assert.deepEqual(changed.repeat,original.repeat);assert.equal(changed.flagged,true);assert.equal(changed.note,original.note)}});
test('tomorrow at 09:00 uses the account calendar day, including a year boundary',()=>{const h=harness();h.run('tasks='+JSON.stringify([task()]));freezeClock(h,'2026-12-31T22:30:00Z');h.run("snoozeTomorrow('a')");const changed=h.json('tasks')[0];assert.equal(changed.date,'2027-01-02');assert.equal(changed.time,'09:00');assert.equal(changed.id,'a')});
test('quick transfer only changes date, folder and quadrant',()=>{const h=harness(),original={...task(),flagged:true,repeat:{freq:'month',interval:2}};h.run('tasks='+JSON.stringify([original]));h.element('move-date').value='2026-12-25';h.element('move-folder').value='office';h.element('move-cat').value='3';h.run("applyTaskMove({preventDefault(){}},'a')");assert.deepEqual(h.json('tasks')[0],{...original,date:'2026-12-25',folderId:'office',cat:3})});
const navigationSource=fs.readFileSync(path.join(__dirname,'../navigation.js'),'utf8').replace(/\nrender\(\);\s*$/,'');
function navigationHarness(realRender=false){const h=harness();if(realRender)h.run('render=workflowRenderForTest;workflow.userId=cloudUser.id');h.run(navigationSource);h.run("listNavigation.userId=cloudUser.id;var navigationRenderForTest=render;render=function(){}");return h}
test('archiving a month changes no existing task and creates one stable navigation record',()=>{
 const h=navigationHarness(),original=task();h.run('tasks='+JSON.stringify([original]));h.run("setNavigationArchived('month:2026-11',true)");
 assert.deepEqual(h.json('tasks[0]'),original);assert.equal(h.json('tasks').length,2);assert.equal(h.run("navigationMonthState('2026-11').isFolder"),true);assert.equal(h.run("navigationMonthState('2026-11').done"),false);
 const id=h.run("navigationMonthState('2026-11').id");h.run("setNavigationArchived('month:2026-11',false);setNavigationArchived('month:2026-11',true)");assert.equal(h.json('tasks').length,2);assert.equal(h.run("navigationMonthState('2026-11').id"),id);assert.deepEqual(h.json('tasks[0]'),original);
});
test('month restore survives encoding and rebasing against an archived remote copy',()=>{
 const h=navigationHarness();h.run("setNavigationArchived('month:2026-11',true);var oldMonth=Core.copy(navigationMonthState('2026-11'));setNavigationArchived('month:2026-11',false);var restoredMonth=Core.copy(navigationMonthState('2026-11'));var mergedMonth=Core.merge(oldMonth,restoredMonth,oldMonth);tasks=[fromRow(toRow(mergedMonth))]");assert.equal(h.run("archivedList(navigationMonthState('2026-11'))"),false);
});
test('month navigation metadata is not offered as an inbox folder or task list',()=>{
 const h=navigationHarness();h.run("setNavigationArchived('month:2026-11',true)");assert.equal(h.json('userLists()').length,0);assert.equal(h.json('orderedFolderItems()').length,1);assert.doesNotMatch(h.run('folderSelect({})'),/Месяц:/);assert.equal(h.run("navigationItems().filter(i=>i.key==='month:2026-11').length"),1);
});
test('archiving a list preserves dated, undated, completed and deleted tasks and unknown metadata',()=>{
 const h=navigationHarness(),rows=[{id:'office',title:'Офис',isFolder:true,_meta:{future:'keep'},folderRank:17},task('dated'),{...task('undated'),date:''},{...task('done'),done:true},{...task('trash'),deletedAt:'2026-11-20T00:00:00Z'}].map((t,i)=>i?{...t,folderId:'office'}:t);
 h.run('tasks='+JSON.stringify(rows)+";view='list';listNavigation.selected='office';setNavigationArchived('list:office',true)");assert.deepEqual(h.json('tasks.slice(1)'),rows.slice(1));assert.equal(h.run('tasks[0]._meta.future'),'keep');assert.equal(h.run('view'),'inbox');h.run("setNavigationArchived('list:office',false)");assert.equal(h.run('archivedList(tasks[0])'),false);assert.deepEqual(h.json('tasks.slice(1)'),rows.slice(1));
});
test('new custom-list task stays in its list and keeps undated quadrant after reload',()=>{
 const h=navigationHarness();h.element('nav-list-title').value='ЛН офис';h.element('nav-list-color').value='#39bc62';h.run("saveNavigationList({preventDefault(){}});var listId=listNavigation.selected;newTask('',2);quickEditor.title='Позвонить';quickSave();tasks=tasks.map(t=>fromRow(toRow(t)))");
 const row=h.json('tasks.find(t=>!t.isFolder)');assert.equal(row.title,'Позвонить');assert.equal(row.folderId,h.run('listId'));assert.equal(row.date,'');assert.equal(row.cat,2);assert.equal(h.run('view'),'list');assert.equal(h.run('tasks[0]._meta.navColor'),'#39bc62');
});
test('moving a task between list quadrants preserves its date, time, notes and subtasks',()=>{
 const h=navigationHarness(),original=task();h.run('tasks='+JSON.stringify([{id:'office',title:'Офис',isFolder:true},original])+";view='list';listNavigation.selected='office';moveTask('a','',3)");assert.deepEqual(h.json("tasks.find(t=>t.id==='a')"),{...original,folderId:'office',cat:3});
});
test('list names are escaped and archived duplicate names are rejected without changing tasks',()=>{
 const h=navigationHarness();h.element('nav-list-title').value='<img src=x onerror=alert(1)>';h.element('nav-list-color').value='#3484fa';h.run('saveNavigationList({preventDefault(){}})');assert.doesNotMatch(h.run('navigationLibrary()'),/<img src=x/);assert.match(h.run('navigationLibrary()'),/&lt;img/);
 h.run("setNavigationArchived('list:'+listNavigation.selected,true)");h.run('saveNavigationList({preventDefault(){}})');assert.equal(h.json('userLists()').length,1);assert.match(h.element('nav-list-error').textContent,/архиве/);
});
test('custom-list screen renders four quadrants and only tasks from that list',()=>{
 const h=navigationHarness(true);h.run('tasks='+JSON.stringify([{id:'office',title:'ЛН офис',isFolder:true},{...task('own'),title:'Задача офиса',folderId:'office'},{...task('other'),title:'Чужой список',folderId:'another'}])+";view='list';listNavigation.selected='office';navigationRenderForTest()");
 const html=h.element('content').innerHTML;assert.equal((html.match(/class="quad"/g)||[]).length,4);assert.match(html,/Задача офиса/);assert.doesNotMatch(html,/Чужой список/);assert.equal(h.element('heading').textContent,'ЛН офис');assert.match(h.element('months').innerHTML,/Добавить список/);
});
test('copying into a custom list preserves original data and resets completion in the copy',()=>{
 const h=navigationHarness(),source={...task(),done:true,completedAt:'2026-11-20T12:00:00Z'};h.run('tasks='+JSON.stringify([{id:'office',title:'Офис',isFolder:true},source])+";view='list';listNavigation.selected='office';taskClipboard={mode:'copy',userId:cloudUser.id,task:Core.copy(tasks[1])};pasteTarget={date:'',cat:3}");
 h.run("pasteIntoNavigationList({metaKey:true,code:'KeyV',target:{closest(){return null}},preventDefault(){},stopImmediatePropagation(){}})");const rows=h.json('tasks');assert.deepEqual(rows[1],source);assert.equal(rows[2].folderId,'office');assert.equal(rows[2].date,source.date);assert.equal(rows[2].time,source.time);assert.equal(rows[2].cat,3);assert.equal(rows[2].done,false);assert.notEqual(rows[2].subtasks[0].id,source.subtasks[0].id);
});
test('cutting into a list keeps the task ID and does not duplicate or change its date',()=>{
 const h=navigationHarness(),source=task();h.run('tasks='+JSON.stringify([{id:'office',title:'Офис',isFolder:true},source])+";view='list';listNavigation.selected='office';taskClipboard={mode:'cut',userId:cloudUser.id,task:Core.copy(tasks[1])}");h.run("pasteIntoNavigationList({ctrlKey:true,code:'KeyV',target:{closest(){return null}},preventDefault(){},stopImmediatePropagation(){}})");assert.equal(h.json('tasks').length,2);assert.deepEqual(h.json('tasks[1]'),{...source,folderId:'office'});assert.equal(h.run('taskClipboard'),null);
});
test('a scroll cancels mobile long-press without archiving or opening a menu',async()=>{
 const h=navigationHarness(),handlers={};h.ctx.handlers=handlers;h.ctx.document.addEventListener=(name,fn)=>handlers[name]=fn;h.ctx.document.removeEventListener=name=>delete handlers[name];h.run("navigationHold({button:0,pointerType:'touch',currentTarget:{dataset:{navKey:'month:2026-11'}},clientX:0,clientY:0})");handlers.pointermove({clientX:0,clientY:40});await h.flushTimers();assert.equal(h.element('modalroot').innerHTML,'');assert.equal(h.json('tasks').length,0);
});
test('right-click opens the archive action but does not archive until it is chosen',()=>{
 const h=navigationHarness();h.run("navigationContext({preventDefault(){},stopPropagation(){}},'month:2026-11')");assert.match(h.element('modalroot').innerHTML,/Убрать в архив/);assert.equal(h.json('tasks').length,0);
});
