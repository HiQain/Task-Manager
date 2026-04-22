import { Link, useLocation } from "wouter";
import {
  AlarmClock,
  Bell,
  ChevronLeft,
  ChevronRight,
  HardDrive,
  Kanban,
  KeyRound,
  LayoutDashboard,
  ListTodo,
  LogOut,
  MessageSquare,
  Plus,
  Shield,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useTaskGroupUnreadCounts, useUnreadCounts } from "@/hooks/use-chat";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useNotificationUnreadCount } from "@/hooks/use-notifications";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  icon: LucideIcon;
  href: string;
};

export function Sidebar({
  onNewTask,
  onLogout,
  mobileOpen,
  onMobileOpenChange,
  collapsed,
  onToggleCollapsed,
}: {
  onNewTask: () => void;
  onLogout: () => void;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const [location] = useLocation();
  const { user } = useAuth();
  const { data: unreadCounts } = useUnreadCounts();
  const { data: taskGroupUnreadCounts } = useTaskGroupUnreadCounts();
  const { data: notificationsUnread } = useNotificationUnreadCount();
  const totalUnread = (unreadCounts?.total || 0) + (taskGroupUnreadCounts?.total || 0);
  const notificationUnreadCount = notificationsUnread?.count || 0;
  const effectiveNotificationUnreadCount = location === "/notifications" ? 0 : notificationUnreadCount;
  const canAccessStorage = !!user?.allowStorage;
  const canAccessClientCreds = user?.role === "admin" || !!user?.allowClientCreds;

  const adminNavItems: NavItem[] = [
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

  const userNavItems: NavItem[] = [
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
  const adminItems: NavItem[] = user?.role === "admin"
    ? [{ label: "Admin Console", icon: Shield, href: "/admin" }]
    : [];

  const closeMobileSidebar = () => onMobileOpenChange(false);

  const renderNavItem = (
    item: NavItem,
    options?: { compact?: boolean; admin?: boolean },
  ) => {
    const compact = !!options?.compact;
    const admin = !!options?.admin;
    const isActive = location === item.href;
    const badgeCount =
      item.href === "/chat"
        ? totalUnread
        : item.href === "/notifications"
          ? effectiveNotificationUnreadCount
          : 0;

    const linkContent = (
      <div
        onClick={closeMobileSidebar}
        aria-label={item.label}
        className={cn(
          "relative flex cursor-pointer items-center rounded-lg text-sm font-medium transition-all duration-200",
          compact ? "justify-center px-0 py-3" : "gap-3 px-3 py-2.5",
          isActive
            ? admin
              ? "bg-amber-500/10 text-amber-600"
              : "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <item.icon className={cn("shrink-0", compact ? "h-5 w-5" : "h-4 w-4")} />
        {!compact && <span className="whitespace-nowrap">{item.label}</span>}
        {badgeCount > 0 && (
          <span
            className={cn(
              "flex items-center justify-center rounded-full bg-destructive font-semibold text-destructive-foreground",
              compact
                ? "absolute right-1 top-1 min-h-4 min-w-4 px-1 text-[9px]"
                : "ml-auto h-5 min-w-5 px-1 text-[10px]",
            )}
          >
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        )}
      </div>
    );

    return (
      <Link key={item.href} href={item.href}>
        {compact ? (
          <Tooltip delayDuration={120}>
            <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        ) : (
          linkContent
        )}
      </Link>
    );
  };

  const renderActionButton = (
    label: string,
    icon: LucideIcon,
    onClick: () => void,
    options?: { compact?: boolean; variant?: "default" | "destructive" | "outline"; className?: string },
  ) => {
    const compact = !!options?.compact;
    const Icon = icon;
    const buttonNode = (
      <Button
        variant={options?.variant}
        onClick={() => {
          closeMobileSidebar();
          onClick();
        }}
        aria-label={label}
        className={cn(
          compact ? "h-11 w-full justify-center px-0 rounded-xl" : "w-full justify-start gap-2",
          options?.className,
        )}
      >
        <Icon className={cn("shrink-0", compact ? "h-5 w-5" : "h-4 w-4")} />
        {!compact && <span>{label}</span>}
      </Button>
    );

    return compact ? (
      <Tooltip delayDuration={120}>
        <TooltipTrigger asChild>{buttonNode}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    ) : (
      buttonNode
    );
  };

  const renderNavSection = (compact = false) => (
    <>
      <div className="space-y-1">
        {navItems.map((item) => renderNavItem(item, { compact }))}
      </div>

      {user?.role === "admin" && (
        <div className="mt-8">
          {!compact && (
            <p className="mb-4 pl-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Admin
            </p>
          )}
          <div className="space-y-1">
            {adminItems.map((item) => renderNavItem(item, { compact, admin: true }))}
          </div>
        </div>
      )}

      <div className={cn("mt-8", compact ? "px-0" : "px-2")}>
        {!compact && (
          <p className="mb-4 pl-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Actions
          </p>
        )}
        <div className={cn("space-y-3", compact && "space-y-2")}>
          {renderActionButton("New Task", Plus, onNewTask, {
            compact,
            className: "shadow-lg shadow-primary/20 transition-all hover:-translate-y-0.5 hover:shadow-primary/30",
          })}
          {renderActionButton("Logout", LogOut, onLogout, {
            compact,
            variant: "destructive",
            className: !compact ? "mb-4" : undefined,
          })}
        </div>
      </div>
    </>
  );

  return (
    <>
      <div
        className={cn(
          "fixed left-0 top-0 z-30 hidden h-screen transition-[width] duration-300 md:block",
          collapsed ? "w-20" : "w-64",
        )}
      >
        <div className="relative h-full overflow-visible">
          <div
            className={cn(
              "flex h-screen flex-col border-r border-border/40 bg-card/50 pt-6 backdrop-blur-sm transition-all duration-300",
              collapsed ? "items-center px-3" : "px-4",
            )}
          >
            <div className={cn("mb-8 flex items-center", collapsed ? "justify-center px-0" : "gap-2 px-2")}>
              <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-primary/10">
                <img src="/favicon.png" alt="TaskFlow" className="h-9 w-9 rounded-lg object-contain" />
              </div>
              {!collapsed && (
                <span className="font-display text-xl font-bold tracking-tight text-foreground">
                  TaskFlow
                </span>
              )}
            </div>
            <div className={cn("flex-1 min-h-0 overflow-y-auto", collapsed ? "w-full px-0" : "pr-1")}>
              {renderNavSection(collapsed)}
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="absolute right-0 top-1/2 z-10 hidden h-10 w-10 translate-x-1/2 -translate-y-1/2 rounded-full border-border/70 bg-background/95 shadow-[0_14px_30px_rgba(15,23,42,0.18)] backdrop-blur md:inline-flex"
          >
            {collapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent side="left" className="w-[88vw] max-w-[320px] p-4">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="mb-6 flex items-center gap-2 px-2">
            <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg bg-primary/10">
              <img src="/favicon.png" alt="TaskFlow" className="h-10 w-10 object-contain" />
            </div>
            <span className="font-display text-xl font-bold tracking-tight text-foreground">
              TaskFlow
            </span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto pr-1">
            {renderNavSection(false)}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
