import { useMemo, useState } from "react";
import { useUsers } from "@/hooks/use-users";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Loader2, MessageSquare, Search, Users as UsersIcon } from "lucide-react";
import { useLocation } from "wouter";

export default function Members() {
  const { data: users, isLoading } = useUsers();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");

  const members = useMemo(() => {
    const list = (users || []).filter((entry) => entry.id !== user?.id);
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((entry) =>
      `${entry.name} ${entry.email} ${entry.designation || ""} ${entry.role}`
        .toLowerCase()
        .includes(q),
    );
  }, [users, user?.id, search]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in">
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <UsersIcon className="w-5 h-5" />
            Members
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative max-w-md">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search members..."
              className="h-10 pl-9"
            />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {members.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No member found.
            </CardContent>
          </Card>
        ) : (
          members.map((member) => {
            const designation = member.role === "admin"
              ? "Admin"
              : ((member.designation || "").trim() || "No designation");

            return (
              <Card key={member.id} className="border border-border/70 shadow-sm">
                <CardContent className="py-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      type="button"
                      onClick={() => setLocation(`/profile?userId=${member.id}`)}
                      className="rounded-full"
                      aria-label={`Open ${member.name} profile`}
                    >
                      <Avatar className="h-9 w-9 border border-primary/10">
                        <AvatarFallback className="text-[11px] bg-primary/5 text-primary font-semibold">
                          {member.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    </button>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{member.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{designation}</p>
                    </div>
                  </div>
                  <div className="shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => setLocation(`/chat?userId=${member.id}`)}
                      aria-label={`Chat with ${member.name}`}
                    >
                      <MessageSquare className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
