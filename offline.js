/* Cached identity unlocks only this device's copy. Supabase still authorizes every request. */
const offlineAccountKey='matrica.offline.account.v1';
let rebaseNeeded=true,offlineExplicitSignOut=false;
function offlineStatus(){cloudStatus('Без подключения · изменения сохранены на устройстве')}
function rememberOfflineAccount(user){try{localStorage.setItem(offlineAccountKey,JSON.stringify({id:user.id,email:user.email}))}catch(e){console.error(e)}}
function restoreOfflineAccount(){
 try{const user=JSON.parse(localStorage.getItem(offlineAccountKey));if(!user?.id)return false;
 const pending=JSON.parse(localStorage.getItem('matrica.pending.v2.'+user.id));
 if(!Array.isArray(pending?.tasks)||!Array.isArray(pending?.snapshot))return false;
 cloudUser=user;tasks=pending.tasks;cloudSnapshot=new Map(pending.snapshot);
 document.getElementById('authroot').innerHTML='';document.getElementById('signout').style.display='block';render();return true;
 }catch(e){console.error(e);return false}
}
const connectedCloudSave=cloudSave,connectedCloudRefresh=cloudRefresh;
cloudSave=async function(){
 if(!cloudUser)return;
 persistPending();
 if(navigator.onLine===false){rebaseNeeded=true;offlineStatus();return}
 if(rebaseNeeded)return cloudRefresh();
 try{return await connectedCloudSave()}catch(e){rebaseNeeded=true;cloudStatus('Изменения сохранены на устройстве · ожидаем подключения');throw e}
};
cloudRefresh=async function(){
 if(!cloudUser)return;
 if(navigator.onLine===false){rebaseNeeded=true;offlineStatus();return}
 // The original refresh merges fresh remote rows before calling cloudSave.
 rebaseNeeded=false;
 try{return await connectedCloudRefresh()}catch(e){rebaseNeeded=true;cloudStatus('Изменения сохранены на устройстве · ожидаем подключения');throw e}
};
cloudLogin=async function(user){
 if(cloudUser?.id!==user.id){
  if(cloudChannel){db.removeChannel(cloudChannel);cloudChannel=null}
  quickEditor=null;clearPendingCompletions();tasks=[];cloudSnapshot=new Map();cloudUser=user;
  try{const pending=JSON.parse(localStorage.getItem(pendingKey()));if(Array.isArray(pending?.tasks)&&Array.isArray(pending?.snapshot)){tasks=pending.tasks;cloudSnapshot=new Map(pending.snapshot)}}catch(e){console.error(e)}
 }
 cloudUser=user;rememberOfflineAccount(user);persistPending();rebaseNeeded=true;
 document.getElementById('authroot').innerHTML='';document.getElementById('signout').style.display='block';render();
 if(navigator.onLine===false){offlineStatus();return}
 try{await cloudRefresh()}catch(e){console.error(e)}
 initTaskPush().catch(console.error);
 if(!cloudChannel&&db)cloudChannel=db.channel('tasks-'+user.id).on('postgres_changes',{event:'*',schema:'public',table:'tasks',filter:'user_id=eq.'+user.id},resumeSync).subscribe();
};
async function recoverOnlineSession(){
 if(!db||navigator.onLine===false)return;
 try{const {data,error}=await db.auth.getSession();if(error)throw error;
 if(data.session?.user){await cloudLogin(data.session.user)}
 else authScreen('Войдите снова для синхронизации. Изменения на этом устройстве сохранены.');
 }catch(e){if(cloudUser){cloudStatus('Работаем с локальной копией · ожидаем подключения')}else authScreen('Для первого входа нужен интернет. После входа задачи будут доступны без сети.');console.error(e)}
}
cloudInit=async function(){
 restoreOfflineAccount();
 try{
 if(!window.supabase)throw new Error('Не удалось загрузить приложение');
 db=window.supabase.createClient(CLOUD_URL,CLOUD_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 db.auth.onAuthStateChange((event,session)=>{
  if(event==='SIGNED_IN'&&session?.user&&cloudUser?.id!==session.user.id)setTimeout(()=>cloudLogin(session.user),0);
  if(event==='SIGNED_OUT'&&!offlineExplicitSignOut&&navigator.onLine!==false){rebaseNeeded=true;authScreen('Для синхронизации войдите снова. Локальные изменения сохранены.')}
 });
 if(navigator.onLine===false){if(cloudUser)offlineStatus();else authScreen('Для первого входа нужен интернет. После входа задачи будут доступны без сети.');return}
 await recoverOnlineSession();
 }catch(e){if(cloudUser)offlineStatus();else authScreen('Для первого открытия нужен интернет. Подключитесь и обновите страницу.');console.error(e)}
};
const connectedResumeSync=resumeSync;
resumeSync=function(){
 if(navigator.onLine===false){if(cloudUser)offlineStatus();return}
 if(cloudUser)connectedResumeSync();else recoverOnlineSession();
};
// Earlier listeners reference the original function. The extra handler also recovers expired sessions.
window.addEventListener('online',()=>{rebaseNeeded=true;recoverOnlineSession()});
window.addEventListener('offline',()=>{rebaseNeeded=true;if(cloudUser){persistPending();offlineStatus()}});
cloudSignOut=async function(){
 if(!confirm('Выйти из аккаунта Матрицы? Локальная копия сохранится до следующего входа в этот аккаунт.'))return;
 persistPending();offlineExplicitSignOut=true;
 try{localStorage.removeItem(offlineAccountKey);if(navigator.onLine!==false)await detachTaskPush()}catch(e){console.error(e)}
 try{await db?.auth.signOut({scope:'local'})}catch(e){console.error(e)}
 if(cloudChannel){db.removeChannel(cloudChannel);cloudChannel=null}
 taskPushSignedOut();quickEditor=null;clearPendingCompletions();taskClipboard=null;selectedTaskId=null;pasteTarget=null;
 cloudUser=null;tasks=[];cloudSnapshot.clear();render();authScreen();cloudStatus('Не выполнен вход');document.getElementById('signout').style.display='none';offlineExplicitSignOut=false;
};
function openInstallHelp(){
 document.getElementById('modalroot').innerHTML=`<div class="modalback" onclick="if(event.target===this)closeModal()"><section class="modal"><h2>Матрица как приложение</h2><p><b>iPhone:</b> откройте этот сайт в Safari → «Поделиться» → «На экран Домой». Включите «Открывать как веб-приложение», если такой переключатель есть.</p><p><b>Mac:</b> в Safari выберите «Файл» → «Добавить в Dock».</p><p class="small">На каждом устройстве войдите в один аккаунт и дождитесь синхронизации. Затем задачи можно создавать и менять без интернета. После подключения изменения объединятся. Уведомления требуют подключения.</p><p class="small" id="offline-ready">Проверяем готовность к работе без сети…</p><button class="btn primary" onclick="closeModal()">Понятно</button></section></div>`;
 if('caches' in window)caches.open('matrica-shell-20261124-telegram-v1').then(c=>c.match(new URL('index.html',document.baseURI))).then(ready=>{const el=document.getElementById('offline-ready');if(el)el.textContent=ready?'Приложение сохранено для запуска без интернета.':'Оставьте приложение открытым с интернетом до завершения загрузки.'});
}
if('serviceWorker' in navigator&&window.isSecureContext){
 navigator.serviceWorker.register(new URL('./sw.js',document.baseURI),{scope:new URL('./',document.baseURI).pathname,updateViaCache:'none'}).catch(e=>console.error('Offline installation',e));
 navigator.storage?.persist?.().catch(()=>{});
}
const installButton=document.createElement('button');installButton.className='btn';installButton.textContent='Установить приложение';installButton.onclick=openInstallHelp;installButton.style.margin='8px 0';document.querySelector('.footer')?.before(installButton);
