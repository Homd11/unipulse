import {
  DEMO_USERS,
  INITIAL_GROUPS,
  INITIAL_TASKS,
} from "@/lib/initial-data";
import { StoredPushSubscription } from "@/lib/vapid";
import { StudyGroup, TaskItem, UserProfile } from "@/types/app";

export interface FallbackUser extends UserProfile {
  pinHash: string;
}

export interface MemoryDatabaseSchema {
  users: FallbackUser[];
  groups: StudyGroup[];
  tasks: TaskItem[];
  pushSubscriptions: StoredPushSubscription[];
  updatedAt: string;
}

const DEFAULT_PIN_HASH = "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4";

const globalForDb = globalThis as unknown as {
  __unipulseMemDb?: MemoryDatabaseSchema;
};

export function readServerDb(): MemoryDatabaseSchema {
  if (process.env.NODE_ENV === "production") throw new Error("Memory storage is disabled in production.");
  if (!globalForDb.__unipulseMemDb) {
    globalForDb.__unipulseMemDb = {
      users: DEMO_USERS.map((u) => ({
        ...u,
        displayName: u.id === "user-you" ? "Ahmed" : u.displayName,
        pinHash: DEFAULT_PIN_HASH,
      })),
      groups: INITIAL_GROUPS,
      tasks: INITIAL_TASKS,
      pushSubscriptions: [],
      updatedAt: new Date().toISOString(),
    };
  }
  return globalForDb.__unipulseMemDb;
}

export function writeServerDb(
  updater: (current: MemoryDatabaseSchema) => MemoryDatabaseSchema
): MemoryDatabaseSchema {
  const current = readServerDb();
  const next = updater(current);
  next.updatedAt = new Date().toISOString();
  globalForDb.__unipulseMemDb = next;
  return next;
}
