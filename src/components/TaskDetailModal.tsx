"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  BellRing,
  Check,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Lock,
  MessageSquare,
  Paperclip,
  Pencil,
  Send,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import {
  StudyGroup,
  TaskCategory,
  TaskItem,
  UserProfile,
} from "@/types/app";
import { useLanguage } from "@/lib/i18n";

interface TaskDetailModalProps {
  task: TaskItem | null;
  group?: StudyGroup;
  currentUser: UserProfile;
  onClose: () => void;
  onAddComment: (taskId: string, content: string) => Promise<void>;
  onUploadAttachment: (taskId: string, file: File) => Promise<void>;
  onClaimOnMe: (taskId: string, intervalMinutes?: number) => Promise<void>;
  onChangeInterval?: (taskId: string, intervalMinutes: number) => Promise<void>;
  onToggleDone: (taskId: string) => Promise<void>;
  onEditTask?: (
    taskId: string,
    updates: {
      title: string;
      description: string;
      category: TaskCategory;
      dueAt: string;
      defaultReminderMinutes: number;
    }
  ) => Promise<void>;
  onDeleteTask?: (taskId: string) => Promise<void>;
}

const INTERVAL_OPTIONS = [
  { labelEn: "30m", labelAr: "٣٠ د", value: 30 },
  { labelEn: "1h", labelAr: "١ س", value: 60 },
  { labelEn: "2h", labelAr: "٢ س", value: 120 },
  { labelEn: "4h", labelAr: "٤ س", value: 240 },
];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toLocalDatetimeInputValue(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const offsetMs = d.getTimezoneOffset() * 60_000;
    return new Date(d.getTime() - offsetMs).toISOString().slice(0, 16);
  } catch {
    return "";
  }
}

