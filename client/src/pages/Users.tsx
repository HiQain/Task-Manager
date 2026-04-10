import { useUsers, useCreateUser, useDeleteUser, useUpdateUser, useUpdateUserStatus } from "@/hooks/use-users";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertUserSchema, type InsertUser } from "@shared/schema";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Loader2, UserPlus, Trash2, Search, Pencil, Eye, EyeOff, Power } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useLocation } from "wouter";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function getDisplayDesignation(member: { designation?: string | null; role: string }) {
  if (member.role === "admin") return "Admin";
  const raw = (member.designation || "").trim();
  if (raw) return raw;
  return "No designation";
}

export default function Users() {
  const { data: users, isLoading } = useUsers();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const createUser = useCreateUser();
  const deleteUser = useDeleteUser();
  const updateUser = useUpdateUser();
  const updateUserStatus = useUpdateUserStatus();
  const { toast } = useToast();
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [search, setSearch] = useState("");
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [isCsvUploading, setIsCsvUploading] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [statusTarget, setStatusTarget] = useState<{ id: number; name: string; isActive: boolean } | null>(null);
  const [activationPassword, setActivationPassword] = useState("");
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    designation: "",
    password: "",
    role: "user" as "user" | "admin",
    allowStorage: false,
    allowClientCreds: false,
  });

  // Redirect non-admin users to dashboard
  useEffect(() => {
    if (user && user.role !== 'admin') {
      setLocation('/');
    }
  }, [user, setLocation]);

  const form = useForm<InsertUser>({
    resolver: zodResolver(insertUserSchema),
    defaultValues: {
      name: "",
      email: "",
      designation: "",
      password: "",
      role: "user",
      allowStorage: false,
      allowClientCreds: false,
    },
  });

  async function onSubmit(data: InsertUser) {
    try {
      const payload: InsertUser = {
        ...data,
        name: data.name.trim(),
        email: data.email.trim(),
        designation: data.designation.trim(),
      };
      const created = await createUser.mutateAsync(payload);
      if ((created.designation || "").trim() !== payload.designation) {
        await updateUser.mutateAsync({
          id: created.id,
          data: { designation: payload.designation },
        });
      }
      form.reset();
      toast({ title: "User created", description: "Team member added successfully." });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Something went wrong",
        variant: "destructive"
      });
    }
  }

  const handleDelete = (id: number, name: string) => {
    setDeleteTarget({ id, name });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteUser.mutate(deleteTarget.id, {
      onSuccess: () => toast({ title: "User deleted" }),
    });
    setDeleteTarget(null);
  };

  const filteredUsers = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return users || [];
    return (users || []).filter((member) => {
      return `${member.name} ${member.email} ${member.designation || ""} ${member.role}`.toLowerCase().includes(q);
    });
  }, [users, search]);

  const closeEditDialog = () => {
    setEditingUserId(null);
    setEditForm({ name: "", email: "", designation: "", password: "", role: "user", allowStorage: false, allowClientCreds: false });
  };

  const closeStatusDialog = () => {
    setStatusTarget(null);
    setActivationPassword("");
  };

  const openEditDialog = (member: { id: number; name: string; email: string; designation?: string | null; role: string; allowStorage?: boolean | null; allowClientCreds?: boolean | null }) => {
    setEditingUserId(member.id);
    setEditForm({
      name: member.name,
      email: member.email,
      designation: member.designation || "",
      password: "",
      role: member.role === "admin" ? "admin" : "user",
      allowStorage: member.role === "admin" ? true : !!member.allowStorage,
      allowClientCreds: member.role === "admin" ? true : !!member.allowClientCreds,
    });
  };

  const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingUserId) return;

    const payload: Partial<InsertUser> = {
      name: editForm.name.trim(),
      email: editForm.email.trim(),
      designation: editForm.designation.trim(),
      role: editForm.role,
      allowStorage: editForm.allowStorage,
      allowClientCreds: editForm.allowClientCreds,
    };

    const nextPassword = editForm.password.trim();
    if (nextPassword) {
      payload.password = nextPassword;
    }

    try {
      const updated = await updateUser.mutateAsync({ id: editingUserId, data: payload });
      if (payload.designation && (updated.designation || "").trim() !== payload.designation) {
        await updateUser.mutateAsync({
          id: editingUserId,
          data: { designation: payload.designation },
        });
      }
      toast({ title: "User updated", description: "Team member updated successfully." });
      closeEditDialog();
    } catch (error) {
      toast({
        title: "Update failed",
        description: error instanceof Error ? error.message : "Something went wrong",
        variant: "destructive",
      });
    }
  };

  const handleStatusSubmit = async () => {
    if (!statusTarget) return;

    try {
      if (statusTarget.isActive) {
        await updateUserStatus.mutateAsync({
          id: statusTarget.id,
          data: { isActive: false },
        });
        toast({
          title: "Account deactivated",
          description: "The user has been signed out and can no longer log in.",
        });
      } else {
        const password = activationPassword.trim();
        if (!password) {
          toast({
            title: "Temporary password required",
            description: "Enter a temporary password before reactivating this account.",
            variant: "destructive",
          });
          return;
        }

        await updateUserStatus.mutateAsync({
          id: statusTarget.id,
          data: {
            isActive: true,
            activationPassword: password,
          },
        });
        toast({
          title: "Account reactivated",
          description: "The user can sign in with the temporary password and must change it immediately.",
        });
      }
      closeStatusDialog();
    } catch (error) {
      toast({
        title: "Status update failed",
        description: error instanceof Error ? error.message : "Something went wrong.",
        variant: "destructive",
      });
    }
  };

  const parseCsv = (text: string) => {
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length === 0) return { rows: [], errors: ["CSV is empty."] };

    const headers = lines[0].split(",").map((h) => h.trim());
    const required = ["name", "email", "designation", "role", "allowStorage", "password"];
    const missing = required.filter((key) => !headers.includes(key));
    if (missing.length > 0) {
      return { rows: [], errors: [`Missing columns: ${missing.join(", ")}`] };
    }

    const rows = lines.slice(1).map((line, idx) => {
      const cols = line.split(",").map((c) => c.trim());
      const row: Record<string, string> = {};
      headers.forEach((h, i) => {
        row[h] = cols[i] ?? "";
      });
      return { row, line: idx + 2 };
    });

    return { rows, errors: [] as string[] };
  };

  const handleCsvUpload = async () => {
    if (!csvFile) return;
    setIsCsvUploading(true);
    try {
      const text = await csvFile.text();
      const parsed = parseCsv(text);
      if (parsed.errors.length > 0) {
        toast({
          title: "CSV error",
          description: parsed.errors.join(" "),
          variant: "destructive",
        });
        return;
      }

      const failures: string[] = [];
      let successCount = 0;
      for (const item of parsed.rows) {
        const { row, line } = item;
        const name = (row.name || "").trim();
        const email = (row.email || "").trim();
        const designation = (row.designation || "").trim();
        const roleRaw = (row.role || "user").trim().toLowerCase();
        const role = roleRaw === "employee" ? "user" : roleRaw;
        const allowStorage = (row.allowStorage || "false").trim().toLowerCase() === "true";
        const allowClientCreds = (row.allowClientCreds || "false").trim().toLowerCase() === "true";
        const password = (row.password || "").trim();

        if (!name || !email || !designation || !password) {
          failures.push(`Line ${line}: missing required fields.`);
          continue;
        }
        if (role !== "admin" && role !== "user") {
          failures.push(`Line ${line}: role must be admin or employee.`);
          continue;
        }

        try {
          await createUser.mutateAsync({
            name,
            email,
            designation,
            password,
            role: role as "user" | "admin",
            allowStorage: role === "admin" ? true : allowStorage,
            allowClientCreds: role === "admin" ? true : allowClientCreds,
          });
          successCount += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to create user";
          failures.push(`Line ${line}: ${message}`);
        }
      }

      if (failures.length > 0) {
        toast({
          title: "Upload completed with errors",
          description: `${successCount} created, ${failures.length} failed. ${failures.slice(0, 3).join(" ")}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Upload complete",
          description: `${successCount} users created.`,
        });
      }

      setCsvFile(null);
    } finally {
      setIsCsvUploading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in">
      <div className="max-w-2xl">
        <Card className="shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5" />
              Add Team Member
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Full Name</FormLabel>
                        <FormControl>
                          <Input placeholder="John Doe" {...field} className="h-11" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email Address</FormLabel>
                        <FormControl>
                          <Input placeholder="john@example.com" type="email" {...field} className="h-11" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="designation"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Designation</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Project Manager" {...field} className="h-11" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input
                              placeholder="Enter password"
                              type={showCreatePassword ? "text" : "password"}
                              {...field}
                              className="h-11 pr-10"
                            />
                            <button
                              type="button"
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              onClick={() => setShowCreatePassword((prev) => !prev)}
                              aria-label={showCreatePassword ? "Hide password" : "Show password"}
                            >
                              {showCreatePassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="role"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Role</FormLabel>
                        <FormControl>
                          <select
                            value={field.value}
                            onChange={(e) => {
                              const nextRole = e.target.value as "user" | "admin";
                              field.onChange(nextRole);
                              if (nextRole === "admin") {
                                form.setValue("allowStorage", true, { shouldValidate: true, shouldDirty: true });
                                form.setValue("allowClientCreds", true, { shouldValidate: true, shouldDirty: true });
                              }
                            }}
                            className="h-11 w-full rounded-md border border-input bg-background px-3 py-2"
                          >
                            <option value="user">Employee</option>
                            <option value="admin">Admin</option>
                          </select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="allowStorage"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Storage Access</FormLabel>
                        <FormControl>
                          <label className="h-11 w-full rounded-md border border-input bg-background px-3 py-2 flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={!!field.value}
                              onChange={(e) => field.onChange(e.target.checked)}
                              disabled={form.watch("role") === "admin"}
                            />
                            Allow storage tab {form.watch("role") === "admin" ? "(always on for admin)" : ""}
                          </label>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="allowClientCreds"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Client Creds Access</FormLabel>
                        <FormControl>
                          <label className="h-11 w-full rounded-md border border-input bg-background px-3 py-2 flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={!!field.value}
                              onChange={(e) => field.onChange(e.target.checked)}
                              disabled={form.watch("role") === "admin"}
                            />
                            Allow client creds tab {form.watch("role") === "admin" ? "(always on for admin)" : ""}
                          </label>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <Button type="submit" disabled={createUser.isPending} className="w-full h-11">
                  {createUser.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add User"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border/60">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative max-w-sm w-full">
              <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, email, designation, role..."
                className="h-10 pl-9 bg-background"
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-muted-foreground">Upload CSV</label>
              <Input
                type="file"
                accept=".csv"
                className="h-10 w-full lg:w-[260px]"
                onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-10"
                onClick={handleCsvUpload}
                disabled={!csvFile || isCsvUploading}
              >
                {isCsvUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Upload"}
              </Button>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="min-w-[220px]">Name</TableHead>
                <TableHead className="min-w-[220px]">Email</TableHead>
                <TableHead className="min-w-[180px]">Designation</TableHead>
                <TableHead className="min-w-[120px]">Role</TableHead>
                <TableHead className="min-w-[140px]">Account</TableHead>
                <TableHead className="min-w-[140px]">Storage</TableHead>
                <TableHead className="min-w-[160px]">Client Creds</TableHead>
                <TableHead className="text-right min-w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-36 text-center text-muted-foreground">
                    {search.trim() ? "No matching team member found." : "No users found."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredUsers.map((member) => {
                  const storageAllowed = member.role === "admin" ? true : !!member.allowStorage;
                  const clientCredsAllowed = member.role === "admin" ? true : !!member.allowClientCreds;
                  return (
                  <TableRow key={member.id} className="group odd:bg-[#f8fafc] even:bg-[#eef2f7] hover:bg-[#e6edf6]">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8 border border-primary/10">
                          <AvatarFallback className="text-[11px] bg-primary/5 text-primary font-semibold">
                            {member.name.split(" ").map((n) => n[0]).join("").toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">{member.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {getDisplayDesignation(member)}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{member.email}</TableCell>
                    <TableCell className="text-muted-foreground">{getDisplayDesignation(member)}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={member.role === "admin"
                          ? "text-purple-700 bg-purple-50 border-purple-100"
                          : "text-blue-700 bg-blue-50 border-blue-100"}
                      >
                        {member.role === "admin" ? "Admin" : "Employee"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={member.isActive === false
                          ? "text-rose-700 bg-rose-50 border-rose-100"
                          : member.mustChangePassword
                            ? "text-amber-700 bg-amber-50 border-amber-100"
                            : "text-emerald-700 bg-emerald-50 border-emerald-100"}
                      >
                        {member.isActive === false
                          ? "Deactivated"
                          : member.mustChangePassword
                            ? "Password Reset Required"
                            : "Active"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={storageAllowed
                          ? "text-emerald-700 bg-emerald-50 border-emerald-100"
                          : "text-slate-600 bg-slate-50 border-slate-100"}
                      >
                        {storageAllowed ? "Allowed" : "Blocked"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={clientCredsAllowed
                          ? "text-amber-700 bg-amber-50 border-amber-100"
                          : "text-slate-600 bg-slate-50 border-slate-100"}
                      >
                        {clientCredsAllowed ? "Allowed" : "Blocked"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {member.id !== user?.id && (
                          <Button
                            variant={member.isActive === false ? "outline" : "destructive"}
                            size="sm"
                            className={member.isActive === false
                              ? "h-8 border-emerald-200 px-3 text-emerald-700 hover:bg-emerald-50"
                              : "h-8 px-3"}
                            onClick={() => setStatusTarget({
                              id: member.id,
                              name: member.name,
                              isActive: member.isActive !== false,
                            })}
                          >
                            <Power className="mr-1.5 h-3.5 w-3.5" />
                            {member.isActive === false ? "Activate" : "Deactivate"}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-primary"
                          onClick={() => openEditDialog(member)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        {member.email.toLowerCase() !== "admin@hiqain.com" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDelete(member.id, member.name)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={editingUserId !== null} onOpenChange={(open) => (!open ? closeEditDialog() : undefined)}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:w-full sm:max-w-[480px] max-h-[85vh] overflow-y-auto fixed !top-1/2 !left-1/2 !-translate-x-1/2 !-translate-y-1/2">
          <DialogHeader>
            <DialogTitle>Edit Team Member</DialogTitle>
            <DialogDescription>
              Update user details. Leave password blank to keep current password.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdate} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Full Name</label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Full name"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="Email address"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Role</label>
              <select
                value={editForm.role}
                onChange={(e) => {
                  const nextRole = e.target.value as "user" | "admin";
                  setEditForm((prev) => ({
                    ...prev,
                    role: nextRole,
                    allowStorage: nextRole === "admin" ? true : prev.allowStorage,
                    allowClientCreds: nextRole === "admin" ? true : prev.allowClientCreds,
                  }));
                }}
                className="h-10 w-full rounded-md border border-input bg-background px-3 py-2"
              >
                <option value="user">Employee</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Storage Access</label>
              <label className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editForm.allowStorage}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, allowStorage: e.target.checked }))}
                  disabled={editForm.role === "admin"}
                />
                Allow storage tab {editForm.role === "admin" ? "(always on for admin)" : ""}
              </label>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Client Creds Access</label>
              <label className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editForm.allowClientCreds}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, allowClientCreds: e.target.checked }))}
                  disabled={editForm.role === "admin"}
                />
                Allow client creds tab {editForm.role === "admin" ? "(always on for admin)" : ""}
              </label>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Designation</label>
              <Input
                value={editForm.designation}
                onChange={(e) => setEditForm((prev) => ({ ...prev, designation: e.target.value }))}
                placeholder="e.g. Project Manager"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">New Password (Optional)</label>
              <div className="relative">
                <Input
                  type={showEditPassword ? "text" : "password"}
                  value={editForm.password}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder="Leave blank to keep unchanged"
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowEditPassword((prev) => !prev)}
                  aria-label={showEditPassword ? "Hide password" : "Show password"}
                >
                  {showEditPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={closeEditDialog}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateUser.isPending}>
                {updateUser.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Changes"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => (!open ? setDeleteTarget(null) : undefined)}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:w-full sm:max-w-[420px] fixed !top-1/2 !left-1/2 !-translate-x-1/2 !-translate-y-1/2">
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
            <DialogDescription>
              {`Are you sure you want to delete ${deleteTarget?.name || "this user"}? This may affect their assigned tasks.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" type="button" onClick={confirmDelete} disabled={deleteUser.isPending}>
              {deleteUser.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={statusTarget !== null} onOpenChange={(open) => (!open ? closeStatusDialog() : undefined)}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:w-full sm:max-w-[460px] fixed !top-1/2 !left-1/2 !-translate-x-1/2 !-translate-y-1/2">
          <DialogHeader>
            <DialogTitle>{statusTarget?.isActive ? "Deactivate Account" : "Reactivate Account"}</DialogTitle>
            <DialogDescription>
              {statusTarget?.isActive
                ? `Deactivate ${statusTarget?.name || "this user"} and immediately end their current session.`
                : `Reactivate ${statusTarget?.name || "this user"} with a temporary password. They must change it before using the app.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!statusTarget?.isActive && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Temporary Password</label>
                <Input
                  type="text"
                  value={activationPassword}
                  onChange={(event) => setActivationPassword(event.target.value)}
                  placeholder="Enter a temporary password"
                />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" type="button" onClick={closeStatusDialog}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void handleStatusSubmit()} disabled={updateUserStatus.isPending}>
                {updateUserStatus.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : statusTarget?.isActive ? "Deactivate" : "Reactivate"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
