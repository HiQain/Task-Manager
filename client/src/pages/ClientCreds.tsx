import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useUsers } from "@/hooks/use-users";
import { api, buildUrl } from "@shared/routes";
import { apiRequest } from "@/lib/queryClient";
import { ChevronDown, ExternalLink, KeyRound, Loader2, MoreHorizontal, Pencil, Plus, Search, ShieldCheck, Trash2, X } from "lucide-react";

type ProjectMember = {
  userId: number;
  name: string;
  access: "view" | "edit";
};

type ClientCredProject = {
  id: number;
  clientName: string;
  projectName: string;
  link?: string | null;
  links?: string[];
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

type CredentialFormRow = {
  via: string;
  value: string;
  password: string;
  link: string;
};

type ProjectFormState = {
  clientName: string;
  projectName: string;
  rows: CredentialFormRow[];
};

type ClientGroup = {
  key: string;
  clientName: string;
  projects: ClientCredProject[];
  credentialCount: number;
};

const emptyFormState = (): ProjectFormState => ({
  clientName: "",
  projectName: "",
  rows: [createFormRow()],
});

function sanitizeValueList(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function createFormRow(): CredentialFormRow {
  return {
    via: "",
    value: "",
    password: "",
    link: "",
  };
}

function buildRowsFromProject(project: ClientCredProject): CredentialFormRow[] {
  const projectLinks = Array.isArray(project.links) ? project.links : [];
  const maxRows = Math.max(project.viaChannels.length, project.emails.length, project.passwords.length, projectLinks.length, 1);
  return Array.from({ length: maxRows }, (_, index) => {
    return {
      via: project.viaChannels[index] || "",
      value: project.emails[index] || "",
      password: project.passwords[index] || "",
      link: projectLinks[index] || (index === 0 ? String(project.link || "").trim() : ""),
    };
  });
}

function getClientGroupKey(clientName: string): string {
  return clientName.trim().toLowerCase();
}

function getUniqueSortedValues(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

function getProjectLinkHref(value: string | null | undefined): string | null {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function getProjectLinkLabel(value: string | null | undefined): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "-";
  return trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/$/, "");
}

type SearchableDropdownInputProps = {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
  emptyMessage: string;
};

type DropdownPanelStyle = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

function SearchableDropdownInput({
  value,
  onChange,
  options,
  placeholder,
  emptyMessage,
}: SearchableDropdownInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<DropdownPanelStyle | null>(null);

  const normalizedOptions = useMemo(() => getUniqueSortedValues(options), [options]);
  const filteredOptions = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (!query) return normalizedOptions;
    return normalizedOptions.filter((option) => option.toLowerCase().includes(query));
  }, [normalizedOptions, value]);
  const hasExactMatch = normalizedOptions.some((option) => option.toLowerCase() === value.trim().toLowerCase());

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    const updatePanelPosition = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect) return;

      setPanelStyle({
        top: rect.bottom + 8,
        left: rect.left,
        width: rect.width,
        maxHeight: Math.max(120, Math.min(240, window.innerHeight - rect.bottom - 16)),
      });
    };

    updatePanelPosition();
    const frame = requestAnimationFrame(updatePanelPosition);
    const handleViewportChange = () => updatePanelPosition();

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setPanelStyle(null);
    }
  }, [open]);

  const dropdownPanel = open && panelStyle
    ? createPortal(
      <div
        ref={panelRef}
        className="overflow-hidden rounded-xl border border-border bg-background shadow-lg"
        style={{
          position: "fixed",
          top: panelStyle.top,
          left: panelStyle.left,
          width: panelStyle.width,
          zIndex: 260,
        }}
      >
        <div className="overflow-y-auto p-1" style={{ maxHeight: panelStyle.maxHeight }}>
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                  option.toLowerCase() === value.trim().toLowerCase() ? "bg-muted/70" : ""
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
              >
                {option}
              </button>
            ))
          ) : (
            <p className="px-3 py-2 text-sm text-muted-foreground">{emptyMessage}</p>
          )}
        </div>

        {value.trim() && !hasExactMatch && (
          <div className="border-t px-3 py-2 text-xs text-muted-foreground">
            Use typed value: <span className="font-medium text-foreground">{value.trim()}</span>
          </div>
        )}
      </div>,
      document.body,
    )
    : null;

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative w-full">
        <Input
          ref={inputRef}
          value={value}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            onChange(e.target.value);
            if (!open) setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
            }
            if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          autoComplete="off"
          placeholder={placeholder}
          className="pr-10"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground hover:bg-muted/60"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (open) {
              setOpen(false);
              return;
            }
            setOpen(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </Button>
      </div>

      {dropdownPanel}
    </div>
  );
}

