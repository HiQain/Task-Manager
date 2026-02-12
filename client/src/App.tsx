import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/Sidebar";
import { TaskDialog } from "@/components/TaskDialog";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";
import NotFound from "@/pages/not-found";
import Login from "@/pages/Login";

// Pages
import Overview from "@/pages/Overview";
import BoardView from "@/pages/BoardView";
import ListView from "@/pages/ListView";
import Users from "@/pages/Users";
import AdminConsole from "@/pages/AdminConsole";
import Chat from "@/pages/Chat";

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

      <Route path="/chat">
        <ProtectedRoute>
          <Chat />
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
  const [location] = useLocation();

  const getPageTitle = (path: string) => {
    switch (path) {
      case "/": return "Overview";
      case "/board": return "Hiqain Board";
      case "/list": return "All Tasks";
      case "/users": return "Team Management";
      case "/chat": return "Team Chat";
      default: return "";
    }
  };

  // Show logout for authenticated users only
  if (!user) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-background font-sans flex">
      <Sidebar onNewTask={() => setIsDialogOpen(true)} />

      <main className="flex-1 ml-64 p-8 overflow-y-auto h-screen">
        <header className="mb-8 flex items-center justify-between animate-in">
          <div>
            <h1 className="text-3xl font-bold text-foreground">{getPageTitle(location)}</h1>
            <p className="text-muted-foreground mt-1">Manage your team's work efficiently.</p>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-foreground">{user.name}</p>
              <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
            </div>
            <button
              onClick={() => {
                logout();
                window.location.href = '/login';
              }}
              className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Logout
            </button>
          </div>
        </header>

        {children}
      </main>

      <TaskDialog open={isDialogOpen} onOpenChange={setIsDialogOpen} />
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
