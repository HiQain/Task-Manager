import { useAuth } from "@/hooks/use-auth";
import { useUsers } from "@/hooks/use-users";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { useLocation } from "wouter";
import { useMemo } from "react";

export default function Profile() {
  const { user } = useAuth();
  const { data: users } = useUsers();
  const [location] = useLocation();

  if (!user) return null;

  const selectedUserId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = Number(params.get("userId"));
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }, [location]);

  const profileUser = selectedUserId
    ? (users || []).find((entry) => entry.id === selectedUserId) || user
    : user;

  const initials = profileUser.name
    .split(" ")
    .map((word) => word.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const designationLabel = profileUser.role === "admin"
    ? "Admin"
    : ((profileUser.designation || "").trim() || "Team Member");

  return (
    <div className="max-w-2xl">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarFallback className="text-lg font-semibold">{initials}</AvatarFallback>
            </Avatar>
            <div>
              <p className="text-xl font-semibold">{profileUser.name}</p>
              <p className="text-sm text-muted-foreground">{profileUser.email}</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground mb-1">Role</p>
              <Badge variant={profileUser.role === "admin" ? "default" : "secondary"} className="capitalize">
                {profileUser.role}
              </Badge>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground mb-1">Designation</p>
              <p className="text-sm font-medium">{designationLabel}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground mb-1">Joined</p>
              <p className="text-sm font-medium">
                {profileUser.createdAt ? format(new Date(profileUser.createdAt), "dd MMM yyyy") : "N/A"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
