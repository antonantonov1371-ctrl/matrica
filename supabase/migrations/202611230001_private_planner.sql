create table public.matrica_months (
  user_id uuid not null references auth.users(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  archived boolean not null,
  primary key (user_id, month)
);

alter table public.matrica_months enable row level security;
create policy matrica_months_owner on public.matrica_months for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
revoke all on public.matrica_months from anon;
grant select, insert, update on public.matrica_months to authenticated;

-- Track revisions for edits from both the private site and older clients.
create function public.matrica_task_revision() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;
create trigger matrica_task_revision before update on public.tasks
  for each row execute function public.matrica_task_revision();

alter publication supabase_realtime add table public.tasks, public.matrica_months;

-- Insert new tasks and apply conditional changes in one transaction. A revision
-- conflict rolls back the whole batch so the client can rebase and retry.
create function public.matrica_write_tasks(p_user_id uuid, p_upserts jsonb, p_deletions jsonb)
returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  change record;
begin
  if owner_id is null or owner_id is distinct from p_user_id then
    raise insufficient_privilege;
  end if;

  for change in
    select * from jsonb_to_recordset(p_upserts) as r(
      id uuid, title text, description text, task_date date, task_time time,
      quadrant integer, completed boolean, completed_at timestamptz,
      revision timestamptz, generated boolean
    ) order by id
  loop
    if change.revision is null then
      insert into public.tasks (id, user_id, title, description, task_date, task_time, quadrant, completed, completed_at)
        values (change.id, owner_id, change.title, change.description, change.task_date, change.task_time,
                change.quadrant, change.completed, change.completed_at)
        on conflict (id) do nothing;
      if not found and not change.generated then
        raise serialization_failure;
      end if;
    else
      update public.tasks set title = change.title, description = change.description,
        task_date = change.task_date, task_time = change.task_time, quadrant = change.quadrant,
        completed = change.completed, completed_at = change.completed_at
        where id = change.id and user_id = owner_id and updated_at = change.revision;
      if not found then
        raise serialization_failure;
      end if;
    end if;
  end loop;

  for change in
    select * from jsonb_to_recordset(p_deletions) as r(id uuid, revision timestamptz) order by id
  loop
    delete from public.tasks where id = change.id and user_id = owner_id and updated_at = change.revision
      and case when pg_input_is_valid(description, 'jsonb')
        then description::jsonb @> '{"matrica":2,"kind":"folder"}'::jsonb else false end;
    if not found then
      raise serialization_failure;
    end if;
  end loop;
  return true;
exception when serialization_failure or deadlock_detected then
  return false;
end;
$$;

revoke all on function public.matrica_write_tasks(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.matrica_write_tasks(uuid, jsonb, jsonb) to authenticated;
