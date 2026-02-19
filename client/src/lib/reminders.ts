export type TimezoneOption = {
  value: string;
  label: string;
};

export type ReminderItem = {
  id: string;
  title: string;
  description: string;
  timezone: string;
  datetimeLocal: string;
  triggerAtUtc: number;
  createdAt: number;
};

export const TIMEZONES: TimezoneOption[] = [
  { value: "America/New_York", label: "US Eastern (New York)" },
  { value: "America/Chicago", label: "US Central (Chicago)" },
  { value: "America/Denver", label: "US Mountain (Denver)" },
  { value: "America/Los_Angeles", label: "US Pacific (Los Angeles)" },
  { value: "Asia/Karachi", label: "Pakistan (Karachi)" },
];

export const REMINDERS_STORAGE_KEY = "taskflow_reminders_v2";
export const REMINDERS_CHANGED_EVENT = "taskflow:reminders-changed";

function parseDateTimeLocal(value: string) {
  const [datePart, timePart] = value.split("T");
  if (!datePart || !timePart) return null;

  const [yearStr, monthStr, dayStr] = datePart.split("-");
  const [hourStr, minuteStr] = timePart.split(":");

  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null;
  }

  return { year, month, day, hour, minute };
}

function getTimeZoneOffsetMs(timestamp: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(timestamp));

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - timestamp;
}

export function zonedLocalToUtc(localDateTime: string, timezone: string) {
  const parsed = parseDateTimeLocal(localDateTime);
  if (!parsed) return null;

  const naiveUtc = Date.UTC(parsed.year, parsed.month - 1, parsed.day, parsed.hour, parsed.minute, 0);
  let guess = naiveUtc;

  for (let i = 0; i < 3; i += 1) {
    const offset = getTimeZoneOffsetMs(guess, timezone);
    guess = naiveUtc - offset;
  }

  return guess;
}

function emitRemindersChanged() {
  window.dispatchEvent(new Event(REMINDERS_CHANGED_EVENT));
}

function writeReminders(reminders: ReminderItem[]) {
  localStorage.setItem(REMINDERS_STORAGE_KEY, JSON.stringify(reminders));
  emitRemindersChanged();
}

export function readReminders(): ReminderItem[] {
  const raw = localStorage.getItem(REMINDERS_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as ReminderItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.timezone === "string" &&
        typeof item.datetimeLocal === "string" &&
        Number.isFinite(item.triggerAtUtc),
      )
      .map((item) => ({
        ...item,
        title: typeof item.title === "string" && item.title.trim() ? item.title : "Reminder",
        description: typeof item.description === "string" ? item.description : "",
      }))
      .sort((a, b) => a.triggerAtUtc - b.triggerAtUtc);
  } catch {
    return [];
  }
}

export function addReminder(reminder: Omit<ReminderItem, "id" | "createdAt">) {
  const reminders = readReminders();
  const next: ReminderItem = {
    ...reminder,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };
  reminders.push(next);
  reminders.sort((a, b) => a.triggerAtUtc - b.triggerAtUtc);
  writeReminders(reminders);
  return next;
}

export function removeReminder(reminderId: string) {
  const reminders = readReminders().filter((item) => item.id !== reminderId);
  writeReminders(reminders);
}

export function removeReminders(reminderIds: string[]) {
  const idSet = new Set(reminderIds);
  const reminders = readReminders().filter((item) => !idSet.has(item.id));
  writeReminders(reminders);
}
