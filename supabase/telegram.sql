-- Additive Telegram integration. No existing task is deleted or rewritten.
create table public.telegram_settings (
  singleton boolean primary key default true check(singleton),
  owner_id uuid not null references auth.users(id),
  bot_username text,
  last_dispatch_at timestamptz
);
-- Bootstrap only an unambiguous existing owner; never let the first visitor claim setup.
insert into public.telegram_settings(singleton,owner_id)
select true,min(user_id::text)::uuid from public.tasks having count(distinct user_id)=1;
create table public.telegram_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chat_id bigint not null unique,
  telegram_user_id bigint not null unique,
  enabled boolean not null default true,
  prompt jsonb,
  last_test_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.telegram_link_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null unique,
  time_zone text not null,
  expires_at timestamptz not null
);
create table public.telegram_updates (
  update_id bigint primary key,
  chat_id bigint not null,
  lease_until timestamptz not null,
  finished boolean not null default false,
  effect_done boolean not null default false,
  created_at timestamptz not null default now()
);
create index telegram_updates_chat_created_idx on public.telegram_updates(chat_id,created_at);
create table public.telegram_reminders (
  task_id uuid primary key references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scheduled_for timestamptz not null,
  source_date date not null,
  source_time time not null,
  delivered_at timestamptz,
  attempts integer not null default 0,
  lease_token uuid,
  lease_until timestamptz,
  message_id bigint
);
create index telegram_reminders_due_idx on public.telegram_reminders(scheduled_for) where delivered_at is null;
create index telegram_reminders_user_idx on public.telegram_reminders(user_id);
alter table public.telegram_settings enable row level security;
alter table public.telegram_links enable row level security;
alter table public.telegram_link_codes enable row level security;
alter table public.telegram_updates enable row level security;
alter table public.telegram_reminders enable row level security;
revoke all on public.telegram_settings,public.telegram_links,public.telegram_link_codes,public.telegram_updates,public.telegram_reminders from anon,authenticated;
grant all on public.telegram_settings,public.telegram_links,public.telegram_link_codes,public.telegram_updates,public.telegram_reminders to service_role;

create function public.telegram_credentials() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object(
 'token',(select decrypted_secret from vault.decrypted_secrets where name='matrica_telegram_token'),
 'webhook',(select decrypted_secret from vault.decrypted_secrets where name='matrica_telegram_webhook'),
 'scheduler',(select decrypted_secret from vault.decrypted_secrets where name='matrica_push_scheduler_token'));
$$;
create function public.telegram_store_credentials(bot_token text,webhook_secret text,username text) returns void
language plpgsql security definer set search_path='' as $$
declare existing uuid;
begin
 select id into existing from vault.secrets where name='matrica_telegram_token';
 if existing is null then perform vault.create_secret(bot_token,'matrica_telegram_token');
 else perform vault.update_secret(existing,bot_token); end if;
 select id into existing from vault.secrets where name='matrica_telegram_webhook';
 if existing is null then perform vault.create_secret(webhook_secret,'matrica_telegram_webhook');
 else perform vault.update_secret(existing,webhook_secret); end if;
 update public.telegram_settings set bot_username=username where singleton;
end $$;

create function public.telegram_sync_reminder() returns trigger language plpgsql security definer set search_path='' as $$
declare zone text; due timestamptz;
begin
 if new.completed or new.task_date is null or new.task_time is null then
   delete from public.telegram_reminders where task_id=new.id; return new;
 end if;
 select p.time_zone into zone from public.notification_preferences p
 join public.telegram_links l using(user_id) where p.user_id=new.user_id and l.enabled;
 if zone is null then return new; end if;
 due:=(new.task_date+new.task_time) at time zone zone;
 if due<=now() then
   delete from public.telegram_reminders where task_id=new.id and
    (source_date is distinct from new.task_date or source_time is distinct from new.task_time);
   return new;
 end if;
 insert into public.telegram_reminders(task_id,user_id,scheduled_for,source_date,source_time)
 values(new.id,new.user_id,due,new.task_date,new.task_time)
 on conflict(task_id) do update set scheduled_for=excluded.scheduled_for,source_date=excluded.source_date,
 source_time=excluded.source_time,delivered_at=null,attempts=0,lease_until=null,lease_token=null,message_id=null
 where public.telegram_reminders.scheduled_for is distinct from excluded.scheduled_for;
 return new;
end $$;
create trigger matrica_telegram_reminder after insert or update on public.tasks
for each row execute function public.telegram_sync_reminder();

