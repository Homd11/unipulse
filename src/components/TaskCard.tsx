"use client";

import React, { useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  BellRing,
  Check,
  Clock,
  FileText,
  Lock,
  MessageSquare,
  Paperclip,
  RotateCcw,
  X,
} from "lucide-react";
import {
  REMINDER_INTERVAL_OPTIONS,
  StudyGroup,
  TaskCategory,
  TaskItem,
  UserProfile,
} from "@/types/app";
import {
  getCategoryLabel,
  getIntervalOptionLabel,
  Language,
  useLanguage,
} from "@/lib/i18n";

interface TaskCardProps {
  task: TaskItem;
  currentUser: UserProfile;
  group?: StudyGroup;
  onClaimOnMe: (taskId: string, intervalMinutes?: number) => Promise<void>;
  onSkipTask: (taskId: string) => Promise<void>;
  onToggleDone: (taskId: string) => Promise<void>;
  onChangeInterval: (taskId: string, intervalMinutes: number) => Promise<void>;
  onOpenDetail: (taskId: string) => void;
}

const CATEGORY_CLASS: Record<TaskCategory, string> = {
  assignment:
    "bg-[#0D9488]/10 text-[#0F766E] dark:text-[#2DD4BF] border-[#0D9488]/25",
  quiz:
    "bg-[#EA580C]/10 text-[#C2410C] dark:text-[#FB923C] border-[#EA580C]/25",
  exam:
    "bg-[#DC2626]/10 text-[#B91C1C] dark:text-[#F87171] border-[#DC2626]/25",
  project:
    "bg-[#0284C7]/10 text-[#0369A1] dark:text-[#38BDF8] border-[#0284C7]/25",
  personal:
    "bg-[var(--bg-subtle)] text-[var(--text-secondary)] border-[var(--border-strong)]",
};

function formatTimeRemaining(
  isoDate: string,
  lang: Language
): {
  label: string;
  urgent: boolean;
} {
  const diffMs = new Date(isoDate).getTime() - Date.now();
  if (diffMs <= 0) {
    const overdueHrs = Math.abs(Math.round(diffMs / 3600_000));
    if (lang === "ar") {
      return {
        label: overdueHrs < 1 ? "التسليم دلوقتي!" : `متأخر من ${overdueHrs} س`,
        urgent: true,
      };
    }
    return {
      label: overdueHrs < 1 ? "DUE NOW" : `OVERDUE ${overdueHrs}H`,
      urgent: true,
    };
  }
  const totalMins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours < 24) {
    if (lang === "ar") {
      return {
        label:
          hours > 0
            ? `فاضل ${hours} س و${mins} د`
            : `فاضل ${mins} دقيقة`,
        urgent: hours < 14,
      };
    }
    return {
      label: hours > 0 ? `DUE ${hours}H ${mins}M` : `DUE ${mins}M`,
      urgent: hours < 14,
    };
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (lang === "ar") {
    return {
      label: `فاضل ${days} يوم و${remHours} س`,
      urgent: false,
    };
  }
  return {
    label: `DUE ${days}D ${remHours}H`,
    urgent: false,
  };
}

function formatNextPing(
  isoDate: string | null,
  intervalMins: number,
  lang: Language
): string {
  if (!isoDate) {
    if (lang === "ar") {
      return intervalMins >= 60
        ? `تذكير كل ${intervalMins / 60} س`
        : `تذكير كل ${intervalMins} د`;
    }
    return intervalMins >= 60
      ? `EVERY ${intervalMins / 60}H`
      : `EVERY ${intervalMins}M`;
  }
  const diffMs = new Date(isoDate).getTime() - Date.now();
  if (diffMs <= 0) return lang === "ar" ? "رنّة دلوقتي" : "PING NOW";
  const mins = Math.ceil(diffMs / 60_000);
  if (mins < 60) {
    return lang === "ar" ? `الرنّة الجاية بعد ${mins} د` : `NEXT PING ${mins}M`;
  }
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (lang === "ar") {
    return m > 0
      ? `الرنّة الجاية بعد ${h} س و${m} د`
      : `الرنّة الجاية بعد ${h} س`;
  }
  return m > 0 ? `NEXT PING ${h}H ${m}M` : `NEXT PING ${h}H`;
}

