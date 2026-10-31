import { createClient } from 'npm:@supabase/supabase-js@2.49.8';
import webpush from 'npm:web-push@3.6.7';
import { timingSafeEqual } from 'node:crypto';
import { validSubscription, validTimeZone, subscriptionProblem } from './validation.ts';

const env = (name: string) => Deno.env.get(name) || '';
const url = env('SUPABASE_URL');
const service = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), {auth:{persistSession:false}});
const checked = async (result: any) => { const r=await result; if(r.error) throw r.error; return r.data; };
const origins = (env('ALLOWED_ORIGINS') || 'https://antonantonov1371-ctrl.github.io,http://127.0.0.1:4173,http://localhost:4173').split(',').map(v=>v.trim()).filter(Boolean);
const proposed=webpush.generateVAPIDKeys();
const credentials=await checked(service.rpc('push_server_credentials',{
  proposed_public:proposed.publicKey,proposed_private:proposed.privateKey,
  proposed_scheduler:crypto.randomUUID()+crypto.randomUUID(),
  function_url:url+'/functions/v1/matrica-push?action=dispatch',
}));
const ready=!!credentials.publicKey;
webpush.setVapidDetails('https://github.com/antonantonov1371-ctrl/matrica',credentials.publicKey,credentials.privateKey);
const sameSecret = (a: string,b: string) => {
  const encoder=new TextEncoder(), x=encoder.encode(a),y=encoder.encode(b);
  return !!b && x.length===y.length && timingSafeEqual(x,y);
};

async function sendJob(job: any) {
  let succeeded=false;
  try {
    const task=await checked(service.from('tasks').select('id,user_id,title,completed,task_date,task_time').eq('id',job.task_id).eq('user_id',job.user_id).maybeSingle());
    if(!task || task.completed || task.task_date!==job.source_date || task.task_time!==job.source_time) {
      succeeded=true; return;
    }
    const subscriptions=await checked(service.from('push_subscriptions').select('*').eq('user_id',job.user_id));
    const delivered=await checked(service.from('reminder_deliveries').select('subscription_id').eq('job_id',job.id).eq('scheduled_for',job.scheduled_for));
    const sent=new Set(delivered.map((r:any)=>r.subscription_id));
    const results=await Promise.all(subscriptions.map(async (sub:any) => {
      if(sent.has(sub.id)) return true;
      try {
        await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},
          JSON.stringify({title:'Матрица · Напоминание',body:task.title,data:{taskId:task.id},tag:`task-${task.id}-${job.scheduled_for}`}),
          {TTL:300,urgency:'high',timeout:5000});
        await checked(service.from('reminder_deliveries').upsert({job_id:job.id,scheduled_for:job.scheduled_for,subscription_id:sub.id}));
        return true;
      } catch(error:any) {
        if(error.statusCode===404 || error.statusCode===410) {
          await checked(service.from('push_subscriptions').delete().eq('id',sub.id)); return true;
        }
        // Do not log the endpoint, keys, task title, or payload.
        console.error('Push delivery failed',error.statusCode || 'network'); return false;
      }
    }));
    succeeded=results.every(Boolean);
  } finally {
    await checked(service.rpc('finish_reminder',{job:job.id,lease:job.lease_token,succeeded}));
  }
}

