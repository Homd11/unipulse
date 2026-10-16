import { NextResponse } from "next/server";
import webpush from "web-push";
import { getServiceSupabase } from "@/lib/supabase";
import { checkSupabaseTablesReady } from "@/lib/supabase-data";
import { readServerDb, writeServerDb } from "@/lib/server-db";
import {
  getLocalPushStore,
  PRIVATE_VAPID_KEY,
  PUBLIC_VAPID_KEY,
  VAPID_SUBJECT,
} from "@/lib/vapid";

webpush.setVapidDetails(VAPID_SUBJECT, PUBLIC_VAPID_KEY, PRIVATE_VAPID_KEY);

function isWithinQuietHours(
  nowDate: Date,
  quietStart?: string | null,
  quietEnd?: string | null
): boolean {
  if (!quietStart || !quietEnd) return false;
  const currentMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();
  const [startH, startM] = quietStart.split(":").map(Number);
  const [endH, endM] = quietEnd.split(":").map(Number);
  if (isNaN(startH) || isNaN(endH)) return false;

  const startTotal = startH * 60 + (startM || 0);
  const endTotal = endH * 60 + (endM || 0);

  if (startTotal <= endTotal) {
    return currentMinutes >= startTotal && currentMinutes < endTotal;
  }
  return currentMinutes >= startTotal || currentMinutes < endTotal;
}

export async function GET(request: Request) {
  return handleCronReminders(request);
}

export async function POST(request: Request) {
  return handleCronReminders(request);
}

async function handleCronReminders(request: Request) {
  try {
    const now = new Date();
    const nowMs = now.getTime();
    const supabase = getServiceSupabase();
    const schemaReady = await checkSupabaseTablesReady();

    let forceImmediateForUser: string | null = null;
    if (request.method === "POST") {
      try {
        const parsed = await request.json();
        if (parsed?.forceUserId) {
          forceImmediateForUser = parsed.forceUserId;
        }
      } catch {
        // Empty body from Vercel Cron / cron-job.org / pg_cron is fine
      }
    }

    let dispatched = 0;
    const processedTaskIds: string[] = [];

    // 1. Relational Supabase Production Cron Loop
    if (supabase && schemaReady) {
      let query = supabase
        .from("task_statuses")
        .select(
          `
          task_id,
          user_id,
          status,
          reminder_interval_mins,
          next_reminder_at,
          tasks ( id, title, due_at, category, group_id ),
          users ( id, name, quiet_hours_start, quiet_hours_end )
        `
        )
        .eq("status", "on_me");

      if (forceImmediateForUser) {
        query = query.eq("user_id", forceImmediateForUser);
      } else {
        query = query.lte("next_reminder_at", now.toISOString());
      }

      const { data: dueRows, error } = await query;

      if (!error && dueRows) {
        for (const row of dueRows) {
          const userObj = Array.isArray(row.users) ? row.users[0] : row.users;
          const taskObj = Array.isArray(row.tasks) ? row.tasks[0] : row.tasks;

          if (!taskObj) continue;

          if (
            !forceImmediateForUser &&
            userObj &&
            isWithinQuietHours(
              now,
              userObj.quiet_hours_start,
              userObj.quiet_hours_end
            )
          ) {
            continue;
          }

          const { data: subs } = await supabase
            .from("push_subscriptions")
            .select("endpoint, p256dh, auth")
            .eq("user_id", row.user_id);

          const intervalMins = row.reminder_interval_mins || 120;
          const intervalLabel =
            intervalMins >= 60 ? `${intervalMins / 60}h` : `${intervalMins}m`;

          const payload = JSON.stringify({
            title: `Still On You: ${taskObj.title}`,
            body: `This task is still unfinished! Pinging you every ${intervalLabel} until you mark it Done.`,
            taskId: taskObj.id,
            tag: `task-${taskObj.id}`,
            url: `/?tab=on-me&taskId=${taskObj.id}`,
          });

          if (subs && subs.length > 0) {
            for (const sub of subs) {
              try {
                await webpush.sendNotification(
                  {
                    endpoint: sub.endpoint,
                    keys: { p256dh: sub.p256dh, auth: sub.auth },
                  },
                  payload
                );
                dispatched++;
              } catch {
                // Ignore expired endpoints during batch
              }
            }
          }

          const nextPing = new Date(
            nowMs + intervalMins * 60 * 1000
          ).toISOString();

          await supabase
            .from("task_statuses")
            .update({
              last_reminded_at: now.toISOString(),
              next_reminder_at: nextPing,
              updated_at: now.toISOString(),
            })
            .eq("task_id", row.task_id)
            .eq("user_id", row.user_id);

          processedTaskIds.push(taskObj.id);
        }
      }

      return NextResponse.json({
        ok: true,
        mode: "supabase-relational",
        checkedAt: now.toISOString(),
        dispatchedNotifications: dispatched,
        processedTaskIds,
      });
    }

    // 2. Fallback loop before supabase/schema.sql is run
    const db = readServerDb();
    const localStore = getLocalPushStore();
    const allSubs = [...db.pushSubscriptions];
    for (const memSub of localStore.values()) {
      if (!allSubs.some((s) => s.endpoint === memSub.endpoint)) {
        allSubs.push(memSub);
      }
    }

    for (const task of db.tasks) {
      const grp = db.groups.find((g) => g.id === task.groupId);
      const courseTag = grp?.courseCode || "PRIVATE";

      for (const st of task.memberStatuses) {
        if (st.involvement !== "on_me" || st.status === "done") continue;

        const isDue =
          forceImmediateForUser === st.userId ||
          !st.nextReminderAt ||
          new Date(st.nextReminderAt).getTime() <= nowMs;

        if (!isDue) continue;

        const intervalMins = st.reminderIntervalMinutes || 120;
        const intervalLabel =
          intervalMins >= 60 ? `${intervalMins / 60}h` : `${intervalMins}m`;

        const payload = JSON.stringify({
          title: `[${courseTag}] Still On You: ${task.title}`,
          body: `Pinging you every ${intervalLabel} until you mark this task Done.`,
          taskId: task.id,
          tag: `task-${task.id}`,
          url: `/?tab=on-me&taskId=${task.id}`,
        });

        const userSubs = allSubs.filter((s) => s.userId === st.userId);
        for (const sub of userSubs) {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: sub.keys },
              payload
            );
            dispatched++;
          } catch {
            // Ignore
          }
        }
        processedTaskIds.push(task.id);
      }
    }

    if (processedTaskIds.length > 0) {
      writeServerDb((curr) => ({
        ...curr,
        tasks: curr.tasks.map((t) => {
          if (!processedTaskIds.includes(t.id)) return t;
          return {
            ...t,
            memberStatuses: t.memberStatuses.map((st) => {
              if (st.involvement !== "on_me" || st.status === "done") return st;
              const interval = st.reminderIntervalMinutes || 120;
              return {
                ...st,
                lastRemindedAt: now.toISOString(),
                nextReminderAt: new Date(
                  nowMs + interval * 60_000
                ).toISOString(),
              };
            }),
          };
        }),
      }));
    }

    return NextResponse.json({
      ok: true,
      mode: "fallback",
      checkedAt: now.toISOString(),
      dispatchedNotifications: dispatched,
      processedTaskIds,
    });
  } catch (err) {
    console.error("Cron reminder error:", err);
    return NextResponse.json(
      { error: "Cron reminder execution failed" },
      { status: 500 }
    );
  }
}
