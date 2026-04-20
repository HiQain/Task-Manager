import { Link, useLocation } from "wouter";
import { Bell, LayoutDashboard, Kanban, ListTodo, Plus, Users, Shield, MessageSquare, HardDrive, AlarmClock, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useTaskGroupUnreadCounts, useUnreadCounts } from "@/hooks/use-chat";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useNotificationUnreadCount } from "@/hooks/use-notifications";

export function Sidebar({
  onNewTask,
  onLogout,
  mobileOpen,
  onMobileOpenChange,
}: {
  onNewTask: () => void;
  onLogout: () => void;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}) {
  const [location] = useLocation();
  const { user } = useAuth();
  const { data: unreadCounts } = useUnreadCounts();
  const { data: taskGroupUnreadCounts } = useTaskGroupUnreadCounts();
  const { data: notificationsUnread } = useNotificationUnreadCount();
  const totalUnread = (unreadCounts?.total || 0) + (taskGroupUnreadCounts?.total || 0);
  const notificationUnreadCount = notificationsUnread?.count || 0;
  const canAccessStorage = !!user?.allowStorage;
  const canAccessClientCreds = user?.role === "admin" || !!user?.allowClientCreds;

  const adminNavItems = [
    { label: "Overview", icon: LayoutDashboard, href: "/" },
    { label: "Hiqain Board", icon: Kanban, href: "/board" },
    { label: "List View", icon: ListTodo, href: "/list" },
    { label: "Team", icon: Users, href: "/users" },
    { label: "Reminder", icon: AlarmClock, href: "/reminder" },
    { label: "Chat", icon: MessageSquare, href: "/chat" },
    { label: "Notifications", icon: Bell, href: "/notifications" },
    ...(canAccessStorage ? [{ label: "Storage", icon: HardDrive, href: "/storage" }] : []),
    ...(canAccessClientCreds ? [{ label: "Client Creds", icon: KeyRound, href: "/client-creds" }] : []),
    { label: "Todo List", icon: ListTodo, href: "/todo" },
  ];

  const userNavItems = [
    { label: "Hiqain Board", icon: Kanban, href: "/board" },
    { label: "List View", icon: ListTodo, href: "/list" },
    { label: "Members", icon: Users, href: "/members" },
    { label: "Reminder", icon: AlarmClock, href: "/reminder" },
    { label: "Chat", icon: MessageSquare, href: "/chat" },
    { label: "Notifications", icon: Bell, href: "/notifications" },
    ...(canAccessStorage ? [{ label: "Storage", icon: HardDrive, href: "/storage" }] : []),
    ...(canAccessClientCreds ? [{ label: "Client Creds", icon: KeyRound, href: "/client-creds" }] : []),
    { label: "Todo List", icon: ListTodo, href: "/todo" },
  ];

  const navItems = user?.role === "admin" ? adminNavItems : userNavItems;
  const adminItems = user?.role === "admin"
    ? [{ label: "Admin Console", icon: Shield, href: "/admin" }]
    : [];

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
                <span className="whitespace-nowrap">{item.label}</span>
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
                    <span className="whitespace-nowrap">{item.label}</span>
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
        <Button
          variant="destructive"
          onClick={() => {
            closeMobileSidebar();
            onLogout();
          }}
          className="w-full justify-start gap-2 mt-3 mb-4"
        >
          Logout
        </Button>
      </div>
    </>
  );

  return (
    <>
      <div className="hidden md:flex w-64 border-r border-border/40 bg-card/50 backdrop-blur-sm h-screen flex-col fixed left-0 top-0 pt-6 px-4 overflow-hidden">
        <div className="px-2 mb-8 flex items-center gap-2">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center overflow-hidden">
            <img src="/favicon.png" alt="TaskFlow" className="w-9 h-9 object-contain rounded-lg" />
          </div>
          <span className="font-display font-bold text-xl tracking-tight text-foreground">
            TaskFlow
          </span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          {renderNavSection()}
        </div>
      </div>

      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent side="left" className="w-[88vw] max-w-[320px] p-4">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="px-2 mb-6 flex items-center gap-2">
            <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center overflow-hidden">
              <img src="/favicon.png" alt="TaskFlow" className="w-10 h-10 object-contain" />
            </div>
            <span className="font-display font-bold text-xl tracking-tight text-foreground">
              TaskFlow
            </span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto pr-1">
            {renderNavSection()}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
