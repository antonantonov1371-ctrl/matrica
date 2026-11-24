'use strict';
var telegramState={userId:null,checked:false,ready:false,connected:false,canConfigure:false,busy:false,error:'',username:null,link:null,upcoming:0,schedulerActive:false};
async function telegramRequest(action,body){
 if(!db||!cloudUser)throw new Error('Сначала войдите в аккаунт');
 const owner=cloudUser.id,{data,error}=await db.auth.getSession();
 if(error||!data.session)throw new Error('Сначала войдите в аккаунт');
 const response=await fetch(CLOUD_URL+'/functions/v1/matrica-telegram?action='+action,{method:'POST',headers:{'Content-Type':'application/json',apikey:CLOUD_KEY,Authorization:'Bearer '+data.session.access_token},body:JSON.stringify(body||{})});
 const result=await response.json().catch(()=>({}));
 if(cloudUser?.id!==owner)throw new Error('Аккаунт изменился');
 if(!response.ok)throw new Error(result.error||'Не удалось подключиться к Telegram');return result;
}
async function loadTelegramStatus(){
 if(!cloudUser)return;const owner=cloudUser.id;
 if(telegramState.userId!==owner)telegramState={userId:owner,checked:false,ready:false,connected:false,canConfigure:false,busy:false,error:'',username:null,link:null,upcoming:0,schedulerActive:false};
 try{const result=await telegramRequest('status');if(cloudUser?.id!==owner)return;Object.assign(telegramState,result,{checked:true,error:''});if(result.connected)telegramState.link=null;}
 catch(error){if(cloudUser?.id!==owner)return;telegramState.checked=true;telegramState.error=error.message;}
 renderTelegramSettings();
}
function renderTelegramSettings(){
 const root=document.querySelector('[data-telegram-settings]');if(!root)return;
 const s=telegramState,disabled=s.busy?'disabled':'';
 // An unrelated push status update must not discard a token currently being entered.
 if(document.activeElement?.id==='telegram-bot-token'&&!s.busy)return;
 root.innerHTML=`<h3>Telegram</h3><p class="small">Напоминания приходят в личный чат, даже когда «Матрица» закрыта. В боте также можно добавлять задачи и просматривать разделы.</p>
 ${s.error?`<p role="alert">${esc(s.error)}</p>`:''}
 ${!s.checked?'<p class="small">Проверяем подключение…</p>':s.connected?`<p>✓ Telegram подключён${s.username?' · @'+esc(s.username):''}</p><p class="small">Запланировано напоминаний: ${s.upcoming}. Проверка времени — раз в минуту.${s.schedulerActive?'':' Планировщик пока не подтвердил работу.'}</p><div class="actions"><button type="button" class="btn" onclick="telegramAction('test')" ${disabled}>Проверить сообщение</button><button type="button" class="btn" onclick="telegramAction('disconnect')" ${disabled}>Отключить Telegram</button></div>`:s.ready?`<button type="button" class="btn primary" onclick="telegramAction('link')" ${disabled}>Подключить Telegram</button>`:`<p class="small">Бот ещё не настроен.</p>`}
 ${s.link?`<p><a class="btn primary" href="${esc(s.link)}" target="_blank" rel="noreferrer">Открыть бота и нажать «Старт»</a></p><p class="small">Ссылка действует 10 минут. После подключения вернитесь сюда.</p><button type="button" class="btn" onclick="loadTelegramStatus()" ${disabled}>Проверить подключение</button>`:''}
 ${s.canConfigure&&!s.ready?`<details><summary>Настроить своего бота</summary><p class="small">Откройте <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">официальный BotFather</a>, отправьте /newbot и выберите имя и username. Полученный токен вставьте сюда — он будет сохранён только на сервере.</p><form onsubmit="event.preventDefault();configureTelegramBot()"><label class="field">Токен BotFather<input id="telegram-bot-token" type="password" autocomplete="off" spellcheck="false" required maxlength="125" ${disabled}></label><button class="btn" type="submit" ${disabled}>Сохранить и подключить бота</button></form></details>`:''}
 <p class="small">Для доставки нужен интернет. Разрешите уведомления Telegram и включите звук чата. После подключения тексты задач передаются Telegram при просмотре и отправке напоминаний.</p>`;
}
async function telegramAction(action,body){
 if(telegramState.busy)return;const owner=cloudUser?.id;
 telegramState.busy=true;telegramState.error='';renderTelegramSettings();
 try{
   const result=await telegramRequest(action,body||{timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});
   if(cloudUser?.id!==owner)return;
   if(action==='link'){
     if(!/^https:\/\/t\.me\/\w+\?start=[a-f0-9]{64}$/.test(result.url||''))throw new Error('Не удалось создать ссылку');
     telegramState.link=result.url;
   }else if(action==='test')toast('Проверочное сообщение отправлено в Telegram');
   else {if(action==='disconnect')telegramState.link=null;await loadTelegramStatus();}
 }catch(error){if(cloudUser?.id===owner)telegramState.error=error.message;}
 finally{if(cloudUser?.id===owner){telegramState.busy=false;renderTelegramSettings();}}
}
async function configureTelegramBot(){
 const input=document.getElementById('telegram-bot-token'),token=input?.value.trim();if(!token)return;
 input.value='';await telegramAction('configure',{token});
}
const renderPushBeforeTelegram=renderTaskPushSettings;
renderTaskPushSettings=function(){
 const existing=document.querySelector('[data-telegram-settings]');
 // Preserve the token field on unrelated push renders; never store its value in state or localStorage.
 if(existing)existing.remove();renderPushBeforeTelegram();
 const root=document.querySelector('[data-push-settings]');if(!root)return;
 const section=existing||document.createElement('section');section.setAttribute('data-telegram-settings','');section.style.cssText='border-top:1px solid var(--border,#8884);margin-top:20px;padding-top:10px';
 const actions=root.querySelector('.modalactions');if(actions)root.insertBefore(section,actions);else root.appendChild(section);
 if(!existing)renderTelegramSettings();
};
const initPushBeforeTelegram=initTaskPush;
initTaskPush=async function(){try{return await initPushBeforeTelegram();}finally{await loadTelegramStatus();}};
const signedOutBeforeTelegram=taskPushSignedOut;
taskPushSignedOut=function(){const token=document.getElementById('telegram-bot-token');if(token)token.value='';telegramState={userId:null,checked:false,ready:false,connected:false,canConfigure:false,busy:false,error:'',link:null};renderTelegramSettings();return signedOutBeforeTelegram();};
