'use strict';
var taskPushState={ready:false,enabled:false,publicKey:null,timeZone:null,error:'',busy:false,checked:false};
var taskPushRegistration=null;
function pushIOSNeedsInstall(){
  const ios=/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
  return ios && !navigator.standalone && !matchMedia('(display-mode: standalone)').matches;
}
function pushSupported(){return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;}
async function registerTaskPush(){
  if(!pushSupported()) return null;
  if(!taskPushRegistration) {
    await navigator.serviceWorker.register(new URL('./sw.js',document.baseURI),{scope:new URL('./',document.baseURI).pathname});
    taskPushRegistration=await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Не удалось запустить уведомления')),12000))]);
  }
  return taskPushRegistration;
}
async function taskPushRequest(action,body){
  const {data,error}=await db.auth.getSession();
  if(error || !data.session) throw new Error('Сначала войдите в аккаунт');
  const response=await fetch(CLOUD_URL+'/functions/v1/matrica-push?action='+action,{
    method:'POST',headers:{'Content-Type':'application/json','apikey':CLOUD_KEY,'Authorization':'Bearer '+data.session.access_token},body:JSON.stringify(body || {})
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(result.error || 'Не удалось подключить уведомления');
  return result;
}
async function initTaskPush(){
  taskPushState.enabled=false;taskPushState.error='';taskPushState.checked=false;
  try {
    const response=await fetch(CLOUD_URL+'/functions/v1/matrica-push?action=config',{headers:{apikey:CLOUD_KEY}});
    if(!response.ok) throw new Error('Сервер уведомлений ещё не подключён');
    const config=await response.json();
    taskPushState.ready=!!config.ready;taskPushState.publicKey=config.publicKey;
    if(!config.ready) taskPushState.error='Сервер уведомлений ещё не подключён';
    if(config.ready && cloudUser && pushSupported()) {
      const registration=await registerTaskPush(),sub=await registration.pushManager.getSubscription();
      if(sub) {
        const status=await taskPushRequest('status',{endpoint:sub.endpoint});
        taskPushState.enabled=status.enabled && Notification.permission==='granted';
        taskPushState.timeZone=status.timeZone;
      }
    }
  } catch(error) {taskPushState.ready=false;taskPushState.error=error.message;}
  taskPushState.checked=true;updatePushButton();renderTaskPushSettings();openPendingReminder();
}
function updatePushButton(){
  const button=document.getElementById('push-toggle');if(!button)return;
  button.classList.toggle('push-enabled',taskPushState.enabled);
  button.setAttribute('aria-label',taskPushState.enabled?'Уведомления включены':'Настроить уведомления');
  button.title=taskPushState.enabled?'Уведомления включены':'Настроить уведомления';
}
function openNotificationSettings(){
  document.getElementById('modalroot').innerHTML='<div class="modalback" onclick="if(event.target===this)closeModal()"><div class="modal" data-push-settings></div></div>';
  renderTaskPushSettings();
  if(!taskPushState.busy) initTaskPush().catch(console.error);
}
function renderTaskPushSettings(){
  const root=document.querySelector('[data-push-settings]');if(!root)return;
  const needsInstall=pushIOSNeedsInstall(),supported=pushSupported(),denied='Notification' in window && Notification.permission==='denied';
  const zone=taskPushState.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const message=!taskPushState.checked?'Проверяем подключение…':taskPushState.error || (taskPushState.enabled?'Уведомления включены на этом устройстве':'Уведомления выключены на этом устройстве');
  root.innerHTML=`<h2>Напоминания</h2><p>${esc(message)}</p><p class="small">Для напоминания укажите дату и время задачи. Уведомление приходит и при закрытой «Матрице». Проверка времени выполняется раз в минуту.</p>
    ${needsInstall?'<div class="banner">На iPhone откройте опубликованную «Матрицу» в Safari → «Поделиться» → «На экран Домой». Затем откройте её через новую иконку и включите уведомления здесь.</div>':''}
    ${!supported&&!needsInstall?'<p class="small">Этот браузер не поддерживает уведомления. Откройте «Матрицу» в Safari, Chrome или другом браузере с поддержкой Web Push.</p>':''}
    ${denied?'<p class="small">Уведомления запрещены. Разрешите их в настройках браузера или устройства, затем вернитесь сюда.</p>':''}
    <p class="small">Часовой пояс напоминаний: ${esc(zone)}. Для доставки нужен интернет.</p>
    <div class="actions">${taskPushState.enabled?`<button class="btn" onclick="testTaskPush()" ${taskPushState.busy?'disabled':''}>Проверить уведомление</button><button class="btn" onclick="disableTaskPush()" ${taskPushState.busy?'disabled':''}>Выключить на устройстве</button>`:`<button class="btn primary" onclick="enableTaskPush()" ${!taskPushState.ready||!supported||needsInstall||denied||taskPushState.busy?'disabled':''}>Включить уведомления</button>`}</div>
    <div class="modalactions"><div></div><button class="btn" onclick="closeModal()">Готово</button></div>`;
}
function vapidBytes(value){const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
async function enableTaskPush(){
  if(taskPushState.busy || !taskPushState.ready || !cloudUser || !pushSupported() || pushIOSNeedsInstall()) return;
  // Permission is requested directly from the user's tap, before any network awaits.
  const permissionPromise=Notification.requestPermission();
  taskPushState.busy=true;taskPushState.error='';renderTaskPushSettings();
  try {
    if(await permissionPromise!=='granted') throw new Error('Разрешите уведомления, чтобы получать напоминания');
    const reg=await registerTaskPush();
    let subscription=await reg.pushManager.getSubscription();
    if(!subscription) subscription=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:vapidBytes(taskPushState.publicKey)});
    const status=await taskPushRequest('subscribe',{subscription:subscription.toJSON(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});
    taskPushState.enabled=!!status.enabled;taskPushState.timeZone=status.timeZone;
  } catch(error){taskPushState.error=error.message;taskPushState.enabled=false;}
  finally {taskPushState.busy=false;updatePushButton();renderTaskPushSettings();}
}
async function detachTaskPush(){
  if(!pushSupported())return;
  const reg=await navigator.serviceWorker.getRegistration(new URL('./',document.baseURI));
  const subscription=await reg?.pushManager.getSubscription();if(!subscription)return;
  try {await taskPushRequest('unsubscribe',{endpoint:subscription.endpoint});}
  finally {await subscription.unsubscribe();taskPushState.enabled=false;updatePushButton();}
}
async function disableTaskPush(){
  if(taskPushState.busy)return;taskPushState.busy=true;
  try {await detachTaskPush();taskPushState.error='';}
  catch(error){taskPushState.error=error.message;}
  finally{taskPushState.busy=false;renderTaskPushSettings();}
}
async function testTaskPush(){
  if(taskPushState.busy)return;taskPushState.busy=true;taskPushState.error='';renderTaskPushSettings();
  try {
    const reg=await registerTaskPush(),sub=await reg.pushManager.getSubscription();
    if(!sub)throw new Error('Сначала включите уведомления');
    await taskPushRequest('test',{endpoint:sub.endpoint});toast('Проверочное уведомление отправлено');
  }catch(error){taskPushState.error=error.message;}
  finally{taskPushState.busy=false;renderTaskPushSettings();}
}
function taskPushSignedOut(){
  taskPushState.enabled=false;updatePushButton();
  if('serviceWorker' in navigator)navigator.serviceWorker.getRegistration(new URL('./',document.baseURI)).then(r=>r?.pushManager?.getSubscription()).then(s=>s?.unsubscribe()).catch(console.error);
}
async function openReminderTask(id){
  if(!cloudUser || typeof id!=='string')return;
  const task=tasks.find(t=>t.id===id&&!t.isFolder);if(!task)return;
  if(task.done)go('archive');else if(task.date)selectDate(task.date);else go('inbox');
}
function openPendingReminder(){
  const current=new URL(location.href),id=current.searchParams.get('task');
  if(id&&cloudUser){openReminderTask(id);current.searchParams.delete('task');history.replaceState(null,'',current);}
}
if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('message',event=>{
  if(event.data?.type==='matrica-open-task')openReminderTask(event.data.taskId);
  if(event.data?.type==='matrica-push-expired'){taskPushState.enabled=false;updatePushButton();}
});
