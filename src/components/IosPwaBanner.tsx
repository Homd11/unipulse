"use client";

import React, { useState } from "react";
import {
  Bell,
  BellRing,
  Check,
  PlusSquare,
  Radio,
  Share,
  Smartphone,
  X,
} from "lucide-react";
import { PlatformPushState } from "@/lib/push-client";
import { useLanguage } from "@/lib/i18n";

interface IosPwaBannerProps {
  platformState: PlatformPushState;
  simulateIosSafari: boolean;
  onToggleSimulateIos: () => void;
  onEnablePushGesture: () => Promise<void>;
  onSendTestPush: () => Promise<void>;
  pushLoading: boolean;
  pushFeedback: string | null;
}

export default function IosPwaBanner({
  platformState,
  simulateIosSafari,
  onToggleSimulateIos,
  onEnablePushGesture,
  onSendTestPush,
  pushLoading,
  pushFeedback,
}: IosPwaBannerProps) {
  const { isAr } = useLanguage();
  const [showGuideModal, setShowGuideModal] = useState(false);

  const isUninstalledIos =
    (platformState.isIOS && !platformState.isStandalone) || simulateIosSafari;

  const isPushGranted = platformState.permission === "granted";

  return (
    <>
      {/* 1. Persistent iOS Safari "!window.navigator.standalone" Gate Banner */}
      {isUninstalledIos && (
        <div className="bg-[#111315] text-[#F6F5F0] border-b border-[#272B30] px-4 py-3">
          <div className="max-w-5xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#EA580C] text-white flex items-center justify-center shrink-0">
                <Smartphone className="w-4 h-4 stroke-[2]" aria-hidden="true" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono-tabular text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-[#EA580C]/20 text-[#FB923C] border border-[#EA580C]/40">
                    {isAr ? "فاتح من سفاري آيفون" : "iOS Safari Detected"}
                  </span>
                  <span className="text-xs sm:text-sm font-semibold text-white">
                    {isAr
                      ? "دوس Share وبعدين Add to Home Screen عشان يوصلك زنّ التذكير كل ساعتين ع الآيفون."
                      : "Tap Share → Add to Home Screen to receive 2-hour task reminders on iPhone."}
                  </span>
                </div>
                <p className="text-xs text-[#9CA3AF] mt-0.5 leading-relaxed">
                  {isAr ? (
                    <>
                      عشان إشعارات الآيفون تشتغل في الخلفية: دوس على{" "}
                      <span className="inline-flex items-center gap-1 font-semibold text-white">
                        <Share
                          className="w-3 h-3 inline text-[#14B8A6]"
                          aria-hidden="true"
                        />{" "}
                        Share
                      </span>{" "}
                      وبعدين اختار{" "}
                      <span className="inline-flex items-center gap-1 font-semibold text-white">
                        <PlusSquare
                          className="w-3 h-3 inline text-[#14B8A6]"
                          aria-hidden="true"
                        />{" "}
                        Add to Home Screen
                      </span>
                      .
                    </>
                  ) : (
                    <>
                      iOS 16.4+ requires Home Screen installation for background Web Push: tap{" "}
                      <span className="inline-flex items-center gap-1 font-semibold text-white">
                        <Share
                          className="w-3 h-3 inline text-[#14B8A6]"
                          aria-hidden="true"
                        />{" "}
                        Share
                      </span>{" "}
                      then{" "}
                      <span className="inline-flex items-center gap-1 font-semibold text-white">
                        <PlusSquare
                          className="w-3 h-3 inline text-[#14B8A6]"
                          aria-hidden="true"
                        />{" "}
                        Add to Home Screen
                      </span>
                      .
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowGuideModal(true)}
                className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-[#F6F5F0] hover:bg-white text-[#111315] font-semibold text-xs transition cursor-pointer active:scale-[0.98]"
              >
                {isAr ? "إزاي أثبّته؟" : "Install Guide"}
              </button>
              {simulateIosSafari && (
                <button
                  type="button"
                  onClick={onToggleSimulateIos}
                  aria-label="Close iOS Safari preview"
                  className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg bg-[#1F2328] hover:bg-[#2B3036] text-[#9CA3AF] hover:text-white transition cursor-pointer"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. Tactile Telemetry & Gesture Push Bar */}
      <div className="bg-[var(--bg-subtle)] border-b border-[var(--border-subtle)] px-4 py-2">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            {isPushGranted ? (
              <span className="inline-flex items-center gap-1.5 font-mono-tabular text-[11px] font-semibold text-[#059669] dark:text-[#10B981] bg-[#059669]/10 border border-[#059669]/25 px-2.5 py-1 rounded-md">
                <span className="w-1.5 h-1.5 rounded-full bg-[#059669] dark:bg-[#10B981]" />
                {isAr ? "سماح إشعارات المتصفح: مفعّل" : "BROWSER NOTIFICATION PERMISSION: ALLOWED"}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-mono-tabular text-[11px] font-semibold text-[#EA580C] bg-[#EA580C]/10 border border-[#EA580C]/25 px-2.5 py-1 rounded-md">
                <span className="w-1.5 h-1.5 rounded-full bg-[#EA580C] animate-ping" />
                {isAr ? "التنبيهات: مستنية تفعيلك" : "PUSH ENGINE: STANDBY"}
              </span>
            )}

            {pushFeedback && (
              <span className="text-xs text-[var(--text-secondary)] truncate max-w-[220px] sm:max-w-md">
                {pushFeedback}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!isPushGranted ? (
              <button
                type="button"
                disabled={pushLoading}
                onClick={onEnablePushGesture}
                className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#0D9488] hover:bg-[#0F766E] text-white text-xs font-semibold transition cursor-pointer active:scale-[0.98] disabled:opacity-50"
              >
                <BellRing className="w-3.5 h-3.5" aria-hidden="true" />
                {pushLoading
                  ? isAr
                    ? "بيوصّل..."
                    : "Connecting..."
                  : isAr
                  ? "شغّل تنبيه كل ساعتين"
                  : "Enable 2h Alerts"}
              </button>
            ) : (
              <button
                type="button"
                disabled={pushLoading}
                onClick={onSendTestPush}
                className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-subtle)] text-xs font-semibold transition cursor-pointer active:scale-[0.98]"
              >
                <Radio className="w-3.5 h-3.5 text-[#0D9488]" aria-hidden="true" />
                {isAr ? "جرّب إشعار" : "Test Push"}
              </button>
            )}

            {!platformState.isIOS && (
              <button
                type="button"
                onClick={onToggleSimulateIos}
                className={`min-h-[34px] px-2.5 py-1 rounded-md font-mono-tabular text-[11px] font-medium border transition cursor-pointer ${
                  simulateIosSafari
                    ? "bg-[#111315] text-white border-[#111315] dark:bg-white dark:text-[#111315]"
                    : "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {simulateIosSafari
                  ? isAr
                    ? "شرح الآيفون: شغّال"
                    : "iOS Banner: ON"
                  : isAr
                  ? "شرح الآيفون"
                  : "iOS Guide"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 3. Architectural iOS Installation Modal */}
      {showGuideModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ios-guide-title"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-[2px] p-0 sm:p-4"
        >
          <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-6 shadow-2xl text-[var(--text-primary)]">
            <div className="flex items-start justify-between pb-4 border-b border-[var(--border-subtle)]">
              <div>
                <span className="font-mono-tabular text-[10px] font-bold uppercase tracking-widest text-[#EA580C]">
                  {isAr ? "خطوات تشغيل إشعارات الآيفون" : "iOS 16.4+ Setup Protocol"}
                </span>
                <h3
                  id="ios-guide-title"
                  className="font-display font-bold text-lg mt-0.5"
                >
                  {isAr
                    ? "ضيف UniPulse على الشاشة الرئيسية"
                    : "Install UniPulse to Home Screen"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                aria-label="Close modal"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] cursor-pointer"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-3 my-5">
              <div className="flex items-start gap-3.5 p-3.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
                <span className="font-mono-tabular w-6 h-6 rounded bg-[#111315] text-white dark:bg-white dark:text-[#111315] font-bold text-xs flex items-center justify-center shrink-0">
                  01
                </span>
                <div>
                  <p className="text-sm font-semibold flex items-center gap-1.5">
                    {isAr ? "دوس على زرار Share في سفاري" : "Tap Safari Share"}{" "}
                    <Share className="w-4 h-4 text-[#0D9488]" aria-hidden="true" />
                  </p>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                    {isAr
                      ? "من الشريط اللي تحت في متصفح Safari على الآيفون، دوس على علامة المشاركة."
                      : "In the bottom Safari bar on your iPhone, tap the Share icon."}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3.5 p-3.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
                <span className="font-mono-tabular w-6 h-6 rounded bg-[#111315] text-white dark:bg-white dark:text-[#111315] font-bold text-xs flex items-center justify-center shrink-0">
                  02
                </span>
                <div>
                  <p className="text-sm font-semibold flex items-center gap-1.5">
                    {isAr
                      ? "اختار Add to Home Screen"
                      : "Select “Add to Home Screen”"}{" "}
                    <PlusSquare
                      className="w-4 h-4 text-[#0D9488]"
                      aria-hidden="true"
                    />
                  </p>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                    {isAr
                      ? "انزل تحت شوية في القايمة ودوس على إضافة للشاشة الرئيسية وبعدين Add."
                      : "Scroll down the share sheet and tap Add to Home Screen, then confirm Add."}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3.5 p-3.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
                <span className="font-mono-tabular w-6 h-6 rounded bg-[#0D9488] text-white font-bold text-xs flex items-center justify-center shrink-0">
                  03
                </span>
                <div>
                  <p className="text-sm font-semibold flex items-center gap-1.5">
                    {isAr
                      ? "افتح الأبلكيشن ودوس «عليّا أنا»"
                      : "Open App & Claim “On Me”"}{" "}
                    <Bell className="w-4 h-4 text-[#EA580C]" aria-hidden="true" />
                  </p>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                    {isAr
                      ? "افتح UniPulse من الشاشة الرئيسية ودوس «شغّل تنبيه كل ساعتين» أو استلم أي تاسك."
                      : "Open UniPulse from your Home Screen and tap Enable 2h Alerts or claim any task to start background notifications."}
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowGuideModal(false)}
              className="w-full min-h-[44px] py-2.5 rounded-xl bg-[#0D9488] hover:bg-[#0F766E] text-white font-semibold text-sm flex items-center justify-center gap-1.5 transition cursor-pointer active:scale-[0.99]"
            >
              <Check className="w-4 h-4" aria-hidden="true" />
              {isAr ? "تمام فهمت" : "Understood"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