export default function TaskDetailModal({
  task,
  group,
  currentUser,
  onClose,
  onAddComment,
  onUploadAttachment,
  onClaimOnMe,
  onChangeInterval,
  onToggleDone,
  onEditTask,
  onDeleteTask,
}: TaskDetailModalProps) {
  const { isAr } = useLanguage();
  const [commentText, setCommentText] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editCategory, setEditCategory] = useState<TaskCategory>("assignment");
  const [editDueLocal, setEditDueLocal] = useState("");
  const [editDefaultInterval, setEditDefaultInterval] = useState<number>(120);
  const [savingEdit, setSavingEdit] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taskId = task?.id;

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (task) {
      setIsEditing(false);
      setEditTitle(task.title);
      setEditDesc(task.description);
      setEditCategory(task.category);
      setEditDueLocal(toLocalDatetimeInputValue(task.dueAt));
      setEditDefaultInterval(task.defaultReminderMinutes || 120);
    }
    setCommentText("");
    setError(null);
  // Refreshing the same task must preserve unsaved fields.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  if (!task) return null;

  const canManageTask =
    task.createdBy === currentUser.id;

  const myStatus = task.memberStatuses.find(
    (s) => s.userId === currentUser.id
  );
  const isOnMe = myStatus?.involvement === "on_me";
  const isDoneForMe = myStatus?.status === "done";
  const myInterval =
    myStatus?.reminderIntervalMinutes || task.defaultReminderMinutes || 120;

  const workingList = task.memberStatuses.filter(
    (m) => m.involvement === "on_me" && m.status !== "done"
  );
  const doneList = task.memberStatuses.filter(
    (m) => m.involvement === "on_me" && m.status === "done"
  );

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onEditTask || !editTitle.trim() || savingEdit) return;
    setSavingEdit(true);
    setError(null);
    try {
      await onEditTask(task.id, {
        title: editTitle.trim(),
        description: editDesc.trim(),
        category: editCategory,
        dueAt: editDueLocal
          ? new Date(editDueLocal).toISOString()
          : task.dueAt,
        defaultReminderMinutes: editDefaultInterval,
      });
      setIsEditing(false);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save task."); }
    finally { setSavingEdit(false); }
  };

  const runAction = async (action: () => Promise<void>) => {
    if (actionPending) return;
    setActionPending(true);
    setError(null);
    try { await action(); }
    catch (err) { setError(err instanceof Error ? err.message : (isAr ? "العملية متحفظتش. جرّب تاني." : "Changes were not saved. Please retry.")); }
    finally { setActionPending(false); }
  };

  const handleCommentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    void runAction(async () => {
      await onAddComment(task.id, commentText.trim());
      setCommentText("");
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void runAction(async () => {
        if (file.size > 4 * 1024 * 1024) throw new Error(isAr ? "الملف لازم يكون ٤ ميجا أو أقل." : "Files must be 4 MB or smaller.");
        await onUploadAttachment(task.id, file);
      });
      e.target.value = "";
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-detail-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-[2px] p-0 sm:p-4"
    >
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl text-[var(--text-primary)] overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              {task.groupId === null ? (
                <span className="inline-flex items-center gap-1 font-mono-tabular text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[#111315] text-white dark:bg-white dark:text-[#111315]">
                  <Lock className="w-3 h-3" aria-hidden="true" />
                  {isAr ? "خزنتي الخاصة" : "PRIVATE VAULT"}
                </span>
              ) : (
                <span className="font-mono-tabular text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[var(--bg-subtle)] text-[var(--text-primary)] border border-[var(--border-strong)]">
                  {group?.courseCode} · {group?.name}
                </span>
              )}
              <span className="font-mono-tabular text-xs text-[var(--text-muted)]">
                {isAr
                  ? `نزّله: ${task.creatorName}`
                  : `BY ${task.creatorName.toUpperCase()}`}
              </span>
            </div>
            <h2
              id="task-detail-title"
              className="font-display text-lg sm:text-xl font-bold leading-snug"
            >
              {task.title}
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {canManageTask && onEditTask && (
              <button
                type="button"
                onClick={() => setIsEditing((v) => !v)}
                aria-label="Edit task"
                title="Edit task deadline or details"
                className={`min-h-[40px] px-3 flex items-center justify-center gap-1.5 rounded-lg border text-xs font-bold cursor-pointer transition ${
                  isEditing
                    ? "bg-[#111315] text-white dark:bg-white dark:text-[#111315] border-transparent"
                    : "bg-[var(--bg-subtle)] hover:bg-[var(--bg-elevated)] text-[var(--text-primary)] border-[var(--border-subtle)]"
                }`}
              >
                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {isEditing
                    ? isAr
                      ? "إلغاء"
                      : "Cancel"
                    : isAr
                    ? "تعديل"
                    : "Edit"}
                </span>
              </button>
            )}
            {canManageTask && onDeleteTask && (
              <button
                type="button"
                onClick={() => {
                  void runAction(async () => { await onDeleteTask(task.id); onClose(); });
                }}
                aria-label="Delete task"
                title="Delete task"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg bg-[#DC2626]/10 hover:bg-[#DC2626]/20 text-[#DC2626] border border-[#DC2626]/25 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close task details"
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg bg-[var(--bg-subtle)] hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] cursor-pointer"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Inline Task Edit Form (Creator / Admin) */}
          {isEditing && (
            <form
              onSubmit={handleSaveEdit}
              className="p-4 rounded-xl bg-[var(--bg-subtle)] border border-[#0D9488]/40 space-y-3.5"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-[#0D9488]">
                  {isAr ? "تعديل التاسك وميعاد التسليم" : "EDIT TASK & DEADLINE"}
                </span>
                <span className="font-mono-tabular text-[10px] text-[var(--text-muted)]">
                  {isAr
                    ? "التعديل بيسمّع عند الدفعة فوراً"
                    : "CHANGES SYNC LIVE TO BATCH"}
                </span>
              </div>

              <div>
                <label className="block font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                  {isAr ? "العنوان *" : "Title *"}
                </label>
                <input
                  type="text"
                  required
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full min-h-[40px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[#0D9488]"
                />
              </div>

              <div>
                <label className="block font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                  {isAr ? "التفاصيل / التعليمات" : "Description / Instructions"}
                </label>
                <textarea
                  rows={3}
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[#0D9488] resize-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                    {isAr ? "النوع" : "Category"}
                  </label>
                  <select
                    value={editCategory}
                    onChange={(e) =>
                      setEditCategory(e.target.value as TaskCategory)
                    }
                    className="w-full min-h-[40px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-xs font-bold text-[var(--text-primary)]"
                  >
                    <option value="assignment">
                      {isAr ? "تاسك / شيت" : "Assignment"}
                    </option>
                    <option value="quiz">{isAr ? "كويز" : "Quiz"}</option>
                    <option value="project">
                      {isAr ? "بروجيكت" : "Project"}
                    </option>
                    <option value="exam">
                      {isAr ? "امتحان / ميد" : "Exam"}
                    </option>
                    <option value="personal">
                      {isAr ? "شخصي" : "Personal"}
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                    {isAr ? "ميعاد التسليم (الديدلاين)" : "Deadline (Due At)"}
                  </label>
                  <input
                    type="datetime-local"
                    value={editDueLocal}
                    onChange={(e) => setEditDueLocal(e.target.value)}
                    className="w-full min-h-[40px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-2 font-mono-tabular text-xs text-[var(--text-primary)]"
                  />
                </div>

                <div>
                  <label className="block font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                    {isAr ? "تكرار التذكير الافتراضي" : "Default Ping Interval"}
                  </label>
                  <select
                    value={editDefaultInterval}
                    onChange={(e) =>
                      setEditDefaultInterval(Number(e.target.value))
                    }
                    className="w-full min-h-[40px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 font-mono-tabular text-xs font-bold text-[var(--text-primary)]"
                  >
                    <option value={30}>
                      {isAr ? "كل نص ساعة" : "Every 30 mins"}
                    </option>
                    <option value={60}>
                      {isAr ? "كل ساعة" : "Every 1 hour"}
                    </option>
                    <option value={120}>
                      {isAr ? "كل ساعتين" : "Every 2 hours"}
                    </option>
                    <option value={240}>
                      {isAr ? "كل ٤ ساعات" : "Every 4 hours"}
                    </option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-bold text-[var(--text-secondary)] cursor-pointer"
                >
                  {isAr ? "إلغاء" : "Cancel"}
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="min-h-[38px] px-4 py-1.5 rounded-lg bg-[#0D9488] hover:bg-[#0F766E] text-white text-xs font-bold cursor-pointer"
                >
                  {savingEdit
                    ? isAr
                      ? "بيحفظ..."
                      : "Saving..."
                    : isAr
                    ? "حفظ التعديلات"
                    : "Save Task Changes"}
                </button>
              </div>
            </form>
          )}

          {/* Description */}
          {!isEditing && task.description && (
            <div className="p-4 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap">
              {task.description}
            </div>
          )}

          {/* Personal Loop Status & Custom Reminder Interval Box */}
          <div className="p-4 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-strong)] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-[#EA580C]">
                  {isAr ? "نظام الزنّ والتذكير كل ساعتين" : "2-HOUR REMINDER PROTOCOL"}
                </p>
                <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-0.5">
                  {!isOnMe
                    ? isAr
                      ? "مش مستلمه لسه. دوس «عليّا أنا» عشان يبعتلك تنبيهات لحد ما تخلّصه."
                      : "Unclaimed. Opt in to receive background push pings until finished."
                    : isDoneForMe
                    ? isAr
                      ? "خلّصته خلاص! التذكير وقف."
                      : "Completed by you. Your background reminders are halted."
                    : isAr
                    ? `شغّال — بيفكّرك كل ${myInterval} دقيقة لحد ما تدوس خلّصت خلاص.`
                    : `Armed — pinging you every ${myInterval} minutes until marked Done.`}
                </p>
              </div>
              <div>
                {!isOnMe ? (
                  <button
                    type="button"
                    onClick={() =>
                      void runAction(() => onClaimOnMe(task.id, task.defaultReminderMinutes || 120))
                    }
                    className="min-h-[40px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#111315] text-white dark:bg-white dark:text-[#111315] text-xs font-bold cursor-pointer active:scale-[0.98]"
                  >
                    <BellRing
                      className="w-3.5 h-3.5 text-[#EA580C]"
                      aria-hidden="true"
                    />
                    {isAr ? "عليّا أنا" : "Claim “On Me”"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void runAction(() => onToggleDone(task.id))}
                    disabled={actionPending}
                    className={`min-h-[40px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer active:scale-[0.98] ${
                      isDoneForMe
                        ? "bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)]"
                        : "bg-[#0D9488] hover:bg-[#0F766E] text-white"
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                    {isDoneForMe
                      ? isAr
                        ? "خلّصت (افتحه تاني)"
                        : "Done (Reopen)"
                      : isAr
                      ? "خلّصت خلاص"
                      : "Mark Done"}
                  </button>
                )}
              </div>
            </div>

            {/* Per-Task Custom Reminder Interval Selector */}
            {isOnMe && !isDoneForMe && onChangeInterval && (
              <div className="pt-3 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                  <Clock className="w-3.5 h-3.5 text-[#0D9488]" aria-hidden="true" />
                  {isAr
                    ? "فكّرني بالتاسك ده كل:"
                    : "MY PING FREQUENCY FOR THIS TASK:"}
                </span>
                <div className="flex items-center gap-1.5">
                  {INTERVAL_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => void runAction(() => onChangeInterval(task.id, opt.value))}
                      disabled={actionPending}
                      className={`min-h-[32px] px-2.5 py-1 rounded-md font-mono-tabular text-xs font-bold transition cursor-pointer ${
                        myInterval === opt.value
                          ? "bg-[#111315] text-white dark:bg-white dark:text-[#111315]"
                          : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      {isAr ? opt.labelAr : opt.labelEn}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Group Accountability Roster */}
          {task.groupId !== null && (
            <div className="space-y-2.5">
              <h4 className="font-mono-tabular text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
                <Users className="w-4 h-4 text-[#0D9488]" aria-hidden="true" />
                {isAr
                  ? `مين من الدفعة شغال عليه (${workingList.length} شغالين · ${doneList.length} خلّصوا)`
                  : `SOCIAL ACCOUNTABILITY (${workingList.length} ON IT · ${doneList.length} DONE)`}
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
                  <div className="flex items-center gap-1.5 font-mono-tabular text-xs font-bold text-[#EA580C] mb-2.5">
                    <span className="w-2 h-2 rounded-full bg-[#EA580C]" />
                    {isAr
                      ? `شغالين عليه دلوقتي (${workingList.length})`
                      : `WORKING ON IT (${workingList.length})`}
                  </div>
                  {workingList.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)]">
                      {isAr
                        ? "محدش شغال عليه دلوقتي."
                        : "No active members on this task right now."}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {workingList.map((m) => (
                        <span
                          key={m.userId}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-primary)]"
                        >
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: m.userColor }}
                          />
                          {m.userName}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-3.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
                  <div className="flex items-center gap-1.5 font-mono-tabular text-xs font-bold text-[#059669] dark:text-[#10B981] mb-2.5">
                    <Check
                      className="w-3.5 h-3.5 stroke-[2.5]"
                      aria-hidden="true"
                    />
                    {isAr
                      ? `خلّصوا خلاص (${doneList.length})`
                      : `COMPLETED (${doneList.length})`}
                  </div>
                  {doneList.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)]">
                      {isAr
                        ? "محدش خلّصه لسه."
                        : "Nobody has completed this yet."}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {doneList.map((m) => (
                        <span
                          key={m.userId}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#059669]/10 border border-[#059669]/25 text-xs font-medium text-[#059669] dark:text-[#10B981]"
                        >
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: m.userColor }}
                          />
                          {m.userName}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* File Attachments Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-mono-tabular text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
                <Paperclip
                  className="w-4 h-4 text-[#0D9488]"
                  aria-hidden="true"
                />
                {isAr
                  ? `الملفات والشيتات (${task.attachments.length})`
                  : `FILES & RESOURCES (${task.attachments.length})`}
              </h4>
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-subtle)] hover:bg-[var(--bg-elevated)] border border-[var(--border-strong)] text-xs font-semibold text-[var(--text-primary)] cursor-pointer active:scale-[0.98]"
              >
                <Upload
                  className="w-3.5 h-3.5 text-[#0D9488]"
                  aria-hidden="true"
                />
                {isAr ? "ارفع ملف" : "Attach File"}
              </button>
            </div>

            {task.attachments.length === 0 ? (
              <div className="p-4 rounded-xl border border-dashed border-[var(--border-strong)] text-center text-xs text-[var(--text-muted)]">
                {isAr
                  ? "مفيش ملفات مرفوعة لسه. ارفع الـ PDF أو السلايدز أو الكود هنا."
                  : "No files attached yet. Upload PDF specs, slides, or starter code."}
              </div>
            ) : (
              <div className="space-y-2">
                {task.attachments.map((att) => (
                  <div
                    key={att.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)]"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[#0D9488] flex items-center justify-center shrink-0">
                        <FileText className="w-4 h-4" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[var(--text-primary)] truncate">
                          {att.fileName}
                        </p>
                        <p className="font-mono-tabular text-[11px] text-[var(--text-muted)]">
                          {formatFileSize(att.fileSize)} · {att.uploaderName}
                        </p>
                      </div>
                    </div>
                    <a
                      href={att.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      download={att.fileName}
                      className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-primary)] shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" aria-hidden="true" />
                      {isAr ? "تحميل" : "Download"}
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Comments Thread */}
          <div className="space-y-3">
            <h4 className="font-mono-tabular text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
              <MessageSquare
                className="w-4 h-4 text-[#0D9488]"
                aria-hidden="true"
              />
              {isAr
                ? `نقاش وكومنتات التاسك (${task.comments.length})`
                : `DISCUSSION THREAD (${task.comments.length})`}
            </h4>

            {task.comments.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">
                {isAr
                  ? "مفيش كومنتات لسه. اكتب أي توضيح أو لينك هنا عشان ميتوهش في شات الواتساب."
                  : "No comments yet. Clarify instructions or share hints here so they don't get lost in chat."}
              </p>
            ) : (
              <div className="space-y-2.5">
                {task.comments.map((com) => (
                  <div
                    key={com.id}
                    className="p-3.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)]"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span
                          className="font-mono-tabular w-5 h-5 rounded-full text-[10px] font-bold text-white flex items-center justify-center"
                          style={{ backgroundColor: com.userColor }}
                        >
                          {com.userName[0]}
                        </span>
                        <span className="text-xs font-bold text-[var(--text-primary)]">
                          {com.userName}
                        </span>
                      </div>
                      <span className="font-mono-tabular text-[11px] text-[var(--text-muted)]">
                        {new Date(com.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="text-xs sm:text-sm text-[var(--text-secondary)] ps-7 leading-relaxed">
                      {com.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {error && <p role="alert" className="px-4 py-2 text-xs text-[#DC2626]">{error}</p>}
        {/* Comment Input */}
        <form
          onSubmit={handleCommentSubmit}
          className="p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center gap-2 pb-safe"
        >
          <input
            type="text"
            value={commentText}
            disabled={actionPending}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder={
              isAr
                ? "اكتب كومنت، سؤال، أو لينك مهم..."
                : "Add a comment, clarification, or link..."
            }
            className="flex-1 min-h-[42px] bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#0D9488]"
          />
          <button
            type="submit"
            disabled={!commentText.trim() || actionPending}
            aria-label="Send comment"
            className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl bg-[#0D9488] hover:bg-[#0F766E] disabled:opacity-40 text-white transition cursor-pointer"
          >
            <Send className="w-4 h-4" aria-hidden="true" />
          </button>
        </form>
      </div>
    </div>
  );
}
