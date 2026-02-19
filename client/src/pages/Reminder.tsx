import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  addReminder,
  readReminders,
  removeReminder,
  REMINDERS_CHANGED_EVENT,
  TIMEZONES,
  zonedLocalToUtc,
} from "@/lib/reminders";

function formatReminder(triggerAtUtc: number, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(triggerAtUtc));
}

export default function Reminder() {
  const { toast } = useToast();
  const [title, setTitle] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [timezone, setTimezone] = useState<string>("Asia/Karachi");
  const [datetimeLocal, setDatetimeLocal] = useState<string>("");
  const [remindersVersion, setRemindersVersion] = useState(0);

  const triggerAtUtc = useMemo(() => {
    if (!datetimeLocal) return null;
    return zonedLocalToUtc(datetimeLocal, timezone);
  }, [datetimeLocal, timezone]);

  const reminders = useMemo(() => readReminders(), [remindersVersion]);
  const now = Date.now();
  const upcomingReminders = reminders.filter((item) => item.triggerAtUtc > now);
  const dueReminders = reminders.filter((item) => item.triggerAtUtc <= now);

  useEffect(() => {
    const tickId = window.setInterval(() => {
      setRemindersVersion((prev) => prev + 1);
    }, 1000);
    const handleChange = () => setRemindersVersion((prev) => prev + 1);
    window.addEventListener(REMINDERS_CHANGED_EVENT, handleChange);
    window.addEventListener("storage", handleChange);

    return () => {
      window.clearInterval(tickId);
      window.removeEventListener(REMINDERS_CHANGED_EVENT, handleChange);
      window.removeEventListener("storage", handleChange);
    };
  }, []);

  const handleAddReminder = () => {
    const normalizedTitle = title.trim();
    if (!datetimeLocal || triggerAtUtc === null) {
      toast({
        title: "Invalid reminder",
        description: "Please select timezone, date and time.",
        variant: "destructive",
      });
      return;
    }
    if (!normalizedTitle) {
      toast({
        title: "Title required",
        description: "Please enter reminder title.",
        variant: "destructive",
      });
      return;
    }

    if (triggerAtUtc <= Date.now()) {
      toast({
        title: "Past time not allowed",
        description: "Please select a future date and time.",
        variant: "destructive",
      });
      return;
    }

    addReminder({
      title: normalizedTitle,
      description: description.trim(),
      timezone,
      datetimeLocal,
      triggerAtUtc,
    });
    setTitle("");
    setDescription("");
    setDatetimeLocal("");

    toast({
      title: "Reminder added",
      description: "Multiple reminders are supported now.",
    });
  };

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Reminder</CardTitle>
          <CardDescription>
            Timezone select karo, date/time do. Reminder se 5 minute pehle app aur browser dono par notification aayegi.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Meeting reminder"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              type="text"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional details"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="timezone">Time Zone</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger id="timezone">
                <SelectValue placeholder="Select timezone" />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((zone) => (
                  <SelectItem key={zone.value} value={zone.value}>
                    {zone.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="date-time">Date & Time</Label>
            <Input
              id="date-time"
              type="datetime-local"
              value={datetimeLocal}
              onChange={(event) => setDatetimeLocal(event.target.value)}
            />
          </div>

          <Button onClick={handleAddReminder}>Add Reminder</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Upcoming Reminders</CardTitle>
          <CardDescription>{upcomingReminders.length} scheduled</CardDescription>
        </CardHeader>
        <CardContent>
          {upcomingReminders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No upcoming reminders.</p>
          ) : (
            <div className="space-y-2">
              {upcomingReminders.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
                    {item.description && (
                      <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground truncate">
                      {formatReminder(item.triggerAtUtc, item.timezone)} ({item.timezone})
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => removeReminder(item.id)}>
                    Delete
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Due Reminders</CardTitle>
          <CardDescription>These reminders will keep ringing until you stop them.</CardDescription>
        </CardHeader>
        <CardContent>
          {dueReminders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No due reminders.</p>
          ) : (
            <div className="space-y-2">
              {dueReminders.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
                    {item.description && (
                      <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground truncate">
                      {formatReminder(item.triggerAtUtc, item.timezone)} ({item.timezone})
                    </p>
                  </div>
                  <Button variant="destructive" size="sm" onClick={() => removeReminder(item.id)}>
                    Stop
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
