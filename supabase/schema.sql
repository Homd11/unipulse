-- ============================================================================
-- UNIPULSE PRODUCTION SCHEMA (Idempotent Relational Migration)
-- Target Project: https://cpiepahitseyuejctfab.supabase.co
-- Run this entire script in: Supabase Dashboard -> SQL Editor -> New Query
-- ============================================================================

create extension if not exists "uuid-ossp";

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

-- Indexes for fast queries & cron scans
create index if not exists idx_tasks_group_id on public.tasks(group_id);
create index if not exists idx_tasks_created_by on public.tasks(created_by);
create index if not exists idx_task_statuses_due on public.task_statuses(status, next_reminder_at);
create index if not exists idx_task_comments_task_id on public.task_comments(task_id);
create index if not exists idx_task_attachments_task_id on public.task_attachments(task_id);

-- ============================================================================
-- ROW-LEVEL SECURITY (RLS) & REALTIME CONFIGURATION
-- ============================================================================
alter table public.users enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.tasks enable row level security;
alter table public.task_statuses enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_attachments enable row level security;
alter table public.push_subscriptions enable row level security;

-- Public read policies for Realtime subscriptions on shared entities
-- (Private Vault tasks with group_id IS NULL are protected & filtered by server session)
drop policy if exists "Allow realtime read on groups" on public.groups;
create policy "Allow realtime read on groups" on public.groups for select using (true);

drop policy if exists "Allow realtime read on shared tasks" on public.tasks;
create policy "Allow realtime read on shared tasks" on public.tasks for select using (group_id is not null);

drop policy if exists "Allow realtime read on task_statuses" on public.task_statuses;
create policy "Allow realtime read on task_statuses" on public.task_statuses for select using (true);

drop policy if exists "Allow realtime read on task_comments" on public.task_comments;
create policy "Allow realtime read on task_comments" on public.task_comments for select using (true);

drop policy if exists "Allow realtime read on task_attachments" on public.task_attachments;
create policy "Allow realtime read on task_attachments" on public.task_attachments for select using (true);

-- Enable Supabase Realtime on relational tables (idempotent DO block)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'task_statuses'
  ) then
    alter publication supabase_realtime add table public.task_statuses;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'task_comments'
  ) then
    alter publication supabase_realtime add table public.task_comments;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'task_attachments'
  ) then
    alter publication supabase_realtime add table public.task_attachments;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'groups'
  ) then
    alter publication supabase_realtime add table public.groups;
  end if;
end $$;

-- ============================================================================
-- STORAGE BUCKET SETUP (task-files)
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('task-files', 'task-files', true)
on conflict (id) do update set public = true;

drop policy if exists "Public read access for task-files" on storage.objects;
create policy "Public read access for task-files"
  on storage.objects for select
  using (bucket_id = 'task-files');

drop policy if exists "Service role upload access for task-files" on storage.objects;
create policy "Service role upload access for task-files"
  on storage.objects for insert
  with check (bucket_id = 'task-files');

-- ============================================================================
-- SAFE IDEMPOTENT SEED DATA (Default PIN for demo users: 1234)
-- SHA-256('1234') = 03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4
-- ============================================================================
insert into public.users (id, name, pin_hash, avatar_color, quiet_hours_start, quiet_hours_end)
values
  ('user-you',  'Ahmed',   '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', '#0D9488', '01:00', '08:00'),
  ('user-omar', 'Omar K.', '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', '#10B981', '00:30', '07:30'),
  ('user-sara', 'Sara M.', '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', '#EA580C', '01:00', '08:00'),
  ('user-ziad', 'Ziad T.', '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', '#0284C7', '02:00', '09:00')
on conflict (id) do nothing;

insert into public.groups (id, name, course_code, invite_code, created_by)
values
  ('grp-cs302', 'Operating Systems',    'CS-302',   'OS2026', 'user-omar'),
  ('grp-se401', 'Software Engineering', 'SE-401',   'SE401X', 'user-you'),
  ('grp-squad', 'Uni Batch 26 Squad',   'BATCH-26', 'SQUAD9', 'user-sara')
on conflict (id) do nothing;

insert into public.group_members (group_id, user_id)
values
  ('grp-cs302', 'user-you'), ('grp-cs302', 'user-omar'), ('grp-cs302', 'user-sara'), ('grp-cs302', 'user-ziad'),
  ('grp-se401', 'user-you'), ('grp-se401', 'user-omar'), ('grp-se401', 'user-sara'), ('grp-se401', 'user-ziad'),
  ('grp-squad', 'user-you'), ('grp-squad', 'user-omar'), ('grp-squad', 'user-sara'), ('grp-squad', 'user-ziad')
on conflict (group_id, user_id) do nothing;

