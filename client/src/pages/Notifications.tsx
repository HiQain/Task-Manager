import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useDeleteNotification, useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from "@/hooks/use-notifications";
import { Loader2, Trash2 } from "lucide-react";
import { deleteLocalNotification, markAllLocalNotificationsRead, markLocalNotificationRead } from "@/lib/local-notifications";

function formatDate(value: unknown): string {
  const date = value ? new Date(value as any) : null;
  if (!date || Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

export default function Notifications() {
  const { data: notifications, isLoading } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const deleteNotification = useDeleteNotification();

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const unreadCount = (notifications || []).filter((n: any) => !n.readAt).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Total {notifications?.length || 0} notifications, unread {unreadCount}
        </p>
        <Button
          variant="outline"
          onClick={() => {
            markAllRead.mutate();
            markAllLocalNotificationsRead();
          }}
          disabled={markAllRead.isPending || unreadCount === 0}
        >
          Mark All Read
        </Button>
      </div>

      {notifications?.length ? (
        <div className="space-y-3">
          {notifications.map((notification: any) => {
            const isUnread = !notification.readAt;
            const isLocal = notification?.local === true || typeof notification.id === "string";
            return (
              <Card key={notification.id} className={isUnread ? "border-primary/40" : ""}>
                <CardContent className="p-4 flex flex-col sm:flex-row gap-3 sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{notification.title}</p>
                    <p className="text-sm text-muted-foreground mt-1 break-words">{notification.description}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {formatDate(notification.createdAt)}
                    </p>
                  </div>
                  <div className="shrink-0">
                    <div className="flex items-center gap-2">
                      {isUnread ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            if (isLocal) {
                              markLocalNotificationRead(notification.id);
                            } else {
                              markRead.mutate(notification.id);
                            }
                          }}
                          disabled={markRead.isPending || deleteNotification.isPending}
                        >
                          Mark Read
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">Read</span>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (isLocal) {
                            deleteLocalNotification(notification.id);
                          } else {
                            deleteNotification.mutate(notification.id);
                          }
                        }}
                        disabled={deleteNotification.isPending || markRead.isPending}
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No notifications yet.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
