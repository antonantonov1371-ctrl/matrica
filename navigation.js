'use strict';
// Navigation metadata uses the existing owner-scoped folder envelope. Task rows are never moved or deleted when archiving navigation items.
const listNavigation={selected:null,userId:null,suppressClickUntil:0};
const listColors=['#3484fa','#39bc62','#fa9e34','#a174e8','#ec6b8d','#7c8b94'];
const isNavigationMonth=t=>t.isFolder&&t._meta?.navKind==='month'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(t._meta.navMonth||'');
const userLists=()=>tasks.filter(t=>t.isFolder&&!isNavigationMonth(t));
const archivedList=t=>!!t?._meta?.navArchivedAt;
const navigationTask=t=>!t.isFolder&&!t.deletedAt&&(!t.done||pendingCompletions.has(t.id));
function navigationMonthTitle(key){return monthLabel(parse(key+'-01'))}
function navigationMonthState(key){return tasks.find(t=>isNavigationMonth(t)&&t._meta.navMonth===key)}
function navigationMonths(){
 const keys=new Set();for(let n=-3;n<=12;n++)keys.add(fmt(new Date(today.getFullYear(),today.getMonth()+n,1)).slice(0,7));
 for(const t of tasks){if(isNavigationMonth(t))keys.add(t._meta.navMonth);else if(navigationTask(t)&&Core.date(t.date))keys.add(t.date.slice(0,7))}
 return [...keys].sort().map(key=>({key,title:navigationMonthTitle(key),archived:archivedList(navigationMonthState(key)),count:tasks.filter(t=>navigationTask(t)&&t.date?.startsWith(key+'-')).length}));
}
function navigationItems(){return [...navigationMonths().map(m=>({...m,key:'month:'+m.key,color:'#7c8b94',kind:'month'})),...userLists().map((t,i)=>({key:'list:'+t.id,title:t.title,archived:archivedList(t),count:tasks.filter(x=>navigationTask(x)&&x.folderId===t.id).length,color:listColors.includes(t._meta?.navColor)?t._meta.navColor:listColors[i%listColors.length],kind:'list',rank:t.folderRank??(i+1)*1024})).sort((a,b)=>(a.rank||0)-(b.rank||0))]}
function navigationItem(key){return navigationItems().find(item=>item.key===key)}
function navigationRow(item,archived=false){
 const selectedItem=item.kind==='month'?['day','week'].includes(view)&&fmt(monthDate).startsWith(item.key.slice(6)):view==='list'&&listNavigation.selected===item.key.slice(5);
 return `<div class="nav-list-row"><button type="button" class="nav-list-button ${selectedItem?'active':''}" data-nav-key="${esc(item.key)}" oncontextmenu="navigationContext(event,this.dataset.navKey)" onpointerdown="navigationHold(event)" onkeydown="navigationKey(event,this.dataset.navKey)" onclick="selectNavigationItem(this.dataset.navKey)"><span class="nav-list-icon" style="--list-color:${item.color}" aria-hidden="true">☷</span><span class="nav-list-name">${esc(item.title)}</span><span class="nav-list-count" aria-label="${item.count} задач">${item.count}</span></button>${archived?`<button class="btn nav-restore" data-nav-key="${esc(item.key)}" onclick="setNavigationArchived(this.dataset.navKey,false)" aria-label="Восстановить ${esc(item.title)}">Вернуть</button>`:''}</div>`;
}
function navigationLibrary(){return `<div class="nav-user-lists">${navigationItems().filter(i=>!i.archived).map(i=>navigationRow(i)).join('')}</div><button class="nav-add-list" onclick="editNavigationList()">＋ Добавить список</button><button class="nav-archive-link" onclick="openNavigationArchive()">${uiIcon('archive')}Архив списков <span>${navigationItems().filter(i=>i.archived).length}</span></button>`}
const previousNavigationRender=renderNav;
renderNav=function(){
 previousNavigationRender();const root=document.getElementById('months');if(root){if(root.previousElementSibling)root.previousElementSibling.textContent='Мои списки';root.classList.add('my-lists');root.innerHTML=navigationLibrary()}
};
function openMyLists(){document.getElementById('modalroot').innerHTML=`<div class="modalback" onclick="if(event.target===this)closeModal()"><section class="modal nav-library"><div class="result-heading"><h2>Мои списки</h2>${taskButton('Готово','closeModal()')}</div><div data-nav-library>${navigationLibrary()}</div></section></div>`}
function openNavigationArchive(){const archived=navigationItems().filter(i=>i.archived);document.getElementById('modalroot').innerHTML=`<div class="modalback" onclick="if(event.target===this)closeModal()"><section class="modal nav-library"><h2>Архив списков</h2><p class="small">Месяцы и списки скрыты из панели. Их задачи, даты и напоминания сохранены.</p><div data-nav-archive>${archived.length?archived.map(i=>navigationRow(i,true)).join(''):'<p class="muted">В архиве пока пусто.</p>'}</div><div class="modalactions">${taskButton('Мои списки','openMyLists()')}${taskButton('Готово','closeModal()')}</div></section></div>`}
function selectNavigationItem(key,force=false){
 if(!force&&Date.now()<listNavigation.suppressClickUntil)return;const item=navigationItem(key);if(!item)return;closeModal();quickEditor=null;workflow.query='';workflow.tag='';workflow.smart='section';workflow.selecting=false;workflow.ids.clear();
 if(item.kind==='month'){const month=key.slice(6);monthDate=parse(month+'-01');selected=month+'-01';view='day'}else{listNavigation.selected=key.slice(5);view='list'}render();
}
function navigationContext(event,key){event.preventDefault();event.stopPropagation();openNavigationMenu(key)}
function navigationKey(event,key){if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();openNavigationMenu(key)}}
function navigationHold(event){
 if(event.button!==0||event.pointerType==='mouse')return;const key=event.currentTarget.dataset.navKey,x=event.clientX,y=event.clientY;
 const cleanup=()=>{clearTimeout(timer);document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',cleanup);document.removeEventListener('pointercancel',cleanup)};
 const move=e=>{if(Math.hypot(e.clientX-x,e.clientY-y)>9)cleanup()};
 const timer=setTimeout(()=>{cleanup();listNavigation.suppressClickUntil=Date.now()+800;openNavigationMenu(key)},550);
 document.addEventListener('pointermove',move,{passive:true});document.addEventListener('pointerup',cleanup);document.addEventListener('pointercancel',cleanup);
}
function openNavigationMenu(key){const item=navigationItem(key);if(!item)return;document.getElementById('modalroot').innerHTML=`<div class="modalback" onclick="if(event.target===this)closeModal()"><section class="modal task-actions"><h2>${esc(item.title)}</h2><button class="btn" data-nav-key="${esc(key)}" onclick="selectNavigationItem(this.dataset.navKey,true)">Открыть</button>${item.kind==='list'?`<button class="btn" data-list-id="${esc(key.slice(5))}" onclick="editNavigationList(this.dataset.listId)">Переименовать / изменить цвет</button>`:''}<button class="btn" data-nav-key="${esc(key)}" onclick="setNavigationArchived(this.dataset.navKey,${!item.archived})">${item.archived?'Вернуть в «Мои списки»':'Убрать в архив'}</button>${taskButton('Отмена','closeModal()')}</section></div>`}
function setNavigationArchived(key,archived){
 if(!cloudUser)return;const item=navigationItem(key);if(!item)return;const reopen=!!document.querySelector('[data-nav-archive]');let record;
 if(item.kind==='month'){
  const month=key.slice(6);record=navigationMonthState(month);
  if(!record){record={id:Core.occurrenceId('navigation.month.'+cloudUser.id,month+'-01'),title:'Месяц: '+item.title,note:'',date:'',time:'',cat:1,isFolder:true,done:false,createdAt:new Date().toISOString(),_meta:{navKind:'month',navMonth:month}};tasks.push(record)}
 }else record=userLists().find(t=>t.id===key.slice(5));
 if(!record)return;record._meta={...(record._meta||{}),navArchivedAt:archived?new Date().toISOString():null};
 if(archived&&view==='list'&&listNavigation.selected===record.id){view='inbox';inboxFolder='all';quickEditor=null}
 if(archived&&inboxFolder===record.id)inboxFolder='all';save();closeModal();render();if(reopen)openNavigationArchive();toast(archived?'Убрано в архив. Задачи сохранены.':'Возвращено в «Мои списки»');
}
function editNavigationList(id=''){
 const list=id?userLists().find(t=>t.id===id):null;if(id&&!list)return;
 document.getElementById('modalroot').innerHTML=`<div class="modalback" onclick="if(event.target===this)closeModal()"><form class="modal" onsubmit="saveNavigationList(event,'${id}')"><h2>${list?'Изменить список':'Новый список'}</h2><label class="field">Название<input id="nav-list-title" required maxlength="100" placeholder="Например, ЛН офис" value="${esc(list?.title||'')}"></label><label class="field">Цвет<select id="nav-list-color">${listColors.map((color,i)=>`<option value="${color}" ${list?._meta?.navColor===color?'selected':''}>${['Синий','Зелёный','Оранжевый','Фиолетовый','Розовый','Серый'][i]}</option>`).join('')}</select></label><p class="small" id="nav-list-error" role="alert"></p><div class="modalactions">${taskButton('Отмена','closeModal()')}<button class="btn primary" type="submit">${list?'Сохранить':'Создать список'}</button></div></form></div>`;document.getElementById('nav-list-title').focus();
}
function saveNavigationList(event,id=''){
 event.preventDefault();if(!cloudUser)return;const title=document.getElementById('nav-list-title').value.trim(),color=document.getElementById('nav-list-color').value;
 if(!title||title.length>100){document.getElementById('nav-list-error').textContent='Введите название до 100 символов';return}
 const duplicate=userLists().find(t=>t.id!==id&&t.title.toLocaleLowerCase()===title.toLocaleLowerCase());if(duplicate){document.getElementById('nav-list-error').textContent=archivedList(duplicate)?'Такой список уже есть в архиве. Его можно восстановить.':'Список с таким названием уже существует';return}
 let list=id?userLists().find(t=>t.id===id):null;if(id&&!list)return;
 if(!list){list={id:uid(),title,note:'',date:'',time:'',cat:1,done:false,isFolder:true,folderRank:Math.max(0,...userLists().map(t=>t.folderRank||0))+1024,createdAt:new Date().toISOString()};tasks.push(list)}
 list.title=title;list._meta={...(list._meta||{}),navColor:listColors.includes(color)?color:listColors[0]};save();closeModal();listNavigation.selected=list.id;view='list';workflow.query='';workflow.tag='';workflow.smart='section';render();toast(id?'Список изменён':'Список создан');
}
orderedFolderItems=function(){return [{id:'',title:'Без папки',rank:0},...userLists().map((t,i)=>({id:t.id,title:t.title,rank:Number.isFinite(t.folderRank)?t.folderRank:(i+1)*1024}))].sort((a,b)=>a.rank-b.rank)};
folderBar=function(){return '<div class="folderbar"><button class="btn '+(inboxFolder==='all'?'selected':'')+'" onclick="selectInboxFolder(\'all\')">Все</button>'+orderedFolderItems().filter(f=>!f.id||!archivedList(userLists().find(t=>t.id===f.id))).map(f=>`<button type="button" class="btn folder-chip ${inboxFolder===f.id?'selected':''}" data-folder-id="${f.id}" onpointerdown="holdFolder(event)" oncontextmenu="event.preventDefault();openFolderMenu(this.dataset.folderId)" onkeydown="folderKey(event,this.dataset.folderId)" onclick="selectInboxFolder(this.dataset.folderId)">${f.id?'📁 ':''}${esc(f.title)}</button>`).join('')+'<button class="btn" onclick="addFolder()">＋ Папка</button></div>'};
folderSelect=function(t){return `<label class="field">Список / папка<select id="t-folder"><option value="">Без папки</option>${userLists().map(f=>`<option value="${f.id}" ${t.folderId===f.id?'selected':''}>${esc(f.title)}${archivedList(f)?' (в архиве)':''}</option>`).join('')}</select></label>`};
function navigationListHtml(list){
 const visible=tasks.filter(t=>!t.isFolder&&!t.deletedAt&&t.folderId===list.id),pending=t=>!t.done||pendingCompletions.has(t.id),done=visible.filter(t=>!pending(t));
 return `<div class="quadrants">${cats.map((c,i)=>{const items=Core.sort(visible.filter(t=>pending(t)&&t.cat===i),workflow.sort),key='list-'+list.id+'-'+i,collapsed=workflow.collapsed.has(key);return `<section class="quad" data-list-id="${list.id}" data-date="" data-cat="${i}" style="--bg:${c.bg};--fg:${c.fg};--border:${c.border}" ondragover="dragOver(event)" ondragleave="this.classList.remove('dragover')" ondrop="dropTask(event)"><div class="quadhead"><button class="quad-toggle" aria-expanded="${!collapsed}" onclick="toggleQuadrant('${key}')"><span aria-hidden="true">${collapsed?'▸':'▾'}</span><span class="quad-heading-label">${c.label}</span><small class="quad-count">${items.length}</small></button><button aria-label="Добавить задачу" onclick="newTask('',${i})">+</button></div>${collapsed?'':`${items.map(t=>taskHtml(t,true)).join('')}${quickEditor&&!quickEditor.id&&quickEditor.navListId===list.id&&quickEditor.anchorCat===i?quickEditorHtml():''}${items.length?'':'<div class="empty">Пока нет задач</div>'}<button class="addline" onclick="newTask('',${i})">＋ Добавить задачу</button>`}</section>`}).join('')}</div>${done.length?`<details class="day-completed"><summary>Выполнено: ${done.length}</summary>${done.map(t=>taskHtml(t,true)).join('')}</details>`:''}`;
}
const previousListRender=render;
render=function(){
 if(listNavigation.userId!==cloudUser?.id){listNavigation.userId=cloudUser?.id;listNavigation.selected=null;if(view==='list')view='day'}
 if(view==='list'&&!userLists().some(t=>t.id===listNavigation.selected)){view='inbox';inboxFolder='all';quickEditor=null}
 const editorFocus=view==='list'&&['qe-title','qe-note'].includes(document.activeElement?.id)?{id:document.activeElement.id,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd}:null;const openSteps=new Set([...document.querySelectorAll('[data-subtask-owner][open]')].map(e=>e.dataset.subtaskOwner));
 previousListRender();
 if(view==='list'){
  const list=userLists().find(t=>t.id===listNavigation.selected);if(!list)return;
  document.getElementById('heading').textContent=list.title;document.getElementById('subtitle').textContent='Четыре приоритета · задачи этого списка';
  document.getElementById('actions').innerHTML=`<button class="btn" data-list-id="${list.id}" onclick="editNavigationList(this.dataset.listId)">Изменить список</button>`;
  if(!workflowGlobal())document.getElementById('content').innerHTML=navigationListHtml(list);
 }
 const library=document.querySelector('[data-nav-library]');if(library)library.innerHTML=navigationLibrary();
 if(view==='list'){document.querySelectorAll('[data-subtask-owner]').forEach(e=>{if(openSteps.has(e.dataset.subtaskOwner))e.open=true});if(editorFocus){const field=document.getElementById(editorFocus.id);if(field){field.focus({preventScroll:true});field.setSelectionRange(editorFocus.start,editorFocus.end)}}paintTaskSelection()}
};
const previousListNewTask=newTask;
newTask=function(date='',cat=0){if(view!=='list')return previousListNewTask(date,cat);const list=userLists().find(t=>t.id===listNavigation.selected);if(!list)return;workflow.query='';workflow.tag='';workflow.smart='section';workflow.selecting=false;workflow.ids.clear();workflow.collapsed.delete('list-'+list.id+'-'+cat);quickEditor={id:null,title:'',note:'',date,time:'',cat,folderId:list.id,anchorDate:date,anchorCat:cat,navListId:list.id};render();focusQuick()};
const previousListQuickSave=quickSave;
quickSave=function(){const listId=view==='list'?listNavigation.selected:null;previousListQuickSave();if(listId){listNavigation.selected=listId;view='list';render()}};
const previousListMoveTask=moveTask;
moveTask=function(id,date,cat){if(view!=='list'||date)return previousListMoveTask(id,date,cat);const list=userLists().find(t=>t.id===listNavigation.selected);if(!list||!Number.isInteger(cat)||cat<0||cat>3)return;changeTasks([id],t=>({...t,folderId:list.id,cat}),'перемещение в списке')};
const previousListTaskDrop=taskDrop;
taskDrop=function(event){if(view!=='list')return previousListTaskDrop(event);const source=activeTask(draggedTask),target=activeTask(event.currentTarget.dataset.taskId);if(!source||!target||source.id===target.id)return;event.preventDefault();event.stopPropagation();clearDrag();const list=Core.sort(tasks.filter(t=>!t.isFolder&&!t.deletedAt&&t.folderId===target.folderId&&t.cat===target.cat&&t.id!==source.id),'manual'),before=clone([source,...list]),index=list.findIndex(t=>t.id===target.id),rect=event.currentTarget.getBoundingClientRect();Object.assign(source,{folderId:target.folderId,cat:target.cat});list.splice(index+(event.clientY>rect.top+rect.height/2?1:0),0,source);list.forEach((t,i)=>{t.rank=i*1024});recordUndo(before,'порядок задач');save();render()};
function pasteIntoNavigationList(event){
 if(view!=='list'||!(event.metaKey||event.ctrlKey)||event.altKey||event.shiftKey||event.repeat||!(event.code==='KeyV'||event.key?.toLowerCase()==='v'))return;
 if(event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')||document.getElementById('modalroot').children.length||document.getElementById('authroot').children.length)return;
 if(!taskClipboard||taskClipboard.userId!==cloudUser?.id)return;const list=userLists().find(t=>t.id===listNavigation.selected);if(!list)return;
 event.preventDefault();event.stopImmediatePropagation();const source=taskClipboard.task,cat=pasteTarget?.date===''?pasteTarget.cat:source.cat;let pasted;
 if(taskClipboard.mode==='cut'){pasted=activeTask(source.id);if(!pasted){taskClipboard=null;toast('Исходная задача больше недоступна');return}Object.assign(pasted,{folderId:list.id,cat});taskClipboard=null}
 else{pasted={...clone(source),id:uid(),folderId:list.id,cat,done:false,completedAt:null,deletedAt:null,deletedState:null,seriesId:null,nextOccurrenceId:null,generatedFrom:null,createdAt:new Date().toISOString(),subtasks:Core.subtasks(source.subtasks).map(s=>({...s,id:uid(),done:false}))};tasks.push(pasted)}
 selectedTaskId=pasted.id;save();render();paintTaskSelection();toast('Задача вставлена в список');
}
document.addEventListener('keydown',pasteIntoNavigationList,true);
render();
