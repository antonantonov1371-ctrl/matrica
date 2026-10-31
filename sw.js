'use strict';
// No task or account data is cached by this worker.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let payload={};
  try { payload=event.data?.json() || {}; } catch {}
  const taskId=typeof payload.data?.taskId==='string' ? payload.data.taskId : null;
  event.waitUntil(self.registration.showNotification(
    typeof payload.title==='string' ? payload.title.slice(0,100) : 'Матрица', {
      body:typeof payload.body==='string' ? payload.body.slice(0,500) : 'Пора проверить задачи',
      icon:new URL('icons/icon-192.png',self.registration.scope).href,
      badge:new URL('icons/icon-192.png',self.registration.scope).href,
      tag:typeof payload.tag==='string' ? payload.tag : 'matrica-reminder',
      data:{taskId},
    }
  ));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const taskId=event.notification.data?.taskId;
  const target=new URL('index.html',self.registration.scope);
  if(taskId) target.searchParams.set('task',taskId);
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const client=windows.find(w=>w.url.startsWith(self.registration.scope));
    if(client) {
      if(taskId) client.postMessage({type:'matrica-open-task',taskId});
      return client.focus();
    }
    return self.clients.openWindow(target.href);
  })());
});
self.addEventListener('pushsubscriptionchange',event=>{
  event.waitUntil(self.clients.matchAll({type:'window'}).then(windows=>{
    for(const client of windows) client.postMessage({type:'matrica-push-expired'});
  }));
});
