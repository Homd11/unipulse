"use client";

import React, { useEffect, useState } from "react";
import {
  BellRing,
  Check,
  Hash,
  KeyRound,
  Lock,
  LogOut,
  Moon,
  Send,
  ShieldCheck,
  UserPlus,
  X,
} from "lucide-react";
import { UserProfile } from "@/types/app";
import { useLanguage } from "@/lib/i18n";

interface ProfileModalProps {
  open: boolean;
  forceOpen?: boolean;
  onClose: () => void;
  users: UserProfile[];
  authenticatedUser: UserProfile | null;
  onLogin: (
    userIdOrCollegeId: string,
    pin: string,
    byCollegeId?: boolean
  ) => Promise<{ ok: boolean; error?: string }>;
  onRegister: (
    collegeId: string,
    name: string,
    pin: string,
    avatarColor: string
  ) => Promise<{ ok: boolean; error?: string }>;
  onLogout: () => Promise<void>;
  onUpdateQuietHours?: (start: string, end: string) => Promise<void>;
  onEnablePushGesture?: () => Promise<void>;
  onSendTestPush?: () => Promise<void>;
  pushLoading?: boolean;
  pushFeedback?: string | null;
}

const AVATAR_PALETTE = [
  { label: "Editorial Teal", value: "#0D9488" },
  { label: "Signal Orange", value: "#EA580C" },
  { label: "Cobalt Blue", value: "#0284C7" },
  { label: "Emerald Green", value: "#059669" },
  { label: "Crimson Red", value: "#DC2626" },
  { label: "Obsidian Ink", value: "#111315" },
];

