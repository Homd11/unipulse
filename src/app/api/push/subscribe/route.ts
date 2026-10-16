import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { checkSupabaseTablesReady } from "@/lib/supabase-data";
import { getLocalPushStore } from "@/lib/vapid";
import { writeServerDb } from "@/lib/server-db";

export async function POST(request: Request) {
  try {
    const session = await getSessionUser();
    const body = await request.json();
    const { userId: bodyUserId, subscription, userAgent } = body;
    const userId = session?.userId || bodyUserId;

    if (!userId || !subscription?.endpoint || !subscription?.keys?.p256dh) {
      return NextResponse.json(
        { error: "Missing userId or valid PushSubscription object" },
        { status: 400 }
      );
    }

    const subRecord = {
      userId,
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      userAgent: userAgent || "",
      createdAt: new Date().toISOString(),
    };

    const store = getLocalPushStore();
    store.set(subscription.endpoint, subRecord);

    writeServerDb((db) => {
      const filtered = db.pushSubscriptions.filter(
        (s) => s.endpoint !== subscription.endpoint
      );
      return {
        ...db,
        pushSubscriptions: [...filtered, subRecord],
      };
    });

    const supabase = getServiceSupabase();
    const schemaReady = await checkSupabaseTablesReady();
    if (supabase && schemaReady) {
      await supabase.from("push_subscriptions").upsert(
        {
          id: `sub-${Buffer.from(subscription.endpoint)
            .toString("base64url")
            .slice(-24)}`,
          user_id: userId,
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          user_agent: userAgent || null,
        },
        { onConflict: "endpoint" }
      );
    }

    return NextResponse.json({
      ok: true,
      storedInSupabase: Boolean(supabase && schemaReady),
    });
  } catch (err) {
    console.error("Error saving push subscription:", err);
    return NextResponse.json(
      { error: "Failed to save subscription" },
      { status: 500 }
    );
  }
}
