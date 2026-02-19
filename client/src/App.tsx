import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/Sidebar";
import { TaskDialog } from "@/components/TaskDialog";
import { ReminderEngine } from "@/components/ReminderEngine";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";
import NotFound from "@/pages/not-found";
import Login from "@/pages/Login";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

// Pages
import Overview from "@/pages/Overview";
import BoardView from "@/pages/BoardView";
import ListView from "@/pages/ListView";
import Users from "@/pages/Users";
import Members from "@/pages/Members";
import AdminConsole from "@/pages/AdminConsole";
import Chat from "@/pages/Chat";
import Notifications from "@/pages/Notifications";
import Profile from "@/pages/Profile";
import Storage from "@/pages/Storage";
import Reminder from "@/pages/Reminder";

function Router() {
  const { user } = useAuth();

  return (
    <Switch>
      <Route path="/login" component={Login} />

      <Route path="/">
        <ProtectedRoute>
          {user?.role === "admin" ? <Overview /> : <BoardView />}
        </ProtectedRoute>
      </Route>

      <Route path="/board">
        <ProtectedRoute>
          <BoardView />
        </ProtectedRoute>
      </Route>

      <Route path="/list">
        <ProtectedRoute>
          <ListView />
        </ProtectedRoute>
      </Route>

      <Route path="/users">
        <ProtectedRoute>
          <Users />
        </ProtectedRoute>
      </Route>

      <Route path="/members">
        <ProtectedRoute>
          <Members />
        </ProtectedRoute>
      </Route>

      <Route path="/chat">
        <ProtectedRoute>
          <Chat />
        </ProtectedRoute>
      </Route>

      <Route path="/notifications">
        <ProtectedRoute>
          <Notifications />
        </ProtectedRoute>
      </Route>

      <Route path="/profile">
        <ProtectedRoute>
          <Profile />
        </ProtectedRoute>
      </Route>

      <Route path="/storage">
        <ProtectedRoute>
          <Storage />
        </ProtectedRoute>
      </Route>

      <Route path="/reminder">
        <ProtectedRoute>
          <Reminder />
        </ProtectedRoute>
      </Route>

      <Route path="/admin">
        <ProtectedRoute requiredRole="admin">
          <AdminConsole />
        </ProtectedRoute>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [location, setLocation] = useLocation();

  const getPageTitle = (path: string) => {
    switch (path) {
      case "/": return "Overview";
      case "/board": return "Hiqain Board";
      case "/list": return "All Tasks";
      case "/users": return "Team Management";
      case "/members": return "Members";
      case "/chat": return "Team Chat";
      case "/notifications": return "Notifications";
      case "/profile": return "Profile";
      case "/storage": return "Storage";
      case "/reminder": return "Reminder";
      default: return "";
    }
  };

  // Show logout for authenticated users only
  if (!user) {
    return <>{children}</>;
  }

  const userInitials = user.name
    .split(" ")
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="min-h-screen bg-background font-sans flex">
      <Sidebar
        onNewTask={() => setIsDialogOpen(true)}
        mobileOpen={isMobileSidebarOpen}
        onMobileOpenChange={setIsMobileSidebarOpen}
      />

      <main className="flex-1 md:ml-64 p-4 md:p-8 overflow-y-auto min-h-screen">
        <header className="mb-6 md:mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between animate-in">
          <div className="flex items-start gap-3">
            <Button
              variant="outline"
              size="icon"
              className="md:hidden"
              onClick={() => setIsMobileSidebarOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground">{getPageTitle(location)}</h1>
              <p className="text-muted-foreground mt-1 text-sm md:text-base">Manage your team's work efficiently.</p>
            </div>
          </div>

          <div className="flex items-center justify-between md:justify-end gap-3 md:gap-4">
            <button
              type="button"
              onClick={() => setLocation("/profile")}
              className="flex items-center gap-2 text-left md:text-right min-w-0 rounded-md px-2 py-1 hover:bg-muted transition-colors"
            >
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs font-semibold">{userInitials}</AvatarFallback>
              </Avatar>
              <div>
                <p className="text-sm font-medium text-foreground truncate">{user.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
              </div>
            </button>
            <button
              onClick={() => {
                logout();
                window.location.href = '/login';
              }}
              className="px-3 md:px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Logout
            </button>
          </div>
        </header>

        {children}
      </main>

      <TaskDialog open={isDialogOpen} onOpenChange={setIsDialogOpen} />
      <ReminderEngine />
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Layout>
          <Router />
        </Layout>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
