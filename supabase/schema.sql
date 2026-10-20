-- UniPulse production schema. Run with the Supabase database owner.
-- No demo users or live deployment credentials are installed by this file.
-- All application access runs through the session-authorized server service role.
-- 1. USERS TABLE (Name + 4-Digit PIN Hash Authentication)
create table if not exists public.users (
  id text primary key,
  name text unique not null,
  pin_hash text not null,
  avatar_color text not null default '#0D9488',
  quiet_hours_start text not null default '01:00',
  quiet_hours_end text not null default '08:00',
  created_at timestamptz not null default now()
);

-- 2. GROUPS TABLE (Shared Courses / Study Spaces)
create table if not exists public.groups (
  id text primary key,
  name text not null,
  course_code text not null,
  invite_code text unique not null,
  created_by text not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Optional Group Memberships table
create table if not exists public.group_members (
  group_id text not null references public.groups(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- 3. TASKS TABLE (group_id IS NULL = Private Vault task isolated to created_by)
create table if not exists public.tasks (
  id text primary key,
  group_id text references public.groups(id) on delete cascade,
  title text not null,
  description text not null default '',
  category text not null default 'assignment' check (category in ('assignment', 'quiz', 'exam', 'project', 'personal')),
  due_at timestamptz not null,
  reminder_interval_mins int not null default 120,
  created_by text not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 4. TASK_STATUSES TABLE (Atomic Per-User "On Me" & "Done" Row — No Race Conditions!)
create table if not exists public.task_statuses (
  task_id text not null references public.tasks(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  status text not null default 'on_me' check (status in ('on_me', 'done', 'skipped')),
  reminder_interval_mins int not null default 120,
  last_reminded_at timestamptz,
  next_reminder_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

-- 5. TASK_COMMENTS TABLE (Real-Time Discussion Thread per Task)
create table if not exists public.task_comments (
  id text primary key,
  task_id text not null references public.tasks(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

-- 6. TASK_ATTACHMENTS TABLE (Supabase Storage CDN Files)
create table if not exists public.task_attachments (
  id text primary key,
  task_id text not null references public.tasks(id) on delete cascade,
  file_name text not null,
  file_url text not null,
  file_type text not null default 'application/octet-stream',
  file_size int not null default 0,
  uploaded_by text not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 7. PUSH_SUBSCRIPTIONS TABLE (iOS 16.4+ Standalone PWA & Browser VAPID Endpoints)
create table if not exists public.push_subscriptions (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  endpoint text unique not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

-- Shared, persistent login/register/manual-reminder rate limits.
create table if not exists public.api_rate_limits (
  key text primary key,
  attempts bigint not null default 0 check (attempts >= 0),
  expires_at timestamptz not null
);

create index if not exists idx_tasks_group_id on public.tasks(group_id);
create index if not exists idx_tasks_created_by on public.tasks(created_by);
create index if not exists idx_task_statuses_due on public.task_statuses(status, next_reminder_at);
create index if not exists idx_task_comments_task_id on public.task_comments(task_id);
create index if not exists idx_task_attachments_task_id on public.task_attachments(task_id);
create index if not exists idx_group_members_user_id on public.group_members(user_id);
create index if not exists idx_push_subscriptions_user_id on public.push_subscriptions(user_id);
create index if not exists idx_api_rate_limits_expires_at on public.api_rate_limits(expires_at);

-- Remove browser database access, including inherited Supabase default grants.
-- Existing rows, including legacy demo rows, are preserved. Production login must
-- reject demo IDs beginning user- until the operator deactivates/replaces them.
do $$
declare
  app_table text;
  old_policy record;
begin
  foreach app_table in array array['users','groups','group_members','tasks','task_statuses','task_comments','task_attachments','push_subscriptions','api_rate_limits'] loop
    execute format('alter table public.%I enable row level security', app_table);
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', app_table);
    execute format('grant all privileges on table public.%I to service_role', app_table);
    for old_policy in select policyname from pg_policies where schemaname='public' and tablename=app_table loop
      execute format('drop policy %I on public.%I', old_policy.policyname, app_table);
    end loop;
  end loop;
end $$;

-- These records are delivered through authorized server polling. Remove the
-- app's old public realtime publication entries without changing other tables.
do $$
declare
  app_table text;
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime' and not puballtables) then
    foreach app_table in array array['groups','tasks','task_statuses','task_comments','task_attachments'] loop
      if exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=app_table) then
        execute format('alter publication supabase_realtime drop table public.%I', app_table);
      end if;
    end loop;
  end if;
end $$;

-- Store attachment object paths in file_url; issue short-lived signed downloads
-- after server authorization. Existing object paths/URLs are retained as data.
insert into storage.buckets (id,name,public) values ('task-files','task-files',false)
on conflict (id) do update set public=false;
alter table storage.objects enable row level security;
drop policy if exists "Public read access for task-files" on storage.objects;
drop policy if exists "Service role upload access for task-files" on storage.objects;
-- A restrictive policy also defeats older permissive wildcard policies for this
-- bucket, while preserving the access rules of unrelated buckets.
drop policy if exists "task-files server access only" on storage.objects;
create policy "task-files server access only" on storage.objects as restrictive
  for all to anon, authenticated
  using (bucket_id <> 'task-files') with check (bucket_id <> 'task-files');
grant all privileges on storage.buckets, storage.objects to service_role;

create or replace function public.consume_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  current_attempts bigint;
  rate_now timestamptz := clock_timestamp();
begin
  if p_key is null or length(p_key)=0 or length(p_key)>512 or p_limit is null or p_limit<1 or p_window_seconds is null or p_window_seconds<1 then
    raise exception 'Invalid rate limit arguments' using errcode='22023';
  end if;

  insert into public.api_rate_limits as rate (key,attempts,expires_at)
  values (p_key,1,rate_now + make_interval(secs => p_window_seconds))
  on conflict (key) do update set
    attempts=case when rate.expires_at<=rate_now then 1 else rate.attempts+1 end,
    expires_at=case when rate.expires_at<=rate_now then rate_now + make_interval(secs => p_window_seconds) else rate.expires_at end
  returning attempts into current_attempts;
  -- Claim this key before cleanup; cleanup skips other callers' locked keys.
  -- Bounded indexed cleanup; never scans/deletes all expired keys in a request.
  delete from public.api_rate_limits where key in (
    select key from public.api_rate_limits where expires_at < rate_now - interval '1 day'
    order by expires_at limit 100 for update skip locked
  );
  return current_attempts<=p_limit;
end $$;

create or replace function public.create_task(p_task jsonb, p_status jsonb default null, p_attachment jsonb default null)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_status is not null and p_status->>'task_id' is distinct from p_task->>'id' then
    raise exception 'Initial status must belong to the created task' using errcode='22023';
  end if;
  if p_attachment is not null and p_attachment->>'task_id' is distinct from p_task->>'id' then
    raise exception 'Attachment must belong to the created task' using errcode='22023';
  end if;
  insert into public.tasks (id,group_id,title,description,category,due_at,reminder_interval_mins,created_by,created_at)
  values (p_task->>'id',p_task->>'group_id',p_task->>'title',coalesce(p_task->>'description',''),coalesce(p_task->>'category','assignment'),
    (p_task->>'due_at')::timestamptz,coalesce((p_task->>'reminder_interval_mins')::integer,120),p_task->>'created_by',coalesce((p_task->>'created_at')::timestamptz,now()));
  if p_status is not null then
    insert into public.task_statuses (task_id,user_id,status,reminder_interval_mins,next_reminder_at,updated_at)
    values (p_task->>'id',p_status->>'user_id',coalesce(p_status->>'status','on_me'),coalesce((p_status->>'reminder_interval_mins')::integer,120),
      (p_status->>'next_reminder_at')::timestamptz,coalesce((p_status->>'updated_at')::timestamptz,now()));
  end if;
  if p_attachment is not null then
    insert into public.task_attachments (id,task_id,file_name,file_url,file_type,file_size,uploaded_by,created_at)
    values (p_attachment->>'id',p_task->>'id',p_attachment->>'file_name',p_attachment->>'file_url',coalesce(p_attachment->>'file_type','application/octet-stream'),
      coalesce((p_attachment->>'file_size')::integer,0),p_attachment->>'uploaded_by',coalesce((p_attachment->>'created_at')::timestamptz,now()));
  end if;
end $$;

-- Remove the superseded overload so default-argument calls stay unambiguous.
drop function if exists public.claim_due_reminders(timestamptz,text,boolean);
create or replace function public.claim_due_reminders(p_now timestamptz,p_user_id text default null,p_force boolean default false,p_timezone text default 'Africa/Cairo')
returns table(task_id text,user_id text,status text,reminder_interval_mins integer,next_reminder_at timestamptz,tasks jsonb,users jsonb)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  reminder_local_time time;
begin
  if p_now is null or p_force is null or p_timezone is null or p_timezone='' or (p_force and p_user_id is null) then
    raise exception 'Reminder claims require a timestamp and force claims require a user' using errcode='22023';
  end if;
  reminder_local_time := (p_now at time zone p_timezone)::time;
  return query
  with due as (
    select s.task_id,s.user_id
    from public.task_statuses s
    join public.tasks t on t.id=s.task_id
    join public.users reminder_user on reminder_user.id=s.user_id
    cross join lateral (
      select
        case when reminder_user.quiet_hours_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:00)?$' then reminder_user.quiet_hours_start::time end as starts_at,
        case when reminder_user.quiet_hours_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:00)?$' then reminder_user.quiet_hours_end::time end as ends_at
    ) quiet
    where s.status='on_me'
      -- Quiet rows stay due: advancing a daily lease here would starve them.
      and not coalesce(case
        when quiet.starts_at < quiet.ends_at then reminder_local_time >= quiet.starts_at and reminder_local_time < quiet.ends_at
        when quiet.starts_at > quiet.ends_at then reminder_local_time >= quiet.starts_at or reminder_local_time < quiet.ends_at
        else false
      end,false)
      and (p_user_id is null or s.user_id=p_user_id)
      and ((not p_force and s.next_reminder_at<=p_now) or (p_force and (s.last_reminded_at is null or s.last_reminded_at<=p_now-interval '1 minute')))
      and ((t.group_id is null and t.created_by=s.user_id) or (t.group_id is not null and (
        exists (select 1 from public.groups g where g.id=t.group_id and g.created_by=s.user_id)
        or exists (select 1 from public.group_members m where m.group_id=t.group_id and m.user_id=s.user_id)
      )))
    order by s.next_reminder_at nulls first,s.task_id,s.user_id
    limit 100 for update of s skip locked
  ), claimed as (
    update public.task_statuses s
    set last_reminded_at=p_now,next_reminder_at=p_now+make_interval(mins => greatest(30,s.reminder_interval_mins))
    from due where s.task_id=due.task_id and s.user_id=due.user_id
    returning s.task_id,s.user_id,s.status,s.reminder_interval_mins,s.next_reminder_at
  )
  select c.task_id,c.user_id,c.status,c.reminder_interval_mins,c.next_reminder_at,
    jsonb_build_object('id',t.id,'title',t.title,'group_id',t.group_id,'created_by',t.created_by),
    jsonb_build_object('quiet_hours_start',u.quiet_hours_start,'quiet_hours_end',u.quiet_hours_end)
  from claimed c join public.tasks t on t.id=c.task_id join public.users u on u.id=c.user_id;
end $$;

revoke all on function public.consume_rate_limit(text,integer,integer) from public,anon,authenticated;
revoke all on function public.create_task(jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.claim_due_reminders(timestamptz,text,boolean,text) from public,anon,authenticated;
grant execute on function public.consume_rate_limit(text,integer,integer) to service_role;
grant execute on function public.create_task(jsonb,jsonb,jsonb) to service_role;
grant execute on function public.claim_due_reminders(timestamptz,text,boolean,text) to service_role;
