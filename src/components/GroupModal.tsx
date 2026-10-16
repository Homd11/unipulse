"use client";

import React, { useEffect, useState } from "react";
import { KeyRound, Plus, X } from "lucide-react";

interface GroupModalProps {
  open: boolean;
  initialInviteCode?: string;
  onClose: () => void;
  onCreateGroup: (
    name: string,
    courseCode: string,
    customInviteCode?: string
  ) => Promise<{ ok: boolean; error?: string }>;
  onJoinByCode: (
    inviteCode: string
  ) => Promise<{ ok: boolean; message: string }>;
}

export default function GroupModal({
  open,
  initialInviteCode = "",
  onClose,
  onCreateGroup,
  onJoinByCode,
}: GroupModalProps) {
  const [mode, setMode] = useState<"create" | "join">("create");
  const [name, setName] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [customInviteCode, setCustomInviteCode] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (initialInviteCode) {
      setMode("join");
      setInviteCode(initialInviteCode.toUpperCase());
    }
  }, [initialInviteCode]);

  if (!open) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !courseCode.trim()) return;
    setLoading(true);
    setFeedback(null);
    const res = await onCreateGroup(
      name.trim(),
      courseCode.trim().toUpperCase(),
      customInviteCode.trim().toUpperCase() || undefined
    );
    setLoading(false);
    if (!res.ok) {
      setFeedback({
        ok: false,
        message: res.error || "Could not create group.",
      });
      return;
    }
    setName("");
    setCourseCode("");
    setCustomInviteCode("");
    onClose();
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode.trim()) return;
    setLoading(true);
    setFeedback(null);
    const res = await onJoinByCode(inviteCode.trim().toUpperCase());
    setLoading(false);
    setFeedback(res);
    if (res.ok) {
      setInviteCode("");
      setTimeout(() => {
        setFeedback(null);
        onClose();
      }, 650);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="group-modal-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-[2px] p-0 sm:p-4"
    >
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-5 sm:p-6 shadow-2xl text-[var(--text-primary)]">
        <div className="flex items-center justify-between pb-3.5 border-b border-[var(--border-subtle)]">
          <div>
            <span className="font-mono-tabular text-[10px] font-bold uppercase tracking-widest text-[#0D9488]">
              SHARED SPACES
            </span>
            <h3
              id="group-modal-title"
              className="font-display text-lg font-bold flex items-center gap-2"
            >
              Create or Join Course Group
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

        <div className="grid grid-cols-2 gap-1.5 p-1 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-xl my-4">
          <button
            type="button"
            onClick={() => {
              setMode("create");
              setFeedback(null);
            }}
            className={`min-h-[38px] py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
              mode === "create"
                ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm border border-[var(--border-subtle)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            Create Course
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("join");
              setFeedback(null);
            }}
            className={`min-h-[38px] py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
              mode === "join"
                ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm border border-[var(--border-subtle)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            Join by Code
          </button>
        </div>

        {feedback && (
          <p
            className={`mb-4 text-xs rounded-xl p-2.5 font-semibold border ${
              feedback.ok
                ? "text-[#0D9488] bg-[#0D9488]/10 border-[#0D9488]/30"
                : "text-[#DC2626] bg-[#DC2626]/10 border-[#DC2626]/30"
            }`}
          >
            {feedback.message}
          </p>
        )}

        {mode === "create" ? (
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label
                htmlFor="course-code-input"
                className="block font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5"
              >
                Course Code *
              </label>
              <input
                id="course-code-input"
                type="text"
                required
                maxLength={12}
                value={courseCode}
                onChange={(e) => setCourseCode(e.target.value)}
                placeholder="e.g., CS-305 or AI-LAB"
                className="w-full min-h-[42px] bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2.5 font-mono-tabular text-sm uppercase text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#0D9488]"
              />
            </div>

            <div>
              <label
                htmlFor="course-name-input"
                className="block font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5"
              >
                Group Title *
              </label>
              <input
                id="course-name-input"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Artificial Intelligence — Section 2"
                className="w-full min-h-[42px] bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#0D9488]"
              />
            </div>

            <div>
              <label
                htmlFor="custom-invite-input"
                className="block font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5 flex items-center justify-between"
              >
                <span>Custom Invite Code (Optional)</span>
                <span className="text-[10px] text-[var(--text-muted)]">
                  AUTO-GENERATED IF BLANK
                </span>
              </label>
              <input
                id="custom-invite-input"
                type="text"
                maxLength={10}
                value={customInviteCode}
                onChange={(e) =>
                  setCustomInviteCode(
                    e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "")
                  )
                }
                placeholder="e.g., AI2026"
                className="w-full min-h-[42px] bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2.5 font-mono-tabular text-sm uppercase tracking-wider text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#0D9488]"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[44px] py-3 rounded-xl bg-[#0D9488] hover:bg-[#0F766E] disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.99]"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              {loading ? "Creating Space..." : "Create Shared Space"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <label
                htmlFor="invite-code-input"
                className="block font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5"
              >
                Course Invite Code
              </label>
              <input
                id="invite-code-input"
                type="text"
                required
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="OS2026, SE401X, or BATCH26"
                className="w-full min-h-[42px] bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2.5 font-mono-tabular text-sm uppercase tracking-widest text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#0D9488]"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[44px] py-3 rounded-xl bg-[#111315] text-white dark:bg-white dark:text-[#111315] disabled:opacity-50 font-bold text-sm flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.99]"
            >
              <KeyRound className="w-4 h-4" aria-hidden="true" />
              {loading ? "Joining..." : "Join Course Group"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
