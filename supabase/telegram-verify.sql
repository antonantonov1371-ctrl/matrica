-- Run as one transaction. All synthetic tasks, links and queue changes are rolled back.
begin;
do $test$
declare owner uuid; t uuid:=gen_random_uuid(); other_task uuid:=gen_random_uuid(); version timestamptz;
 linked uuid; changed boolean; claimed text; count_before bigint; code text:=repeat('a',64);
begin
 select owner_id into owner from public.telegram_settings where singleton;
 if owner is null then raise exception 'Owner missing'; end if;
 select count(*) into count_before from public.tasks;
 insert into public.telegram_link_codes(user_id,token_hash,time_zone,expires_at)
 values(owner,code,'Europe/Moscow',now()+interval '10 minutes')
 on conflict(user_id) do update set token_hash=excluded.token_hash,expires_at=excluded.expires_at;
 linked:=public.telegram_consume_link(code,900000000000,900000000000,'UTC');
 if linked is distinct from owner then raise exception 'Link failed'; end if;
 if public.telegram_consume_link(code,900000000000,900000000000,'UTC') is not null then raise exception 'Token reused'; end if;
 insert into public.tasks(id,user_id,title,description,task_date,task_time,quadrant,completed)
 values(t,owner,'Synthetic Telegram QA','QA',(now() at time zone 'Europe/Moscow')::date+1,'09:00',1,false);
 if not exists(select 1 from public.telegram_reminders where task_id=t and delivered_at is null) then raise exception 'Reminder not scheduled'; end if;
 claimed:=public.telegram_claim_update(900000000001,900000000000);
 if claimed<>'claimed' then raise exception 'Update not claimed'; end if;
 if public.telegram_claim_update(900000000001,900000000000)<>'busy' then raise exception 'Lease ignored'; end if;
 select updated_at into version from public.tasks where id=t;
 changed:=public.telegram_edit_task(owner,t,version,jsonb_build_object('completed',true,'completed_at',now()),900000000001,null);
 if not changed then raise exception 'Completion failed'; end if;
 if exists(select 1 from public.telegram_reminders where task_id=t) then raise exception 'Completed reminder retained'; end if;
 -- A retried effect must be a no-op even with a changed patch.
 changed:=public.telegram_edit_task(owner,t,version,jsonb_build_object('title','Should not change'),900000000001,null);
 if not changed or exists(select 1 from public.tasks where id=t and title='Should not change') then raise exception 'Effect repeated'; end if;
 perform public.telegram_claim_update(900000000002,900000000000);
 changed:=public.telegram_edit_task(owner,other_task,version,'{}',900000000002,null);
 if changed then raise exception 'Unknown task was editable'; end if;
 -- RLS and function ACLs protect every server-only resource.
 if has_table_privilege('authenticated','public.telegram_links','SELECT') or has_table_privilege('anon','public.telegram_link_codes','SELECT') then raise exception 'Private tables exposed'; end if;
 if has_function_privilege('authenticated','public.telegram_credentials()','EXECUTE') then raise exception 'Credentials exposed'; end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'telegram_%' and c.relkind='r' and not c.relrowsecurity) then raise exception 'RLS missing'; end if;
 if (select count(*) from public.tasks)<>count_before+1 then raise exception 'Unexpected task mutation'; end if;
end $test$;
rollback;
