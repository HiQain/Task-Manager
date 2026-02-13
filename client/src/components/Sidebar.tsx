import { Link, useLocation } from "wouter";
import { Bell, LayoutDashboard, Kanban, ListTodo, Plus, Users, Shield, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useUnreadCounts } from "@/hooks/use-chat";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useNotificationUnreadCount } from "@/hooks/use-notifications";

export function Sidebar({
  onNewTask,
  mobileOpen,
  onMobileOpenChange,
}: {
  onNewTask: () => void;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}) {
  const [location] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: unreadCounts } = useUnreadCounts();
  const { data: notificationsUnread } = useNotificationUnreadCount();
  const totalUnread = unreadCounts?.total || 0;
  const notificationUnreadCount = notificationsUnread?.count || 0;

  useEffect(() => {
    if (!user?.id) return;

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws?userId=${user.id}`);

    ws.onmessage = (event) => {
      let parsed: any = null;
      try {
        parsed = JSON.parse(String(event.data || "{}"));
      } catch {
        parsed = null;
      }

      const type = parsed?.type;
      const payload = parsed?.payload;

      if (type === "task:changed") {
        queryClient.invalidateQueries({ queryKey: [api.tasks.list.path] });
        queryClient.invalidateQueries({ queryKey: [api.tasks.get.path] });
      }

      if (type === "notify" && payload?.title) {
        toast({
          title: String(payload.title),
          description: payload?.description ? String(payload.description) : undefined,
          variant: payload?.variant === "destructive" ? "destructive" : "default",
        });
      }

      queryClient.invalidateQueries({ queryKey: [api.chats.unread.path] });
      queryClient.invalidateQueries({ queryKey: [api.chats.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.chats.groups.path] });
      queryClient.invalidateQueries({ queryKey: [api.chats.groupsUnread.path] });
      queryClient.invalidateQueries({ queryKey: ["chat", "task-group"] });
      queryClient.invalidateQueries({ queryKey: [api.notifications.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.notifications.unread.path] });
    };

    return () => {
      ws.close();
    };
  }, [user?.id, queryClient, toast]);

  // All admin items
  const adminNavItems = [
    { label: "Overview", icon: LayoutDashboard, href: "/" },
    { label: "Hiqain Board", icon: Kanban, href: "/board" },
    { label: "List View", icon: ListTodo, href: "/list" },
    { label: "Team", icon: Users, href: "/users" },
    { label: "Chat", icon: MessageSquare, href: "/chat" },
    { label: "Notifications", icon: Bell, href: "/notifications" },
  ];

  // User only sees tasks for drag & drop
  const userNavItems = [
    { label: "Hiqain Board", icon: Kanban, href: "/board" },
    { label: "Chat", icon: MessageSquare, href: "/chat" },
    { label: "Notifications", icon: Bell, href: "/notifications" },
  ];

  const navItems = user?.role === "admin" ? adminNavItems : userNavItems;

  const adminItems = user?.role === "admin" ? [
    { label: "Admin Console", icon: Shield, href: "/admin" },
  ] : [];

  const closeMobileSidebar = () => onMobileOpenChange(false);

  const renderNavSection = () => (
    <>
      <div className="space-y-1">
        {navItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href}>
              <div
                onClick={closeMobileSidebar}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-all duration-200
                  ${isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }
                `}
              >
                <item.icon className="w-4 h-4" />
                <span>{item.label}</span>
                {item.href === "/chat" && totalUnread > 0 && (
                  <span className="ml-auto min-w-5 h-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center">
                    {totalUnread > 99 ? "99+" : totalUnread}
                  </span>
                )}
                {item.href === "/notifications" && notificationUnreadCount > 0 && (
                  <span className="ml-auto min-w-5 h-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center">
                    {notificationUnreadCount > 99 ? "99+" : notificationUnreadCount}
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>

      {user?.role === "admin" && (
        <div className="mt-8">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4 pl-1">
            Admin
          </p>
          <div className="space-y-1">
            {adminItems.map((item) => {
              const isActive = location === item.href;
              return (
                <Link key={item.href} href={item.href}>
                  <div
                    onClick={closeMobileSidebar}
                    className={`
                      flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-all duration-200
                      ${isActive
                        ? "bg-amber-500/10 text-amber-600"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }
                    `}
                  >
                    <item.icon className="w-4 h-4" />
                    {item.label}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-8 px-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4 pl-1">
          Actions
        </p>
        <Button
          onClick={() => {
            closeMobileSidebar();
            onNewTask();
          }}
          className="w-full justify-start gap-2 shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all hover:-translate-y-0.5"
        >
          <Plus className="w-4 h-4" />
          New Task
        </Button>
      </div>
    </>
  );

  return (
    <>
      <div className="hidden md:flex w-64 border-r border-border/40 bg-card/50 backdrop-blur-sm h-screen flex-col fixed left-0 top-0 pt-6 px-4">
        <div className="px-2 mb-8 flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Kanban className="w-5 h-5 text-primary" />
          </div>
          <span className="font-display font-bold text-xl tracking-tight text-foreground">
            TaskFlow
          </span>
        </div>
        {renderNavSection()}
      </div>

      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent side="left" className="w-[88vw] max-w-[320px] p-4">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="px-2 mb-6 flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Kanban className="w-5 h-5 text-primary" />
            </div>
            <span className="font-display font-bold text-xl tracking-tight text-foreground">
              TaskFlow
            </span>
          </div>
          {renderNavSection()}
        </SheetContent>
      </Sheet>
    </>
  );
}
