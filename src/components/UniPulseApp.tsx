"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BellRing,
  CheckCircle2,
  Copy,
  Database,
  FolderKanban,
  KeyRound,
  Languages,
  Link2,
  Lock,
  Moon,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sun,
  Trash2,
  UserCheck,
  Users,
} from "lucide-react";
import {
  detectPlatformPushState,
  detachWebPush,
  syncExistingWebPush,
  PlatformPushState,
  requestAndSubscribeWebPush,
  triggerServerPushNotification,
} from "@/lib/push-client";
import { Language, LanguageContext } from "@/lib/i18n";
import {
  StudyGroup,
  TaskAttachment,
  TaskCategory,
  TaskItem,
  UserProfile,
} from "@/types/app";
import IosPwaBanner from "./IosPwaBanner";
import TaskCard from "./TaskCard";
import TaskDetailModal from "./TaskDetailModal";
import CreateTaskModal from "./CreateTaskModal";
import GroupModal from "./GroupModal";
import ProfileModal from "./ProfileModal";

type ActiveTab = "on-me" | "groups" | "personal";

const STORAGE_KEY_THEME = "unipulse_theme_v2";
const STORAGE_KEY_LANG = "unipulse_lang_v1";

class HttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function requestJson(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.ok === false) {
    throw new HttpError(data?.error || `Request failed (${response.status}). Please retry.`, response.status);
  }
  return data;
}


