export const APP_URL='https://antonantonov1371-ctrl.github.io/matrica/';
export const QUADRANTS=['Срочно и важно','Не срочно и важно','Срочно и не важно','Не срочно и не важно'];
export const HELP='Напишите текст — добавлю задачу во «Входящие». Затем можно выбрать дату, список и квадрант.\n\n/today — сегодня\n/week — ближайшие 7 дней\n/inbox — входящие\n/matrix — четыре квадранта\n/lists — мои списки\n/overdue — просроченные\n/archive — выполненные\n/search текст — поиск\n/cancel — отменить ввод\n/disconnect — отключить Telegram';
export const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function zoned(instant,zone){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(instant).map(p=>[p.type,p.value]));
 return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`};
}
export function plusDays(date,n){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
export function parseSchedule(text,zone,now=new Date()){
 const raw=text.trim().toLowerCase();if(raw==='-'||raw==='без даты')return {date:'',time:''};
 const today=zoned(now,zone).date;
 const match=raw.match(/^(сегодня|завтра|\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}):(\d{2}))?$/u);
 if(!match)return null;
 const date=match[1]==='сегодня'?today:match[1]==='завтра'?plusDays(today,1):match[1];
 if(!Number.isFinite(Date.parse(date+'T12:00:00Z'))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)return null;
 if(match[2]&&(Number(match[2])>23||Number(match[3])>59))return null;
 return {date,time:match[2]?match[2].padStart(2,'0')+':'+match[3]:''};
}
export function privateActor(update){
 const message=update.callback_query?.message||update.message,from=update.callback_query?.from||update.message?.from;
 if(!message||message.chat?.type!=='private'||!Number.isSafeInteger(from?.id)||from.is_bot||message.chat.id!==from.id)return null;
 return {chat:message.chat.id,user:from.id,message,callback:update.callback_query};
}
const button=(text,callback_data)=>({text,callback_data});
export function menu(){return {inline_keyboard:[
 [button('Сегодня','view:today:0'),button('Неделя','view:week:0')],
 [button('Входящие','view:inbox:0'),button('Квадранты','matrix')],
 [button('Мои списки','lists:0'),button('Месяцы','months:0')],
 [button('Хвосты','view:overdue:0')],
 [button('Архив','view:archive:0'),{text:'Открыть «Матрицу»',url:APP_URL}]]}}
export function taskButtons(id){return {inline_keyboard:[
 [button('✓ Выполнено','done:'+id)],
 [button('15 мин','s15:'+id),button('30 мин','s30:'+id),button('Через час','s60:'+id)],
 [button('Завтра в 09:00','tomorrow:'+id)],
 [button('Дата и время','date:'+id),button('Список','folder:'+id),button('Квадрант','quadrant:'+id)],
 [{text:'Открыть задачу',url:APP_URL+'?task='+id}]]}}
export function createBot({repo,call,Core,now=()=>new Date()}){
 const send=(chat,text,reply_markup)=>call('sendMessage',{chat_id:chat,text,reply_markup,link_preview_options:{is_disabled:true}});
 const decode=rows=>rows.map(Core.decode);
 const visible=t=>!t.isFolder&&!t.deletedAt;
 const active=t=>visible(t)&&!t.done;
 async function card(chat,owner,id){
   const row=await repo.task(owner,id);if(!row)return send(chat,'Задача не найдена.');const t=Core.decode(row);
   if(!visible(t))return send(chat,'Задача находится в корзине.');
   const rows=decode(await repo.tasks(owner)),folder=rows.find(f=>f.isFolder&&f.id===t.folderId);
   const lines=[(t.done?'✓ ':'')+t.title,t.note, t.date?[t.date,t.time].filter(Boolean).join(' '):'Без даты',folder?'Список: '+folder.title:'',QUADRANTS[t.cat],t.tags.length?t.tags.map(x=>'#'+x).join(' '):'',...t.subtasks.map(s=>(s.done?'☑ ':'☐ ')+s.title)].filter(Boolean);
   return send(chat,lines.join('\n').slice(0,4000),t.done?{inline_keyboard:[[{text:'Открыть задачу',url:APP_URL+'?task='+id}]]}:taskButtons(id));
 }
 async function listing(chat,owner,section,page=0,query=''){
   const all=decode(await repo.tasks(owner)),today=zoned(now(),await repo.zone(owner)).date;
   let items=all.filter(section==='archive'?t=>visible(t)&&t.done:active);
   if(section==='inbox')items=items.filter(t=>!t.date);
   else if(section==='today')items=items.filter(t=>t.date===today);
   else if(section==='week')items=items.filter(t=>t.date>=today&&t.date<plusDays(today,7));
   else if(section==='overdue')items=items.filter(t=>t.date&&t.date<today);
   else if(section.startsWith('m'))items=items.filter(t=>t.date?.startsWith(section.slice(1)));
   else if(section.startsWith('q'))items=items.filter(t=>t.cat===Number(section.slice(1)));
   else if(section.startsWith('f'))items=items.filter(t=>t.folderId===section.slice(1));
   else if(section==='search')items=items.filter(t=>Core.matches(t,query,all.find(f=>f.id===t.folderId)?.title));
   items=Core.sort(items,section==='archive'?'created':'date');page=Math.max(0,Math.min(Math.floor(Number(page)||0),Math.max(0,Math.ceil(items.length/8)-1)));
   const labels={today:'Сегодня',week:'Ближайшие 7 дней',inbox:'Входящие',overdue:'Хвосты',archive:'Архив',search:'Результаты поиска'};
   const title=labels[section]|| (section.startsWith('m')?new Intl.DateTimeFormat('ru',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(section.slice(1)+'-01T12:00:00Z')):section.startsWith('q')?QUADRANTS[Number(section.slice(1))]:all.find(t=>t.id===section.slice(1))?.title)||'Задачи';
   const keyboard=items.slice(page*8,page*8+8).map(t=>[button((t.done?'✓ ':'')+t.title.slice(0,48)+(t.date?' · '+t.date:''),'task:'+t.id)]);
   // Search pages keep the query server-side, rather than putting task text in callback data.
   if(section==='search')await repo.prompt(owner,{field:'search',query,expires:now().getTime()+600000});
   const paging=[];if(page>0)paging.push(button('←','view:'+section+':'+(page-1)));if((page+1)*8<items.length)paging.push(button('→','view:'+section+':'+(page+1)));if(paging.length)keyboard.push(paging);
   keyboard.push([button('Меню','menu')]);return send(chat,`${title} · ${items.length}${items.length?`\nСтраница ${page+1}`:'\nЗдесь пока пусто.'}`,{inline_keyboard:keyboard});
 }
 async function folders(chat,owner,page=0,target=''){
   const all=decode(await repo.tasks(owner)).filter(t=>t.isFolder&&t._meta?.navKind!=='month'&&!t._meta?.navArchivedAt);
   const items=Core.sort(all,'manual');page=Math.max(0,Math.min(Math.floor(Number(page)||0),Math.max(0,Math.ceil(items.length/8)-1)));
   const keyboard=items.slice(page*8,page*8+8).map(t=>[button(t.title.slice(0,60),target?'pickfolder:'+t.id:'view:f'+t.id+':0')]);
   if(target){await repo.prompt(owner,{field:'folder',id:target,expires:now().getTime()+600000});keyboard.unshift([button('Без папки','pickfolder:none')]);}
   const paging=[];if(page>0)paging.push(button('←','lists:'+(page-1)));if((page+1)*8<items.length)paging.push(button('→','lists:'+(page+1)));if(paging.length)keyboard.push(paging);
   keyboard.push([button('Меню','menu')]);return send(chat,target?'Выберите список для задачи:':'Мои списки',{inline_keyboard:keyboard});
 }
 async function edit(owner,id,mutate,operation){
   const row=await repo.task(owner,id);if(!row)return 'Задача не найдена.';
   const t=Core.decode(row);if(!active(t))return 'Задача уже выполнена или находится в корзине.';
   mutate(t);const next=Core.nextOccurrence(t,zoned(now(),await repo.zone(owner)).date,now().toISOString());
   if(next){t.seriesId=next.seriesId;t.nextOccurrenceId=next.id;}
   const patch=Core.encode(t,owner);delete patch.id;delete patch.user_id;
   if(!await repo.edit(owner,id,row.updated_at,patch,next?Core.encode(next,owner):null,operation))return 'Задача изменилась на другом устройстве. Откройте её ещё раз.';
   return null;
 }
 async function process(update){
   const actor=privateActor(update);if(!actor||!Number.isSafeInteger(update.update_id))return;
   const {chat,user,message,callback}=actor;
   const claim=await repo.claim(update.update_id,chat);
   if(claim==='busy')throw new Error('Update busy');
   if(claim!=='claimed')return;
   let failed=false;
   try {
     if(callback){try{await call('answerCallbackQuery',{callback_query_id:callback.id});}catch(error){if(error.code!==400)throw error;}}
     const text=String(update.message?.text||'').trim();
     let link=await repo.link(chat,user);
     if(/^\/start(?:@\w+)?\s+[a-f0-9]{64}$/i.test(text)){
       const owner=await repo.consume(text.split(/\s+/)[1],chat,user);
       if(!owner){await send(chat,'Ссылка недействительна или истекла. Создайте новую в настройках «Матрицы».');return;}
       link=await repo.link(chat,user);await send(chat,'Telegram подключён к «Матрице». Напоминания будут приходить сюда.\n\n'+HELP,menu());return;
     }
     if(!link){await send(chat,'Откройте «Матрицу» → колокольчик → Telegram → «Подключить». Затем перейдите по одноразовой ссылке.',{inline_keyboard:[[{text:'Открыть «Матрицу»',url:APP_URL}]]});return;}
     const owner=link.user_id,zone=await repo.zone(owner),prompt=link.prompt?.expires>now().getTime()?link.prompt:null;
     const data=String(callback?.data||'');
     if(data==='menu'||/^\/(start|help|menu|cancel)(?:@\w+)?$/.test(text)){await repo.prompt(owner,null);await send(chat,HELP,menu());return;}
     if(/^\/disconnect(?:@\w+)?$/.test(text)){await repo.disconnect(owner);await send(chat,'Telegram отключён. Ваши задачи сохранены в «Матрице».');return;}
     if(data==='matrix'||text==='/matrix'){await send(chat,'Все активные задачи по квадрантам:',{inline_keyboard:[...QUADRANTS.map((q,i)=>[button(q,'view:q'+i+':0')]),[button('Меню','menu')]]});return;}
     if(data.startsWith('months:')||text==='/months'){
       const all=decode(await repo.tasks(owner)),months=[...new Set(all.filter(active).map(t=>t.date.slice(0,7)).filter(Boolean))].sort();
       const page=Math.max(0,Math.min(Number(data.split(':')[1])||0,Math.max(0,Math.ceil(months.length/8)-1)));
       const keyboard=months.slice(page*8,page*8+8).map(m=>[button(m,'view:m'+m+':0')]);const paging=[];
       if(page>0)paging.push(button('←','months:'+(page-1)));if((page+1)*8<months.length)paging.push(button('→','months:'+(page+1)));if(paging.length)keyboard.push(paging);keyboard.push([button('Меню','menu')]);
       await send(chat,'Месяцы с активными задачами',{inline_keyboard:keyboard});return;
     }
     if(data.startsWith('lists:')||text==='/lists'){await folders(chat,owner,data.split(':')[1],prompt?.field==='folder'?prompt.id:'');return;}
     const view=data.match(/^view:([a-z0-9-]+):(\d{1,6})$/i),command=text.match(/^\/(today|week|inbox|overdue|archive)$/);
     if(view||command){const section=view?.[1]||command[1];if(!['today','week','inbox','overdue','archive','search'].includes(section)&&!/^m\d{4}-(0[1-9]|1[0-2])$/.test(section)&&!/^q[0-3]$/.test(section)&&!(section.startsWith('f')&&UUID.test(section.slice(1))))return;
       await listing(chat,owner,section,view?.[2]||0,section==='search'?prompt?.query||'': '');return;}
     if(text.startsWith('/search ')){await listing(chat,owner,'search',0,text.slice(8));return;}
     const action=data.match(/^(task|done|s15|s30|s60|tomorrow|date|folder|quadrant):(.+)$/);
     if(action&&UUID.test(action[2])){
       const [_,kind,id]=action;
       if(kind==='task'){await card(chat,owner,id);return;}
       if(kind==='folder'){await folders(chat,owner,0,id);return;}
       if(kind==='date'){await repo.prompt(owner,{field:'date',id,expires:now().getTime()+600000});await send(chat,'Введите дату и время: «завтра 09:00», «сегодня 18:30» или «2026-12-01 14:00». Для задачи без даты отправьте «-». /cancel — отмена.');return;}
       if(kind==='quadrant'){await repo.prompt(owner,{field:'quadrant',id,expires:now().getTime()+600000});await send(chat,'Выберите квадрант:',{inline_keyboard:QUADRANTS.map((q,i)=>[button(q,'pickquadrant:'+i)])});return;}
       const error=await edit(owner,id,t=>{if(kind==='done'){t.done=true;t.completedAt=now().toISOString();}else if(kind==='tomorrow'){t.date=plusDays(zoned(now(),zone).date,1);t.time='09:00';}else Object.assign(t,zoned(new Date(now().getTime()+Number(kind.slice(1))*60000),zone));},update.update_id);
       if(error)await send(chat,error);else if(kind==='done')await send(chat,'✓ Задача выполнена. Изменения сохранены в «Матрице».');else await card(chat,owner,id);return;
     }
     if(data.startsWith('pickfolder:')&&prompt?.field==='folder'){
       const folder=data.slice(11);if(folder!=='none'&&!UUID.test(folder))return;
       if(folder!=='none'){const row=await repo.task(owner,folder);if(!row||!Core.decode(row).isFolder||Core.decode(row)._meta?.navKind==='month')return;}
       const error=await edit(owner,prompt.id,t=>{t.folderId=folder==='none'?'':folder;},update.update_id);await repo.prompt(owner,null);if(error)await send(chat,error);else await card(chat,owner,prompt.id);return;
     }
     if(/^pickquadrant:[0-3]$/.test(data)&&prompt?.field==='quadrant'){
       const error=await edit(owner,prompt.id,t=>{t.cat=Number(data.split(':')[1]);},update.update_id);await repo.prompt(owner,null);if(error)await send(chat,error);else await card(chat,owner,prompt.id);return;
     }
     if(callback){await send(chat,'Эта кнопка устарела. Откройте задачу заново.',menu());return;}
     if(!text){await send(chat,'Пока принимаю задачи текстом.',menu());return;}
     if(prompt?.field==='date'){
       const schedule=parseSchedule(text,zone,now());if(!schedule){await send(chat,'Не удалось распознать дату. Например: «завтра 09:00» или «2026-12-01 14:00». /cancel — отмена.');return;}
       const error=await edit(owner,prompt.id,t=>Object.assign(t,schedule),update.update_id);await repo.prompt(owner,null);if(error)await send(chat,error);else await card(chat,owner,prompt.id);return;
     }
     if(text.startsWith('/')&&!/^\/add\s/.test(text)){await send(chat,HELP,menu());return;}
     const title=text.replace(/^\/add\s+/,'');if(title.length>300){await send(chat,'Название должно быть не длиннее 300 символов.');return;}
     // Telegram retries reuse this ID; ignoreDuplicates never overwrites an edited task.
     const id=Core.occurrenceId('telegram:'+owner,String(update.update_id));
     await repo.create(Core.encode({id,title,note:'',date:'',time:'',cat:1,done:false,folderId:'',createdAt:now().toISOString()},owner));
     await repo.prompt(owner,null);await send(chat,'Добавлено во «Входящие».');await card(chat,owner,id);
   } catch(error){failed=true;await repo.release(update.update_id);throw error;}
   finally {if(!failed)await repo.finish(update.update_id);}
 }
 return {process,card,send};
}
