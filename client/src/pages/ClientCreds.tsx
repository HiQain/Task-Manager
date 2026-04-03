import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useUsers } from "@/hooks/use-users";
import { api, buildUrl } from "@shared/routes";
import { apiRequest } from "@/lib/queryClient";
import { Eye, EyeOff, KeyRound, Loader2, Pencil, Plus, ShieldCheck, Trash2, UserRound, X } from "lucide-react";

type ProjectMember = {
  userId: number;
  name: string;
  access: "view" | "edit";
};

type ClientCredProject = {
  id: number;
  clientName: string;
  projectName: string;
  viaChannels: string[];
  emails: string[];
  passwords: string[];
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
  canEdit: boolean;
  canDelete: boolean;
  members: ProjectMember[];
};

type AccessMap = Record<number, "view" | "edit" | null>;

type CredentialMode = "email" | "phone" | "custom";

type CredentialFormRow = {
  mode: CredentialMode;
  via: string;
  value: string;
  password: string;
};

type ProjectFormState = {
  clientName: string;
  projectName: string;
  rows: CredentialFormRow[];
};

const emptyFormState = (): ProjectFormState => ({
  clientName: "",
  projectName: "",
  rows: [{ mode: "email", via: "Email", value: "", password: "" }],
});

function sanitizeValueList(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function inferCredentialMode(via: string): CredentialMode {
  const normalized = via.trim().toLowerCase();
  if (normalized === "email") return "email";
  if (normalized === "phone") return "phone";
  return "custom";
}

function createFormRow(mode: CredentialMode = "email"): CredentialFormRow {
  return {
    mode,
    via: mode === "email" ? "Email" : mode === "phone" ? "Phone" : "",
    value: "",
    password: "",
  };
}

function buildRowsFromProject(project: ClientCredProject): CredentialFormRow[] {
  const maxRows = Math.max(project.viaChannels.length, project.emails.length, project.passwords.length, 1);
  return Array.from({ length: maxRows }, (_, index) => {
    const via = project.viaChannels[index] || "";
    const mode = inferCredentialMode(via);
    return {
      mode,
      via: via || (mode === "email" ? "Email" : mode === "phone" ? "Phone" : ""),
      value: project.emails[index] || "",
      password: project.passwords[index] || "",
    };
  });
}

export default function ClientCreds() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: users } = useUsers();

  const [projects, setProjects] = useState<ClientCredProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasClientCredsAccess, setHasClientCredsAccess] = useState(true);
  const [showPasswords, setShowPasswords] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [formState, setFormState] = useState<ProjectFormState>(emptyFormState());
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [formError, setFormError] = useState("");

  const [accessDialogOpen, setAccessDialogOpen] = useState(false);
  const [manageAccessMap, setManageAccessMap] = useState<AccessMap>({});
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) || null;

  const allowedUsers = useMemo(() => {
    return (users || []).filter(
      (member) => (member.role === "admin" || !!member.allowClientCreds) && member.id !== user?.id,
    );
  }, [users, user?.id]);

  const loadProjects = async (preferredProjectId?: number | null) => {
    try {
      setIsLoading(true);
      const res = await fetch(api.clientCreds.list.path, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setProjects([]);
          setSelectedProjectId(null);
          setHasClientCredsAccess(false);
          return;
        }
        throw new Error("Failed to load client creds");
      }

      setHasClientCredsAccess(true);
      const data = await res.json() as { projects: ClientCredProject[] };
      const nextProjects = Array.isArray(data.projects) ? data.projects : [];
      setProjects(nextProjects);

      const candidateId = preferredProjectId ?? selectedProjectId;
      const hasCandidate = candidateId !== null && nextProjects.some((project) => project.id === candidateId);
      if (hasCandidate) {
        setSelectedProjectId(candidateId);
      } else {
        setSelectedProjectId(nextProjects[0]?.id ?? null);
      }
    } catch {
      toast({
        title: "Load failed",
        description: "Could not load client creds.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!user?.id) return;
    void loadProjects();
  }, [user?.id]);

  const buildMembersPayload = (source: AccessMap) => {
    return Object.entries(source)
      .map(([userId, access]) => ({ userId: Number(userId), access }))
      .filter((entry): entry is { userId: number; access: "view" | "edit" } =>
        Number.isFinite(entry.userId) && (entry.access === "view" || entry.access === "edit"),
      );
  };

  const openCreateDialog = () => {
    setFormMode("create");
    setEditingProjectId(null);
    setFormState(emptyFormState());
    setManageAccessMap({});
    setFormError("");
    setFormOpen(true);
  };

  const openEditDialog = () => {
    if (!selectedProject) return;
    setFormMode("edit");
    setEditingProjectId(selectedProject.id);
    setFormState({
      clientName: selectedProject.clientName,
      projectName: selectedProject.projectName,
      rows: buildRowsFromProject(selectedProject),
    });
    setFormError("");
    setFormOpen(true);
  };

  const submitForm = async () => {
    const normalizedRows = formState.rows
      .map((row) => ({
        via: row.mode === "email" ? "Email" : row.mode === "phone" ? "Phone" : row.via.trim(),
        value: row.value.trim(),
        password: row.password.trim(),
      }))
      .filter((row) => row.via || row.value || row.password);

    const payload = {
      clientName: formState.clientName.trim(),
      projectName: formState.projectName.trim(),
      viaChannels: sanitizeValueList(normalizedRows.map((row) => row.via)),
      emails: sanitizeValueList(normalizedRows.map((row) => row.value)),
      passwords: sanitizeValueList(normalizedRows.map((row) => row.password)),
    };

    if (!payload.clientName || !payload.projectName) {
      setFormError("Client name and project name are required.");
      return;
    }
    if (normalizedRows.length === 0) {
      setFormError("At least one credentials row is required.");
      return;
    }
    if (normalizedRows.some((row) => !row.via || !row.value || !row.password)) {
      setFormError("Selected via ke neeche value aur password dono required hain.");
      return;
    }

    try {
      if (formMode === "create") {
        const members = buildMembersPayload(manageAccessMap);
        const res = await apiRequest(api.clientCreds.createProject.method, api.clientCreds.createProject.path, {
          ...payload,
          members,
        });
        const created = await res.json() as { id: number };
        setFormOpen(false);
        await loadProjects(created?.id ?? null);
      } else if (editingProjectId) {
        await apiRequest(
          api.clientCreds.updateProject.method,
          buildUrl(api.clientCreds.updateProject.path, { id: editingProjectId }),
          payload,
        );
        setFormOpen(false);
        await loadProjects(editingProjectId);
      }
    } catch (error) {
      toast({
        title: formMode === "create" ? "Create failed" : "Update failed",
        description: error instanceof Error ? error.message : "Something went wrong.",
        variant: "destructive",
      });
    }
  };

  const openAccessDialog = () => {
    if (!selectedProject) return;
    const initialMap: AccessMap = {};
    selectedProject.members.forEach((member) => {
      initialMap[member.userId] = member.access;
    });
    setManageAccessMap(initialMap);
    setAccessDialogOpen(true);
  };

  const saveAccess = async () => {
    if (!selectedProject) return;
    try {
      await apiRequest(
        api.clientCreds.updateAccess.method,
        buildUrl(api.clientCreds.updateAccess.path, { id: selectedProject.id }),
        { members: buildMembersPayload(manageAccessMap) },
      );
      setAccessDialogOpen(false);
      await loadProjects(selectedProject.id);
    } catch {
      toast({
        title: "Access update failed",
        description: "Could not update client creds access.",
        variant: "destructive",
      });
    }
  };

  const openDeleteDialog = () => {
    if (!selectedProject || !selectedProject.canDelete) return;
    setDeleteTarget({
      id: selectedProject.id,
      label: `${selectedProject.clientName} / ${selectedProject.projectName}`,
    });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;

    try {
      setIsDeleting(true);
      await apiRequest(
        api.clientCreds.deleteProject.method,
        buildUrl(api.clientCreds.deleteProject.path, { id: deleteTarget.id }),
      );
      setDeleteTarget(null);
      await loadProjects(null);
    } catch {
      toast({
        title: "Delete failed",
        description: "Client creds could not be deleted.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const renderAccessPicker = (
    mapState: AccessMap,
    setMapState: Dispatch<SetStateAction<AccessMap>>,
  ) => (
    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
      {allowedUsers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No users with client creds access found. Enable it from Team page.</p>
      ) : (
        allowedUsers.map((member) => {
          const selectedAccess = mapState[member.id] || null;
          return (
            <div key={member.id} className="flex items-center gap-2 rounded-md border p-2">
              <label className="flex items-center gap-2 min-w-0 flex-1">
                <input
                  type="checkbox"
                  checked={selectedAccess !== null}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setMapState((prev) => ({
                      ...prev,
                      [member.id]: checked ? (prev[member.id] || "view") : null,
                    }));
                  }}
                />
                <span className="text-sm truncate">{member.name}</span>
              </label>
              <select
                value={selectedAccess || "view"}
                disabled={selectedAccess === null}
                onChange={(e) => {
                  const nextAccess = e.target.value === "edit" ? "edit" : "view";
                  setMapState((prev) => ({ ...prev, [member.id]: nextAccess }));
                }}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="view">View</option>
                <option value="edit">Edit</option>
              </select>
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Client Projects</CardTitle>
            <p className="text-xs text-muted-foreground">Manage shared client login and communication creds.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button type="button" className="w-full" onClick={openCreateDialog}>
              <Plus className="h-4 w-4" />
              New Client Creds
            </Button>

            <div className="space-y-2">
              {projects.map((project) => {
                const isActive = project.id === selectedProjectId;
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => setSelectedProjectId(project.id)}
                    className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${isActive ? "border-primary/40 bg-primary/10" : "hover:bg-muted"}`}
                  >
                    <p className="text-sm font-semibold truncate">{project.clientName}</p>
                    <p className="text-xs text-muted-foreground truncate mt-1">{project.projectName}</p>
                    <p className="text-xs text-muted-foreground mt-2">{project.members.length} shared users</p>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="h-4 w-4" />
                {selectedProject ? `${selectedProject.clientName} / ${selectedProject.projectName}` : "Client Creds"}
              </CardTitle>
              {selectedProject && (
                <p className="text-xs text-muted-foreground mt-1">
                  Updated {formatDate(selectedProject.updatedAt)}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedProject?.canDelete && (
                <Button type="button" variant="secondary" onClick={openAccessDialog}>
                  <ShieldCheck className="h-4 w-4" />
                  Manage Access
                </Button>
              )}
              {selectedProject?.canEdit && (
                <Button type="button" variant="outline" onClick={openEditDialog}>
                  <Pencil className="h-4 w-4" />
                  Edit
                </Button>
              )}
              {selectedProject && (
                <Button type="button" variant="outline" onClick={() => setShowPasswords((prev) => !prev)}>
                  {showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  {showPasswords ? "Hide Passwords" : "Show Passwords"}
                </Button>
              )}
              {selectedProject?.canDelete && (
                <Button type="button" variant="destructive" onClick={openDeleteDialog}>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              )}
            </div>
          </CardHeader>

          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading client creds...</p>
            ) : !hasClientCredsAccess ? (
              <p className="text-sm text-muted-foreground">Client creds tab is disabled for your account.</p>
            ) : !selectedProject ? (
              <p className="text-sm text-muted-foreground">Create or select a client creds project to start.</p>
            ) : (
              <div className="space-y-4">
                {!selectedProject.canEdit && (
                  <p className="text-xs text-muted-foreground">View-only access: editing is disabled for this record.</p>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  <Card className="border-border/60">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Client Details</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Client Name</p>
                        <p className="mt-1 font-medium">{selectedProject.clientName}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Project Name</p>
                        <p className="mt-1 font-medium">{selectedProject.projectName}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Created</p>
                        <p className="mt-1">{formatDate(selectedProject.createdAt)}</p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-border/60">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Shared With</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {selectedProject.members.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Only admin/owner currently has access.</p>
                      ) : (
                        selectedProject.members.map((member) => (
                          <div key={member.userId} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                            <div className="flex items-center gap-2 min-w-0">
                              <UserRound className="h-4 w-4 text-muted-foreground" />
                              <span className="truncate">{member.name}</span>
                            </div>
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">{member.access}</span>
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-4 lg:grid-cols-3">
                  <Card className="border-border/60">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Via</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {selectedProject.viaChannels.map((value, index) => (
                        <div key={`${value}-${index}`} className="rounded-md border px-3 py-2 text-sm">
                          {value}
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  <Card className="border-border/60">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Emails</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {selectedProject.emails.map((value, index) => (
                        <div key={`${value}-${index}`} className="rounded-md border px-3 py-2 text-sm break-all">
                          {value}
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  <Card className="border-border/60">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Passwords</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {selectedProject.passwords.map((value, index) => (
                        <div key={`${value}-${index}`} className="rounded-md border px-3 py-2 text-sm break-all">
                          {showPasswords ? value : "•".repeat(Math.max(8, value.length))}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-[210] bg-black/60 p-3 sm:p-4 flex items-start sm:items-center justify-center overflow-y-auto" onClick={() => setFormOpen(false)}>
          <div
            className="w-full sm:w-[95vw] max-w-3xl max-h-[95vh] overflow-y-auto rounded-lg border bg-background p-4 sm:p-6 mt-6 sm:mt-0"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-3">{formMode === "create" ? "Create Client Creds" : "Edit Client Creds"}</h3>
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Client Name</label>
                  <Input
                    value={formState.clientName}
                    onChange={(e) => {
                      setFormState((prev) => ({ ...prev, clientName: e.target.value }));
                      if (formError) setFormError("");
                    }}
                    placeholder="Enter client name"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Project Name</label>
                  <Input
                    value={formState.projectName}
                    onChange={(e) => {
                      setFormState((prev) => ({ ...prev, projectName: e.target.value }));
                      if (formError) setFormError("");
                    }}
                    placeholder="Enter project name"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Via</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setFormState((prev) => ({
                        ...prev,
                        rows: [...prev.rows, createFormRow()],
                      }))
                    }
                  >
                    <Plus className="h-4 w-4" />
                    Add more
                  </Button>
                </div>

                <div className="space-y-3">
                  {formState.rows.map((row, index) => (
                    <div key={`via-row-${index}`} className="rounded-lg border p-3 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium">Entry {index + 1}</p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={formState.rows.length === 1}
                          onClick={() =>
                            setFormState((prev) => ({
                              ...prev,
                              rows: prev.rows.length === 1
                                ? prev.rows
                                : prev.rows.filter((_, rowIndex) => rowIndex !== index),
                            }))
                          }
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium">Select Via Type</label>
                        <select
                          value={row.mode}
                          onChange={(e) => {
                            const nextMode = e.target.value as CredentialMode;
                            setFormState((prev) => ({
                              ...prev,
                              rows: prev.rows.map((entry, entryIndex) =>
                                entryIndex !== index
                                  ? entry
                                  : {
                                      ...entry,
                                      mode: nextMode,
                                      via: nextMode === "email" ? "Email" : nextMode === "phone" ? "Phone" : "",
                                      value: "",
                                    },
                              ),
                            }));
                          }}
                          className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        >
                          <option value="email">Email</option>
                          <option value="phone">Phone</option>
                          <option value="custom">Custom Via</option>
                        </select>
                      </div>

                      <div className="rounded-md border bg-muted/20 p-3 space-y-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-sm font-medium">
                              {row.mode === "email" ? "Email selected" : row.mode === "phone" ? "Phone selected" : "Custom via selected"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {row.mode === "email"
                                ? "Neeche email add karein."
                                : row.mode === "phone"
                                  ? "Neeche phone number add karein."
                                  : "Neeche custom via aur uski value add karein."}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setFormState((prev) => ({
                                ...prev,
                                rows: [
                                  ...prev.rows.slice(0, index + 1),
                                  createFormRow(row.mode),
                                  ...prev.rows.slice(index + 1),
                                ],
                              }))
                            }
                          >
                            <Plus className="h-4 w-4" />
                            {row.mode === "email" ? "Add more email" : row.mode === "phone" ? "Add more phone" : "Add more custom via"}
                          </Button>
                        </div>

                        {row.mode === "custom" && (
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Custom Via</label>
                            <Input
                              value={row.via}
                              placeholder="Twilio / WhatsApp / Portal"
                              onChange={(e) =>
                                setFormState((prev) => ({
                                  ...prev,
                                  rows: prev.rows.map((entry, entryIndex) =>
                                    entryIndex === index ? { ...entry, via: e.target.value } : entry,
                                  ),
                                }))
                              }
                            />
                          </div>
                        )}

                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-2">
                            <label className="text-sm font-medium">
                              {row.mode === "email" ? "Email" : row.mode === "phone" ? "Phone Number" : "Value"}
                            </label>
                            <Input
                              type={row.mode === "email" ? "email" : "text"}
                              value={row.value}
                              placeholder={
                                row.mode === "email"
                                  ? "client@example.com"
                                  : row.mode === "phone"
                                    ? "+1 234 567 890"
                                    : "Enter custom value"
                              }
                              onChange={(e) =>
                                setFormState((prev) => ({
                                  ...prev,
                                  rows: prev.rows.map((entry, entryIndex) =>
                                    entryIndex === index ? { ...entry, value: e.target.value } : entry,
                                  ),
                                }))
                              }
                            />
                          </div>

                          <div className="space-y-2">
                            <label className="text-sm font-medium">Password</label>
                            <Input
                              type="text"
                              value={row.password}
                              placeholder="Enter password"
                              onChange={(e) =>
                                setFormState((prev) => ({
                                  ...prev,
                                  rows: prev.rows.map((entry, entryIndex) =>
                                    entryIndex === index ? { ...entry, password: e.target.value } : entry,
                                  ),
                                }))
                              }
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {formMode === "create" && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Allow Users (Read/Edit)</p>
                  {renderAccessPicker(manageAccessMap, setManageAccessMap)}
                </div>
              )}

              {formError && <p className="text-xs text-destructive">{formError}</p>}

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
                <Button variant="outline" className="w-full sm:w-auto" onClick={() => setFormOpen(false)}>Cancel</Button>
                <Button className="w-full sm:w-auto" onClick={() => void submitForm()}>
                  {formMode === "create" ? "Create" : "Save Changes"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {accessDialogOpen && selectedProject && (
        <div className="fixed inset-0 z-[210] bg-black/60 p-3 sm:p-4 flex items-start sm:items-center justify-center overflow-y-auto" onClick={() => setAccessDialogOpen(false)}>
          <div
            className="w-full sm:w-[95vw] max-w-2xl max-h-[95vh] overflow-y-auto rounded-lg border bg-background p-4 sm:p-6 mt-6 sm:mt-0"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-1">Manage Client Creds Access</h3>
            <p className="text-sm text-muted-foreground mb-3">{selectedProject.clientName} / {selectedProject.projectName}</p>
            {renderAccessPicker(manageAccessMap, setManageAccessMap)}
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-3">
              <Button variant="outline" className="w-full sm:w-auto" onClick={() => setAccessDialogOpen(false)}>Cancel</Button>
              <Button className="w-full sm:w-auto" onClick={() => void saveAccess()}>Save Access</Button>
            </div>
          </div>
        </div>
      )}

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => (!open ? setDeleteTarget(null) : undefined)}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:w-full sm:max-w-[420px] fixed !top-1/2 !left-1/2 !-translate-x-1/2 !-translate-y-1/2">
          <DialogHeader>
            <DialogTitle>Delete Client Creds</DialogTitle>
            <DialogDescription>
              {`Are you sure you want to delete client creds for ${deleteTarget?.label || "this record"}?`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setDeleteTarget(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" type="button" onClick={() => void confirmDelete()} disabled={isDeleting}>
              {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
