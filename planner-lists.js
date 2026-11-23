'use strict';

let archivedMonths=new Map(),monthEdits=new Map(),activeFunnel='';
function mergeArchivedMonths(rows){
 const next=new Map(rows.map(({month,archived})=>[month,archived]));
 for(const [month,archived] of monthEdits)next.set(month,archived);
 const changed=[...next].some(([month,archived])=>!!archived!==!!archivedMonths.get(month))
  ||[...archivedMonths].some(([month,archived])=>archived&&!next.has(month));
 archivedMonths=next;
 return changed;
}
function plannerMonthKeys(){
 const now=new Date();
 const months=new Set(Array.from({length:16},(_,index)=>fmt(new Date(now.getFullYear(),now.getMonth()+index-3,1))));
 for(const task of tasks)if(task.date&&!task.deletedAt)months.add(task.date.slice(0,7)+'-01');
 return [...months].filter(month=>!archivedMonths.get(month)).sort();
}
function plannerMonthRows(months,archived=false){
 const selectedMonth=fmt(monthDate);
 return months.map(month=>{
  const name=esc(monthLabel(parse(month)));
  return `<div class="planner-row">
   <button type="button" class="monthbtn ${!archived&&selectedMonth===month&&['day','week'].includes(view)?'active':''}"
    onclick="openPlannerMonth('${month}')" oncontextmenu="openMonthMenu(event,'${month}')"
    onkeydown="monthMenuKey(event,'${month}')">${name}</button>
   <button type="button" class="btn planner-row-menu" aria-label="${archived?'Вернуть':'Действия'}: ${name}"
    onclick="${archived?`setMonthArchived('${month}',false)`:`openMonthMenu(event,'${month}')`}">${archived?'Вернуть':'⋯'}</button>
   </div>`;
 }).join('');
}
function plannerFunnelRows(){
 const folders=orderedFolderItems().filter(folder=>folder.id);
 return folders.map(folder=>`<div class="planner-row">
  <button type="button" class="monthbtn ${view==='funnel'&&activeFunnel===folder.id?'active':''}"
   onclick="openFunnel('${folder.id}')" oncontextmenu="event.preventDefault();openFolderMenu('${folder.id}')">
   ${uiIcon('folder')}${esc(folder.title)}</button>
  <button type="button" class="btn planner-row-menu" aria-label="Действия: ${esc(folder.title)}" onclick="openFolderMenu('${folder.id}')">⋯</button>
 </div>`).join('')+'<button type="button" class="btn planner-new-funnel" onclick="addFolder(true)">＋ Новая воронка</button>';
}
function renderPlannerLists(){
 document.getElementById('months').innerHTML=plannerMonthRows(plannerMonthKeys())+
  '<button class="btn planner-list-link" onclick="openMonthArchive()">Архив месяцев</button>';
 document.getElementById('funnels').innerHTML=plannerFunnelRows();
}
function openPlannerLists(){
 document.getElementById('modalroot').innerHTML=`<div class="modalback" onclick="if(event.target===this)closeModal()"><section class="modal planner-list">
  <h2>Списки</h2><h3>Воронки</h3><div class="months">${plannerFunnelRows()}</div>
  <h3>Месяцы</h3><div class="months">${plannerMonthRows(plannerMonthKeys())}</div>
  <button class="btn" onclick="openMonthArchive()">Архив месяцев</button>
  <div class="modalactions"><button class="btn" onclick="cloudSignOut()">Выйти из Матрицы</button><button class="btn" onclick="closeModal()">Готово</button></div>
 </section></div>`;
}
function openPlannerMonth(month){
 closeModal();
 go('day');
 selectDate(month);
}
function openMonthArchive(){
 closeModal();
 workflow.archive='months';
 go('archive');
}
function archivedMonthList(){
 const months=[...archivedMonths].filter(([,archived])=>archived).map(([month])=>month).sort().reverse();
 return months.length?`<section class="section-card months">${plannerMonthRows(months,true)}</section>`:'<p class="muted">В архиве пока нет месяцев.</p>';
}
function monthMenuKey(event,month){
 if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))openMonthMenu(event,month);
}
function openMonthMenu(event,month){
 event.preventDefault();
 if(!MatricaCore.date(month))return;
 const name=esc(monthLabel(parse(month)));
 document.getElementById('modalroot').innerHTML=`<div class="modalback" onclick="if(event.target===this)closeModal()"><div class="modal folder-menu planner-context">
  <h2>${name}</h2><button class="btn" id="archive-month-action" onclick="setMonthArchived('${month}',true)">Убрать в архив</button>
  <button class="btn" onclick="closeModal()">Отмена</button></div></div>`;
 const menu=document.querySelector('.planner-context');
 if(menu&&event.clientX>0&&matchMedia('(pointer:fine)').matches){
  menu.style.position='fixed';
  menu.style.left=Math.max(12,Math.min(event.clientX,window.innerWidth-menu.offsetWidth-12))+'px';
  menu.style.top=Math.max(12,Math.min(event.clientY,window.innerHeight-menu.offsetHeight-12))+'px';
 }
 document.getElementById('archive-month-action').focus();
}
function setMonthArchived(month,archived){
 if(!cloudUser||!MatricaCore.date(month)||!month.endsWith('-01'))return;
 archivedMonths.set(month,archived);
 monthEdits.set(month,archived);
 save();
 closeModal();
 render();
 toast(archived?'Месяц в архиве':'Месяц возвращён');
}
function openFunnel(id){
 if(!tasks.some(task=>task.isFolder&&task.id===id))return;
 closeModal();
 activeFunnel=id;
 go('funnel');
}
function funnelHtml(){
 const list=Core.sort(tasks.filter(task=>!task.isFolder&&!task.deletedAt&&task.folderId===activeFunnel),workflow.sort);
 const active=list.filter(task=>!task.done||pendingCompletions.has(task.id));
 const completed=list.filter(task=>task.done&&!pendingCompletions.has(task.id));
 return `<section class="section-card">
  <div class="inboxrow">${taskButton('＋ Добавить задачу',"newTask('',1)")}${taskButton('Настройки воронки',`openFolderMenu('${activeFunnel}')`)}</div>
  ${quickEditor&&!quickEditor.id?quickEditorHtml():''}
  ${active.length?active.map(task=>taskHtml(task,true)).join(''):'<p class="muted">Активных задач пока нет.</p>'}
  ${completed.length?`<details class="day-completed"><summary>Выполнено: ${completed.length}</summary>${completed.map(task=>taskHtml(task,true)).join('')}</details>`:''}
 </section>`;
}
