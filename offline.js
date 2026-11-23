'use strict';

const offlineAccountKey='matrica.offline.account.v1';
const signedOutKey='matrica.signed-out.v1';
const authStorageKey='sb-qageovdipbmegxfcsvdp-auth-token';
let sessionCheck=null,sessionResolved=false,signingOut=false,realtimeTimer;
const plannerRoots=document.querySelectorAll('.app,.mobilebar,.composebar');
function offlineStatus(){cloudStatus('Локальная копия · изменения отправятся при подключении')}
function lockPlanner(){for(const root of plannerRoots)root.inert=true}
function unlockPlanner(){
 for(const root of plannerRoots)root.inert=false;
 document.getElementById('authroot').innerHTML='';
 document.getElementById('signout').style.display='block';
}
function authScreen(message='',loading=false){
 lockPlanner();
 const content=loading?'<p role="status">Проверяем вход…</p>':`
  <p class="small">Войдите в существующий аккаунт Матрицы, чтобы открыть свои задачи.</p>
  <label class="field">Электронная почта<input id="auth-email" type="email" autocomplete="username" required></label>
  <label class="field">Пароль<input id="auth-password" type="password" autocomplete="current-password" required></label>
  <p class="small" id="auth-message" role="status">${esc(message)}</p>
  <button class="btn primary" id="auth-form-submit" type="submit">Войти</button>`;
 document.getElementById('authroot').innerHTML=`<div class="modalback auth-back"><form class="modal" onsubmit="cloudAuth(event)"><h2>Матрица · Вход</h2>${content}</form></div>`;
}
async function cloudAuth(event){
 event.preventDefault();
 const message=document.getElementById('auth-message'),submit=document.getElementById('auth-form-submit');
 if(!db||submit.disabled)return;
 const email=document.getElementById('auth-email').value.trim(),password=document.getElementById('auth-password').value;
 submit.disabled=true;
 message.textContent='Проверяем данные…';
 try{
  const {data,error}=await db.auth.signInWithPassword({email,password});
  if(error)throw error;
  if(!data.session?.user)throw new Error('No session');
  try{localStorage.removeItem(signedOutKey)}catch{}
  await cloudLogin(data.session.user);
 }catch(error){
  message.textContent=error.code==='invalid_credentials'?'Проверьте адрес почты и пароль.':navigator.onLine===false||error.name==='AuthRetryableFetchError'?'Нет связи с сервером. Попробуйте после подключения.':'Не удалось войти. Проверьте данные и попробуйте снова.';
 }finally{submit.disabled=false}
}
function storedAccount(){
 try{
  if(localStorage.getItem(signedOutKey))return null;
  const user=JSON.parse(localStorage.getItem(offlineAccountKey));
  return user?.id?user:null;
 }catch{return null}
}
function restoreAccountTasks(user){
 try{
  const pending=JSON.parse(localStorage.getItem('matrica.pending.v2.'+user.id));
  if(!Array.isArray(pending?.tasks)||!Array.isArray(pending?.snapshot))return false;
  tasks=pending.tasks;
  cloudSnapshot=new Map(pending.snapshot);
  archivedMonths=new Map(pending.months??[]);
  monthEdits=new Map(pending.monthEdits??[]);
  return true;
 }catch(error){console.error(error);return false}
}
function restoreOfflineAccount(){
 const user=storedAccount();
 if(!user||!restoreAccountTasks(user))return false;
 cloudUser=user;
 unlockPlanner();
 render();
 openPendingReminder();
 return true;
}
function clearCloudAccount(){
 cloudCanSync=false;
 cloudEpoch++;
 cloudRun=null;
 cloudQueued=false;
 clearTimeout(realtimeTimer);
 if(cloudChannel){db.removeChannel(cloudChannel);cloudChannel=null}
 closeModal();
 quickEditor=null;
 clearPendingCompletions();
 taskClipboard=null;
 selectedTaskId=null;
 pasteTarget=null;
 cloudUser=null;
 tasks=[];
 cloudSnapshot=new Map();
 archivedMonths=new Map();
 monthEdits=new Map();
 activeFunnel='';
 inboxFolder='all';
 view='day';
 selected=fmt(new Date());
 monthDate=new Date(parse(selected).getFullYear(),parse(selected).getMonth(),1);
 document.getElementById('signout').style.display='none';
 render();
}
function requireAccount(message){
 sessionResolved=true;
 if(cloudUser){persistPending();clearCloudAccount();taskPushSignedOut()}
 try{localStorage.removeItem(offlineAccountKey)}catch{}
 cloudStatus('Войдите в аккаунт');
 authScreen(message);
}
function subscribeCloud(user){
 if(cloudChannel)return;
 const change=()=>{
  clearTimeout(realtimeTimer);
  realtimeTimer=setTimeout(resumeSync,300);
 };
 cloudChannel=db.channel('matrica-'+user.id)
  .on('postgres_changes',{event:'*',schema:'public',table:'tasks',filter:'user_id=eq.'+user.id},change)
  .on('postgres_changes',{event:'*',schema:'public',table:'matrica_months',filter:'user_id=eq.'+user.id},change)
  .subscribe(status=>{if(status==='SUBSCRIBED')change()});
}
async function cloudLogin(user){
 if(signingOut)return;
 sessionResolved=true;
 const newAccount=cloudUser?.id!==user.id,wasConnected=cloudCanSync;
 if(newAccount){clearCloudAccount();restoreAccountTasks(user)}
 cloudUser=user;
 cloudCanSync=true;
 try{localStorage.setItem(offlineAccountKey,JSON.stringify({id:user.id,email:user.email}))}catch{}
 unlockPlanner();
 persistPending();
 if(newAccount||!wasConnected){
  cloudStatus('Загружаем задачи…');
  render();
  initTaskPush().catch(console.error);
 }
 subscribeCloud(user);
 try{await cloudRefresh()}catch(error){console.error(error)}
 openPendingReminder();
}
function recoverOnlineSession(){
 if(!db||navigator.onLine===false||signingOut)return;
 if(sessionCheck)return sessionCheck;
 const epoch=cloudEpoch;
 sessionCheck=(async()=>{
  try{
   const {data,error}=await db.auth.getSession();
   if(epoch!==cloudEpoch||signingOut)return;
   if(error)throw error;
   if(data.session?.user){
    await cloudLogin(data.session.user);
   }else{
    requireAccount('Войдите, чтобы открыть задачи. Локальные изменения сохраняются до следующего входа.');
   }
  }catch(error){
   if(epoch!==cloudEpoch||signingOut)return;
   if(error.name==='AuthRetryableFetchError'){
    if(cloudUser||restoreOfflineAccount())offlineStatus();
    else authScreen('Нет связи с сервером. Для первого входа нужен интернет.');
   }else{
    requireAccount('Сессия закончилась. Войдите снова.');
   }
  }
 })().finally(()=>{sessionCheck=null});
 return sessionCheck;
}
async function cloudInit(){
 authScreen('',true);
 if(!window.supabase){
  authScreen('Не удалось загрузить вход. Обновите страницу после подключения.');
  return;
 }
 try{
  if(localStorage.getItem(signedOutKey))localStorage.removeItem(authStorageKey);
 }catch{}
 db=window.supabase.createClient(CLOUD_URL,CLOUD_KEY,{
  auth:{storageKey:authStorageKey,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false},
  global:{fetch:(input,init={})=>{
   const controller=new AbortController();
   const abort=()=>controller.abort();
   const timeout=setTimeout(abort,15000);
   if(init.signal?.aborted)abort();
   init.signal?.addEventListener('abort',abort,{once:true});
   return fetch(input,{...init,signal:controller.signal}).finally(()=>{
    clearTimeout(timeout);
    init.signal?.removeEventListener('abort',abort);
   });
  }},
 });
 db.auth.onAuthStateChange((event,session)=>{
  // Supabase invokes this callback while holding its session lock.
  if(event==='SIGNED_OUT'&&!signingOut)setTimeout(()=>{
   if(!signingOut)requireAccount('Сессия закончилась. Войдите снова.');
  },0);
  if(event==='SIGNED_IN'&&session?.user&&session.user.id!==cloudUser?.id)setTimeout(()=>{
   if(!signingOut)recoverOnlineSession();
  },0);
 });
 if(navigator.onLine===false){
  if(restoreOfflineAccount())offlineStatus();
  else authScreen('Для первого входа нужен интернет.');
  return;
 }
 await recoverOnlineSession();
}
function resumeSync(){
 if(document.visibilityState==='hidden'||signingOut)return;
 const now=new Date();
 if(fmt(now)!==fmt(today)){
  if(view==='day'&&selected===fmt(today)){
   selected=fmt(now);
   monthDate=new Date(now.getFullYear(),now.getMonth(),1);
  }
  today=now;
  render();
 }
 if(navigator.onLine===false){if(cloudUser)offlineStatus();return}
 if(cloudCanSync)cloudRefresh()?.catch(console.error);
 else if(!sessionResolved||cloudUser)recoverOnlineSession();
}
document.addEventListener('visibilitychange',resumeSync);
window.addEventListener('focus',resumeSync);
window.addEventListener('pageshow',resumeSync);
window.addEventListener('online',resumeSync);
window.addEventListener('offline',()=>{if(cloudUser){persistPending();offlineStatus()}});
setInterval(resumeSync,30000);

