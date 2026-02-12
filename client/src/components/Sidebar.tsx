import { Link, useLocation } from "wouter";
import { LayoutDashboard, Kanban, ListTodo, Plus, Users, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

export function Sidebar({ onNewTask }: { onNewTask: () => void }) {
  const [location] = useLocation();
  const { user } = useAuth();

  // All admin items
  const adminNavItems = [
    { label: "Overview", icon: LayoutDashboard, href: "/" },
    { label: "Hiqain Board", icon: Kanban, href: "/board" },
    { label: "List View", icon: ListTodo, href: "/list" },
    { label: "Team", icon: Users, href: "/users" },
  ];

  // User only sees tasks for drag & drop
  const userNavItems = [
    { label: "Hiqain Board", icon: Kanban, href: "/board" },
  ];

  const navItems = user?.role === "admin" ? adminNavItems : userNavItems;

  const adminItems = user?.role === "admin" ? [
    { label: "Admin Console", icon: Shield, href: "/admin" },
  ] : [];

  return (
    <div className="w-64 border-r border-border/40 bg-card/50 backdrop-blur-sm h-screen flex flex-col fixed left-0 top-0 pt-6 px-4">
      <div className="px-2 mb-8 flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Kanban className="w-5 h-5 text-primary" />
        </div>
        <span className="font-display font-bold text-xl tracking-tight text-foreground">
          TaskFlow
        </span>
      </div>

      <div className="space-y-1">
        {navItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href}>
              <div
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-all duration-200
                  ${isActive
                    ? "bg-primary/10 text-primary"
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

      {/* Admin Section */}
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

      {
        user?.role === "admin" && (
          <div className="mt-8 px-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4 pl-1">
              Actions
            </p>
            <Button
              onClick={onNewTask}
              className="w-full justify-start gap-2 shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all hover:-translate-y-0.5"
            >
              <Plus className="w-4 h-4" />
              New Task
            </Button>
          </div>
        )
      }

      {/* <div className="mt-auto mb-8 px-4">
        <div className="bg-gradient-to-br from-primary/5 to-accent/5 rounded-xl p-4 border border-border/50">
          <h4 className="font-semibold text-sm mb-1">Pro Plan</h4>
          <p className="text-xs text-muted-foreground mb-3">Get more features</p>
          <Button variant="outline" size="sm" className="w-full text-xs h-8 bg-transparent hover:bg-white/50">
            Upgrade
          </Button>
        </div>
      </div> */}
    </div>
  );
}