function getInitials(name: string) {
  return name
    .replace(/\(.*\)/, "")
    .trim()
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function TaskCard({
  task,
  currentUser,
  group,
  onClaimOnMe,
  onSkipTask,
  onToggleDone,
  onChangeInterval,
  onOpenDetail,
}: TaskCardProps) {
  const { lang, isAr } = useLanguage();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runAction = async (action: () => Promise<void>) => {
    if (pending) return;
    setPending(true);
    setError(null);
    try { await action(); }
    catch (err) { setError(err instanceof Error ? err.message : (isAr ? "العملية متحفظتش. جرّب تاني." : "Changes were not saved. Please retry.")); }
    finally { setPending(false); }
  };


  const myStatus = task.memberStatuses.find(
    (s) => s.userId === currentUser.id
  );
  const involvement = myStatus?.involvement || "unassigned";
  const isDoneForMe = myStatus?.status === "done";
  const isOnMe = involvement === "on_me";
  const isSkipped = involvement === "skipped";
  const intervalMins =
    myStatus?.reminderIntervalMinutes || task.defaultReminderMinutes || 120;

  const catClass =
    CATEGORY_CLASS[task.category] || CATEGORY_CLASS.assignment;
  const catLabel = getCategoryLabel(task.category, lang);
  const dueInfo = formatTimeRemaining(task.dueAt, lang);

  const workingMembers = task.memberStatuses.filter(
    (m) => m.involvement === "on_me" && m.status !== "done"
  );
  const doneMembers = task.memberStatuses.filter(
    (m) => m.involvement === "on_me" && m.status === "done"
  );

  const leftRailColor = isDoneForMe
    ? "bg-[#059669]"
    : isOnMe
    ? "bg-[#EA580C]"
    : "bg-[var(--border-strong)]";

  return (
    <article
      className={`relative overflow-hidden rounded-xl border transition-colors bg-[var(--bg-surface)] ${
        isDoneForMe
          ? "border-[var(--border-subtle)] opacity-80"
          : isOnMe
          ? "border-[var(--border-strong)] shadow-[0_2px_6px_rgba(0,0,0,0.04)]"
          : "border-[var(--border-subtle)]"
      }`}
    >
      {error && <p role="alert" className="px-4 py-2 text-xs text-[#DC2626]">{error}</p>}
      {/* Architectural Status Rail (start-0 adapts automatically to LTR / RTL) */}
      <div
        className={`absolute start-0 top-0 bottom-0 w-1.5 ${leftRailColor}`}
        aria-hidden="true"
      />

      <div className="ps-5 pe-4 py-4 sm:ps-6 sm:pe-5 sm:py-5">
        {/* Top Metadata Ledger Row */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--border-subtle)]">
          <div className="flex flex-wrap items-center gap-2">
            {/* Course / Space Tag */}
            {task.groupId === null ? (
              <span className="inline-flex items-center gap-1.5 font-mono-tabular text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[#111315] text-white dark:bg-white dark:text-[#111315]">
                <Lock className="w-3 h-3" aria-hidden="true" />
                {isAr ? "خزنتي الخاصة" : "PRIVATE VAULT"}
              </span>
            ) : (
              <span className="font-mono-tabular text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[var(--bg-subtle)] text-[var(--text-primary)] border border-[var(--border-strong)]">
                {group?.courseCode || (isAr ? "جروب المادة" : "SHARED")}
              </span>
            )}

            {/* Category Tag */}
            <span
              className={`font-mono-tabular text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${catClass}`}
            >
              {catLabel}
            </span>

            {/* Active 2-Hour Loop Telemetry */}
            {isOnMe && !isDoneForMe && (
              <span className="inline-flex items-center gap-1.5 font-mono-tabular text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[#EA580C]/12 text-[#EA580C] border border-[#EA580C]/30">
                <span className="w-1.5 h-1.5 rounded-full bg-[#EA580C] animate-pulse" />
                {formatNextPing(
                  myStatus?.nextReminderAt || null,
                  intervalMins,
                  lang
                )}
              </span>
            )}

            {isDoneForMe && (
              <span className="inline-flex items-center gap-1 font-mono-tabular text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[#059669]/12 text-[#059669] dark:text-[#10B981] border border-[#059669]/30">
                <Check className="w-3 h-3 stroke-[2.5]" aria-hidden="true" />
                {isAr ? "خلّصت خلاص (الزنّ وقف)" : "DONE (ALERTS OFF)"}
              </span>
            )}
          </div>

          {/* Tabular Deadline Badge */}
          <span
            className={`inline-flex items-center gap-1 font-mono-tabular text-[11px] font-bold px-2 py-0.5 rounded ${
              isDoneForMe
                ? "text-[var(--text-muted)] bg-[var(--bg-subtle)]"
                : dueInfo.urgent
                ? "text-[#EA580C] bg-[#EA580C]/10 border border-[#EA580C]/30"
                : "text-[var(--text-secondary)] bg-[var(--bg-subtle)]"
            }`}
          >
            {dueInfo.urgent && !isDoneForMe ? (
              <AlertCircle
                className="w-3.5 h-3.5 text-[#EA580C]"
                aria-hidden="true"
              />
            ) : (
              <Clock
                className="w-3.5 h-3.5 text-[var(--text-muted)]"
                aria-hidden="true"
              />
            )}
            {dueInfo.label}
          </span>
        </div>

        {/* Main Task Content */}
        <div
          onClick={() => onOpenDetail(task.id)}
          className="mt-3 cursor-pointer group"
        >
          <div className="flex items-start justify-between gap-3">
            <h3
              className={`font-display text-base sm:text-lg font-bold tracking-tight transition-colors ${
                isDoneForMe
                  ? "line-through text-[var(--text-muted)]"
                  : "text-[var(--text-primary)] group-hover:text-[#0D9488]"
              }`}
            >
              {task.title}
            </h3>
            <ArrowUpRight
              className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[#0D9488] shrink-0 mt-1 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              aria-hidden="true"
            />
          </div>

          {task.description && (
            <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-1.5 line-clamp-2 leading-relaxed max-w-2xl">
              {task.description}
            </p>
          )}
        </div>

        {/* Attached Files Strip */}
        {task.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3.5">
            {task.attachments.map((att) => (
              <button
                key={att.id}
                type="button"
                onClick={() => onOpenDetail(task.id)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--bg-subtle)] hover:bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-primary)] transition cursor-pointer"
              >
                <FileText
                  className="w-3.5 h-3.5 text-[#0D9488] shrink-0"
                  aria-hidden="true"
                />
                <span className="truncate max-w-[200px]">{att.fileName}</span>
              </button>
            ))}
          </div>
        )}

        {/* Social Accountability Strip (Shared Tasks) */}
        {task.groupId !== null && (
          <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-4">
              {/* Working ("On Me") Stack */}
              <div className="flex items-center gap-2">
                <div className="flex -space-x-1.5">
                  {workingMembers.length === 0 ? (
                    <span className="font-mono-tabular w-6 h-6 rounded-full bg-[var(--bg-subtle)] border border-[var(--border-strong)] flex items-center justify-center text-[10px] font-bold text-[var(--text-muted)]">
                      0
                    </span>
                  ) : (
                    workingMembers.map((m) => (
                      <span
                        key={m.userId}
                        title={`${m.userName} — ${
                          isAr ? "شغال عليه" : "On It"
                        } (${m.reminderIntervalMinutes}m)`}
                        style={{ backgroundColor: m.userColor }}
                        className="font-mono-tabular w-6 h-6 rounded-full ring-2 ring-[var(--bg-surface)] text-[10px] font-bold text-white flex items-center justify-center"
                      >
                        {getInitials(m.userName)}
                      </span>
                    ))
                  )}
                </div>
                <div className="text-xs">
                  <span className="font-mono-tabular font-bold text-[var(--text-primary)]">
                    {workingMembers.length}
                  </span>{" "}
                  <span className="text-[var(--text-secondary)]">
                    {isAr ? "شغالين عليه" : "On It"}
                  </span>
                  {workingMembers.length > 0 && (
                    <span className="text-[var(--text-muted)] hidden sm:inline">
                      {" "}
                      ·{" "}
                      {workingMembers
                        .map((m) => m.userName.split(" ")[0])
                        .join(", ")}
                    </span>
                  )}
                </div>
              </div>

              {/* Divider */}
              <span
                className="h-3.5 w-[1px] bg-[var(--border-subtle)]"
                aria-hidden="true"
              />

              {/* Completed ("Done") Stack */}
              <div className="flex items-center gap-2">
                <div className="flex -space-x-1.5">
                  {doneMembers.length === 0 ? (
                    <span className="font-mono-tabular w-6 h-6 rounded-full bg-[var(--bg-subtle)] border border-[var(--border-strong)] flex items-center justify-center text-[10px] font-bold text-[var(--text-muted)]">
                      0
                    </span>
                  ) : (
                    doneMembers.map((m) => (
                      <span
                        key={m.userId}
                        title={`${m.userName} — ${isAr ? "خلّص" : "Done"}`}
                        style={{ backgroundColor: m.userColor }}
                        className="font-mono-tabular w-6 h-6 rounded-full ring-2 ring-[#059669] text-[10px] font-bold text-white flex items-center justify-center"
                      >
                        {getInitials(m.userName)}
                      </span>
                    ))
                  )}
                </div>
                <div className="text-xs">
                  <span className="font-mono-tabular font-bold text-[#059669] dark:text-[#10B981]">
                    {doneMembers.length}
                  </span>{" "}
                  <span className="text-[var(--text-secondary)]">
                    {isAr ? "خلّصوا" : "Done"}
                  </span>
                  {doneMembers.length > 0 && (
                    <span className="text-[var(--text-muted)] hidden sm:inline">
                      {" "}
                      ·{" "}
                      {doneMembers
                        .map((m) => m.userName.split(" ")[0])
                        .join(", ")}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Thread & Attachment Button */}
            <button
              type="button"
              onClick={() => onOpenDetail(task.id)}
              className="min-h-[36px] inline-flex items-center gap-3 px-2.5 py-1 rounded-lg bg-[var(--bg-subtle)] hover:bg-[var(--bg-elevated)] text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer"
            >
              <span className="inline-flex items-center gap-1 font-mono-tabular">
                <Paperclip className="w-3.5 h-3.5" aria-hidden="true" />
                {task.attachments.length}
              </span>
              <span className="inline-flex items-center gap-1 font-mono-tabular">
                <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
                {task.comments.length}
              </span>
            </button>
          </div>
        )}

        {/* Bottom Control Deck: Opt-In ("On Me") vs Active Reminder Frequency + Mark Done */}
        <div className="mt-3.5 pt-3 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-2.5">
          {!isOnMe ? (
            <>
              <span className="text-xs font-medium text-[var(--text-secondary)]">
                {isSkipped
                  ? isAr
                    ? "شيلته من قايمتك"
                    : "Dismissed from your queue"
                  : isAr
                  ? "التاسك ده تبعك؟ شغّل التذكير كل ساعتين:"
                  : "Applies to you? Start your 2-hour loop:"}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void runAction(() => onClaimOnMe(task.id, 120))}
                  disabled={pending}
                  className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#111315] hover:bg-[#272B30] text-white dark:bg-white dark:text-[#111315] dark:hover:bg-[#E5E7EB] text-xs font-bold transition cursor-pointer active:scale-[0.98]"
                >
                  <BellRing
                    className="w-3.5 h-3.5 text-[#EA580C]"
                    aria-hidden="true"
                  />
                  {isAr ? "عليّا أنا (كل ساعتين)" : "On Me (Every 2h)"}
                </button>
                {!isSkipped && (
                  <button
                    type="button"
                    onClick={() => void runAction(() => onSkipTask(task.id))}
                    disabled={pending}
                    className="min-h-[40px] inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-[var(--bg-subtle)] hover:bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] text-xs font-semibold transition cursor-pointer active:scale-[0.98]"
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                    {isAr ? "فكك / مش تبعي" : "Skip"}
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {!isDoneForMe ? (
                  <div className="min-h-[38px] inline-flex items-center gap-1.5 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-1">
                    <BellRing
                      className="w-3.5 h-3.5 text-[#EA580C]"
                      aria-hidden="true"
                    />
                    <span className="font-mono-tabular text-[11px] font-semibold text-[var(--text-secondary)]">
                      {isAr ? "فكّرني:" : "INTERVAL:"}
                    </span>
                    <select
                      aria-label="Reminder interval"
                      value={intervalMins}
                      onChange={(e) =>
                        void runAction(() => onChangeInterval(task.id, Number(e.target.value)))
                      }
                      className="bg-transparent font-mono-tabular text-xs font-bold text-[var(--text-primary)] focus:outline-none cursor-pointer"
                    >
                      {REMINDER_INTERVAL_OPTIONS.map((opt) => (
                        <option
                          key={opt.value}
                          value={opt.value}
                          className="bg-[var(--bg-surface)] text-[var(--text-primary)]"
                        >
                          {getIntervalOptionLabel(opt.value, lang)}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <span className="font-mono-tabular text-xs font-semibold text-[#059669] dark:text-[#10B981]">
                    {isAr
                      ? "تم التسليم · التذكير وقف خلاص"
                      : "COMPLETED BY YOU · REMINDERS HALTED"}
                  </span>
                )}

                {task.groupId !== null && !isDoneForMe && (
                  <button
                    type="button"
                    onClick={() => void runAction(() => onSkipTask(task.id))}
                    disabled={pending}
                    className="min-h-[36px] px-2 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] underline cursor-pointer"
                  >
                    {isAr ? "شيله من عليّا" : "Remove from my queue"}
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                {task.groupId === null && (
                  <button
                    type="button"
                    onClick={() => onOpenDetail(task.id)}
                    className="min-h-[40px] px-3 py-2 rounded-lg bg-[var(--bg-subtle)] hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] text-xs font-semibold cursor-pointer"
                  >
                    {isAr
                      ? `الملفات (${task.attachments.length})`
                      : `Files (${task.attachments.length})`}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void runAction(() => onToggleDone(task.id))}
                  disabled={pending}
                  className={`min-h-[40px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer active:scale-[0.98] ${
                    isDoneForMe
                      ? "bg-[var(--bg-subtle)] hover:bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-strong)]"
                      : "bg-[#0D9488] hover:bg-[#0F766E] text-white"
                  }`}
                >
                  {isDoneForMe ? (
                    <>
                      <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                      {isAr ? "افتحه تاني" : "Reopen"}
                    </>
                  ) : (
                    <>
                      <Check
                        className="w-4 h-4 stroke-[2.5]"
                        aria-hidden="true"
                      />
                      {isAr ? "خلّصت خلاص" : "Mark Done"}
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
