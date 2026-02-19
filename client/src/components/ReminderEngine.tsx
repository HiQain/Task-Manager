import { useEffect, useRef, useState } from "react";
import { BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  REMINDERS_CHANGED_EVENT,
  ReminderItem,
  readReminders,
  removeReminders,
} from "@/lib/reminders";
import { addLocalNotification } from "@/lib/local-notifications";

const PRE_REMINDER_MS = 5 * 60 * 1000;
const REMINDER_BROWSER_PROMPT_KEY = "taskflow_reminder_browser_prompt_v1";

function formatReminder(reminder: ReminderItem) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: reminder.timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(reminder.triggerAtUtc));
}

function buildReminderBody(reminder: ReminderItem) {
  const at = `${formatReminder(reminder)} (${reminder.timezone})`;
  return reminder.description ? `${reminder.description} | ${at}` : at;
}

export function ReminderEngine() {
  const { toast } = useToast();
  const [dueReminders, setDueReminders] = useState<ReminderItem[]>([]);
  const ringIntervalRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const lastDueKeyRef = useRef<string>("");
  const preNotifiedRef = useRef<Set<string>>(new Set());
  const dueNotifiedRef = useRef<Set<string>>(new Set());

  const showBrowserNotification = (title: string, body: string, tag: string) => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    const notification = new Notification(title, { body, tag });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  };

  const playBeep = () => {
    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;

    if (!audioCtxRef.current) {
      audioCtxRef.current = new Ctx();
    }

    const ctx = audioCtxRef.current;
    void ctx.resume();
    const now = ctx.currentTime;

    for (let i = 0; i < 2; i += 1) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 1000;
      gain.gain.setValueAtTime(0.0001, now + i * 0.28);
      gain.gain.exponentialRampToValueAtTime(0.35, now + i * 0.28 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.28 + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.28);
      osc.stop(now + i * 0.28 + 0.22);
    }
  };

  const startRing = () => {
    if (ringIntervalRef.current !== null) return;
    playBeep();
    ringIntervalRef.current = window.setInterval(() => {
      playBeep();
    }, 1100);
  };

  const stopRing = () => {
    if (ringIntervalRef.current !== null) {
      window.clearInterval(ringIntervalRef.current);
      ringIntervalRef.current = null;
    }
  };

  const refreshDueReminders = () => {
    const reminders = readReminders();
    const now = Date.now();
    const reminderIds = new Set(reminders.map((item) => item.id));
    preNotifiedRef.current.forEach((id) => {
      if (!reminderIds.has(id)) preNotifiedRef.current.delete(id);
    });
    dueNotifiedRef.current.forEach((id) => {
      if (!reminderIds.has(id)) dueNotifiedRef.current.delete(id);
    });

    for (const item of reminders) {
      const remaining = item.triggerAtUtc - now;
      if (remaining > 0 && remaining <= PRE_REMINDER_MS && !preNotifiedRef.current.has(item.id)) {
        preNotifiedRef.current.add(item.id);
        const body = buildReminderBody(item);
        addLocalNotification({
          eventKey: `reminder-pre-${item.id}`,
          title: `Upcoming: ${item.title}`,
          description: body,
        });
        toast({
          title: `Upcoming: ${item.title}`,
          description: body,
        });
        showBrowserNotification(`Upcoming: ${item.title}`, body, `reminder-pre-${item.id}`);
      }
      if (remaining <= 0 && !dueNotifiedRef.current.has(item.id)) {
        dueNotifiedRef.current.add(item.id);
        const body = buildReminderBody(item);
        addLocalNotification({
          eventKey: `reminder-due-${item.id}`,
          title: `Reminder: ${item.title}`,
          description: body,
        });
        showBrowserNotification(`Reminder: ${item.title}`, body, `reminder-due-${item.id}`);
      }
    }

    const due = reminders.filter((item) => item.triggerAtUtc <= now);
    setDueReminders(due);
  };

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      const alreadyPrompted = localStorage.getItem(REMINDER_BROWSER_PROMPT_KEY) === "1";
      if (!alreadyPrompted) {
        localStorage.setItem(REMINDER_BROWSER_PROMPT_KEY, "1");
        void Notification.requestPermission();
      }
    }

    refreshDueReminders();

    const intervalId = window.setInterval(() => {
      refreshDueReminders();
    }, 1000);

    const handleChanges = () => refreshDueReminders();
    window.addEventListener(REMINDERS_CHANGED_EVENT, handleChanges);
    window.addEventListener("storage", handleChanges);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener(REMINDERS_CHANGED_EVENT, handleChanges);
      window.removeEventListener("storage", handleChanges);
      stopRing();
    };
  }, []);

  useEffect(() => {
    if (dueReminders.length === 0) {
      stopRing();
      lastDueKeyRef.current = "";
      return;
    }

    startRing();
    const dueKey = dueReminders.map((item) => item.id).join("|");
    if (lastDueKeyRef.current !== dueKey) {
      lastDueKeyRef.current = dueKey;
      toast({
        title: "Reminder ringing",
        description: `${dueReminders.length} reminder${dueReminders.length > 1 ? "s are" : " is"} due.`,
      });
    }
  }, [dueReminders, toast]);

  if (dueReminders.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-[220] w-[calc(100vw-2rem)] max-w-md rounded-xl border bg-background shadow-2xl p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-full bg-red-500/10 p-2">
          <BellRing className="h-4 w-4 text-red-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">Reminder Alarm</p>
          <div className="mt-2 space-y-1 max-h-24 overflow-y-auto pr-1">
            {dueReminders.map((item) => (
              <div key={item.id} className="space-y-0.5">
                <p className="text-xs font-medium text-foreground">{item.title}</p>
                {item.description && (
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {formatReminder(item)} ({item.timezone})
                </p>
              </div>
            ))}
          </div>
          <Button
            className="mt-3"
            variant="destructive"
            size="sm"
            onClick={() => removeReminders(dueReminders.map((item) => item.id))}
          >
            Stop Alarm
          </Button>
        </div>
      </div>
    </div>
  );
}
