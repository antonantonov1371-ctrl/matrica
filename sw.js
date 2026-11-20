'use strict';
// Only public application files are cached. Account data stays in account-scoped local storage.
const APP_CACHE='matrica-shell-20261120-offline-v2';
const APP_ASSETS=['./','index.html','task-core.js?v=20261119','workflow.js?v=20261120-app','workflow.css?v=20261120-app','offline.js?v=20261120-offline2','push-client.js?v=20261119','vendor/supabase-2.49.8.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(APP_CACHE);
 await cache.addAll(APP_ASSETS.map(path=>new Request(new URL(path,self.registration.scope),{cache:'reload'})));
 await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 await Promise.all((await caches.keys()).filter(key=>key.startsWith('matrica-shell-')&&key!==APP_CACHE).map(key=>caches.delete(key)));
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url),scope=new URL(self.registration.scope);
 if(event.request.method!=='GET'||url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))return;
 const asset=APP_ASSETS.find(path=>new URL(path,scope).pathname===url.pathname);
 if(event.request.mode!=='navigate'&&!asset)return;
 event.respondWith((async()=>{
 const cache=await caches.open(APP_CACHE);
 // Serve a complete, consistent release; worker installation updates it atomically.
 if(event.request.mode==='navigate')return (await cache.match(new URL('index.html',scope)))||fetch(event.request);
 return (await cache.match(new URL(asset,scope)))||fetch(event.request);
 })());
});
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