export default function ClientCreds() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: users } = useUsers();

  const [projects, setProjects] = useState<ClientCredProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasClientCredsAccess, setHasClientCredsAccess] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [formState, setFormState] = useState<ProjectFormState>(emptyFormState());
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [formError, setFormError] = useState("");
  const [accessSearch, setAccessSearch] = useState("");

  const [accessDialogOpen, setAccessDialogOpen] = useState(false);
  const [accessProjectId, setAccessProjectId] = useState<number | null>(null);
  const [manageAccessMap, setManageAccessMap] = useState<AccessMap>({});
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const allowedUsers = useMemo(() => {
    return (users || []).filter(
      (member) => (member.role === "admin" || !!member.allowClientCreds) && member.id !== user?.id,
    );
  }, [users, user?.id]);

  const groupedClients = useMemo<ClientGroup[]>(() => {
    const groups = new Map<string, ClientGroup>();

    projects.forEach((project) => {
      const key = getClientGroupKey(project.clientName);
      const existing = groups.get(key);
      const credentialCount = buildRowsFromProject(project).length;

      if (existing) {
        existing.projects.push(project);
        existing.credentialCount += credentialCount;
      } else {
        groups.set(key, {
          key,
          clientName: project.clientName,
          projects: [project],
          credentialCount,
        });
      }
    });

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        projects: [...group.projects].sort((a, b) => a.projectName.localeCompare(b.projectName)),
      }))
      .sort((a, b) => a.clientName.localeCompare(b.clientName));
  }, [projects]);

  const filteredClientGroups = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return groupedClients;

    return groupedClients
      .map((group) => {
        const matchesClient = group.clientName.toLowerCase().includes(query);
        const filteredProjects = group.projects.filter((project) => {
          if (matchesClient) return true;

          if (project.projectName.toLowerCase().includes(query)) return true;

          return buildRowsFromProject(project).some((row) => (
            row.via.toLowerCase().includes(query) ||
            row.value.toLowerCase().includes(query) ||
            row.password.toLowerCase().includes(query) ||
            getProjectLinkLabel(row.link).toLowerCase().includes(query)
          ));
        });

        if (filteredProjects.length === 0) return null;

        return {
          ...group,
          projects: filteredProjects,
          credentialCount: filteredProjects.reduce((total, project) => total + buildRowsFromProject(project).length, 0),
        };
      })
      .filter((group): group is ClientGroup => group !== null);
  }, [groupedClients, searchTerm]);

  const accessProject = projects.find((project) => project.id === accessProjectId) || null;
  const existingClientNames = useMemo(
    () => getUniqueSortedValues(groupedClients.map((group) => group.clientName)),
    [groupedClients],
  );
  const projectNameOptions = useMemo(() => {
    const selectedClientKey = getClientGroupKey(formState.clientName);
    const selectedGroup = groupedClients.find((group) => group.key === selectedClientKey);
    const source = selectedGroup
      ? selectedGroup.projects.map((project) => project.projectName)
      : projects.map((project) => project.projectName);
    return getUniqueSortedValues(source);
  }, [formState.clientName, groupedClients, projects]);
  const viaOptions = useMemo(() => {
    const unique = ["Email", "Phone"];
    projects.forEach((project) => {
      project.viaChannels.forEach((via) => {
        const normalized = via.trim();
        if (normalized) unique.push(normalized);
      });
    });
    return getUniqueSortedValues(unique);
  }, [projects]);

  const loadProjects = async () => {
    try {
      setIsLoading(true);
      const res = await fetch(api.clientCreds.list.path, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setProjects([]);
          setHasClientCredsAccess(false);
          return;
        }
        throw new Error("Failed to load client creds");
      }

      setHasClientCredsAccess(true);
      const data = await res.json() as { projects: ClientCredProject[] };
      const nextProjects = Array.isArray(data.projects) ? data.projects : [];
      setProjects(nextProjects);
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
    setAccessSearch("");
    setFormError("");
    setFormOpen(true);
  };

  const openEditProjectDialog = (project: ClientCredProject) => {
    setFormMode("edit");
    setEditingProjectId(project.id);
    setFormState({
      clientName: project.clientName,
      projectName: project.projectName,
      rows: buildRowsFromProject(project),
    });
    setAccessSearch("");
    setFormError("");
    setFormOpen(true);
  };

  const submitForm = async () => {
    const normalizedRows = formState.rows
      .map((row) => ({
        via: row.via.trim(),
        value: row.value.trim(),
        password: row.password.trim(),
        link: row.link.trim(),
      }))
      .filter((row) => row.via || row.value || row.password || row.link);

    const payload = {
      clientName: formState.clientName.trim(),
      projectName: formState.projectName.trim(),
      viaChannels: sanitizeValueList(normalizedRows.map((row) => row.via)),
      emails: sanitizeValueList(normalizedRows.map((row) => row.value)),
      passwords: sanitizeValueList(normalizedRows.map((row) => row.password)),
      links: normalizedRows.map((row) => row.link),
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
      setFormError("Each credential row requires a via type, a value, and a password.");
      return;
    }

    try {
      if (formMode === "create") {
        const members = buildMembersPayload(manageAccessMap);
        await apiRequest(api.clientCreds.createProject.method, api.clientCreds.createProject.path, {
          ...payload,
          members,
        });
        setFormOpen(false);
        await loadProjects();
      } else if (editingProjectId) {
        await apiRequest(
          api.clientCreds.updateProject.method,
          buildUrl(api.clientCreds.updateProject.path, { id: editingProjectId }),
          payload,
        );
        setFormOpen(false);
        await loadProjects();
      }
    } catch (error) {
      toast({
        title: formMode === "create" ? "Create failed" : "Update failed",
        description: error instanceof Error ? error.message : "Something went wrong.",
        variant: "destructive",
      });
    }
  };

  const openAccessDialog = (project: ClientCredProject) => {
    const initialMap: AccessMap = {};
    project.members.forEach((member) => {
      initialMap[member.userId] = member.access;
    });
    setAccessProjectId(project.id);
    setManageAccessMap(initialMap);
    setAccessSearch("");
    setAccessDialogOpen(true);
  };

  const saveAccess = async () => {
    if (!accessProject) return;
    try {
      await apiRequest(
        api.clientCreds.updateAccess.method,
        buildUrl(api.clientCreds.updateAccess.path, { id: accessProject.id }),
        { members: buildMembersPayload(manageAccessMap) },
      );
      setAccessDialogOpen(false);
      setAccessProjectId(null);
      await loadProjects();
    } catch {
      toast({
        title: "Access update failed",
        description: "Could not update client creds access.",
        variant: "destructive",
      });
    }
  };

  const openDeleteDialog = (project: ClientCredProject) => {
    if (!project.canDelete) return;
    setDeleteTarget({
      id: project.id,
      label: `${project.clientName} / ${project.projectName}`,
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
      await loadProjects();
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
  ) => {
    const query = accessSearch.trim().toLowerCase();
    const filteredUsers = allowedUsers.filter((member) => {
      if (!query) return !!mapState[member.id];
      return `${member.name} ${member.email}`.toLowerCase().includes(query);
    });

    return (
      <div className="space-y-3">
        <Input
          value={accessSearch}
          onChange={(e) => setAccessSearch(e.target.value)}
          placeholder="Search team member..."
          className="h-9"
        />
        <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {allowedUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users with client creds access found. Enable it from Team page.</p>
          ) : filteredUsers.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {query ? "No user found." : "No selected users yet. Search to add users."}
            </p>
          ) : (
            filteredUsers.map((member) => {
              const selectedAccess = mapState[member.id] || null;
              return (
                <div key={member.id} className="flex items-center gap-2 rounded-md border p-2">
                  <label className="flex min-w-0 flex-1 items-center gap-2">
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
                    <span className="truncate text-sm">{member.name}</span>
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
      </div>
    );
  };

  const closeForm = () => {
    setFormOpen(false);
    setAccessSearch("");
    setFormError("");
  };

  return (
    <>
      <div className="grid gap-4">
        <Card className="lg:h-[calc(100vh-10rem)] lg:overflow-hidden">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="h-4 w-4" />
                Client Creds
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Browse all clients and review their associated projects in one place.</p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
              <div className="relative w-full sm:min-w-[300px] sm:flex-1 sm:max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search client, project, email, via, link..."
                  className="pl-9"
                />
              </div>
              <Button type="button" onClick={openCreateDialog} className="w-full sm:w-auto">
                <Plus className="h-4 w-4" />
                New Client Creds
              </Button>
            </div>
          </CardHeader>

          <CardContent className="h-full min-h-0 overflow-hidden">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading client creds...</p>
            ) : !hasClientCredsAccess ? (
              <p className="text-sm text-muted-foreground">The Client Creds section is not enabled for your account.</p>
            ) : groupedClients.length === 0 ? (
              <p className="text-sm text-muted-foreground">Create a record to get started.</p>
            ) : filteredClientGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">No matching client creds found for your search.</p>
            ) : (
              <div className="flex h-full min-h-0 flex-col space-y-4">
                <div className="space-y-4 md:hidden">
                  {filteredClientGroups.map((group) => (
                    <div key={group.key} className="space-y-3">
                      <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
                        <p className="font-semibold">{group.clientName}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{group.projects.length} project(s)</p>
                      </div>

                      {group.projects.map((project) => (
                        <div key={project.id} className="rounded-xl border border-border/60 bg-background p-4 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-semibold">{project.projectName}</p>
                              {!project.canEdit && (
                                <span className="mt-2 inline-flex rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                                  Read only
                                </span>
                              )}
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 border">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-40">
                                {project.canDelete && (
                                  <DropdownMenuItem onClick={() => openAccessDialog(project)}>
                                    <ShieldCheck className="mr-2 h-4 w-4" />
                                    Access
                                  </DropdownMenuItem>
                                )}
                                {project.canEdit && (
                                  <DropdownMenuItem onClick={() => openEditProjectDialog(project)}>
                                    <Pencil className="mr-2 h-4 w-4" />
                                    Edit
                                  </DropdownMenuItem>
                                )}
                                {project.canDelete && (
                                  <DropdownMenuItem
                                    onClick={() => openDeleteDialog(project)}
                                    className="text-destructive focus:text-destructive"
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Delete
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>

                          <div className="mt-4 space-y-3">
                            {buildRowsFromProject(project).map((row, rowIndex) => (
                              <div key={`${project.id}-${rowIndex}`} className="rounded-lg border border-border/60 bg-muted/10 p-3">
                                <div className="grid gap-3 text-sm">
                                  <div>
                                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Via</p>
                                    <p className="mt-1 break-words">{row.via || "-"}</p>
                                  </div>
                                  <div>
                                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Email / Value</p>
                                    <p className="mt-1 break-all">{row.value || "-"}</p>
                                  </div>
                                  <div>
                                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Password</p>
                                    <p className="mt-1 break-all">{row.password || "-"}</p>
                                  </div>
                                  <div>
                                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Link</p>
                                    {getProjectLinkHref(row.link) ? (
                                      <a
                                        href={getProjectLinkHref(row.link) || undefined}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="mt-1 inline-flex max-w-full items-center gap-1 text-primary hover:underline"
                                        title={row.link || undefined}
                                      >
                                        <span className="truncate">{getProjectLinkLabel(row.link)}</span>
                                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                                      </a>
                                    ) : (
                                      <p className="mt-1 text-sm text-muted-foreground">-</p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>

                <div className="hidden min-h-0 max-h-[calc(100vh-18rem)] flex-1 overflow-auto border bg-background md:block">
                  <table className="min-w-[1080px] w-full border-separate border-spacing-0 text-sm">
                    <thead className="sticky top-0 z-10 bg-muted/30 backdrop-blur">
                      <tr>
                        <th className="border-b border-r border-border bg-muted/40 px-4 py-3 text-left font-semibold">Client</th>
                        <th className="border-b border-r border-border bg-muted/40 px-4 py-3 text-left font-semibold">Project</th>
                        <th className="border-b border-r border-border bg-muted/40 px-4 py-3 text-left font-semibold">Via</th>
                        <th className="border-b border-r border-border bg-muted/40 px-4 py-3 text-left font-semibold">Email / Value</th>
                        <th className="border-b border-r border-border bg-muted/40 px-4 py-3 text-left font-semibold">Password</th>
                        <th className="w-[170px] border-b border-r border-border bg-muted/40 px-3 py-3 text-left font-semibold">Link</th>
                        <th className="w-[72px] border-b border-border bg-muted/40 px-2 py-3 text-center font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredClientGroups.map((group) => {
                        const groupRowCount = group.projects.reduce((total, project) => total + buildRowsFromProject(project).length, 0);

                        return group.projects.map((project, projectIndex) => {
                          const rows = buildRowsFromProject(project);
                          const projectRowCount = rows.length;

                          return rows.map((row, rowIndex) => (
                            <tr key={`${group.key}-${project.id}-${rowIndex}`} className="align-top odd:bg-[#f8fafc] even:bg-[#eef2f7]">
                              {projectIndex === 0 && rowIndex === 0 && (
                                <td rowSpan={groupRowCount} className="border-b border-r border-border px-4 py-4 font-semibold whitespace-nowrap align-top">
                                  {group.clientName}
                                </td>
                              )}

                              {rowIndex === 0 && (
                                <td rowSpan={projectRowCount} className="border-b border-r border-border px-4 py-4 align-top">
                                  <div className="space-y-2">
                                    <p className="font-medium">{project.projectName}</p>
                                    {!project.canEdit && (
                                      <span className="inline-flex rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                                        Read only
                                      </span>
                                    )}
                                  </div>
                                </td>
                              )}

                              <td className="border-b border-r border-border px-4 py-4 whitespace-nowrap">{row.via || "-"}</td>
                              <td className="border-b border-r border-border px-4 py-4 break-all">{row.value || "-"}</td>
                              <td className="border-b border-r border-border px-4 py-4 break-all">
                                {row.password || "-"}
                              </td>

                              <td className="border-b border-r border-border px-3 py-3 align-top">
                                {getProjectLinkHref(row.link) ? (
                                  <a
                                    href={getProjectLinkHref(row.link) || undefined}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex max-w-[145px] items-center gap-1 text-xs text-primary hover:underline"
                                    title={row.link || undefined}
                                  >
                                    <span className="truncate">{getProjectLinkLabel(row.link)}</span>
                                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                                  </a>
                                ) : (
                                  <span className="text-xs text-muted-foreground">-</span>
                                )}
                              </td>

                              {rowIndex === 0 && (
                                <td rowSpan={projectRowCount} className="border-b border-border px-2 py-3 align-top">
                                  <div className="flex justify-center">
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 border">
                                          <MoreHorizontal className="h-4 w-4" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end" className="w-40">
                                        {project.canDelete && (
                                          <DropdownMenuItem onClick={() => openAccessDialog(project)}>
                                            <ShieldCheck className="mr-2 h-4 w-4" />
                                            Access
                                          </DropdownMenuItem>
                                        )}
                                        {project.canEdit && (
                                          <DropdownMenuItem onClick={() => openEditProjectDialog(project)}>
                                            <Pencil className="mr-2 h-4 w-4" />
                                            Edit
                                          </DropdownMenuItem>
                                        )}
                                        {project.canDelete && (
                                          <DropdownMenuItem
                                            onClick={() => openDeleteDialog(project)}
                                            className="text-destructive focus:text-destructive"
                                          >
                                            <Trash2 className="mr-2 h-4 w-4" />
                                            Delete
                                          </DropdownMenuItem>
                                        )}
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                </td>
                              )}
                            </tr>
                          ));
                        });
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60 p-3 sm:p-4" onClick={closeForm}>
          <div
            className="flex h-[min(88vh,760px)] w-full max-w-5xl flex-col overflow-hidden rounded-lg border bg-background shadow-2xl sm:w-[95vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b px-4 py-4 sm:px-6">
              <h3 className="text-lg font-semibold">{formMode === "create" ? "Create Client Credentials" : "Edit Client Credentials"}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {formMode === "create"
                  ? "Add a new project record or attach a new project to an existing client."
                  : "Update the selected project record and credential entries."}
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              <div className="space-y-5">
                <div className="grid gap-4 lg:grid-cols-2 xl:items-start">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Client Name</label>
                    <SearchableDropdownInput
                      value={formState.clientName}
                      onChange={(value) => {
                        setFormState((prev) => ({ ...prev, clientName: value }));
                        if (formError) setFormError("");
                      }}
                      options={existingClientNames}
                      placeholder="Type or select client name"
                      emptyMessage="No saved clients found. Keep typing to add a new client."
                    />
                    <p className="text-xs text-muted-foreground">Pick an existing client from the dropdown or type a new one.</p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Project Name</label>
                    <SearchableDropdownInput
                      value={formState.projectName}
                      onChange={(value) => {
                        setFormState((prev) => ({ ...prev, projectName: value }));
                        if (formError) setFormError("");
                      }}
                      options={projectNameOptions}
                      placeholder="Enter project name"
                      emptyMessage="No saved project names found. Keep typing to add a new project."
                    />
                    <p className="text-xs text-muted-foreground">
                      {formMode === "create"
                        ? "A client can have multiple projects. Pick an existing one or type a new project entry."
                        : "Pick an existing project name or type a new one."}
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">Credential Entries</p>
                      <p className="text-xs text-muted-foreground">Add each login method as a separate row, similar to a spreadsheet entry.</p>
                    </div>
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

                  <div className="rounded-lg border bg-background">
                    <div className="hidden grid-cols-[minmax(180px,1.1fr)_minmax(180px,1.35fr)_minmax(180px,1.15fr)_minmax(220px,1.25fr)_56px] gap-0 border-b bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid">
                      <div className="px-3 py-3">Via Type</div>
                      <div className="border-l px-3 py-3">Email / Value</div>
                      <div className="border-l px-3 py-3">Password</div>
                      <div className="border-l px-3 py-3">Link</div>
                      <div className="border-l px-3 py-3 text-center"> </div>
                    </div>

                    <div className="max-h-[360px] overflow-y-auto">
                      {formState.rows.map((row, index) => (
                        <div key={`via-row-${index}`} className="grid grid-cols-1 border-b last:border-b-0 md:grid-cols-[minmax(180px,1.1fr)_minmax(180px,1.35fr)_minmax(180px,1.15fr)_minmax(220px,1.25fr)_56px]">
                          <div className="border-b px-3 py-3 md:border-b-0 md:border-r">
                            <label className="mb-1 block text-xs font-medium text-muted-foreground md:hidden">Via Type</label>
                            <SearchableDropdownInput
                              value={row.via}
                              placeholder="Select or type via type"
                              options={viaOptions}
                              emptyMessage="No saved via types found. Keep typing to add one."
                              onChange={(value) =>
                                setFormState((prev) => ({
                                  ...prev,
                                  rows: prev.rows.map((entry, entryIndex) =>
                                    entryIndex === index ? { ...entry, via: value } : entry,
                                  ),
                                }))
                              }
                            />
                          </div>

                          <div className="border-b px-3 py-3 md:border-b-0 md:border-r">
                            <label className="mb-1 block text-xs font-medium text-muted-foreground md:hidden">Email / Value</label>
                            <Input
                              type="text"
                              value={row.value}
                              placeholder="client@example.com or phone/value"
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

                          <div className="border-b px-3 py-3 md:border-b-0 md:border-r">
                            <label className="mb-1 block text-xs font-medium text-muted-foreground md:hidden">Password</label>
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

                          <div className="border-b px-3 py-3 md:border-b-0 md:border-r">
                            <label className="mb-1 block text-xs font-medium text-muted-foreground md:hidden">Link</label>
                            <Input
                              type="text"
                              value={row.link}
                              placeholder="https://example.com"
                              onChange={(e) =>
                                setFormState((prev) => ({
                                  ...prev,
                                  rows: prev.rows.map((entry, entryIndex) =>
                                    entryIndex === index ? { ...entry, link: e.target.value } : entry,
                                  ),
                                }))
                              }
                            />
                          </div>

                          <div className="flex items-center justify-center px-2 py-3">
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
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {formMode === "create" && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Team Access</p>
                    {renderAccessPicker(manageAccessMap, setManageAccessMap)}
                  </div>
                )}

                {formError && <p className="text-xs text-destructive">{formError}</p>}
              </div>
            </div>

            <div className="border-t px-4 py-4 sm:px-6">
              <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
                <Button variant="outline" className="w-full sm:w-auto" onClick={closeForm}>Cancel</Button>
                <Button className="w-full sm:w-auto" onClick={() => void submitForm()}>
                  {formMode === "create" ? "Create Record" : "Save Changes"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {accessDialogOpen && accessProject && (
        <div
          className="fixed inset-0 z-[210] flex items-start justify-center overflow-y-auto bg-black/60 p-3 sm:items-center sm:p-4"
          onClick={() => {
            setAccessDialogOpen(false);
            setAccessProjectId(null);
          }}
        >
          <div
            className="mt-6 max-h-[95vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-background p-4 sm:mt-0 sm:w-[95vw] sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 text-lg font-semibold">Manage Client Creds Access</h3>
            <p className="mb-3 text-sm text-muted-foreground">{accessProject.clientName} / {accessProject.projectName}</p>
            {renderAccessPicker(manageAccessMap, setManageAccessMap)}
            <div className="flex flex-col-reverse justify-end gap-2 pt-3 sm:flex-row">
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => {
                  setAccessDialogOpen(false);
                  setAccessProjectId(null);
                }}
              >
                Cancel
              </Button>
              <Button className="w-full sm:w-auto" onClick={() => void saveAccess()}>Save Access</Button>
            </div>
          </div>
        </div>
      )}

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => (!open ? setDeleteTarget(null) : undefined)}>
        <DialogContent className="fixed !left-1/2 !top-1/2 w-[calc(100vw-2rem)] !-translate-x-1/2 !-translate-y-1/2 sm:w-full sm:max-w-[420px]">
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
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
