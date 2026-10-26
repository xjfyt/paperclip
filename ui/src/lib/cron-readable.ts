import { t, i18n, formatDate } from "../i18n";
/**
 * Tiny best-effort cron → localized display helper for the routine Triggers section.
 * Not a full cron parser: it covers the common shapes Paperclip schedule triggers
 * produce (every N minutes/hours, daily at HH:MM, weekday/weekend, day-of-week).
 * Falls back to the raw expression when it can't confidently describe it.
 */

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function describeTime(minute: string, hour: string): string | null {
  const m = Number(minute);
  const h = Number(hour);
  if (!Number.isInteger(m) || !Number.isInteger(h)) return null;
  if (m < 0 || m > 59 || h < 0 || h > 23) return null;
  return `${pad2(h)}:${pad2(m)}`;
}

function describeDayOfWeek(dow: string, time: string): string | null {
  if (dow === "*" || dow === "?") return t("routineScheduleUi.daily", { time });
  if (dow === "1-5") return t("routineScheduleUi.weekdayAt", { time });
  if (dow === "0,6" || dow === "6,0" || dow === "0,7") return t("routineScheduleUi.weekendAt", { time });
  const parts = dow.split(",").map((part) => part.trim());
  const names = parts.map((part) => {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 7) return null;
    return formatDate(new Date(Date.UTC(2026, 0, 4 + n % 7)), { weekday: "long", timeZone: "UTC" });
  });
  if (names.some((name) => name === null)) return null;
  const days = new Intl.ListFormat(i18n.language, { style: "long", type: "conjunction" }).format(names as string[]);
  return t("routineScheduleUi.weeklyAt", { days, time });
}

export function describeCron(expression: string | null | undefined): string | null {
  if (!expression) return null;
  const trimmed = expression.trim();
  const fields = trimmed.split(/\s+/);
  // Standard 5-field cron: minute hour day-of-month month day-of-week
  if (fields.length !== 5) return null;
  const [minute, hour, dom, month, dow] = fields;

  // Every N minutes
  const everyMinutes = minute.match(/^\*\/(\d+)$/);
  if (everyMinutes && hour === "*" && dom === "*" && month === "*" && dow === "*") {
    return t("routineScheduleUi.everyMinutes", { amount: everyMinutes[1] });
  }

  // Every N hours, on the minute
  const everyHours = hour.match(/^\*\/(\d+)$/);
  if (everyHours && /^\d+$/.test(minute) && dom === "*" && month === "*" && dow === "*") {
    return t("routineScheduleUi.everyHours", { amount: everyHours[1], minute: pad2(Number(minute)) });
  }

  // Hourly
  if (/^\d+$/.test(minute) && hour === "*" && dom === "*" && month === "*" && dow === "*") {
    return t("routineScheduleUi.hourly", { minute: pad2(Number(minute)) });
  }

  // Daily / weekly at a fixed time
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && month === "*") {
    const time = describeTime(minute, hour);
    if (!time) return null;
    if (dom === "*" && (dow === "*" || dow === "?")) {
      return t("routineScheduleUi.daily", { time });
    }
    if (dom === "*") {
      const dowText = describeDayOfWeek(dow, time);
      if (dowText) return dowText;
    }
    if (/^\d+$/.test(dom) && (dow === "*" || dow === "?")) {
      return t("routineScheduleUi.monthDay", { day: dom, time });
    }
  }

  return null;
}