export default function UniPulseApp() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("on-me");
  const [isDark, setIsDark] = useState<boolean>(false);
  const [lang, setLangState] = useState<Language>("ar");
  const isAr = lang === "ar";

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [authenticatedUser, setAuthenticatedUser] =
    useState<UserProfile | null>(null);
  const [authLoaded, setAuthLoaded] = useState<boolean>(false);
  const [schemaReady, setSchemaReady] = useState<boolean>(false);
  const [groups, setGroups] = useState<StudyGroup[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("all");
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [pendingInviteCode, setPendingInviteCode] = useState<string>("");
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<"synced" | "syncing">("synced");

  // iOS PWA & Web Push State
  const [platformState, setPlatformState] = useState<PlatformPushState>({
    isIOS: false,
    isStandalone: false,
    isSupported: false,
    permission: "unsupported",
  });
  const [simulateIosSafari, setSimulateIosSafari] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushFeedback, setPushFeedback] = useState<string | null>(null);
  const [cronRunning, setCronRunning] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const stateRequest = useRef(0);
  const authGeneration = useRef(0);
  const authPending = useRef(false);
  const stateAbort = useRef<AbortController | null>(null);
  const joiningInvite = useRef<string | null>(null);


  const setLang = useCallback((nextLang: Language) => {
    setLangState(nextLang);
    try {
      localStorage.setItem(STORAGE_KEY_LANG, nextLang);
      document.documentElement.dir = nextLang === "ar" ? "rtl" : "ltr";
      document.documentElement.lang = nextLang;
    } catch {
      // Ignore
    }
  }, []);

  const toggleLang = () => {
    setLang(lang === "ar" ? "en" : "ar");
  };

  const currentUser = useMemo<UserProfile>(
    () =>
      authenticatedUser ||
      users[0] || {
        id: "guest",
        displayName: isAr ? "طالب زائر" : "Guest",
        avatarColor: "#0D9488",
        quietHoursStart: "01:00",
        quietHoursEnd: "08:00",
      },
    [authenticatedUser, users, isAr]
  );

  // Only the newest response from the current authentication generation may apply.
  const fetchServerState = useCallback(async () => {
    const requestId = ++stateRequest.current;
    const generation = authGeneration.current;
    stateAbort.current?.abort();
    const controller = new AbortController();
    stateAbort.current = controller;
    try {
      const data = await requestJson("/api/state", { cache: "no-store", signal: controller.signal });
      if (requestId !== stateRequest.current || generation !== authGeneration.current) return;
      setSchemaReady(Boolean(data.schemaReady));
      setUsers(Array.isArray(data.users) ? data.users : []);
      setGroups(Array.isArray(data.groups) ? data.groups : []);
      setTasks(Array.isArray(data.tasks) ? data.tasks : []);
      setAuthenticatedUser(data.authenticatedUser || null);
      setConnectionError(null);
    } catch (err) {
      if (requestId !== stateRequest.current || generation !== authGeneration.current || controller.signal.aborted) return;
      if (err instanceof HttpError && err.status === 401) {
        setAuthenticatedUser(null);
        setUsers([]);
        setGroups([]);
        setTasks([]);
        setDetailTaskId(null);
        setShowCreateTaskModal(false);
        setShowGroupModal(false);
      }
      setConnectionError(err instanceof Error ? err.message : "Could not refresh tasks. Please retry.");
    } finally {
      if (requestId === stateRequest.current && generation === authGeneration.current) setAuthLoaded(true);
    }
  }, []);

  const beginAuthChange = () => {
    ++authGeneration.current;
    ++stateRequest.current;
    stateAbort.current?.abort();
  };

  const clearAccountState = () => {
    setAuthenticatedUser(null);
    setUsers([]);
    setGroups([]);
    setTasks([]);
    setSelectedGroupId("all");
    setDetailTaskId(null);
    setShowCreateTaskModal(false);
    setShowGroupModal(false);
  };

  // Initial load, theme setup, language setup, URL params (?join=CODE, ?taskId=...), and SW registration
  useEffect(() => {
    setPlatformState(detectPlatformPushState());

    try {
      const savedTheme = localStorage.getItem(STORAGE_KEY_THEME);
      if (savedTheme === "dark") {
        setIsDark(true);
        document.documentElement.classList.add("dark");
      } else {
        setIsDark(false);
        document.documentElement.classList.remove("dark");
      }

      const savedLang = localStorage.getItem(STORAGE_KEY_LANG) as Language | null;
      const initialLang: Language =
        savedLang === "en" || savedLang === "ar" ? savedLang : "ar";
      setLangState(initialLang);
      document.documentElement.dir = initialLang === "ar" ? "rtl" : "ltr";
      document.documentElement.lang = initialLang;
    } catch {
      // Ignore
    }

    // Check URL parameters for direct invite link (?join=CODE) or notification deep link (?taskId=...)
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const joinParam = params.get("join");
      const tabParam = params.get("tab") as ActiveTab | null;
      const taskIdParam = params.get("taskId");

      if (tabParam && ["on-me", "groups", "personal"].includes(tabParam)) {
        setActiveTab(tabParam);
      }
      if (taskIdParam) {
        setDetailTaskId(taskIdParam);
      }
      if (joinParam) {
        const cleanCode = joinParam.trim().toUpperCase();
        setPendingInviteCode(cleanCode);
        setActiveTab("groups");
      }
    }

    fetchServerState();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
      const onMessage = (event: MessageEvent) => {
        if (event.data?.type === "NOTIFICATION_CLICKED" && event.data?.taskId) {
          setActiveTab("on-me");
          setDetailTaskId(event.data.taskId);
          void fetchServerState();
        }
      };
      navigator.serviceWorker.addEventListener("message", onMessage);
      return () => {
        navigator.serviceWorker.removeEventListener("message", onMessage);
        stateAbort.current?.abort();
      };
    }
  }, [fetchServerState]);

  // Automatically process ?join=INVITE_CODE when groups/auth load
  useEffect(() => {
    if (!pendingInviteCode || !authLoaded) return;
    const match = groups.find(
      (g) => g.inviteCode.toUpperCase() === pendingInviteCode.toUpperCase()
    );
    if (match) {
      setSelectedGroupId(match.id);
      setActiveTab("groups");
    }
    if (authenticatedUser) {
      const inviteKey = `${authenticatedUser.id}:${pendingInviteCode}`;
      if (joiningInvite.current === inviteKey) return;
      joiningInvite.current = inviteKey;
      const generation = authGeneration.current;
      requestJson("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "JOIN",
          inviteCode: pendingInviteCode,
        }),
      })
        .then((data) => {
          if (generation !== authGeneration.current) return;
          if (data?.group?.id) {
            setSelectedGroupId(data.group.id);
            setPushFeedback(
              isAr
                ? `دخلت جروب ${data.group.courseCode} — ${data.group.name}`
                : `Joined ${data.group.courseCode} — ${data.group.name}`
            );
            fetchServerState();
          }
        })
        .catch((err) => { setActionError(err instanceof Error ? err.message : "Could not join group. Please retry the invite code."); })
        .finally(() => {
          if (joiningInvite.current === inviteKey) joiningInvite.current = null;
          if (generation !== authGeneration.current) return;
          setPendingInviteCode("");
          if (typeof window !== "undefined") {
            const url = new URL(window.location.href);
            url.searchParams.delete("join");
            window.history.replaceState({}, "", url.toString());
          }
        });
    }
  }, [
    pendingInviteCode,
    authLoaded,
    authenticatedUser,
    groups,
    fetchServerState,
    isAr,
  ]);

  // Server sessions are the access boundary. Poll only visible signed-in tabs.
  const authenticatedUserId = authenticatedUser?.id;
  useEffect(() => {
    if (!authenticatedUserId) return;
    const refreshVisible = () => {
      if (document.visibilityState === "visible" && !authPending.current) void fetchServerState();
    };
    const interval = setInterval(refreshVisible, 25000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [authenticatedUserId, fetchServerState]);

  // Serialize authentication requests so browser cookie writes cannot race.
  const authenticate = async (payload: Record<string, string>) => {
    if (authPending.current) return { ok: false, error: isAr ? "استنى محاولة الدخول الحالية." : "A sign-in request is already in progress." };
    authPending.current = true;
    beginAuthChange();
    try {
      const data = await requestJson("/api/auth", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!data.ok || !data.user) throw new Error(data.error || "Could not sign in.");
      clearAccountState();
      setAuthenticatedUser(data.user);
      await fetchServerState();
      await syncExistingWebPush().catch((err) => setPushFeedback(err instanceof Error ? err.message : "Could not reconnect notifications."));
      return { ok: true };
    } catch (err) {
      await fetchServerState();
      return { ok: false, error: err instanceof Error ? err.message : "Could not sign in. Please retry." };
    } finally { authPending.current = false; }
  };

  const handleLogin = (collegeId: string, pin: string) => authenticate({ action: "LOGIN", collegeId, pin });
  const handleRegister = (collegeId: string, name: string, pin: string, avatarColor: string) => authenticate({ action: "REGISTER", collegeId, name, pin, avatarColor });

  const handleLogout = async () => {
    if (authPending.current) throw new Error("An authentication request is already in progress.");
    authPending.current = true;
    beginAuthChange();
    try {
      await detachWebPush().catch((err) => setPushFeedback(err instanceof Error ? err.message : "Notification cleanup could not complete."));
      await requestJson("/api/auth", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "LOGOUT" }),
      });
      clearAccountState();
      await fetchServerState();
    } finally { authPending.current = false; }
  };

  const requireSignedIn = (): boolean => {
    if (!authenticatedUser) {
      setShowProfileModal(true);
      return false;
    }
    return true;
  };

  const toggleTheme = () => {
    setIsDark((prev) => {
      const next = !prev;
      if (next) {
        document.documentElement.classList.add("dark");
        try { localStorage.setItem(STORAGE_KEY_THEME, "dark"); } catch { /* Theme still applies when browser storage is unavailable. */ }
      } else {
        document.documentElement.classList.remove("dark");
        try { localStorage.setItem(STORAGE_KEY_THEME, "light"); } catch { /* Theme still applies when browser storage is unavailable. */ }
      }
      return next;
    });
  };

  // Explicit User Gesture Web Push Handler (Required by iOS 16.4+)
  const handleEnablePushGesture = async () => {
    if (!requireSignedIn()) return;
    setPushLoading(true);
    setPushFeedback(null);
    const result = await requestAndSubscribeWebPush(currentUser.id);
    setPlatformState(detectPlatformPushState());
    setPushLoading(false);

    if (result.ok) {
      setPushFeedback(
        isAr
          ? "تمام! منبّه الساعتين اشتغل خلاص."
          : "2-hour background push reminders armed."
      );
      await triggerServerPushNotification({
        userId: currentUser.id,
        title: isAr
          ? "UniPulse — التذكير كل ساعتين شغّال"
          : "UniPulse 2h Reminders Armed",
        message: isAr
          ? "أي تاسك هتحطه «عليّا أنا» هيفكّرك كل ساعتين لحد ما تدوس خلّصت خلاص."
          : "Any task marked 'On Me' will ping you every 2 hours until you mark it Done.",
      });
    } else {
      setPushFeedback(
        result.error ||
          (isAr
            ? "فعّل الإشعارات من إعدادات المتصفح أو الموبايل."
            : "Enable notifications in your browser/iOS settings.")
      );
    }
  };

  const handleSendTestPush = async () => {
    if (!requireSignedIn()) return;
    setPushLoading(true);
    const activeOnMe = tasks.find((t) => {
      const st = t.memberStatuses.find((s) => s.userId === currentUser.id);
      return st?.involvement === "on_me" && st?.status !== "done";
    });

    const res = await triggerServerPushNotification({
      userId: currentUser.id,
      title: activeOnMe
        ? isAr
          ? `تذكير كل ساعتين: ${activeOnMe.title}`
          : `2h Reminder: ${activeOnMe.title}`
        : isAr
        ? "تجربة إشعار UniPulse"
        : "UniPulse 2-Hour Reminder Test",
      message: activeOnMe
        ? isAr
          ? "التاسك ده لسه وراك! افتحه ولما تخلّصه دوس «خلّصت خلاص»."
          : "Still on your active list! Tap to open and mark Done when finished."
        : isAr
        ? "الإشعارات شغّالة تمام! حط أي تاسك «عليّا أنا» وهيفكّرك كل ساعتين."
        : "Server-side Web Push is working! Claim any task 'On Me' to start 2h alerts.",
      taskId: activeOnMe?.id,
    });
    setPushLoading(false);
    setPushFeedback(
      res.ok
        ? isAr
          ? "اتبعَت إشعار تجريبي لموبايلك/متصفحك دلوقتي."
          : "Dispatched real server Web Push notification."
        : res.reason ||
            (isAr
              ? "دوس «شغّل تنبيه كل ساعتين» الأول."
              : "Tap 'Enable 2h Alerts' first.")
    );
  };

  // Trigger the Server-Side Cron Endpoint (/api/cron/reminders)
  const handleRunServerCron = async () => {
    if (!requireSignedIn()) return;
    setCronRunning(true);
    try {
      const data = await requestJson("/api/cron/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      await fetchServerState();

      setPushFeedback(
        isAr
          ? `تم تشغيل المنبّه: فكّرناك بـ ${
              data.processedTaskIds?.length || 0
            } تاسك (${data.dispatchedNotifications || 0} إشعار اتبعت).`
          : `Cron executed: pinged ${
              data.processedTaskIds?.length || 0
            } active task(s) (${data.dispatchedNotifications || 0} push sent).`
      );
    } catch (err) {
      setPushFeedback(err instanceof Error ? err.message : (isAr ? "مقدرناش نشغّل التذكير." : "Could not run reminders."));
    } finally {
      setCronRunning(false);
    }
  };

  // Atomic Task Status Mutations (POST /api/tasks/[id]/status)
  const handleClaimOnMe = async (
    taskId: string,
    intervalMinutes: number = 120
  ) => {
    if (!requireSignedIn()) return;

    // Keep permission requests inside the student's click gesture.
    if (typeof Notification !== "undefined" && Notification.permission !== "denied") {
      void requestAndSubscribeWebPush(currentUser.id).then((result) => {
        setPlatformState(detectPlatformPushState());
        if (!result.ok) setPushFeedback(result.error || "Could not enable notifications.");
      });
    }

    setSyncStatus("syncing");
    try {
      await requestJson(`/api/tasks/${encodeURIComponent(taskId)}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "on_me",
          reminderIntervalMinutes: intervalMinutes,
        }),
      });
      await fetchServerState();
    } finally {
      setSyncStatus("synced");
    }
  };

  const handleSkipTask = async (taskId: string) => {
    if (!requireSignedIn()) return;
    setSyncStatus("syncing");
    try {
      await requestJson(`/api/tasks/${encodeURIComponent(taskId)}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "skipped" }),
      });
      await fetchServerState();
    } finally {
      setSyncStatus("synced");
    }
  };

  const handleToggleDone = async (taskId: string) => {
    if (!requireSignedIn()) return;
    const task = tasks.find((t) => t.id === taskId);
    const mySt = task?.memberStatuses.find((s) => s.userId === currentUser.id);
    const nextStatus = mySt?.status === "done" ? "on_me" : "done";

    setSyncStatus("syncing");
    try {
      await requestJson(`/api/tasks/${encodeURIComponent(taskId)}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: nextStatus,
          reminderIntervalMinutes: mySt?.reminderIntervalMinutes || 120,
        }),
      });
      await fetchServerState();
    } finally {
      setSyncStatus("synced");
    }
  };

  const handleChangeInterval = async (
    taskId: string,
    intervalMinutes: number
  ) => {
    if (!requireSignedIn()) return;
    setSyncStatus("syncing");
    try {
      await requestJson(`/api/tasks/${encodeURIComponent(taskId)}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "on_me",
          reminderIntervalMinutes: intervalMinutes,
        }),
      });
      await fetchServerState();
    } finally {
      setSyncStatus("synced");
    }
  };

  const handleEditTask = async (
    taskId: string,
    updates: {
      title: string;
      description: string;
      category: TaskCategory;
      dueAt: string;
      defaultReminderMinutes: number;
    }
  ) => {
    if (!requireSignedIn()) return;
    setSyncStatus("syncing");
    try {
      await requestJson(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      await fetchServerState();
    } finally {
      setSyncStatus("synced");
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!requireSignedIn()) return;
    setSyncStatus("syncing");
    try {
      await requestJson(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: "DELETE",
      });
      await fetchServerState();
    } finally {
      setSyncStatus("synced");
    }
  };

  // Atomic Task Creation (POST /api/upload + POST /api/tasks)
  const handleCreateTask = async (input: {
    title: string;
    description: string;
    groupId: string | null;
    category: TaskCategory;
    dueInHours: number;
    dueAt?: string;
    reminderIntervalMinutes: number;
    claimImmediately: boolean;
    file: File | null;
  }) => {
    if (!requireSignedIn()) return;
    setSyncStatus("syncing");
    try {
      let uploadedAttachment: TaskAttachment | null = null;
      if (input.file) {
        if (input.file.size > 4 * 1024 * 1024) throw new Error(isAr ? "الملف لازم يكون ٤ ميجا أو أقل." : "Files must be 4 MB or smaller.");
        const formData = new FormData();
        formData.append("file", input.file);
        const upData = await requestJson("/api/upload", {
          method: "POST",
          body: formData,
        });
        if (!upData?.attachment) throw new Error("The file was not uploaded. Please retry.");
        uploadedAttachment = upData.attachment;
      }

      await requestJson("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: input.title,
          description: input.description,
          groupId: input.groupId,
          category: input.category,
          dueInHours: input.dueInHours,
          dueAt: input.dueAt,
          reminderIntervalMinutes: input.reminderIntervalMinutes,
          claimImmediately: input.claimImmediately,
          attachment: uploadedAttachment,
        }),
      });

      await fetchServerState();

      if (input.groupId === null) {
        setActiveTab("personal");
      } else if (input.claimImmediately) {
        setActiveTab("on-me");
      } else {
        setActiveTab("groups");
      }
    } finally {
      setSyncStatus("synced");
    }
  };

  // Atomic Comment Creation (POST /api/tasks/[id]/comments)
  const handleAddComment = async (taskId: string, content: string) => {
    if (!requireSignedIn()) return;
    setSyncStatus("syncing");
    try {
      await requestJson(`/api/tasks/${encodeURIComponent(taskId)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      await fetchServerState();
    } finally {
      setSyncStatus("synced");
    }
  };

  // Direct Supabase Storage File Upload (POST /api/upload)
  const handleUploadAttachment = async (taskId: string, file: File) => {
    if (!requireSignedIn()) return;
    setSyncStatus("syncing");
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error(isAr ? "الملف لازم يكون ٤ ميجا أو أقل." : "Files must be 4 MB or smaller.");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("taskId", taskId);
      await requestJson("/api/upload", {
        method: "POST",
        body: formData,
      });
      await fetchServerState();
    } finally {
      setSyncStatus("synced");
    }
  };

  // Group Management (/api/groups)
  const handleCreateGroup = async (
    name: string,
    courseCode: string,
    customInviteCode?: string
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!requireSignedIn()) {
      return {
        ok: false,
        error: isAr
          ? "سجّل دخول بالـ PIN الأول."
          : "Sign in with your 4-digit PIN first.",
      };
    }
    setSyncStatus("syncing");
    try {
      const data = await requestJson("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CREATE",
          name,
          courseCode,
          inviteCode: customInviteCode,
        }),
      });
      if (!data.ok) {
        return {
          ok: false,
          error:
            data.error ||
            (isAr ? "مقدرناش نعمل الجروب." : "Could not create group."),
        };
      }
      if (data.group?.id) {
        setSelectedGroupId(data.group.id);
      }
      await fetchServerState();
      setActiveTab("groups");
      return { ok: true };
    } finally {
      setSyncStatus("synced");
    }
  };

  const handleJoinByCode = async (
    inviteCode: string
  ): Promise<{ ok: boolean; message: string }> => {
    if (!requireSignedIn()) {
      return {
        ok: false,
        message: isAr
          ? "سجّل دخول بالـ PIN الأول."
          : "Sign in with your 4-digit PIN first.",
      };
    }
    setSyncStatus("syncing");
    try {
      const data = await requestJson("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "JOIN",
          inviteCode,
        }),
      });
      if (!data.ok) {
        return {
          ok: false,
          message:
            data.error ||
            (isAr
              ? `مفيش جروب بالكود ده "${inviteCode}". اتأكد من الكود اللي زميلك بعتهولك.`
              : `No group found with code "${inviteCode}".`),
        };
      }
      if (data.group?.id) {
        setSelectedGroupId(data.group.id);
      }
      await fetchServerState();
      setActiveTab("groups");
      return {
        ok: true,
        message:
          data.message ||
          (isAr
            ? `دخلت جروب ${data.group?.courseCode} — ${data.group?.name}`
            : `Joined ${data.group?.courseCode} — ${data.group?.name}`),
      };
    } finally {
      setSyncStatus("synced");
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!requireSignedIn()) return;
    setSyncStatus("syncing");
    try {
      const data = await requestJson(
        `/api/groups?id=${encodeURIComponent(groupId)}`,
        {
          method: "DELETE",
        }
      );
      if (data.ok) {
        setSelectedGroupId("all");
        await fetchServerState();
      }
    } finally {
      setSyncStatus("synced");
    }
  };

  const handleQuietHoursChange = async (start: string, end: string) => {
    if (!requireSignedIn()) return;
    await requestJson("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "UPDATE_QUIET_HOURS",
        payload: { quietHoursStart: start, quietHoursEnd: end },
      }),
    });
    await fetchServerState();
  };

  // Filtered Views
  const onMeTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (t.groupId === null && t.createdBy !== currentUser.id) return false;
      const st = t.memberStatuses.find((s) => s.userId === currentUser.id);
      return st?.involvement === "on_me";
    });
  }, [tasks, currentUser.id]);

  const activeOnMeCount = useMemo(
    () =>
      onMeTasks.filter((t) => {
        const st = t.memberStatuses.find((s) => s.userId === currentUser.id);
        return st?.status !== "done";
      }).length,
    [onMeTasks, currentUser.id]
  );

  const sharedTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (t.groupId === null) return false;
      if (selectedGroupId !== "all" && t.groupId !== selectedGroupId)
        return false;
      return true;
    });
  }, [tasks, selectedGroupId]);

  const unclaimedSharedCount = useMemo(() => {
    return tasks.filter((t) => {
      if (t.groupId === null) return false;
      const st = t.memberStatuses.find((s) => s.userId === currentUser.id);
      return !st || st.involvement === "unassigned";
    }).length;
  }, [tasks, currentUser.id]);

  const personalTasks = useMemo(() => {
    if (!authenticatedUser) return [];
    return tasks.filter(
      (t) => t.groupId === null && t.createdBy === authenticatedUser.id
    );
  }, [tasks, authenticatedUser]);

  const detailTask = useMemo(
    () => tasks.find((t) => t.id === detailTaskId) || null,
    [tasks, detailTaskId]
  );

  const activeGroup = useMemo(
    () =>
      selectedGroupId !== "all"
        ? groups.find((g) => g.id === selectedGroupId) || null
        : null,
    [groups, selectedGroupId]
  );

  return (
    <LanguageContext.Provider value={{ lang, setLang, isAr }}>
      <div
        dir={isAr ? "rtl" : "ltr"}
        className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] pb-24 md:pb-12"
      >
        {/* iOS PWA Onboarding Gate & Telemetry Strip */}
        <IosPwaBanner
          platformState={platformState}
          simulateIosSafari={simulateIosSafari}
          onToggleSimulateIos={() => setSimulateIosSafari((v) => !v)}
          onEnablePushGesture={handleEnablePushGesture}
          onSendTestPush={handleSendTestPush}
          pushLoading={pushLoading}
          pushFeedback={pushFeedback}
        />

        {/* Top Architectural Header */}
        <header className="sticky top-0 z-30 bg-[var(--bg-canvas)]/90 backdrop-blur-md border-b border-[var(--border-subtle)] px-4 py-3">
          <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-3">
            {/* Brand Identity */}
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#111315] dark:bg-white text-white dark:text-[#111315] flex items-center justify-center relative">
                <BellRing className="w-4 h-4 stroke-[2.2]" aria-hidden="true" />
                <span
                  className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#EA580C] ring-2 ring-[var(--bg-canvas)]"
                  aria-hidden="true"
                />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="font-display font-extrabold text-base sm:text-lg tracking-tight">
                    UNIPULSE
                  </h1>
                  <span className="inline-flex items-center gap-1 font-mono-tabular text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--bg-subtle)] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                    <Database
                      className="w-3 h-3 text-[#0D9488]"
                      aria-hidden="true"
                    />
                    {syncStatus === "syncing"
                      ? isAr
                        ? "بيحفَظ..."
                        : "SYNCING..."
                      : schemaReady
                      ? isAr
                        ? "متصل لايف"
                        : "SUPABASE LIVE"
                      : "CONNECTED"}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] hidden sm:block">
                  {isAr
                    ? "تاسكات الدفعة والسكاشن + زنّ التذكير كل ساعتين لحد ما تخلّص"
                    : "Batch Task Ledger & 2-Hour Background Reminder Protocol"}
                </p>
              </div>
            </div>

            {/* Right Controls: Language Toggle, PIN Session Button, Theme Toggle, New Task CTA */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={toggleLang}
                title={
                  isAr ? "Switch to English" : "حوّل للعامية المصرية (عربي)"
                }
                className="min-h-[38px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-xs font-bold text-[var(--text-primary)] transition cursor-pointer"
              >
                <Languages
                  className="w-3.5 h-3.5 text-[#0D9488]"
                  aria-hidden="true"
                />
                <span>{isAr ? "EN" : "عربي"}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowProfileModal(true)}
                className="min-h-[38px] inline-flex items-center gap-2 bg-[var(--bg-surface)] hover:bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-lg px-2.5 sm:px-3 py-1 text-xs font-bold text-[var(--text-primary)] transition cursor-pointer"
              >
                {authenticatedUser ? (
                  <>
                    <span
                      className="font-mono-tabular w-5 h-5 rounded-full text-[10px] font-bold text-white flex items-center justify-center shrink-0"
                      style={{ backgroundColor: authenticatedUser.avatarColor }}
                    >
                      {authenticatedUser.displayName[0]?.toUpperCase()}
                    </span>
                    <span className="truncate max-w-[90px] sm:max-w-[140px]">
                      {authenticatedUser.displayName}
                    </span>
                    <ShieldCheck
                      className="w-3.5 h-3.5 text-[#059669]"
                      aria-hidden="true"
                    />
                  </>
                ) : (
                  <>
                    <KeyRound
                      className="w-3.5 h-3.5 text-[#EA580C]"
                      aria-hidden="true"
                    />
                    <span>{isAr ? "دخول (PIN)" : "Sign In (PIN)"}</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={toggleTheme}
                aria-label={
                  isDark
                    ? "Switch to Warm Paper Light Mode"
                    : "Switch to Carbon Dark Mode"
                }
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer"
              >
                {isDark ? (
                  <Sun className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <Moon className="w-4 h-4" aria-hidden="true" />
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (requireSignedIn()) setShowCreateTaskModal(true);
                }}
                className="min-h-[38px] inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 rounded-lg bg-[#0D9488] hover:bg-[#0F766E] text-white text-xs font-bold transition cursor-pointer active:scale-[0.98]"
              >
                <Plus className="w-4 h-4 stroke-[2.5]" aria-hidden="true" />
                <span>{isAr ? "تاسك جديد" : "New Task"}</span>
              </button>
            </div>
          </div>
        </header>

        {(connectionError || actionError) && <p role="alert" className="max-w-5xl mx-auto px-4 py-3 text-sm text-[#DC2626]">{actionError || connectionError}</p>}
        {/* Main Architectural Shell */}
        <div className="max-w-5xl mx-auto px-4 pt-5 grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6 items-start">
          {/* Desktop Navigation Rail */}
          <aside className="hidden md:flex flex-col gap-5 sticky top-20">
            <nav aria-label="Workspace navigation" className="space-y-1">
              <p className="font-mono-tabular text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] px-3 mb-2">
                {isAr ? "التقسيمة" : "WORKSPACES"}
              </p>
              <button
                type="button"
                onClick={() => setActiveTab("on-me")}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  activeTab === "on-me"
                    ? "bg-[#111315] text-white dark:bg-white dark:text-[#111315]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <UserCheck className="w-4 h-4" aria-hidden="true" />
                  {isAr ? "عليّا أنا (ورايا)" : "On Me Queue"}
                </span>
                <span
                  className={`font-mono-tabular text-[11px] px-1.5 py-0.2 rounded ${
                    activeTab === "on-me"
                      ? "bg-[#EA580C] text-white"
                      : "bg-[var(--bg-subtle)] text-[var(--text-primary)]"
                  }`}
                >
                  {activeOnMeCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("groups")}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  activeTab === "groups"
                    ? "bg-[#111315] text-white dark:bg-white dark:text-[#111315]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <FolderKanban className="w-4 h-4" aria-hidden="true" />
                  {isAr ? "جروبات المواد" : "Shared Groups"}
                </span>
                {unclaimedSharedCount > 0 && (
                  <span className="font-mono-tabular text-[11px] px-1.5 py-0.2 rounded bg-[#0D9488] text-white">
                    {unclaimedSharedCount} {isAr ? "جديد" : "new"}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("personal")}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  activeTab === "personal"
                    ? "bg-[#111315] text-white dark:bg-white dark:text-[#111315]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Lock className="w-4 h-4" aria-hidden="true" />
                  {isAr ? "خزنتي الخاصة" : "Private Vault"}
                </span>
                <span className="font-mono-tabular text-[11px] opacity-75">
                  {personalTasks.length}
                </span>
              </button>
            </nav>

            {/* Course Directory in Sidebar */}
            <div className="pt-4 border-t border-[var(--border-subtle)] space-y-2">
              <div className="flex items-center justify-between px-3">
                <span className="font-mono-tabular text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">
                  {isAr ? `موادي (${groups.length})` : `COURSES (${groups.length})`}
                </span>
                <button
                  type="button"
                  onClick={() => setShowGroupModal(true)}
                  className="font-mono-tabular text-[11px] font-bold text-[#0D9488] hover:underline cursor-pointer"
                >
                  {isAr ? "+ ادخل بكود" : "+ Join"}
                </button>
              </div>
              <div className="space-y-1">
                {groups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => {
                      setSelectedGroupId(g.id);
                      setActiveTab("groups");
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                      activeTab === "groups" && selectedGroupId === g.id
                        ? "bg-[var(--bg-subtle)] font-bold text-[var(--text-primary)] border border-[var(--border-strong)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
                    }`}
                  >
                    <span className="truncate">{g.courseCode}</span>
                    <span className="font-mono-tabular text-[10px] text-[var(--text-muted)]">
                      {g.inviteCode}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </aside>

          {/* Main Content Column */}
          <main className="space-y-5 min-w-0">
            {/* Prompt to sign in if not authenticated yet */}
            {authLoaded && !authenticatedUser && (
              <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-[var(--bg-surface)] border border-[#0D9488]/40">
                <div>
                  <span className="font-mono-tabular text-[10px] font-bold uppercase tracking-widest text-[#0D9488]">
                    {isAr
                      ? "لازم تسجّل دخول بـ ID الكلية والـ PIN"
                      : "AUTHENTICATION REQUIRED FOR PRIVATE VAULT & MUTATIONS"}
                  </span>
                  <p className="text-xs sm:text-sm font-semibold text-[var(--text-primary)] mt-0.5">
                    {isAr
                      ? "اعمل حساب بالـ ID الجامعي و٤ أرقام PIN عشان تستلم التاسكات وتفتح خزنتك الخاصة."
                      : "Create your student profile or sign in with your 4-digit PIN to claim tasks and unlock your Private Vault."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowProfileModal(true)}
                  className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#111315] text-white dark:bg-white dark:text-[#111315] text-xs font-bold cursor-pointer"
                >
                  <KeyRound
                    className="w-3.5 h-3.5 text-[#0D9488]"
                    aria-hidden="true"
                  />
                  {isAr ? "دخول / حساب جديد" : "Sign In / Sign Up"}
                </button>
              </div>
            )}

            {/* ================================================================= */}
            {/* TAB 1: "ON ME" ACTIVE QUEUE                                       */}
            {/* ================================================================= */}
            {activeTab === "on-me" && (
              <section className="space-y-4">
                {/* Architectural Bento Telemetry Strip */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="font-mono-tabular text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                        {isAr ? "تاسكات عليّا دلوقتي" : "ACTIVE ON ME"}
                      </span>
                      <span className="w-2 h-2 rounded-full bg-[#EA580C]" />
                    </div>
                    <div className="mt-2 flex items-baseline justify-between">
                      <span className="font-mono-tabular text-3xl font-extrabold tracking-tight text-[var(--text-primary)]">
                        {String(activeOnMeCount).padStart(2, "0")}
                      </span>
                      <span className="font-mono-tabular text-[11px] font-semibold text-[#EA580C]">
                        {isAr ? "تذكير كل ساعتين" : "2H PING LOOP"}
                      </span>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="font-mono-tabular text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                        {isAr ? "منبّه السيرفر (كل ساعتين)" : "SERVER CRON ENGINE"}
                      </span>
                      <BellRing
                        className="w-3.5 h-3.5 text-[#0D9488]"
                        aria-hidden="true"
                      />
                    </div>
                    <div className="mt-2">
                      <button
                        type="button"
                        disabled={cronRunning}
                        onClick={handleRunServerCron}
                        className="w-full min-h-[36px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#111315] hover:bg-[#272B30] text-white dark:bg-white dark:text-[#111315] text-xs font-bold transition cursor-pointer active:scale-[0.98] disabled:opacity-50"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${
                            cronRunning ? "animate-spin" : ""
                          }`}
                          aria-hidden="true"
                        />
                        {cronRunning
                          ? isAr
                            ? "بيرنّ..."
                            : "Pinging..."
                          : isAr
                          ? "جرّب رنّة التذكير دلوقتي"
                          : "Trigger 2h Cron Ping"}
                      </button>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex flex-col justify-between min-w-0 overflow-hidden">
                    <div className="flex items-center justify-between">
                      <span className="font-mono-tabular text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                        {isAr ? "وقت النوم (افصل الزنّ)" : "QUIET HOURS (SLEEP)"}
                      </span>
                      <Moon
                        className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0"
                        aria-hidden="true"
                      />
                    </div>
                    <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-1 min-w-0">
                      <input
                        type="time"
                        aria-label="Quiet hours start time"
                        value={currentUser.quietHoursStart}
                        onChange={(e) =>
                          handleQuietHoursChange(
                            e.target.value,
                            currentUser.quietHoursEnd
                          )
                        }
                        className="compact-time-input min-w-0 w-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-md px-1.5 py-1.5 font-mono-tabular text-[11px] font-semibold text-[var(--text-primary)] focus:outline-none focus:border-[#0D9488]"
                      />
                      <span className="font-mono-tabular text-xs text-[var(--text-muted)] px-0.5">
                        –
                      </span>
                      <input
                        type="time"
                        aria-label="Quiet hours end time"
                        value={currentUser.quietHoursEnd}
                        onChange={(e) =>
                          handleQuietHoursChange(
                            currentUser.quietHoursStart,
                            e.target.value
                          )
                        }
                        className="compact-time-input min-w-0 w-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-md px-1.5 py-1.5 font-mono-tabular text-[11px] font-semibold text-[var(--text-primary)] focus:outline-none focus:border-[#0D9488]"
                      />
                    </div>
                  </div>
                </div>

                {unclaimedSharedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("groups")}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-[#EA580C]/10 border border-[#EA580C]/30 text-start transition hover:bg-[#EA580C]/15 cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono-tabular text-xs font-bold px-2 py-0.5 rounded bg-[#EA580C] text-white">
                        {unclaimedSharedCount} {isAr ? "جديد" : "NEW"}
                      </span>
                      <span className="text-xs sm:text-sm font-semibold text-[var(--text-primary)]">
                        {isAr
                          ? "فيه تاسكات جديدة نزلت في جروبات المواد — ادخل شوف إيه اللي عليك"
                          : "Unclaimed group tasks posted by classmates — decide if they are On You"}
                      </span>
                    </div>
                    {isAr ? (
                      <ArrowLeft
                        className="w-4 h-4 text-[#EA580C] shrink-0"
                        aria-hidden="true"
                      />
                    ) : (
                      <ArrowRight
                        className="w-4 h-4 text-[#EA580C] shrink-0"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                )}

                <div className="flex items-center justify-between pt-1">
                  <h2 className="font-display text-base font-bold tracking-tight">
                    {isAr
                      ? `الحاجات اللي ورايا (${onMeTasks.length})`
                      : `Committed Tasks (${onMeTasks.length})`}
                  </h2>
                  <span className="font-mono-tabular text-[11px] text-[var(--text-muted)]">
                    {isAr ? "متزامن لايف" : "ATOMIC RELATIONAL LEDGER"}
                  </span>
                </div>

                {onMeTasks.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] p-10 text-center space-y-2.5">
                    <CheckCircle2
                      className="w-8 h-8 text-[#059669] mx-auto"
                      aria-hidden="true"
                    />
                    <h3 className="font-display font-bold text-base">
                      {isAr
                        ? "مفيش أي تاسكات متأخرة عليك دلوقتي يا بطل"
                        : "Zero active tasks on your plate"}
                    </h3>
                    <p className="text-xs text-[var(--text-secondary)] max-w-sm mx-auto">
                      {isAr ? (
                        <>
                          افتح <strong>جروبات المواد</strong> عشان تستلم شيتات الدفعة، أو ضيف تاسك لنفسك في <strong>خزنتي الخاصة</strong>.
                        </>
                      ) : (
                        <>
                          Open <strong>Shared Groups</strong> to claim batch tasks, or add a private item in your <strong>Private Vault</strong>.
                        </>
                      )}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {onMeTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        currentUser={currentUser}
                        group={groups.find((g) => g.id === task.groupId)}
                        onClaimOnMe={handleClaimOnMe}
                        onSkipTask={handleSkipTask}
                        onToggleDone={handleToggleDone}
                        onChangeInterval={handleChangeInterval}
                        onOpenDetail={(id) => setDetailTaskId(id)}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* ================================================================= */}
            {/* TAB 2: SHARED GROUPS / COURSES                                    */}
            {/* ================================================================= */}
            {activeTab === "groups" && (
              <section className="space-y-4">
                <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSelectedGroupId("all")}
                      className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition cursor-pointer ${
                        selectedGroupId === "all"
                          ? "bg-[#111315] text-white dark:bg-white dark:text-[#111315]"
                          : "bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      {isAr
                        ? `كل موادي (${groups.length})`
                        : `All Courses (${groups.length})`}
                    </button>
                    {groups.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => setSelectedGroupId(g.id)}
                        className={`min-h-[38px] px-3.5 py-1.5 rounded-lg font-mono-tabular text-xs font-bold whitespace-nowrap transition cursor-pointer ${
                          selectedGroupId === g.id
                            ? "bg-[#111315] text-white dark:bg-white dark:text-[#111315]"
                            : "bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        }`}
                      >
                        {g.courseCode}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowGroupModal(true)}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-subtle)] border border-[var(--border-strong)] text-xs font-bold text-[#0D9488] whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {isAr ? "+ اعمل جروب / ادخل بكود" : "+ Create / Join"}
                  </button>
                </div>

                {activeGroup && (
                  <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                    <div>
                      <div className="flex items-center gap-2">
                        <Users
                          className="w-4 h-4 text-[#0D9488]"
                          aria-hidden="true"
                        />
                        <h2 className="font-display text-base font-bold">
                          {activeGroup.courseCode} — {activeGroup.name}
                        </h2>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                        {isAr
                          ? "ابعت اللينك أو كود الدعوة في جروب الواتساب أو التليجرام عشان زمايلك يدخلوا في ثانية:"
                          : "Share the invite link or code in your WhatsApp/Telegram group so classmates can join in 1 tap:"}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (!navigator.clipboard) { setActionError(isAr ? "انسخ كود الدعوة يدوياً من الشاشة." : "Copy the invite code manually from the screen."); return; }
                          void navigator.clipboard.writeText(activeGroup.inviteCode).then(() => {
                            setCopiedCode(activeGroup.inviteCode);
                            setTimeout(() => setCopiedCode(null), 1500);
                          }).catch((err) => setActionError(err instanceof Error ? err.message : "Could not copy invite code."));
                        }}
                        className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-strong)] text-[var(--text-primary)] font-mono-tabular text-xs font-bold cursor-pointer active:scale-[0.98]"
                      >
                        <Copy
                          className="w-3.5 h-3.5 text-[#0D9488]"
                          aria-hidden="true"
                        />
                        {copiedCode === activeGroup.inviteCode
                          ? isAr
                            ? "اتنسخ الكود!"
                            : "COPIED CODE"
                          : isAr
                          ? `الكود: ${activeGroup.inviteCode}`
                          : `CODE: ${activeGroup.inviteCode}`}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const shareUrl = `${window.location.origin}/?join=${encodeURIComponent(
                            activeGroup.inviteCode
                          )}`;
                          if (navigator.share) {
                            navigator
                              .share({
                                title: isAr
                                  ? `ادخل جروب ${activeGroup.courseCode} على UniPulse`
                                  : `Join ${activeGroup.courseCode} on UniPulse`,
                                text: isAr
                                  ? `ادخل جروب ${activeGroup.courseCode} (${activeGroup.name}) على UniPulse عشان تتابع التاسكات والمنبّه كل ساعتين:`
                                  : `Join ${activeGroup.courseCode} (${activeGroup.name}) on UniPulse to track batch assignments & 2-hour reminders:`,
                                url: shareUrl,
                              })
                              .catch(() => {});
                          } else {
                            if (!navigator.clipboard) { setActionError(isAr ? "انسخ كود الدعوة يدوياً من الشاشة." : "Copy the invite code manually from the screen."); return; }
                            void navigator.clipboard.writeText(shareUrl).then(() => {
                              setCopiedLink(activeGroup.inviteCode);
                              setTimeout(() => setCopiedLink(null), 1800);
                            }).catch((err) => setActionError(err instanceof Error ? err.message : "Could not copy invite link."));
                          }
                        }}
                        className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0D9488] hover:bg-[#0F766E] text-white text-xs font-bold cursor-pointer active:scale-[0.98]"
                      >
                        <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
                        {copiedLink === activeGroup.inviteCode
                          ? isAr
                            ? "اتنسخ لينك الجروب!"
                            : "Invite Link Copied!"
                          : isAr
                          ? "شير لينك الجروب"
                          : "Share Invite Link"}
                      </button>

                      {authenticatedUser &&
                        activeGroup.createdBy === authenticatedUser.id && (
                          <button
                            type="button"
                            onClick={() => void handleDeleteGroup(activeGroup.id).catch((err) => setActionError(err instanceof Error ? err.message : "Could not delete group."))}
                            title="Delete this course group"
                            aria-label="Delete course group"
                            className="min-h-[38px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#DC2626]/10 hover:bg-[#DC2626]/20 border border-[#DC2626]/25 text-[#DC2626] text-xs font-bold cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            <span className="hidden sm:inline">
                              {isAr ? "مسح الجروب" : "Delete"}
                            </span>
                          </button>
                        )}
                    </div>
                  </div>
                )}

                {groups.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] p-10 text-center space-y-3">
                    <KeyRound
                      className="w-8 h-8 text-[#0D9488] mx-auto"
                      aria-hidden="true"
                    />
                    <h3 className="font-display font-bold text-base">
                      {isAr
                        ? "إنت لسه مدخلتش أي جروب مادة"
                        : "You haven't joined any course groups yet"}
                    </h3>
                    <p className="text-xs text-[var(--text-secondary)] max-w-sm mx-auto">
                      {isAr ? (
                        <>
                          جروبات المواد خاصة بأعضاء السكشن أو الدفعة بس. اكتب <strong>كود الدعوة</strong> اللي مع زمايلك أو اعمل جروب لمادتك.
                        </>
                      ) : (
                        <>
                          Course groups are private to members. Enter an <strong>Invite Code</strong> shared by a classmate or create a new course space.
                        </>
                      )}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        if (requireSignedIn()) setShowGroupModal(true);
                      }}
                      className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0D9488] hover:bg-[#0F766E] text-white text-xs font-bold cursor-pointer"
                    >
                      <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                      {isAr
                        ? "ادخل بكود الدعوة / اعمل جروب مادة"
                        : "Join with Invite Code / Create Group"}
                    </button>
                  </div>
                ) : sharedTasks.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] p-10 text-center space-y-2.5">
                    <FolderKanban
                      className="w-8 h-8 text-[var(--text-muted)] mx-auto"
                      aria-hidden="true"
                    />
                    <h3 className="font-display font-bold text-base">
                      {isAr
                        ? "مفيش تاسكات نزلت في الجروب ده لسه"
                        : "No tasks in this course group yet"}
                    </h3>
                    <p className="text-xs text-[var(--text-secondary)] max-w-sm mx-auto">
                      {isAr
                        ? "نزّل أي شيت أو كويز أو مشروع عشان الدفعة تتابعه مع بعض."
                        : "Post an assignment, quiz, or lab resource so group members can track it."}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {sharedTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        currentUser={currentUser}
                        group={groups.find((g) => g.id === task.groupId)}
                        onClaimOnMe={handleClaimOnMe}
                        onSkipTask={handleSkipTask}
                        onToggleDone={handleToggleDone}
                        onChangeInterval={handleChangeInterval}
                        onOpenDetail={(id) => setDetailTaskId(id)}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* ================================================================= */}
            {/* TAB 3: PRIVATE PERSONAL VAULT                                     */}
            {/* ================================================================= */}
            {activeTab === "personal" && (
              <section className="space-y-4">
                <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <div className="inline-flex items-center gap-1.5 font-mono-tabular text-[10px] font-bold uppercase tracking-widest text-[#0D9488] mb-1">
                        <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                        {isAr
                          ? "خزنتك الخاصة مقفولة بالـ PIN"
                          : "PIN-PROTECTED PRIVATE VAULT"}
                      </div>
                      <h2 className="font-display text-lg font-bold">
                        {authenticatedUser
                          ? isAr
                            ? `الخزنة الخاصة بتاعة ${authenticatedUser.displayName}`
                            : `${authenticatedUser.displayName}'s Private Vault`
                          : isAr
                          ? "سجّل دخول عشان تفتح خزنتك الخاصة"
                          : "Sign In to Unlock Your Private Vault"}
                      </h2>
                      <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-xl leading-relaxed">
                        {isAr ? (
                          <>
                            أي تاسك بتكتبه هنا خاص بيك إنت لوحدك ومقفول بالـ PIN بتاعك، ومستحيل يظهر لأي طالب تاني في الدفعة.
                          </>
                        ) : (
                          <>
                            Tasks created here have{" "}
                            <code className="font-mono-tabular text-[11px] px-1.5 py-0.5 rounded bg-[var(--bg-subtle)]">
                              group_id = NULL
                            </code>{" "}
                            and require your verified 4-digit PIN session cookie on the server.
                          </>
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (requireSignedIn()) setShowCreateTaskModal(true);
                      }}
                      className="min-h-[42px] inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#111315] text-white dark:bg-white dark:text-[#111315] text-xs font-bold cursor-pointer shrink-0 active:scale-[0.98]"
                    >
                      <Plus className="w-4 h-4" aria-hidden="true" />
                      {isAr ? "ضيف تاسك شخصي" : "Add Private Task"}
                    </button>
                  </div>
                </div>

                {!authenticatedUser ? (
                  <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] p-10 text-center space-y-3">
                    <Lock
                      className="w-8 h-8 text-[#EA580C] mx-auto"
                      aria-hidden="true"
                    />
                    <h3 className="font-display font-bold text-base">
                      {isAr ? "الخزنة الخاصة مقفولة" : "Private Vault Locked"}
                    </h3>
                    <p className="text-xs text-[var(--text-secondary)] max-w-sm mx-auto">
                      {isAr
                        ? "اكتب الـ PIN بتاعك المكوّن من ٤ أرقام عشان تشوف تاسكاتك الشخصية. محدش غيرك يقدر يفتحها."
                        : "Enter your 4-digit PIN to view and manage your private tasks. No other classmate can access this space without your PIN."}
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowProfileModal(true)}
                      className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0D9488] hover:bg-[#0F766E] text-white text-xs font-bold cursor-pointer"
                    >
                      <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                      {isAr ? "ادخل بالـ PIN" : "Sign In with 4-Digit PIN"}
                    </button>
                  </div>
                ) : personalTasks.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] p-10 text-center space-y-2.5">
                    <Lock
                      className="w-8 h-8 text-[var(--text-muted)] mx-auto"
                      aria-hidden="true"
                    />
                    <h3 className="font-display font-bold text-base">
                      {isAr
                        ? `مفيش تاسكات شخصية لـ ${authenticatedUser.displayName} لسه`
                        : `No private tasks for ${authenticatedUser.displayName} yet`}
                    </h3>
                    <p className="text-xs text-[var(--text-secondary)] max-w-sm mx-auto">
                      {isAr
                        ? "ضيف مشاويرك، مذاكرتك الخاصة، أو تقديم التدريبات والـ CV هنا."
                        : "Add your personal errands, study goals, or CV tasks here."}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {personalTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        currentUser={currentUser}
                        onClaimOnMe={handleClaimOnMe}
                        onSkipTask={handleSkipTask}
                        onToggleDone={handleToggleDone}
                        onChangeInterval={handleChangeInterval}
                        onOpenDetail={(id) => setDetailTaskId(id)}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </main>
        </div>

        {/* Mobile Bottom Dock (<md) with iOS Safe Area Inset Compliance */}
        <nav
          aria-label="Mobile bottom navigation"
          className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[var(--bg-surface)]/95 backdrop-blur-md border-t border-[var(--border-subtle)] px-3 pt-1.5 pb-safe"
        >
          <div className="max-w-md mx-auto grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("on-me")}
              className={`min-h-[48px] flex flex-col items-center justify-center rounded-xl transition cursor-pointer ${
                activeTab === "on-me"
                  ? "bg-[#111315] text-white dark:bg-white dark:text-[#111315] font-bold"
                  : "text-[var(--text-secondary)]"
              }`}
            >
              <div className="relative flex items-center">
                <UserCheck className="w-4 h-4" aria-hidden="true" />
                {activeOnMeCount > 0 && (
                  <span className="ms-1.5 font-mono-tabular px-1.5 py-0.2 rounded bg-[#EA580C] text-[10px] font-bold text-white">
                    {activeOnMeCount}
                  </span>
                )}
              </div>
              <span className="text-[11px] mt-0.5">
                {isAr ? "عليّا أنا" : "On Me (2h)"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("groups")}
              className={`min-h-[48px] flex flex-col items-center justify-center rounded-xl transition cursor-pointer ${
                activeTab === "groups"
                  ? "bg-[#111315] text-white dark:bg-white dark:text-[#111315] font-bold"
                  : "text-[var(--text-secondary)]"
              }`}
            >
              <div className="relative flex items-center">
                <FolderKanban className="w-4 h-4" aria-hidden="true" />
                {unclaimedSharedCount > 0 && (
                  <span className="ms-1.5 font-mono-tabular px-1.5 py-0.2 rounded bg-[#0D9488] text-[10px] font-bold text-white">
                    {unclaimedSharedCount}
                  </span>
                )}
              </div>
              <span className="text-[11px] mt-0.5">
                {isAr ? "جروبات المواد" : "Groups"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("personal")}
              className={`min-h-[48px] flex flex-col items-center justify-center rounded-xl transition cursor-pointer ${
                activeTab === "personal"
                  ? "bg-[#111315] text-white dark:bg-white dark:text-[#111315] font-bold"
                  : "text-[var(--text-secondary)]"
              }`}
            >
              <Lock className="w-4 h-4" aria-hidden="true" />
              <span className="text-[11px] mt-0.5">
                {isAr ? "خزنتي الخاصة" : "Private Vault"}
              </span>
            </button>
          </div>
        </nav>

        {/* Modals */}
        <TaskDetailModal
          key={`detail-${authenticatedUser?.id || "guest"}`}
          task={detailTask}
          group={groups.find((g) => g.id === detailTask?.groupId)}
          currentUser={currentUser}
          onClose={() => setDetailTaskId(null)}
          onAddComment={handleAddComment}
          onUploadAttachment={handleUploadAttachment}
          onClaimOnMe={handleClaimOnMe}
          onChangeInterval={handleChangeInterval}
          onToggleDone={handleToggleDone}
          onEditTask={handleEditTask}
          onDeleteTask={handleDeleteTask}
        />

        <CreateTaskModal
          key={`create-${authenticatedUser?.id || "guest"}`}
          open={showCreateTaskModal}
          onClose={() => setShowCreateTaskModal(false)}
          groups={groups}
          defaultSpaceId={
            activeTab === "personal"
              ? null
              : selectedGroupId !== "all"
              ? selectedGroupId
              : groups[0]?.id || null
          }
          onCreateTask={handleCreateTask}
        />

        <GroupModal
          key={`group-${authenticatedUser?.id || "guest"}`}
          open={showGroupModal}
          initialInviteCode={pendingInviteCode}
          onClose={() => setShowGroupModal(false)}
          onCreateGroup={handleCreateGroup}
          onJoinByCode={handleJoinByCode}
        />

        <ProfileModal
          open={showProfileModal}
          onClose={() => setShowProfileModal(false)}
          users={users}
          authenticatedUser={authenticatedUser}
          onLogin={handleLogin}
          onRegister={handleRegister}
          onLogout={handleLogout}
          onUpdateQuietHours={handleQuietHoursChange}
          onEnablePushGesture={handleEnablePushGesture}
          onSendTestPush={handleSendTestPush}
          pushLoading={pushLoading}
          pushFeedback={pushFeedback}
        />
      </div>
    </LanguageContext.Provider>
  );
}
