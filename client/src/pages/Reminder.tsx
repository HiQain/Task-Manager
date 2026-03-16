import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarDays } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  addReminder,
  readReminders,
  removeReminder,
  REMINDERS_CHANGED_EVENT,
  TIMEZONES,
  updateReminder,
  zonedLocalToUtc,
} from "@/lib/reminders";

function formatDateOnly(timestamp: number, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    dateStyle: "medium",
  }).format(new Date(timestamp));
}

function formatTimeOnly(timestamp: number, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function formatMultiTimezoneLine(triggerAtUtc: number) {
  const parts = TIMEZONES.map((zone) => `${zone.abbr} ${formatTimeOnly(triggerAtUtc, zone.value)}`);
  return parts.join(" | ");
}

function toLocalInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function parseLocalInputValue(value: string) {
  if (!value) return null;
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
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

export default function Reminder() {
  const { toast } = useToast();
  const [title, setTitle] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [timezone, setTimezone] = useState<string>("Asia/Karachi");
  const [datetimeLocal, setDatetimeLocal] = useState<string>("");
  const [remindersVersion, setRemindersVersion] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);

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
    const isEditing = Boolean(editingId);
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

    if (editingId) {
      updateReminder(editingId, {
        title: normalizedTitle,
        description: description.trim(),
        timezone,
        datetimeLocal,
        triggerAtUtc,
      });
      setEditingId(null);
    } else {
      addReminder({
        title: normalizedTitle,
        description: description.trim(),
        timezone,
        datetimeLocal,
        triggerAtUtc,
      });
    }
    setTitle("");
    setDescription("");
    setDatetimeLocal("");

    toast({
      title: isEditing ? "Reminder updated" : "Reminder added",
      description: isEditing ? "Reminder updated successfully." : "Reminder added successfully.",
    });
  };

  const handleStartEdit = (reminderId: string) => {
    const reminder = reminders.find((item) => item.id === reminderId);
    if (!reminder) return;
    setEditingId(reminderId);
    setTitle(reminder.title);
    setDescription(reminder.description);
    setTimezone(reminder.timezone);
    setDatetimeLocal(reminder.datetimeLocal);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setTitle("");
    setDescription("");
    setDatetimeLocal("");
  };

  const baseDate = parseLocalInputValue(datetimeLocal) || new Date();
  const selectedDate = parseLocalInputValue(datetimeLocal) || undefined;
  const currentHour24 = baseDate.getHours();
  const currentMinute = baseDate.getMinutes();
  const currentAmPm = currentHour24 >= 12 ? "PM" : "AM";
  const currentHour12 = ((currentHour24 + 11) % 12) + 1;

  const applyDateFromCalendar = (date?: Date) => {
    if (!date) return;
    const next = new Date(date);
    if (datetimeLocal) {
      next.setHours(currentHour24, currentMinute, 0, 0);
    } else {
      next.setHours(9, 0, 0, 0);
    }
    setDatetimeLocal(toLocalInputValue(next));
  };

  const applyTimeFromPicker = (hour12: number, minute: number, ampm: "AM" | "PM") => {
    const hour24 = ampm === "PM" ? (hour12 % 12) + 12 : hour12 % 12;
    const next = new Date(baseDate);
    next.setHours(hour24, minute, 0, 0);
    setDatetimeLocal(toLocalInputValue(next));
  };

  const minuteOptions = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));
  const hourOptions = Array.from({ length: 12 }, (_, i) => String(i + 1));

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Reminder</CardTitle>
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
                    {zone.abbr}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="date-time">Date & Time</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" className="w-full justify-between">
                  <span className={triggerAtUtc ? "text-foreground" : "text-muted-foreground"}>
                    {triggerAtUtc
                      ? `${formatDateOnly(triggerAtUtc, timezone)} • ${formatTimeOnly(
                          triggerAtUtc,
                          timezone,
                        )}`
                      : "Pick a date and time"}
                  </span>
                  <CalendarDays className="h-4 w-4 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-4 bg-background border shadow-xl" align="start">
                <div className="flex flex-col gap-4 sm:flex-row">
                  <Calendar mode="single" selected={selectedDate} onSelect={applyDateFromCalendar} />
                  <div className="space-y-3">
                    <Label>Time</Label>
                    <div className="flex gap-2">
                      <Select
                        value={String(currentHour12)}
                        onValueChange={(value) =>
                          applyTimeFromPicker(Number(value), currentMinute, currentAmPm)
                        }
                      >
                        <SelectTrigger className="w-[88px]">
                          <SelectValue placeholder="Hour" />
                        </SelectTrigger>
                        <SelectContent>
                          {hourOptions.map((hour) => (
                            <SelectItem key={hour} value={hour}>
                              {hour}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={String(currentMinute).padStart(2, "0")}
                        onValueChange={(value) =>
                          applyTimeFromPicker(currentHour12, Number(value), currentAmPm)
                        }
                      >
                        <SelectTrigger className="w-[88px]">
                          <SelectValue placeholder="Min" />
                        </SelectTrigger>
                        <SelectContent>
                          {minuteOptions.map((minute) => (
                            <SelectItem key={minute} value={minute}>
                              {minute}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={currentAmPm}
                        onValueChange={(value) =>
                          applyTimeFromPicker(currentHour12, currentMinute, value as "AM" | "PM")
                        }
                      >
                        <SelectTrigger className="w-[88px]">
                          <SelectValue placeholder="AM/PM" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="AM">AM</SelectItem>
                          <SelectItem value="PM">PM</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            {triggerAtUtc ? (
              <p className="text-xs text-muted-foreground">
                Selected: {formatDateOnly(triggerAtUtc, timezone)} • {formatTimeOnly(triggerAtUtc, timezone)}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Pick a date and time, or use quick buttons.</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleAddReminder}>{editingId ? "Update Reminder" : "Add Reminder"}</Button>
            {editingId ? (
              <Button variant="outline" onClick={handleCancelEdit}>
                Cancel
              </Button>
            ) : null}
          </div>
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
                      {formatDateOnly(item.triggerAtUtc, item.timezone)}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {formatMultiTimezoneLine(item.triggerAtUtc)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleStartEdit(item.id)}>
                      Edit
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => removeReminder(item.id)}>
                      Delete
                    </Button>
                  </div>
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
                      {formatDateOnly(item.triggerAtUtc, item.timezone)}
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
