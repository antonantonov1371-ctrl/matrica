-- Additive migration: existing tasks and descriptions are not rewritten.
create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  time_zone text not null default 'Europe/Moscow',
  last_test_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
create table if not exists public.reminder_jobs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null unique references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scheduled_for timestamptz not null,
  source_date date not null,
  source_time time not null,
  delivered_at timestamptz,
  attempts integer not null default 0,
  lease_token uuid,
  lease_until timestamptz
);
create index if not exists reminder_jobs_due_idx on public.reminder_jobs(scheduled_for) where delivered_at is null;
create table if not exists public.reminder_deliveries (
  job_id uuid not null references public.reminder_jobs(id) on delete cascade,
  scheduled_for timestamptz not null,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key(job_id, scheduled_for, subscription_id)
);
create table if not exists public.push_runtime_status (
  singleton boolean primary key default true check(singleton),
  last_dispatch_at timestamptz not null
);
alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.reminder_jobs enable row level security;
alter table public.reminder_deliveries enable row level security;
alter table public.push_runtime_status enable row level security;
create policy preferences_owner on public.notification_preferences for all to authenticated
  using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy subscriptions_owner on public.push_subscriptions for all to authenticated
  using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
grant select, insert, update, delete on public.notification_preferences, public.push_subscriptions to authenticated;
revoke all on public.reminder_jobs, public.reminder_deliveries from anon, authenticated;
revoke all on public.push_runtime_status from anon, authenticated;
grant all on public.notification_preferences, public.push_subscriptions,
  public.reminder_jobs, public.reminder_deliveries, public.push_runtime_status to service_role;

-- Keys are generated inside the server and stored encrypted in Vault. Only the
-- service role can bootstrap/read them; no key is emitted by deployment tools.
create or replace function public.push_server_credentials(
  proposed_public text, proposed_private text, proposed_scheduler text, function_url text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare pub text; priv text; scheduler text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('matrica_push_bootstrap'));
  select decrypted_secret into pub from vault.decrypted_secrets where name='matrica_vapid_public';
  select decrypted_secret into priv from vault.decrypted_secrets where name='matrica_vapid_private';
  select decrypted_secret into scheduler from vault.decrypted_secrets where name='matrica_push_scheduler_token';
  if pub is null and priv is null then
    if length(proposed_public)<80 or length(proposed_private)<40 then raise exception 'Invalid keys'; end if;
    perform vault.create_secret(proposed_public,'matrica_vapid_public');
    perform vault.create_secret(proposed_private,'matrica_vapid_private');
    pub:=proposed_public; priv:=proposed_private;
  elsif pub is null or priv is null then raise exception 'Incomplete key configuration';
  end if;
  if scheduler is null then
    if length(proposed_scheduler)<40 then raise exception 'Invalid scheduler token'; end if;
    perform vault.create_secret(proposed_scheduler,'matrica_push_scheduler_token');
    scheduler:=proposed_scheduler;
  end if;
  if not exists(select 1 from vault.decrypted_secrets where name='matrica_push_url') then
    perform vault.create_secret(function_url,'matrica_push_url');
  end if;
  return jsonb_build_object('publicKey',pub,'privateKey',priv,'schedulerToken',scheduler);
end $$;
revoke all on function public.push_server_credentials(text,text,text,text) from public;
grant execute on function public.push_server_credentials(text,text,text,text) to service_role;

create or replace function public.sync_task_reminder() returns trigger
language plpgsql security definer set search_path = '' as $$
declare zone text; due timestamptz;
begin
  if new.completed or new.task_date is null or new.task_time is null then
    delete from public.reminder_jobs where task_id=new.id;
    return new;
  end if;
  select time_zone into zone from public.notification_preferences where user_id=new.user_id;
  if zone is null then return new; end if;
  due := (new.task_date + new.task_time) at time zone zone;
  if due <= now() then
    -- Keep an unchanged, already due job; changing a deadline into the past cancels it.
    delete from public.reminder_jobs where task_id=new.id and
      (source_date is distinct from new.task_date or source_time is distinct from new.task_time);
    return new;
  end if;
  insert into public.reminder_jobs(task_id,user_id,scheduled_for,source_date,source_time)
  values(new.id,new.user_id,due,new.task_date,new.task_time)
  on conflict(task_id) do update set scheduled_for=excluded.scheduled_for,
    source_date=excluded.source_date,source_time=excluded.source_time,
    delivered_at=null,attempts=0,lease_token=null,lease_until=null
  where public.reminder_jobs.scheduled_for is distinct from excluded.scheduled_for;
  return new;
end $$;
revoke all on function public.sync_task_reminder() from public;
drop trigger if exists matrica_task_reminder on public.tasks;
create trigger matrica_task_reminder after insert or update on public.tasks
  for each row execute function public.sync_task_reminder();

create or replace function public.prepare_user_reminders() returns void
language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := auth.uid(); zone text;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  select time_zone into zone from public.notification_preferences where user_id=owner_id;
  if zone is null then raise exception 'Notification preferences required'; end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then
    raise exception 'Invalid time zone';
  end if;
  insert into public.reminder_jobs(task_id,user_id,scheduled_for,source_date,source_time)
  select id,user_id,(task_date+task_time) at time zone zone,task_date,task_time
  from public.tasks where user_id=owner_id and not completed
    and task_date is not null and task_time is not null
    and (task_date+task_time) at time zone zone > now()
  on conflict(task_id) do nothing;
end $$;
revoke all on function public.prepare_user_reminders() from public;
grant execute on function public.prepare_user_reminders() to authenticated;

create or replace function public.claim_reminders(batch_size integer default 10)
returns setof public.reminder_jobs language sql security definer set search_path = '' as $$
  update public.reminder_jobs j set lease_token=gen_random_uuid(),
    lease_until=now()+interval '45 seconds',attempts=j.attempts+1
  where j.id in (
    select r.id from public.reminder_jobs r where r.delivered_at is null
      and r.scheduled_for<=now() and r.scheduled_for>now()-interval '15 minutes'
      and r.attempts<5 and (r.lease_until is null or r.lease_until<now())
      and exists(select 1 from public.push_subscriptions s where s.user_id=r.user_id)
    order by r.scheduled_for for update skip locked limit least(greatest(batch_size,1),10)
  ) returning j.*;
$$;
create or replace function public.finish_reminder(job uuid, lease uuid, succeeded boolean)
returns void language sql security definer set search_path = '' as $$
  update public.reminder_jobs set delivered_at=case when succeeded then now() else null end,
    lease_until=case when succeeded then null else now()+interval '1 minute' end,
    lease_token=null where id=job and lease_token=lease;
$$;
revoke all on function public.claim_reminders(integer), public.finish_reminder(uuid,uuid,boolean) from public;
grant execute on function public.claim_reminders(integer), public.finish_reminder(uuid,uuid,boolean) to service_role;
