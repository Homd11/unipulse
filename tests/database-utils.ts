import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

export const applicationTables = ["users", "groups", "group_members", "tasks", "task_statuses", "task_comments", "task_attachments", "push_subscriptions", "api_rate_limits"];
export const schemaSql = () => readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
export const migrationSql = () => readFileSync(new URL("../supabase/migrations/20261020_production_hardening.sql", import.meta.url), "utf8");

export async function database(sql = schemaSql()) {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema storage;
    create table storage.buckets(id text primary key, name text not null, public boolean default false);
    create table storage.objects(id text primary key, bucket_id text references storage.buckets(id), name text);
    alter table storage.objects enable row level security;
    grant usage on schema public, storage to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
    create publication supabase_realtime;
  `);
  // The old schema requests an unused extension unavailable in embedded Postgres.
  await db.exec(sql.replace(/create extension if not exists "uuid-ossp";/gi, ""));
  return db;
}

export async function asRole<T>(db: PGlite, role: "anon" | "authenticated" | "service_role", run: () => Promise<T>) {
  await db.exec(`set role ${role}`);
  try { return await run(); } finally { await db.exec("reset role"); }
}

export async function fixtures(db: PGlite) {
  await db.exec(`
    insert into users(id,name,pin_hash) values ('student-a','Student A','hash'),('student-b','Student B','hash'),('outsider','Outsider','hash');
    insert into groups(id,name,course_code,invite_code,created_by) values ('group-a','Course','CS','JOINME','student-a');
    insert into group_members(group_id,user_id) values ('group-a','student-b');
    insert into tasks(id,group_id,title,due_at,created_by) values ('shared','group-a','Shared',now() + interval '1 day','student-a'),('private',null,'Private',now() + interval '1 day','student-a');
  `);
}
