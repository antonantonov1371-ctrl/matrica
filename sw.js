'use strict';

const APP_CACHE='matrica-shell-20261123-private';
const APP_ASSETS=['index.html','task-core.js?v=20261119','workflow.js?v=20261123','workflow.css?v=20261123','offline.js?v=20261123','planner-lists.js?v=20261123','push-client.js?v=20261123','vendor/supabase-2.49.8.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png'];
const scope=new URL(self.registration.scope);
const indexURL=new URL('index.html',scope);
function isAppEntry(url){
 return url.origin===scope.origin&&(url.pathname===scope.pathname||url.pathname===indexURL.pathname);
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(APP_CACHE);
 await cache.addAll(APP_ASSETS.map(path=>new Request(new URL(path,scope),{cache:'reload',redirect:'error'})));
 await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 await Promise.all((await caches.keys()).filter(key=>key.startsWith('matrica-shell-')&&key!==APP_CACHE).map(key=>caches.delete(key)));
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==scope.origin)return;
 if(event.request.mode==='navigate'){
  if(!isAppEntry(url))return;
  // Online navigation goes through the host's access checks. Cache is an offline fallback.
  event.respondWith(fetch(event.request).catch(async()=>{
   return (await (await caches.open(APP_CACHE)).match(indexURL))||Response.error();
  }));
  return;
 }
 if(!APP_ASSETS.some(path=>new URL(path,scope).href===url.href))return;
 event.respondWith((async()=>{
  const cache=await caches.open(APP_CACHE);
  return (await cache.match(url))||fetch(event.request);
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
  const target=new URL('./',scope);
  if(taskId) target.searchParams.set('task',taskId);
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const client=windows.find(w=>isAppEntry(new URL(w.url)));
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
