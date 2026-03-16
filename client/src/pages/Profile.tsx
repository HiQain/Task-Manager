import { useAuth } from "@/hooks/use-auth";
import { useUsers } from "@/hooks/use-users";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { useLocation } from "wouter";
import { useMemo, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Profile() {
  const { user, changePassword } = useAuth();
  const { data: users } = useUsers();
  const [location] = useLocation();
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

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

  const canChangePassword = profileUser.id === user.id;

  const handleChangePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentPassword.trim() || !newPassword.trim()) {
      toast({ title: "Missing fields", description: "Please fill in all password fields.", variant: "destructive" });
      return;
    }
    if (newPassword.length < 6) {
      toast({ title: "Weak password", description: "Password must be at least 6 characters.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords do not match", description: "Please re-enter confirmation.", variant: "destructive" });
      return;
    }

    setIsUpdatingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      toast({ title: "Password updated", description: "Your password has been changed successfully." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      toast({
        title: "Update failed",
        description: error instanceof Error ? error.message : "Unable to update password.",
        variant: "destructive",
      });
    } finally {
      setIsUpdatingPassword(false);
    }
  };

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

      {canChangePassword ? (
        <Card className="shadow-sm mt-6">
          <CardHeader>
            <CardTitle>Change Password</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current-password">Current Password</Label>
                <div className="relative">
                  <Input
                    id="current-password"
                    type={showCurrentPassword ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="pr-10"
                    required
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowCurrentPassword((prev) => !prev)}
                    aria-label={showCurrentPassword ? "Hide password" : "Show password"}
                  >
                    {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password">New Password</Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="pr-10"
                    required
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowNewPassword((prev) => !prev)}
                    aria-label={showNewPassword ? "Hide password" : "Show password"}
                  >
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm New Password</Label>
                <div className="relative">
                  <Input
                    id="confirm-password"
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pr-10"
                    required
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                    aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={isUpdatingPassword}>
                  {isUpdatingPassword ? "Updating..." : "Update Password"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
