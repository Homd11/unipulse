"use client";

import React, { useState } from "react";
import {
  BellRing,
  Calendar,
  Lock,
  Paperclip,
  Plus,
  Users,
  X,
} from "lucide-react";
import {
  REMINDER_INTERVAL_OPTIONS,
  StudyGroup,
  TaskCategory,
} from "@/types/app";

interface CreateTaskModalProps {
  open: boolean;
  onClose: () => void;
  groups: StudyGroup[];
  defaultSpaceId: string | null;
  onCreateTask: (input: {
    title: string;
    description: string;
    groupId: string | null;
    category: TaskCategory;
    dueInHours: number;
    reminderIntervalMinutes: number;
    claimImmediately: boolean;
    file: File | null;
  }) => void;
}

export default function CreateTaskModal({
  open,
  onClose,
  groups,
  defaultSpaceId,
  onCreateTask,
}: CreateTaskModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [spaceId, setSpaceId] = useState<string>(defaultSpaceId || "personal");
  const [category, setCategory] = useState<TaskCategory>(
    defaultSpaceId === null ? "personal" : "assignment"
  );
  const [dueInHours, setDueInHours] = useState<number>(24);
  const [reminderIntervalMinutes, setReminderIntervalMinutes] =
    useState<number>(120);
  const [claimImmediately, setClaimImmediately] = useState<boolean>(true);
  const [file, setFile] = useState<File | null>(null);

  if (!open) return null;

  const isPersonal = spaceId === "personal";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onCreateTask({
      title: title.trim(),
      description: description.trim(),
      groupId: isPersonal ? null : spaceId,
      category: isPersonal ? "personal" : category,
      dueInHours,
      reminderIntervalMinutes,
      claimImmediately: isPersonal ? true : claimImmediately,
      file,
    });
    setTitle("");
    setDescription("");
    setFile(null);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-task-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-[2px] p-0 sm:p-4"
    >
      <div className="w-full max-w-lg rounded-t-2xl sm:rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-5 sm:p-6 shadow-2xl text-[var(--text-primary)] max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3.5 border-b border-[var(--border-subtle)]">
          <div>
            <span className="font-mono-tabular text-[10px] font-bold uppercase tracking-widest text-[#0D9488]">
              NEW TASK ENTRY
            </span>
            <h3 id="create-task-title" className="font-display text-lg font-bold">
              Publish to Group or Private Vault
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg bg-[var(--bg-subtle)] hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] cursor-pointer"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {/* 1. Space Selector */}
          <div>
            <label
              htmlFor="task-space-select"
              className="block font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5"
            >
              Target Workspace
            </label>
            <select
              id="task-space-select"
              value={spaceId}
              onChange={(e) => {
                setSpaceId(e.target.value);
                if (e.target.value === "personal") setCategory("personal");
                else if (category === "personal") setCategory("assignment");
              }}
              className="w-full min-h-[42px] bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2.5 text-sm font-medium text-[var(--text-primary)] focus:outline-none focus:border-[#0D9488]"
            >
              <option value="personal">
                Private Personal Vault (Strictly Invisible to Others)
              </option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  Shared Group: {g.courseCode} — {g.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-[var(--text-muted)] mt-1.5 flex items-center gap-1.5">
              {isPersonal ? (
                <>
                  <Lock className="w-3.5 h-3.5 text-[#0D9488]" aria-hidden="true" />
                  Isolated to your account via Row-Level Security.
                </>
              ) : (
                <>
                  <Users className="w-3.5 h-3.5 text-[#0D9488]" aria-hidden="true" />
                  Classmates can view files, comment, and opt in &ldquo;On Me&rdquo;.
                </>
              )}
            </p>
          </div>

          {/* 2. Title */}
          <div>
            <label
              htmlFor="task-title-input"
              className="block font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5"
            >
              Task Title *
            </label>
            <input
              id="task-title-input"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                isPersonal
                  ? "e.g., Submit summer internship application"
                  : "e.g., Assignment 3: Deadlock Detection Code"
              }
              className="w-full min-h-[42px] bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#0D9488]"
            />
          </div>

          {/* 3. Description */}
          <div>
            <label
              htmlFor="task-desc-input"
              className="block font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5"
            >
              Specifications &amp; Notes
            </label>
            <textarea
              id="task-desc-input"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Submission link, grading rubric notes, or lecture instructions..."
              className="w-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#0D9488]"
            />
          </div>

          {/* 4. Category & Deadline */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {!isPersonal && (
              <div>
                <label
                  htmlFor="task-cat-select"
                  className="block font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5"
                >
                  Category
                </label>
                <select
                  id="task-cat-select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as TaskCategory)}
                  className="w-full min-h-[42px] bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[#0D9488]"
                >
                  <option value="assignment">Assignment</option>
                  <option value="quiz">Quiz</option>
                  <option value="exam">Exam</option>
                  <option value="project">Project</option>
                </select>
              </div>
            )}

            <div className={isPersonal ? "sm:col-span-2" : ""}>
              <label
                htmlFor="task-due-select"
                className="block font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5 flex items-center gap-1"
              >
                <Calendar className="w-3.5 h-3.5 text-[#0D9488]" aria-hidden="true" />
                Due Window
              </label>
              <select
                id="task-due-select"
                value={dueInHours}
                onChange={(e) => setDueInHours(Number(e.target.value))}
                className="w-full min-h-[42px] bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[#0D9488]"
              >
                <option value={6}>Tonight (in 6 hours)</option>
                <option value={18}>Tomorrow Morning (in 18 hours)</option>
                <option value={24}>Tomorrow (in 24 hours)</option>
                <option value={48}>In 2 Days (48 hours)</option>
                <option value={72}>In 3 Days (72 hours)</option>
                <option value={168}>Next Week (7 days)</option>
              </select>
            </div>
          </div>

          {/* 5. Reminder Interval & File Attachment */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="task-interval-select"
                className="block font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5 flex items-center gap-1"
              >
                <BellRing className="w-3.5 h-3.5 text-[#EA580C]" aria-hidden="true" />
                Reminder Cadence
              </label>
              <select
                id="task-interval-select"
                value={reminderIntervalMinutes}
                onChange={(e) =>
                  setReminderIntervalMinutes(Number(e.target.value))
                }
                className="w-full min-h-[42px] bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[#0D9488]"
              >
                {REMINDER_INTERVAL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="block font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5 flex items-center gap-1">
                <Paperclip className="w-3.5 h-3.5 text-[#0D9488]" aria-hidden="true" />
                Attachment
              </span>
              <label className="min-h-[42px] flex items-center justify-center gap-2 w-full bg-[var(--bg-subtle)] hover:bg-[var(--bg-elevated)] border border-dashed border-[var(--border-strong)] rounded-xl px-3 py-2 text-xs font-semibold text-[var(--text-primary)] cursor-pointer truncate">
                <input
                  type="file"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
                <span className="truncate">
                  {file ? file.name : "+ Attach PDF / Code / Image"}
                </span>
              </label>
            </div>
          </div>

          {/* 6. Auto-Claim Checkbox */}
          {!isPersonal && (
            <label className="flex items-center gap-3 p-3.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)] cursor-pointer">
              <input
                type="checkbox"
                checked={claimImmediately}
                onChange={(e) => setClaimImmediately(e.target.checked)}
                className="w-4 h-4 accent-[#0D9488] rounded"
              />
              <div>
                <p className="text-xs font-bold text-[var(--text-primary)]">
                  Also mark this &ldquo;On Me&rdquo; immediately
                </p>
                <p className="text-[11px] text-[var(--text-secondary)]">
                  Arms your 2-hour background push loop as soon as published.
                </p>
              </div>
            </label>
          )}

          <button
            type="submit"
            className="w-full min-h-[44px] py-3 rounded-xl bg-[#0D9488] hover:bg-[#0F766E] text-white font-bold text-sm flex items-center justify-center gap-1.5 transition cursor-pointer active:scale-[0.99]"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" aria-hidden="true" />
            {isPersonal
              ? "Save to Private Vault & Arm Reminders"
              : "Publish Task to Group"}
          </button>
        </form>
      </div>
    </div>
  );
}