create function public.telegram_consume_link(code_hash text,chat bigint,telegram_user bigint,zone text) returns uuid
language plpgsql security definer set search_path='' as $$
declare owner uuid;
begin
 if chat<>telegram_user or chat<=0 then raise exception 'Private chat required'; end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then raise exception 'Invalid timezone'; end if;
 select user_id,time_zone into owner,zone from public.telegram_link_codes where token_hash=code_hash and expires_at>now() for update;
 if owner is null then return null; end if;
 -- A chat cannot silently switch accounts; disconnect the previous account first.
 if exists(select 1 from public.telegram_links where chat_id=chat and user_id<>owner) then return null; end if;
 insert into public.telegram_links(user_id,chat_id,telegram_user_id) values(owner,chat,telegram_user)
 on conflict(user_id) do update set chat_id=excluded.chat_id,telegram_user_id=excluded.telegram_user_id,enabled=true,prompt=null;
 delete from public.telegram_link_codes where user_id=owner;
 insert into public.notification_preferences(user_id,time_zone) values(owner,zone) on conflict(user_id) do nothing;
 insert into public.telegram_reminders(task_id,user_id,scheduled_for,source_date,source_time)
 select t.id,t.user_id,(t.task_date+t.task_time) at time zone p.time_zone,t.task_date,t.task_time
 from public.tasks t join public.notification_preferences p using(user_id)
 where t.user_id=owner and not t.completed and t.task_date is not null and t.task_time is not null
 and (t.task_date+t.task_time) at time zone p.time_zone>now()
 on conflict(task_id) do nothing;
 return owner;
end $$;

create function public.telegram_claim_update(update_number bigint,chat bigint) returns text
language plpgsql security definer set search_path='' as $$
declare claimed bigint;
begin
 -- Serialize rate checks for this chat; a duplicate is never counted as a new action.
 perform pg_catalog.pg_advisory_xact_lock(chat);
 if (select count(*) from public.telegram_updates where chat_id=chat and created_at>now()-interval '1 minute')>=30
 and not exists(select 1 from public.telegram_updates where update_id=update_number) then return 'limited'; end if;
 insert into public.telegram_updates(update_id,chat_id,lease_until) values(update_number,chat,now()+interval '90 seconds')
 on conflict(update_id) do update set lease_until=excluded.lease_until
 where not public.telegram_updates.finished and public.telegram_updates.lease_until<now()
 returning update_id into claimed;
 if claimed is not null then return 'claimed'; end if;
 if exists(select 1 from public.telegram_updates where update_id=update_number and finished) then return 'finished'; end if;
 return 'busy';
end $$;
create function public.telegram_claim_reminders() returns setof public.telegram_reminders
language sql security definer set search_path='' as $$
 update public.telegram_reminders j set lease_token=gen_random_uuid(),lease_until=now()+interval '120 seconds',attempts=j.attempts+1
 where j.task_id in (
 select r.task_id from public.telegram_reminders r join public.telegram_links l using(user_id)
 where l.enabled and r.delivered_at is null and r.scheduled_for<=now() and r.attempts<10
 and (r.lease_until is null or r.lease_until<now())
 order by r.scheduled_for for update of r skip locked limit 10) returning j.*;
$$;

-- Optimistic task edits and recurring completion are committed together.
create function public.telegram_edit_task(owner uuid,task uuid,version timestamptz,patch jsonb,operation bigint,next_task jsonb default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare current_row public.tasks;
begin
 perform 1 from public.telegram_updates where update_id=operation for update;
 if not found then raise exception 'Update not claimed'; end if;
 if exists(select 1 from public.telegram_updates where update_id=operation and effect_done) then return true; end if;
 select * into current_row from public.tasks where id=task and user_id=owner for update;
 if current_row.id is null or current_row.updated_at is distinct from version then return false; end if;
 update public.tasks set
 title=coalesce(patch->>'title',title),description=coalesce(patch->>'description',description),
 task_date=case when patch?'task_date' then (patch->>'task_date')::date else task_date end,
 task_time=case when patch?'task_time' then (patch->>'task_time')::time else task_time end,
 quadrant=case when patch?'quadrant' then (patch->>'quadrant')::integer else quadrant end,
 completed=coalesce((patch->>'completed')::boolean,completed),
 completed_at=case when patch?'completed_at' then (patch->>'completed_at')::timestamptz else completed_at end
 where id=task and user_id=owner;
 if next_task is not null then
 insert into public.tasks(id,user_id,title,description,task_date,task_time,quadrant,completed,completed_at)
 values((next_task->>'id')::uuid,owner,next_task->>'title',next_task->>'description',
 (next_task->>'task_date')::date,(next_task->>'task_time')::time,(next_task->>'quadrant')::integer,false,null)
 on conflict(id) do nothing;
 end if;
 update public.telegram_updates set effect_done=true where update_id=operation;
 return true;
end $$;
revoke all on function public.telegram_credentials(),public.telegram_store_credentials(text,text,text),
 public.telegram_sync_reminder(),public.telegram_consume_link(text,bigint,bigint,text),
 public.telegram_claim_update(bigint,bigint),public.telegram_claim_reminders(),
 public.telegram_edit_task(uuid,uuid,timestamptz,jsonb,bigint,jsonb) from public;
grant execute on function public.telegram_credentials(),public.telegram_store_credentials(text,text,text),
 public.telegram_consume_link(text,bigint,bigint,text),public.telegram_claim_update(bigint,bigint),
 public.telegram_claim_reminders(),public.telegram_edit_task(uuid,uuid,timestamptz,jsonb,bigint,jsonb) to service_role;
