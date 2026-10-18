"use client";

import React, { createContext, useContext } from "react";
import { TaskCategory } from "@/types/app";

export type Language = "en" | "ar";

export const LanguageContext = createContext<{
  lang: Language;
  setLang: (lang: Language) => void;
  isAr: boolean;
}>({
  lang: "en",
  setLang: () => {},
  isAr: false,
});

export function useLanguage() {
  return useContext(LanguageContext);
}

export function getCategoryLabel(category: TaskCategory, lang: Language): string {
  if (lang === "ar") {
    switch (category) {
      case "assignment":
        return "تاسك / شيت";
      case "quiz":
        return "كويز";
      case "exam":
        return "امتحان / ميد";
      case "project":
        return "بروجيكت";
      case "personal":
        return "شخصي";
      default:
        return "تاسك";
    }
  }
  switch (category) {
    case "assignment":
      return "ASSIGNMENT";
    case "quiz":
      return "QUIZ";
    case "exam":
      return "EXAM";
    case "project":
      return "PROJECT";
    case "personal":
      return "PERSONAL";
    default:
      return "TASK";
  }
}

export function getIntervalOptionLabel(minutes: number, lang: Language): string {
  if (lang === "ar") {
    switch (minutes) {
      case 30:
        return "كل نص ساعة";
      case 60:
        return "كل ساعة";
      case 120:
        return "كل ساعتين (افتراضي)";
      case 240:
        return "كل ٤ ساعات";
      default:
        return `كل ${minutes} د`;
    }
  }
  switch (minutes) {
    case 30:
      return "Every 30m";
    case 60:
      return "Every 1h";
    case 120:
      return "Every 2h (Default)";
    case 240:
      return "Every 4h";
    default:
      return `Every ${minutes}m`;
  }
}