Deno.serve(async req => {
  const origin=req.headers.get('Origin');
  const cors:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',
    'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
  if(origin && origins.includes(origin)) cors['Access-Control-Allow-Origin']=origin;
  const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
  if(origin && !origins.includes(origin)) return respond({error:'Origin not allowed'},403);
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
  const action=new URL(req.url).searchParams.get('action') || '';
  if(action==='config' && req.method==='GET') {
    const health=await checked(service.from('push_runtime_status').select('last_dispatch_at').eq('singleton',true).maybeSingle());
    const schedulerActive=!!health && Date.now()-Date.parse(health.last_dispatch_at)<180000;
    return respond({ready:ready&&schedulerActive,publicKey:credentials.publicKey,schedulerActive});
  }
  if(!ready) return respond({error:'Notification server is not configured'},503);
  if(req.method!=='POST') return respond({error:'Method not allowed'},405);
  try {
    const bearer=req.headers.get('Authorization')?.replace(/^Bearer /i,'') || '';
    if(action==='dispatch') {
      if(!sameSecret(bearer,credentials.schedulerToken)) return respond({error:'Unauthorized'},401);
      await checked(service.from('push_runtime_status').upsert({singleton:true,last_dispatch_at:new Date().toISOString()}));
      const jobs=await checked(service.rpc('claim_reminders',{batch_size:10}));
      const result=await Promise.allSettled(jobs.map(sendJob));
      return respond({claimed:jobs.length,processed:result.filter(r=>r.status==='fulfilled').length});
    }
    const {data:{user},error}=await service.auth.getUser(bearer);
    if(error || !user) return respond({error:'Sign in required'},401);
    if(Number(req.headers.get('content-length') || 0)>12000) return respond({error:'Request too large'},413);
    const raw=await req.text();if(raw.length>12000) return respond({error:'Request too large'},413);
    const body=JSON.parse(raw || '{}');
    const db=createClient(url,env('SUPABASE_ANON_KEY'),{global:{headers:{Authorization:'Bearer '+bearer}},auth:{persistSession:false}});
    if(action==='status') {
      const sub=await checked(db.from('push_subscriptions').select('id').eq('endpoint',body.endpoint || '').maybeSingle());
      const pref=await checked(db.from('notification_preferences').select('time_zone').eq('user_id',user.id).maybeSingle());
      return respond({enabled:!!sub,timeZone:pref?.time_zone || null});
    }
    if(action==='subscribe') {
      if(!validSubscription(body.subscription)) return respond({error:subscriptionProblem(body.subscription)},400);
      if(!validTimeZone(body.timeZone)) return respond({error:'Неверный часовой пояс устройства'},400);
      const existing=await checked(db.from('push_subscriptions').select('id,endpoint'));
      if(existing.length>=10 && !existing.some((r:any)=>r.endpoint===body.subscription.endpoint)) return respond({error:'Device limit reached'},400);
      // The first device establishes a stable account time zone; later devices preserve it.
      await checked(db.from('notification_preferences').upsert({user_id:user.id,time_zone:body.timeZone},{onConflict:'user_id',ignoreDuplicates:true}));
      await checked(db.from('push_subscriptions').upsert({user_id:user.id,endpoint:body.subscription.endpoint,p256dh:body.subscription.keys.p256dh,auth:body.subscription.keys.auth},{onConflict:'endpoint'}));
      await checked(db.rpc('prepare_user_reminders'));
      const pref=await checked(db.from('notification_preferences').select('time_zone').eq('user_id',user.id).single());
      return respond({enabled:true,timeZone:pref.time_zone});
    }
    if(action==='unsubscribe') {
      await checked(db.from('push_subscriptions').delete().eq('endpoint',body.endpoint || ''));
      return respond({enabled:false});
    }
    if(action==='test') {
      const threshold=new Date(Date.now()-30000).toISOString();
      const updated=await checked(service.from('notification_preferences').update({last_test_at:new Date().toISOString()}).eq('user_id',user.id).or(`last_test_at.is.null,last_test_at.lt.${threshold}`).select('user_id'));
      if(!updated.length) return respond({error:'Подождите 30 секунд перед повторной проверкой'},429);
      const sub=await checked(db.from('push_subscriptions').select('*').eq('endpoint',body.endpoint || '').maybeSingle());
      if(!sub) return respond({error:'Device is not subscribed'},400);
      await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},JSON.stringify({title:'Матрица',body:'Уведомления на этом устройстве работают',tag:'matrica-test'}),{TTL:60,timeout:5000});
      return respond({sent:true});
    }
    return respond({error:'Unknown action'},404);
  } catch(error) {
    console.error('Push operation failed');
    return respond({error:'Не удалось выполнить настройку уведомлений. Попробуйте ещё раз.'},500);
  }
});