export default function ProfileModal({
  open,
  forceOpen = false,
  onClose,
  authenticatedUser,
  onLogin,
  onRegister,
  onLogout,
  onUpdateQuietHours,
  onEnablePushGesture,
  onSendTestPush,
  pushLoading = false,
  pushFeedback = null,
}: ProfileModalProps) {
  const { isAr } = useLanguage();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [signinCollegeId, setSigninCollegeId] = useState("");
  const [pin, setPin] = useState("");

  const [newCollegeId, setNewCollegeId] = useState("");
  const [newName, setNewName] = useState("");
  const [newPin, setNewPin] = useState("");
  const [avatarColor, setAvatarColor] = useState("#0D9488");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [quietStart, setQuietStart] = useState(
    authenticatedUser?.quietHoursStart || "01:00"
  );
  const [quietEnd, setQuietEnd] = useState(
    authenticatedUser?.quietHoursEnd || "08:00"
  );
  const [quietSaved, setQuietSaved] = useState(false);

  useEffect(() => {
    if (authenticatedUser) {
      setQuietStart(authenticatedUser.quietHoursStart || "01:00");
      setQuietEnd(authenticatedUser.quietHoursEnd || "08:00");
    }
  // Unchanged server snapshots must not overwrite quiet hours being edited.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticatedUser?.id, authenticatedUser?.quietHoursStart, authenticatedUser?.quietHoursEnd]);

  if (!open && !forceOpen) return null;

  const submitSignIn = async () => {
    if (loading) return;
    setErrorMsg(null);
    const cleanCollege = signinCollegeId
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "");

    if (!cleanCollege) {
      setErrorMsg(
        isAr
          ? "اكتب الـ ID الجامعي بتاعك."
          : "Enter your College ID."
      );
      return;
    }
    if (!/^\d{4}$/.test(pin.trim())) {
      setErrorMsg(
        isAr ? "اكتب الـ PIN المكوّن من ٤ أرقام." : "Enter your 4-digit PIN."
      );
      return;
    }
    setLoading(true);
    try {
      const res = await onLogin(cleanCollege, pin.trim(), true);
      if (!res.ok) {
        setErrorMsg(
          res.error ||
            (isAr
              ? "الـ ID الجامعي أو الـ PIN غلط."
              : "Invalid College ID or 4-digit PIN.")
        );
      } else {
        setPin("");
        setSigninCollegeId("");
        onClose();
      }
    } catch (err) { setErrorMsg(err instanceof Error ? err.message : "Could not sign in. Please retry."); }
    finally { setLoading(false); }
  };

  const submitSignUp = async () => {
    if (loading) return;
    setErrorMsg(null);
    const cleanCollege = newCollegeId
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "");

    if (!cleanCollege || cleanCollege.length < 3) {
      setErrorMsg(
        isAr
          ? "اكتب الـ ID الجامعي بتاعك (٣ حروف أو أرقام على الأقل)."
          : "Enter your College / University ID (at least 3 characters)."
      );
      return;
    }
    if (!newName.trim() || newName.trim().length < 2) {
      setErrorMsg(
        isAr
          ? "اكتب اسمك (حرفين على الأقل)."
          : "Enter your name (at least 2 characters)."
      );
      return;
    }
    if (!/^\d{4}$/.test(newPin.trim())) {
      setErrorMsg(
        isAr
          ? "اختار كود سري PIN من ٤ أرقام (زي 4829)."
          : "Choose a 4-digit numeric PIN (e.g. 4829)."
      );
      return;
    }
    setLoading(true);
    try {
      const res = await onRegister(
        cleanCollege,
        newName.trim(),
        newPin.trim(),
        avatarColor
      );
      if (!res.ok) {
        setErrorMsg(res.error || (isAr ? "حصلت مشكلة في التسجيل." : "Registration failed."));
      } else {
        setNewCollegeId("");
        setNewName("");
        setNewPin("");
        onClose();
      }
    } catch (err) { setErrorMsg(err instanceof Error ? err.message : "Could not register. Please retry."); }
    finally { setLoading(false); }
  };

  const handleSaveQuietHours = async () => {
    if (!onUpdateQuietHours) return;
    try {
      await onUpdateQuietHours(quietStart, quietEnd);
      setQuietSaved(true);
      setTimeout(() => setQuietSaved(false), 1800);
    } catch (err) { setErrorMsg(err instanceof Error ? err.message : "Could not save quiet hours."); }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/65 backdrop-blur-[3px] p-0 sm:p-4"
    >
      <div className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-5 sm:p-6 shadow-2xl text-[var(--text-primary)]">
        {/* Header */}
        <div className="flex items-start justify-between pb-3.5 border-b border-[var(--border-subtle)]">
          <div>
            <span className="inline-flex items-center gap-1 font-mono-tabular text-[10px] font-bold uppercase tracking-widest text-[#0D9488]">
              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
              {isAr
                ? "حساب طالب موثّق بـ ID الجامعة + PIN"
                : "COLLEGE ID + PIN VERIFIED SESSION"}
            </span>
            <h3
              id="auth-modal-title"
              className="font-display text-lg font-bold mt-0.5"
            >
              {authenticatedUser
                ? isAr
                  ? "حسابك وإعدادات التنبيهات"
                  : "Verified Student Session & Settings"
                : isAr
                ? "ادخل لحسابك أو اعمل حساب طالب جديد"
                : "Sign In or Create Student Profile"}
            </h3>
          </div>
          {!forceOpen && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close modal"
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg bg-[var(--bg-subtle)] hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] cursor-pointer"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Active Verified Session Card + Quiet Hours + Test Push */}
        {authenticatedUser && (
          <div className="mt-4 space-y-3">
            <div className="p-4 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-strong)] flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className="font-mono-tabular w-9 h-9 rounded-full text-white text-xs font-bold flex items-center justify-center shrink-0"
                  style={{ backgroundColor: authenticatedUser.avatarColor }}
                >
                  {authenticatedUser.displayName[0]?.toUpperCase()}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-[var(--text-primary)] truncate">
                      {authenticatedUser.displayName}
                    </p>
                    {authenticatedUser.collegeId && (
                      <span className="font-mono-tabular text-[10px] font-bold px-1.5 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">
                        ID: {authenticatedUser.collegeId}
                      </span>
                    )}
                  </div>
                  <p className="font-mono-tabular text-[11px] text-[#059669] dark:text-[#10B981]">
                    {isAr
                      ? "مسجّل دخول · خزنتك الخاصة مفتوحة"
                      : "SIGNED IN · PRIVATE VAULT UNLOCKED"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (loading) return;
                  setLoading(true);
                  try { await onLogout(); }
                  catch (err) { setErrorMsg(err instanceof Error ? err.message : "Could not sign out."); }
                  finally { setLoading(false); }
                }}
                className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs font-bold text-[#DC2626] cursor-pointer shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                {isAr ? "خروج" : "Sign Out"}
              </button>
            </div>

            {/* Quiet Hours Settings */}
            <div className="p-3.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                  <Moon
                    className="w-3.5 h-3.5 text-[#0D9488]"
                    aria-hidden="true"
                  />
                  {isAr
                    ? "وقت النوم (افصل الزنّ والمنبهات)"
                    : "Personal Quiet Hours (Pause 2h Pings)"}
                </span>
                {quietSaved && (
                  <span className="font-mono-tabular text-[10px] font-bold text-[#059669]">
                    {isAr ? "اتحفظ خلاص" : "SAVED TO SUPABASE"}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  aria-label="Quiet hours start"
                  value={quietStart}
                  onChange={(e) => setQuietStart(e.target.value)}
                  className="flex-1 min-h-[38px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-1.5 font-mono-tabular text-xs font-semibold text-[var(--text-primary)]"
                />
                <span className="font-mono-tabular text-xs text-[var(--text-muted)]">
                  {isAr ? "لحد" : "to"}
                </span>
                <input
                  type="time"
                  aria-label="Quiet hours end"
                  value={quietEnd}
                  onChange={(e) => setQuietEnd(e.target.value)}
                  className="flex-1 min-h-[38px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-1.5 font-mono-tabular text-xs font-semibold text-[var(--text-primary)]"
                />
                <button
                  type="button"
                  onClick={handleSaveQuietHours}
                  className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#111315] text-white dark:bg-white dark:text-[#111315] text-xs font-bold cursor-pointer shrink-0"
                >
                  {isAr ? "حفظ" : "Save"}
                </button>
              </div>
            </div>

            {/* Instant Web Push Verification Panel */}
            <div className="p-3.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)] space-y-2.5">
              <span className="inline-flex items-center gap-1.5 font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-[#EA580C]">
                <BellRing className="w-3.5 h-3.5" aria-hidden="true" />
                {isAr
                  ? "اختبر إشعارات الموبايل والمتصفح"
                  : "Verify iPhone / Browser Web Push"}
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {onEnablePushGesture && (
                  <button
                    type="button"
                    disabled={pushLoading}
                    onClick={onEnablePushGesture}
                    className="min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] border border-[var(--border-strong)] text-xs font-bold text-[var(--text-primary)] cursor-pointer disabled:opacity-50"
                  >
                    <BellRing
                      className="w-3.5 h-3.5 text-[#0D9488]"
                      aria-hidden="true"
                    />
                    {isAr ? "شغّل تنبيه كل ساعتين" : "Enable 2h Alerts"}
                  </button>
                )}
                {onSendTestPush && (
                  <button
                    type="button"
                    disabled={pushLoading}
                    onClick={onSendTestPush}
                    className="min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#0D9488] hover:bg-[#0F766E] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" aria-hidden="true" />
                    {isAr ? "ابعت إشعار تجريبي" : "Send Test Notification"}
                  </button>
                )}
              </div>
              {pushFeedback && (
                <p className="font-mono-tabular text-[11px] text-[#0D9488] font-semibold">
                  {pushFeedback}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Mode Switcher: Returning Student Sign-In vs New Student Sign-Up */}
        <div className="grid grid-cols-2 gap-1.5 p-1 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-xl my-4">
          <button
            type="button"
            onClick={() => {
              setMode("signin");
              setErrorMsg(null);
            }}
            className={`min-h-[38px] py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
              mode === "signin"
                ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm border border-[var(--border-subtle)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {authenticatedUser
              ? isAr
                ? "بدّل لحساب تاني (PIN)"
                : "Switch Account (PIN)"
              : isAr
              ? "دخول طالب مسجّل (PIN)"
              : "Student Sign In (PIN)"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("signup");
              setErrorMsg(null);
            }}
            className={`min-h-[38px] py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
              mode === "signup"
                ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm border border-[var(--border-subtle)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {isAr ? "+ طالب جديد (حساب جديد)" : "+ New Student Sign Up"}
          </button>
        </div>

        {errorMsg && (
          <div role="alert" className="mb-4 p-3 rounded-xl bg-[#DC2626]/10 border border-[#DC2626]/30 text-xs font-semibold text-[#DC2626]">
            {errorMsg}
          </div>
        )}

        {/* NOTE: Uses <div> instead of <form> + type="tel" with autocomplete="off" so browser password managers never crash */}
        {mode === "signin" ? (
          <div className="space-y-4" role="region" aria-label="Student Sign In">
            <div>
              <label
                htmlFor="signin-college-id"
                className="block font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5 flex items-center gap-1"
              >
                <Hash
                  className="w-3.5 h-3.5 text-[#0D9488]"
                  aria-hidden="true"
                />
                {isAr
                  ? "الـ ID الجامعي (كود الطالب)"
                  : "College / University ID"}
              </label>
              <input
                id="signin-college-id"
                name="unipulse_college_id_signin"
                type="tel"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                data-1p-ignore="true"
                data-lpignore="true"
                data-form-type="other"
                value={signinCollegeId}
                onChange={(e) => setSigninCollegeId(e.target.value)}
                placeholder={isAr ? "مثال: 20220145" : "e.g., 20220145"}
                className="w-full min-h-[42px] bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 font-mono-tabular text-sm uppercase tracking-wider text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#0D9488]"
              />
            </div>


            <div>
              <label
                htmlFor="signin-pin-box"
                className="block font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5 flex items-center gap-1"
              >
                <Lock
                  className="w-3.5 h-3.5 text-[#0D9488]"
                  aria-hidden="true"
                />
                {isAr ? "الكود السري PIN (٤ أرقام) *" : "4-Digit Security PIN *"}
              </label>
              <input
                id="signin-pin-box"
                name="unipulse_pin_signin_code"
                type="tel"
                inputMode="numeric"
                maxLength={4}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                data-1p-ignore="true"
                data-lpignore="true"
                data-form-type="other"
                value={pin}
                onChange={(e) =>
                  setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && pin.length === 4) {
                    e.preventDefault();
                    submitSignIn();
                  }
                }}
                placeholder={isAr ? "٤ أرقام" : "4-digit PIN"}
                className="w-full min-h-[44px] bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 font-mono-tabular text-center text-lg tracking-[0.5em] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#0D9488]"
              />
            </div>

            <button
              type="button"
              onClick={submitSignIn}
              disabled={loading || pin.length !== 4}
              className="w-full min-h-[44px] py-3 rounded-xl bg-[#111315] hover:bg-[#272B30] text-white dark:bg-white dark:text-[#111315] disabled:opacity-40 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition cursor-pointer"
            >
              <KeyRound
                className="w-4 h-4 text-[#0D9488]"
                aria-hidden="true"
              />
              {loading
                ? isAr
                  ? "بيتأكد من الـ PIN..."
                  : "Verifying PIN..."
                : isAr
                ? "افتح حسابي وخزنتي"
                : "Verify PIN & Sign In"}
            </button>
          </div>
        ) : (
          <div className="space-y-4" role="region" aria-label="Student Sign Up">
            <div>
              <label
                htmlFor="signup-college-id-input"
                className="block font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5 flex items-center justify-between"
              >
                <span className="flex items-center gap-1">
                  <Hash
                    className="w-3.5 h-3.5 text-[#0D9488]"
                    aria-hidden="true"
                  />
                  {isAr ? "الـ ID الجامعي (كود الكلية) *" : "College / University ID *"}
                </span>
                <span className="text-[10px] text-[var(--text-muted)]">
                  {isAr ? "حساب واحد لكل طالب" : "1 ACCOUNT PER ID"}
                </span>
              </label>
              <input
                id="signup-college-id-input"
                name="unipulse_student_college_id"
                type="tel"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                data-1p-ignore="true"
                data-lpignore="true"
                data-form-type="other"
                value={newCollegeId}
                onChange={(e) => setNewCollegeId(e.target.value)}
                placeholder={isAr ? "مثال: 20220145" : "e.g., 20220145"}
                className="w-full min-h-[42px] bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 font-mono-tabular text-sm uppercase tracking-wider text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#0D9488]"
              />
            </div>

            <div>
              <label
                htmlFor="signup-display-input"
                className="block font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5"
              >
                {isAr ? "اسمك *" : "Your Name *"}
              </label>
              <input
                id="signup-display-input"
                name="unipulse_student_display_label"
                type="text"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                data-1p-ignore="true"
                data-lpignore="true"
                data-form-type="other"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={isAr ? "مثال: أحمد محمد" : "e.g., Ahmed M."}
                className="w-full min-h-[42px] bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#0D9488]"
              />
            </div>

            <div>
              <label
                htmlFor="signup-pin-box"
                className="block font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5"
              >
                {isAr ? "اختار كود سري PIN (٤ أرقام) *" : "Set Your 4-Digit PIN *"}
              </label>
              <input
                id="signup-pin-box"
                name="unipulse_pin_signup_code"
                type="tel"
                inputMode="numeric"
                maxLength={4}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                data-1p-ignore="true"
                data-lpignore="true"
                data-form-type="other"
                value={newPin}
                onChange={(e) =>
                  setNewPin(e.target.value.replace(/\D/g, "").slice(0, 4))
                }
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    newCollegeId.trim().length >= 3 &&
                    newName.trim().length >= 2 &&
                    newPin.length === 4
                  ) {
                    e.preventDefault();
                    submitSignUp();
                  }
                }}
                placeholder={
                  isAr ? "اكتب ٤ أرقام تحفظهم (مثلاً 4829)" : "Choose 4 digits (e.g. 4829)"
                }
                className="w-full min-h-[42px] bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 font-mono-tabular text-sm tracking-widest text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#0D9488]"
              />
              <p className="text-[11px] text-[var(--text-muted)] mt-1">
                {isAr
                  ? "مربوط بالـ ID الجامعي بتاعك عشان محدش يفتح خزنتك الخاصة أو يعمل أكونت باسمك."
                  : "Linked to your College ID so no one can create duplicate accounts or open your Private Vault."}
              </p>
            </div>

            <div>
              <span className="block font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">
                {isAr ? "لون البروفايل بتاعك" : "Avatar Badge Color"}
              </span>
              <div className="flex items-center gap-2">
                {AVATAR_PALETTE.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setAvatarColor(c.value)}
                    aria-label={c.label}
                    style={{ backgroundColor: c.value }}
                    className={`w-7 h-7 rounded-full flex items-center justify-center transition cursor-pointer ${
                      avatarColor === c.value
                        ? "ring-2 ring-offset-2 ring-[#0D9488] ring-offset-[var(--bg-surface)] scale-105"
                        : "opacity-75 hover:opacity-100"
                    }`}
                  >
                    {avatarColor === c.value && (
                      <Check
                        className="w-3.5 h-3.5 text-white"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={submitSignUp}
              disabled={
                loading ||
                newCollegeId.trim().length < 3 ||
                newName.trim().length < 2 ||
                newPin.length !== 4
              }
              className="w-full min-h-[44px] py-3 rounded-xl bg-[#0D9488] hover:bg-[#0F766E] disabled:opacity-40 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition cursor-pointer"
            >
              <UserPlus className="w-4 h-4" aria-hidden="true" />
              {loading
                ? isAr
                  ? "بيسجّل حسابك..."
                  : "Creating Account..."
                : isAr
                ? "سجّل الـ ID وادخل"
                : "Register College ID & Sign In"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