insert into public.tasks (id, group_id, title, description, category, due_at, reminder_interval_mins, created_by)
values
  (
    'task-os-lab4',
    'grp-cs302',
    'Lab 4: Virtual Memory & LRU Page Replacement',
    'Dr. Khaled mentioned in the last 3 mins of lecture that this is due tomorrow night on Moodle! Submit both C++ source files and the benchmark PDF.',
    'assignment',
    now() + interval '18 hours',
    120,
    'user-omar'
  ),
  (
    'task-se-quiz2',
    'grp-se401',
    'Pop Quiz 2: Sequence Diagrams & Architecture Patterns',
    'TA confirmed in section 2 that tomorrow''s quiz covers Lecture 5 & 6 (Sequence diagrams + MVC vs Microservices). Attached summary notes below.',
    'quiz',
    now() + interval '26 hours',
    120,
    'user-sara'
  ),
  (
    'task-squad-slides',
    'grp-squad',
    'Graduation Project Pitch Deck — Upload Your 3 Slides',
    'Each person only needs to finish their assigned part of the architecture & demo deck before Thursday''s supervisor meeting.',
    'project',
    now() + interval '42 hours',
    120,
    'user-ziad'
  ),
  (
    'task-personal-1',
    null,
    'Pay semester lab fee & pick up stamped ID card',
    'Student affairs office closes at 2:30 PM. Bring receipt PDF on phone.',
    'personal',
    now() + interval '14 hours',
    120,
    'user-you'
  )
on conflict (id) do nothing;

insert into public.task_statuses (task_id, user_id, status, reminder_interval_mins, next_reminder_at)
values
  ('task-os-lab4',      'user-you',  'on_me', 120, now() + interval '90 minutes'),
  ('task-os-lab4',      'user-omar', 'on_me', 120, now() + interval '60 minutes'),
  ('task-os-lab4',      'user-sara', 'done',  120, null),
  ('task-os-lab4',      'user-ziad', 'on_me', 60,  now() + interval '30 minutes'),
  ('task-se-quiz2',     'user-sara', 'done',  120, null),
  ('task-se-quiz2',     'user-omar', 'on_me', 120, now() + interval '60 minutes'),
  ('task-squad-slides', 'user-you',  'on_me', 120, now() + interval '45 minutes'),
  ('task-squad-slides', 'user-ziad', 'done',  120, null),
  ('task-squad-slides', 'user-omar', 'done',  120, null),
  ('task-personal-1',   'user-you',  'on_me', 120, now() + interval '60 minutes')
on conflict (task_id, user_id) do nothing;

insert into public.task_comments (id, task_id, user_id, content)
values
  ('com-1', 'task-os-lab4',  'user-omar', 'Guys don''t let this get buried in WhatsApp like Lab 3. Click On Me so it pings you every 2 hrs!'),
  ('com-2', 'task-os-lab4',  'user-sara', 'Uploaded the starter .cpp file from the TA''s drive above! Just finished mine.'),
  ('com-3', 'task-se-quiz2', 'user-ziad', 'Wait is Chapter 7 included or only 5 & 6?'),
  ('com-4', 'task-se-quiz2', 'user-sara', 'Only 5 & 6! I asked Eng. Mahmoud directly after lab.')
on conflict (id) do nothing;

insert into public.task_attachments (id, task_id, file_name, file_url, file_type, file_size, uploaded_by)
values
  ('att-1', 'task-os-lab4',  'CS302_Lab4_Specification.txt', 'https://cpiepahitseyuejctfab.supabase.co/storage/v1/object/public/task-files/CS302_Lab4_Specification.txt', 'text/plain', 560,  'user-omar'),
  ('att-2', 'task-os-lab4',  'starter_lru_template.cpp',     'https://cpiepahitseyuejctfab.supabase.co/storage/v1/object/public/task-files/starter_lru_template.cpp',     'text/plain', 1180, 'user-sara'),
  ('att-3', 'task-se-quiz2', 'SE401_Quiz2_Summary_Notes.md', 'https://cpiepahitseyuejctfab.supabase.co/storage/v1/object/public/task-files/SE401_Quiz2_Summary_Notes.md', 'text/markdown', 940, 'user-sara')
on conflict (id) do nothing;

-- ============================================================================
-- OPTIONAL: SUPABASE PG_CRON BACKGROUND TRIGGER (Runs every 10 minutes)
-- Uncomment after deploying to Vercel to trigger /api/cron/reminders from DB:
-- ============================================================================
-- create extension if not exists "pg_cron";
-- create extension if not exists "pg_net";
-- select cron.schedule(
--   'unipulse-reminder-dispatcher',
--   '*/10 * * * *',
--   $$
--   select net.http_post(
--     url := 'https://your-vercel-domain.vercel.app/api/cron/reminders',
--     headers := '{"Content-Type": "application/json", "Authorization": "Bearer unipulse-cron-secret-2026"}'::jsonb
--   );
--   $$
-- );
