export type LocalNotification = {
  id: string;
  eventKey: string;
  title: string;
  description: string;
  createdAt: string;
  readAt: string | null;
  local: true;
};

const STORAGE_KEY = "taskflow_local_notifications_v1";
export const LOCAL_NOTIFICATIONS_CHANGED_EVENT = "taskflow:local-notifications-changed";

function emitChanged() {
  window.dispatchEvent(new Event(LOCAL_NOTIFICATIONS_CHANGED_EVENT));
}

function writeNotifications(items: LocalNotification[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  emitChanged();
}

export function readLocalNotifications(): LocalNotification[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as LocalNotification[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.eventKey === "string" &&
        typeof item.title === "string" &&
        typeof item.description === "string" &&
        typeof item.createdAt === "string",
      )
      .map((item) => ({
        ...item,
        local: true as const,
        readAt: typeof item.readAt === "string" ? item.readAt : null,
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch {
    return [];
  }
}

export function addLocalNotification(input: {
  eventKey: string;
  title: string;
  description: string;
  createdAt?: string;
}) {
  const items = readLocalNotifications();
  const exists = items.some((item) => item.eventKey === input.eventKey);
  if (exists) return;
  const next: LocalNotification = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    eventKey: input.eventKey,
    title: input.title,
    description: input.description,
    createdAt: input.createdAt || new Date().toISOString(),
    readAt: null,
    local: true,
  };
  writeNotifications([next, ...items]);
}

export function getLocalNotificationUnreadCount() {
  return readLocalNotifications().filter((item) => !item.readAt).length;
}

export function markLocalNotificationRead(id: string) {
  const items = readLocalNotifications().map((item) =>
    item.id === id ? { ...item, readAt: item.readAt || new Date().toISOString() } : item,
  );
  writeNotifications(items);
}

export function markAllLocalNotificationsRead() {
  const now = new Date().toISOString();
  const items = readLocalNotifications().map((item) =>
    item.readAt ? item : { ...item, readAt: now },
  );
  writeNotifications(items);
}

export function deleteLocalNotification(id: string) {
  const items = readLocalNotifications().filter((item) => item.id !== id);
  writeNotifications(items);
}
