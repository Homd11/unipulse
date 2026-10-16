// Production & fallback VAPID configuration
export const PUBLIC_VAPID_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
  "BOTHByYyoGSTGBcJgkrfiHRSiIHGk76pAugQxBRHbYgCklLi4Yvh7gia_1t3Hzw5C_SA3zVUsnjj1x7LICxDOaU";

export const PRIVATE_VAPID_KEY =
  process.env.VAPID_PRIVATE_KEY ||
  "Nx_5fA4KgI2G0NkgjukOtzJjKjqwZXQdlqh3y21Rs3E";

export const VAPID_SUBJECT =
  process.env.VAPID_SUBJECT || "mailto:reminders@unipulse.app";

export interface StoredPushSubscription {
  userId: string;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string;
  createdAt: string;
}

const globalForPush = globalThis as unknown as {
  __unipulsePushSubs?: Map<string, StoredPushSubscription>;
};

export function getLocalPushStore(): Map<string, StoredPushSubscription> {
  if (!globalForPush.__unipulsePushSubs) {
    globalForPush.__unipulsePushSubs = new Map();
  }
  return globalForPush.__unipulsePushSubs;
}