async function cloudSignOut(){
 if(signingOut||!confirm('Выйти из аккаунта Матрицы? Локальные изменения останутся на устройстве до следующего входа.'))return;
 signingOut=true;
 cloudCanSync=false;
 persistPending();
 lockPlanner();
 authScreen('',true);
 try{if(navigator.onLine!==false)await detachTaskPush()}catch(error){console.error(error)}
 try{await db?.auth.signOut({scope:'local'})}catch(error){console.error(error)}
 finally{
  try{
   localStorage.setItem(signedOutKey,'1');
   localStorage.removeItem(authStorageKey);
   localStorage.removeItem(authStorageKey+'-code-verifier');
  }catch{}
  requireAccount();
  signingOut=false;
 }
}
function openInstallHelp(){
 document.getElementById('modalroot').innerHTML=`<div class="modalback" onclick="if(event.target===this)closeModal()"><section class="modal"><h2>Матрица как приложение</h2><p><b>iPhone:</b> откройте этот адрес в Safari, нажмите «Поделиться» → «На экран Домой» и включите «Открывать как веб-приложение», если есть такой переключатель.</p><p><b>Mac:</b> в Safari выберите «Файл» → «Добавить в Dock».</p><p class="small">После установки войдите в тот же аккаунт Матрицы. Когда загрузятся задачи, с ними можно работать без сети. Уведомления включаются отдельно на каждом устройстве.</p><p class="small" id="offline-ready" role="status">Проверяем готовность к работе без сети…</p><button class="btn primary" onclick="closeModal()">Готово</button></section></div>`;
 if('caches' in window)caches.match(new URL('index.html',document.baseURI)).then(ready=>{
  const element=document.getElementById('offline-ready');
  if(element)element.textContent=ready?'Интерфейс сохранён для запуска без интернета.':'Оставьте Матрицу открытой с интернетом до завершения загрузки.';
 }).catch(console.error);
}
if('serviceWorker' in navigator&&window.isSecureContext){
 navigator.serviceWorker.register(new URL('./sw.js',document.baseURI),{scope:new URL('./',document.baseURI).pathname,updateViaCache:'none'}).catch(console.error);
 navigator.storage?.persist?.().catch(()=>{});
}
const installButton=document.createElement('button');
installButton.className='btn';
installButton.textContent='Установить приложение';
installButton.onclick=openInstallHelp;
installButton.style.margin='8px 0';
document.querySelector('.footer')?.before(installButton);
