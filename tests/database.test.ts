import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { applicationTables, asRole, database, fixtures, migrationSql, schemaSql } from "./database-utils";

const databases: PGlite[] = [];
async function setup(sql?: string) { const db = await database(sql); databases.push(db); return db; }
afterEach(async () => { await Promise.all(databases.splice(0).map(db => db.close())); });

describe("production database boundary", () => {
  it("fails closed when managed Storage RLS is disabled instead of changing its table", async () => {
    await expect(setup("alter table storage.objects disable row level security;\n" + schemaSql()).then(() => undefined)).rejects.toThrow(/Storage RLS must already be enabled/);
  });
  it("denies anonymous and authenticated direct table reads and writes", async () => {
    const db = await setup();
    await fixtures(db);
    for (const role of ["anon", "authenticated"] as const) {
      for (const table of applicationTables) {
        await expect(asRole(db, role, () => db.query(`select * from public.${table}`))).rejects.toThrow(/permission denied/);
      }
      await expect(asRole(db, role, () => db.exec("insert into public.users(id,name,pin_hash) values ('forged','Forged','hash')"))).rejects.toThrow(/permission denied/);
    }
    expect((await asRole(db, "service_role", () => db.query("select * from public.tasks"))).rows).toHaveLength(2);
  });

  it("keeps task files private and inaccessible to browser roles", async () => {
    const db = await setup();
    expect((await db.query<{ public: boolean }>("select public from storage.buckets where id='task-files'")).rows[0].public).toBe(false);
    await db.exec("insert into storage.objects(id,bucket_id,name) values ('file','task-files','secret.txt')");
    for (const role of ["anon", "authenticated"] as const) {
      expect((await asRole(db, role, () => db.query("select * from storage.objects"))).rows).toEqual([]);
      await expect(asRole(db, role, () => db.exec("insert into storage.objects(id,bucket_id,name) values ('forged','task-files','forged.txt')"))).rejects.toThrow(/row-level security|permission denied/);
    }
  });

  it("does not seed demo accounts in the production schema", async () => {
    const db = await setup();
    expect((await db.query("select * from users")).rows).toEqual([]);
  });

  it("counts every rate limit attempt and resets an expired bucket", async () => {
    const db = await setup();
    const consume = () => asRole(db, "service_role", () => db.query<{ allowed: boolean }>("select consume_rate_limit('login-key',2,60) as allowed"));
    const attempts = await Promise.all([consume(), consume(), consume()]);
    expect(attempts.map(result => result.rows[0].allowed)).toEqual([true,true,false]);
    expect((await db.query<{ attempts: number }>("select attempts from api_rate_limits where key='login-key'")).rows[0].attempts).toBe(3);
    await db.exec("update api_rate_limits set expires_at=now()-interval '1 second'");
    expect((await consume()).rows[0].allowed).toBe(true);
    for (const role of ["anon", "authenticated"] as const) {
      await expect(asRole(db, role, () => db.query("select consume_rate_limit('forged',2,60)"))).rejects.toThrow(/permission denied/);
    }
  });

  it("bounds expired rate limit cleanup and rejects invalid limits", async () => {
    const db = await setup();
    await db.exec("insert into api_rate_limits(key,attempts,expires_at) select 'expired-'||n,1,now()-interval '2 days' from generate_series(1,250) n");
    await db.query("select consume_rate_limit('new-key',2,60)");
    expect((await db.query<{count:number}>("select count(*)::int as count from api_rate_limits where key like 'expired-%'")).rows[0].count).toBe(150);
    await expect(db.query("select consume_rate_limit('bad',0,60)")).rejects.toThrow(/Invalid rate limit/);
    await expect(db.query("select consume_rate_limit('bad',2,0)")).rejects.toThrow(/Invalid rate limit/);
  });

  it("rolls back task creation when a secondary write fails", async () => {
    const db = await setup();
    await fixtures(db);
    const task = { id: "atomic-task", title: "Atomic", due_at: "2026-10-21T12:00:00Z", created_by: "student-a" };
    await expect(asRole(db, "service_role", () => db.query("select create_task($1::jsonb,$2::jsonb,null)", [JSON.stringify(task),JSON.stringify({task_id:"atomic-task",user_id:"missing",status:"on_me"})]))).rejects.toThrow();
    expect((await db.query("select * from tasks where id='atomic-task'")).rows).toHaveLength(0);
    await asRole(db, "service_role", () => db.query("select create_task($1::jsonb,$2::jsonb,$3::jsonb)", [JSON.stringify(task),JSON.stringify({task_id:"atomic-task",user_id:"student-a",status:"on_me"}),JSON.stringify({id:"attachment",task_id:"atomic-task",file_name:"notes.txt",file_url:"student-a/file",uploaded_by:"student-a"})]));
    expect((await db.query("select * from task_attachments where task_id='atomic-task'")).rows).toHaveLength(1);
    await expect(asRole(db, "anon", () => db.query("select create_task('{}'::jsonb)"))).rejects.toThrow(/permission denied/);
  });

  it("rolls back the task and status if the final attachment insert fails", async () => {
    const db = await setup();
    await fixtures(db);
    const task = { id:"attachment-rollback", title:"Atomic", due_at:"2026-10-21T12:00:00Z", created_by:"student-a" };
    await expect(db.query("select create_task($1::jsonb,$2::jsonb,$3::jsonb)", [JSON.stringify(task),JSON.stringify({task_id:task.id,user_id:"student-a"}),JSON.stringify({id:"invalid",task_id:task.id,file_name:"notes.txt",file_url:"student-a/file",uploaded_by:"missing"})])).rejects.toThrow(/foreign key/);
    expect((await db.query("select * from tasks where id='attachment-rollback'")).rows).toHaveLength(0);
    expect((await db.query("select * from task_statuses where task_id='attachment-rollback'")).rows).toHaveLength(0);
  });

  it("leases only visible due reminders once while preserving statuses", async () => {
    const db = await setup();
    await fixtures(db);
    await db.exec(`insert into task_statuses(task_id,user_id,status,reminder_interval_mins,next_reminder_at) values
      ('shared','student-a','on_me',5,'2026-10-20T10:00:00Z'),
      ('shared','student-b','on_me',120,'2026-10-20T10:00:00Z'),
      ('shared','outsider','on_me',120,'2026-10-20T10:00:00Z'),
      ('private','outsider','on_me',120,'2026-10-20T10:00:00Z'),
      ('private','student-a','done',120,'2026-10-20T10:00:00Z');`);
    const claim = () => asRole(db, "service_role", () => db.query<{task_id:string,user_id:string,status:string,next_reminder_at:Date,tasks:object,users:object}>("select * from claim_due_reminders('2026-10-20T12:00:00Z')"));
    const results = await Promise.all([claim(),claim()]);
    const rows = results.flatMap(result => result.rows);
    expect(rows.map(row => row.user_id).sort()).toEqual(["student-a","student-b"]);
    expect(rows.find(row => row.user_id === "student-a")?.next_reminder_at.toISOString()).toBe("2026-10-20T12:30:00.000Z");
    expect(rows[0].tasks).toMatchObject({id:"shared",group_id:"group-a",created_by:"student-a"});
    expect(rows[0].users).toMatchObject({quiet_hours_start:"01:00",quiet_hours_end:"08:00"});
    expect((await db.query<{status:string}>("select status from task_statuses where task_id='private' and user_id='student-a'")).rows[0].status).toBe("done");
    await expect(asRole(db, "service_role", () => db.query("select * from claim_due_reminders(now(),null,true)"))).rejects.toThrow(/user/i);
    expect((await asRole(db, "service_role", () => db.query("select * from claim_due_reminders('2026-10-20T12:01:00Z','student-b',true)"))).rows).toHaveLength(1);
    await expect(asRole(db, "authenticated", () => db.query("select * from claim_due_reminders(now())"))).rejects.toThrow(/permission denied/);
  });

  it("bounds reminder batches and avoids duplicate immediate force claims", async () => {
    const db = await setup();
    await fixtures(db);
    await db.exec(`insert into tasks(id,title,due_at,created_by)
      select 'batch-'||n,'Task',now(),'student-a' from generate_series(1,101) n;
      insert into task_statuses(task_id,user_id,next_reminder_at)
      select id,'student-a','2026-10-20T10:00:00Z' from tasks where id like 'batch-%';`);
    expect((await db.query("select * from claim_due_reminders('2026-10-20T12:00:00Z')")).rows).toHaveLength(100);
    expect((await db.query("select * from claim_due_reminders('2026-10-20T12:00:00Z','student-a',true)")).rows).toHaveLength(1);
    expect((await db.query("select * from claim_due_reminders('2026-10-20T12:00:00Z','student-a',true)")).rows).toHaveLength(0);
  });

  it("leaves daily reminders overdue during quiet hours and claims them at quiet end", async () => {
    const db = await setup();
    await fixtures(db);
    await db.exec("insert into task_statuses(task_id,user_id,reminder_interval_mins,next_reminder_at) values ('private','student-a',1440,'2026-10-20T01:00:00+03:00')");
    expect((await db.query("select * from claim_due_reminders('2026-10-20T01:30:00+03:00')")).rows).toHaveLength(0);
    expect((await db.query("select * from claim_due_reminders('2026-10-20T07:59:00+03:00','student-a',true)")).rows).toHaveLength(0);
    const waiting = (await db.query<{next_reminder_at:Date,last_reminded_at:Date|null}>("select next_reminder_at,last_reminded_at from task_statuses where task_id='private'")).rows[0];
    expect(waiting.next_reminder_at.toISOString()).toBe("2026-10-19T22:00:00.000Z");
    expect(waiting.last_reminded_at).toBeNull();
    const claimed = await db.query<{next_reminder_at:Date,status:string}>("select * from claim_due_reminders('2026-10-20T08:00:00+03:00')");
    expect(claimed.rows).toHaveLength(1);
    expect(claimed.rows[0].next_reminder_at.toISOString()).toBe("2026-10-21T05:00:00.000Z");
    expect(claimed.rows[0].status).toBe("on_me");
  });

  it("uses the configured timezone before leasing and denies browser execution of the new signature", async () => {
    const db = await setup();
    await fixtures(db);
    await db.exec("insert into task_statuses(task_id,user_id,next_reminder_at) values ('private','student-a','2026-10-20T00:00:00Z')");
    expect((await asRole(db,"service_role",() => db.query("select * from claim_due_reminders('2026-10-20T00:30:00Z',null,false,'Africa/Cairo')"))).rows).toHaveLength(0);
    expect((await asRole(db,"service_role",() => db.query("select * from claim_due_reminders('2026-10-20T00:30:00Z',null,false,'UTC')"))).rows).toHaveLength(1);
    for (const role of ["anon","authenticated"] as const) {
      await expect(asRole(db,role,() => db.query("select * from claim_due_reminders(now(),null,false,'UTC')"))).rejects.toThrow(/permission denied/);
    }
  });

  it("honors overnight quiet hours with inclusive start and exclusive end", async () => {
    const db = await setup();
    await fixtures(db);
    await db.exec("update users set quiet_hours_start='22:00',quiet_hours_end='08:00' where id='student-a'; insert into task_statuses(task_id,user_id,next_reminder_at) values ('private','student-a','2026-10-20T18:00:00Z')");
    expect((await db.query("select * from claim_due_reminders('2026-10-20T22:00:00+03:00')")).rows).toHaveLength(0);
    expect((await db.query("select * from claim_due_reminders('2026-10-21T07:59:00+03:00')")).rows).toHaveLength(0);
    expect((await db.query("select * from claim_due_reminders('2026-10-21T08:00:00+03:00')")).rows).toHaveLength(1);
  });

  it("treats equal or malformed saved hours as disabled and handles legacy seconds", async () => {
    const db = await setup();
    await fixtures(db);
    await db.exec("insert into task_statuses(task_id,user_id,next_reminder_at) values ('private','student-a','2026-10-20T00:00:00Z')");
    for (const [start,end,count] of [["01:00","01:00",1],["99:00","08:00",1],["01:00:00","08:00:00",0]] as const) {
      await db.query("update users set quiet_hours_start=$1,quiet_hours_end=$2 where id='student-a'",[start,end]);
      await db.exec("update task_statuses set next_reminder_at='2026-10-20T00:00:00Z',last_reminded_at=null");
      expect((await db.query("select * from claim_due_reminders('2026-10-20T03:00:00+03:00')")).rows).toHaveLength(count);
    }
  });

  it("migrates existing rows idempotently and protects files under wildcard policies", async () => {
    const db = await setup(schemaSql());
    await fixtures(db);
    await db.exec(`drop table api_rate_limits;
      create function public.claim_due_reminders(timestamptz,text,boolean) returns boolean language sql as 'select true';
      grant all on public.tasks to anon,authenticated;
      create policy "legacy public tasks" on public.tasks for select using (true);
      update storage.buckets set public=true where id='task-files';
      insert into storage.buckets(id,name,public) values ('other-app','other-app',true);
      insert into storage.objects(id,bucket_id,name) values ('private-object','task-files','secret'),('unrelated-object','other-app','visible');
      create policy "unrelated legacy wildcard" on storage.objects for all to anon,authenticated using (true) with check (true);`);
    await db.exec(migrationSql());
    await db.exec(migrationSql());
    expect((await db.query<{old_signature:string|null}>("select to_regprocedure('public.claim_due_reminders(timestamptz,text,boolean)') as old_signature")).rows[0].old_signature).toBeNull();
    expect((await db.query("select * from tasks")).rows).toHaveLength(2);
    expect((await db.query("select * from group_members")).rows).toHaveLength(1);
    await expect(asRole(db,"anon",() => db.query("select * from tasks"))).rejects.toThrow(/permission denied/);
    expect((await asRole(db,"anon",() => db.query<{id:string}>("select * from storage.objects"))).rows.map(row => row.id)).toEqual(["unrelated-object"]);
    expect((await db.query<{public:boolean}>("select public from storage.buckets where id='other-app'")).rows[0].public).toBe(true);
    expect((await db.query<{public:boolean}>("select public from storage.buckets where id='task-files'")).rows[0].public).toBe(false);
    await expect(asRole(db,"anon",() => db.exec("insert into storage.objects(id,bucket_id,name) values ('forged','task-files','bad')"))).rejects.toThrow(/row-level security/);
    expect((await db.query("select * from storage.objects")).rows).toHaveLength(2);
    expect((await db.query("select * from pg_policies where policyname='unrelated legacy wildcard'")).rows).toHaveLength(1);
  });
});
