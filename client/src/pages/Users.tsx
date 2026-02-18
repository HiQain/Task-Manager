import { useUsers, useCreateUser, useDeleteUser, useUpdateUser } from "@/hooks/use-users";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertUserSchema, type InsertUser } from "@shared/schema";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Loader2, UserPlus, Trash2, Search, Pencil } from "lucide-react";
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
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    designation: "",
    password: "",
    role: "user" as "user" | "admin",
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

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to remove this user? This will affect their assigned tasks.")) {
      deleteUser.mutate(id, {
        onSuccess: () => toast({ title: "User deleted" }),
      });
    }
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
    setEditForm({ name: "", email: "", designation: "", password: "", role: "user" });
  };

  const openEditDialog = (member: { id: number; name: string; email: string; designation?: string | null; role: string }) => {
    setEditingUserId(member.id);
    setEditForm({
      name: member.name,
      email: member.email,
      designation: member.designation || "",
      password: "",
      role: member.role === "admin" ? "admin" : "user",
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
                          <Input placeholder="Enter password" type="password" {...field} className="h-11" />
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
                          <select {...field} className="h-11 w-full rounded-md border border-input bg-background px-3 py-2">
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                          </select>
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
          <div className="relative max-w-sm">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, designation, role..."
              className="h-10 pl-9 bg-background"
            />
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
                <TableHead className="text-right min-w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-36 text-center text-muted-foreground">
                    {search.trim() ? "No matching team member found." : "No users found."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredUsers.map((member) => (
                  <TableRow key={member.id} className="group hover:bg-muted/20">
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
                        {member.role === "admin" ? "Admin" : "User"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-primary"
                        onClick={() => openEditDialog(member)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDelete(member.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
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
                onChange={(e) => setEditForm((prev) => ({ ...prev, role: e.target.value as "user" | "admin" }))}
                className="h-10 w-full rounded-md border border-input bg-background px-3 py-2"
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
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
              <Input
                type="password"
                value={editForm.password}
                onChange={(e) => setEditForm((prev) => ({ ...prev, password: e.target.value }))}
                placeholder="Leave blank to keep unchanged"
              />
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
    </div>
  );
}
