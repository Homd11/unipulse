-- OPTIONAL LOCAL DEVELOPMENT DATA ONLY. Never run against production.
-- These user- demo IDs are blocked by production authentication.
-- PIN 1234 is intentionally known; these rows have no administrator privilege.
insert into public.users (id,name,pin_hash) values
  ('user-demo-student','Demo Student','03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4'),
  ('user-demo-peer','Demo Peer','03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4')
on conflict (id) do nothing;
insert into public.groups (id,name,course_code,invite_code,created_by)
values ('demo-group','Example Study Group','DEMO','DEMO-LOCAL','user-demo-student') on conflict (id) do nothing;
insert into public.group_members (group_id,user_id) values ('demo-group','user-demo-student'),('demo-group','user-demo-peer')
on conflict (group_id,user_id) do nothing;
insert into public.tasks (id,group_id,title,description,category,due_at,created_by)
values ('demo-task','demo-group','Try creating a study task','Optional local example','assignment',now()+interval '1 day','user-demo-student')
on conflict (id) do nothing;
