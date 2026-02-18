import { useEffect, useMemo, useState, type ChangeEvent, type Dispatch, type SetStateAction } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useUsers } from "@/hooks/use-users";
import { api, buildUrl } from "@shared/routes";
import { apiRequest } from "@/lib/queryClient";
import { FileImage, FileText, Files, FolderPlus, Upload, Eye, Download, Trash2, X, ShieldCheck } from "lucide-react";

type StoredFile = {
  id: number;
  projectId: number;
  name: string;
  type: string;
  size: number;
  createdAt: string | Date | null;
  dataUrl: string;
};

type ProjectMember = {
  userId: number;
  name: string;
  access: "view" | "edit";
};

type StorageProject = {
  id: number;
  name: string;
  createdAt: string | Date | null;
  files: StoredFile[];
  canEdit: boolean;
  canDelete: boolean;
  members: ProjectMember[];
};

type AccessMap = Record<number, "view" | "edit" | null>;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, idx);
  return `${value.toFixed(value >= 100 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function formatQuotaPercent(used: number, quota: number): string {
  if (!Number.isFinite(used) || !Number.isFinite(quota) || quota <= 0) return "0%";
  const percent = (used / quota) * 100;
  if (percent > 0 && percent < 0.01) return "<0.01%";
  if (percent < 10) return `${percent.toFixed(2)}%`;
  return `${percent.toFixed(1)}%`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export default function Storage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: users } = useUsers();

  const [projects, setProjects] = useState<StorageProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [previewFile, setPreviewFile] = useState<StoredFile | null>(null);
  const [quotaBytes, setQuotaBytes] = useState<number>(1024 * 1024 * 1024);
  const [usedBytes, setUsedBytes] = useState<number>(0);
  const [hasStorageAccess, setHasStorageAccess] = useState(true);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createProjectName, setCreateProjectName] = useState("");
  const [createProjectError, setCreateProjectError] = useState("");
  const [createAccessMap, setCreateAccessMap] = useState<AccessMap>({});

  const [accessDialogOpen, setAccessDialogOpen] = useState(false);
  const [manageAccessMap, setManageAccessMap] = useState<AccessMap>({});

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null;

  const storageAllowedUsers = useMemo(() => {
    return (users || []).filter((member) => !!member.allowStorage && member.id !== user?.id);
  }, [users, user?.id]);

  const projectUsageById = useMemo(() => {
    return projects.reduce<Record<number, number>>((acc, project) => {
      acc[project.id] = project.files.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
      return acc;
    }, {});
  }, [projects]);

  const loadStorage = async (preferredProjectId?: number | null) => {
    try {
      setIsLoading(true);
      const res = await fetch(api.storage.list.path, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 401) {
          setProjects([]);
          setSelectedProjectId(null);
          setHasStorageAccess(false);
          return;
        }
        if (res.status === 403) {
          setProjects([]);
          setSelectedProjectId(null);
          setHasStorageAccess(false);
          return;
        }
        throw new Error("Failed to load storage");
      }
      setHasStorageAccess(true);

      const data = await res.json() as {
        projects: StorageProject[];
        usedBytes: number;
        quotaBytes: number;
      };

      const nextProjects = Array.isArray(data.projects) ? data.projects : [];
      setProjects(nextProjects);
      setUsedBytes(Number(data.usedBytes) || 0);
      setQuotaBytes(Number(data.quotaBytes) || 1024 * 1024 * 1024);

      const candidateId = preferredProjectId ?? selectedProjectId;
      const hasCandidate = candidateId !== null && nextProjects.some((project) => project.id === candidateId);
      if (hasCandidate) {
        setSelectedProjectId(candidateId);
      } else {
        setSelectedProjectId(nextProjects[0]?.id ?? null);
      }
    } catch {
      toast({
        title: "Storage load failed",
        description: "Could not load shared storage data.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!user?.id) return;
    void loadStorage();
  }, [user?.id]);

  const buildMembersPayload = (source: AccessMap) => {
    return Object.entries(source)
      .map(([userId, access]) => ({ userId: Number(userId), access }))
      .filter((entry): entry is { userId: number; access: "view" | "edit" } =>
        Number.isFinite(entry.userId) && (entry.access === "view" || entry.access === "edit"),
      );
  };

  const openCreateProjectDialog = () => {
    setCreateProjectName("");
    setCreateProjectError("");
    setCreateAccessMap({});
    setCreateDialogOpen(true);
  };

  const createProject = async () => {
    const name = createProjectName.trim();
    if (!name) {
      setCreateProjectError("Project name is required.");
      return;
    }

    try {
      const members = buildMembersPayload(createAccessMap);
      const res = await apiRequest(api.storage.createProject.method, api.storage.createProject.path, { name, members });
      const created = await res.json() as { id: number };
      setCreateDialogOpen(false);
      await loadStorage(created?.id ?? null);
    } catch (err: any) {
      toast({
        title: "Create failed",
        description: err?.message || "Could not create project.",
        variant: "destructive",
      });
    }
  };

  const openManageAccessDialog = () => {
    if (!selectedProject) return;
    const initialMap: AccessMap = {};
    selectedProject.members.forEach((member) => {
      initialMap[member.userId] = member.access;
    });
    setManageAccessMap(initialMap);
    setAccessDialogOpen(true);
  };

  const saveManageAccess = async () => {
    if (!selectedProject) return;
    try {
      const members = buildMembersPayload(manageAccessMap);
      await apiRequest(
        api.storage.updateAccess.method,
        buildUrl(api.storage.updateAccess.path, { id: selectedProject.id }),
        { members },
      );
      setAccessDialogOpen(false);
      await loadStorage(selectedProject.id);
    } catch {
      toast({
        title: "Access update failed",
        description: "Could not update project access.",
        variant: "destructive",
      });
    }
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    if (!fileList || !selectedProject || !selectedProject.canEdit) return;

    setIsUploading(true);
    try {
      const incoming = Array.from(fileList);
      const prepared = await Promise.allSettled(
        incoming.map(async (file) => {
          const dataUrl = await readFileAsDataUrl(file);
          return {
            name: file.name,
            type: file.type || "application/octet-stream",
            size: file.size,
            dataUrl,
          };
        }),
      );

      const validPayloads = prepared
        .filter((item): item is PromiseFulfilledResult<{ name: string; type: string; size: number; dataUrl: string }> => item.status === "fulfilled")
        .map((item) => item.value);

      const uploadResults = await Promise.allSettled(
        validPayloads.map((payload) =>
          apiRequest(
            api.storage.addFile.method,
            buildUrl(api.storage.addFile.path, { id: selectedProject.id }),
            payload,
          ),
        ),
      );

      const uploadedCount = uploadResults.filter((result) => result.status === "fulfilled").length;
      if (uploadedCount === 0) {
        toast({
          title: "Upload failed",
          description: "Files could not be uploaded.",
          variant: "destructive",
        });
        return;
      }

      if (uploadedCount < incoming.length) {
        toast({
          title: "Partial upload",
          description: `${uploadedCount} of ${incoming.length} files uploaded.`,
        });
      }

      await loadStorage(selectedProject.id);
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  };

  const deleteProject = async (projectId: number) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project || !project.canDelete) return;

    const confirmed = window.confirm(`Delete project "${project.name}" and all its files?`);
    if (!confirmed) return;

    try {
      await apiRequest(api.storage.deleteProject.method, buildUrl(api.storage.deleteProject.path, { id: projectId }));
      await loadStorage(null);
    } catch {
      toast({
        title: "Delete failed",
        description: "Project could not be deleted.",
        variant: "destructive",
      });
    }
  };

  const deleteFile = async (fileId: number) => {
    if (!selectedProject || !selectedProject.canEdit) return;
    const file = selectedProject.files.find((f) => f.id === fileId);
    if (!file) return;

    const confirmed = window.confirm(`Delete file "${file.name}"?`);
    if (!confirmed) return;

    try {
      await apiRequest(api.storage.deleteFile.method, buildUrl(api.storage.deleteFile.path, { id: fileId }));
      await loadStorage(selectedProject.id);
    } catch {
      toast({
        title: "Delete failed",
        description: "File could not be deleted.",
        variant: "destructive",
      });
    }
  };

  const getFileIcon = (file: StoredFile) => {
    if (file.type.startsWith("image/")) {
      return <FileImage className="w-4 h-4 text-blue-500" />;
    }
    return <FileText className="w-4 h-4 text-muted-foreground" />;
  };

  const openFile = (file: StoredFile) => {
    setPreviewFile(file);
  };

  const renderPreview = () => {
    if (!previewFile) return null;
    if (previewFile.type.startsWith("image/")) {
      return (
        <img
          src={previewFile.dataUrl}
          alt={previewFile.name}
          className="w-full max-h-[70vh] object-contain rounded-md border"
        />
      );
    }
    if (previewFile.type === "application/pdf") {
      return (
        <iframe
          src={previewFile.dataUrl}
          title={previewFile.name}
          className="w-full h-[70vh] rounded-md border"
        />
      );
    }
    if (previewFile.type.startsWith("text/")) {
      return (
        <iframe
          src={previewFile.dataUrl}
          title={previewFile.name}
          className="w-full h-[70vh] rounded-md border bg-background"
        />
      );
    }
    return (
      <div className="rounded-md border p-4 text-sm text-muted-foreground">
        Preview not available for this file type. Please use Download.
      </div>
    );
  };

  const renderAccessPicker = (
    mapState: AccessMap,
    setMapState: Dispatch<SetStateAction<AccessMap>>,
  ) => (
    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
      {storageAllowedUsers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No users with storage access found. Enable it from Team page.</p>
      ) : (
        storageAllowedUsers.map((member) => {
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
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Projects</CardTitle>
            <p className="text-xs text-muted-foreground">
              Used by app: {formatBytes(usedBytes)} of {formatBytes(quotaBytes)} ({formatQuotaPercent(usedBytes, quotaBytes)})
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button type="button" className="w-full" onClick={openCreateProjectDialog}>
              <FolderPlus className="w-4 h-4" />
              New Project
            </Button>

            <div className="space-y-1">
              {projects.map((project) => {
                const active = project.id === selectedProjectId;
                const projectUsedBytes = projectUsageById[project.id] || 0;
                const projectPercent = quotaBytes > 0
                  ? Math.max(0, Math.min(100, (projectUsedBytes / quotaBytes) * 100))
                  : 0;
                const circleRadius = 14;
                const circleStroke = 3;
                const circumference = 2 * Math.PI * circleRadius;
                const dashOffset = circumference - (projectPercent / 100) * circumference;

                return (
                  <div
                    key={project.id}
                    className={`w-full rounded-lg border px-3 py-2 transition-colors ${active ? "bg-primary/10 border-primary/30" : "hover:bg-muted"
                      }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedProjectId(project.id)}
                        className="min-w-0 text-left flex-1"
                      >
                        <p className="text-sm font-medium truncate">{project.name}</p>
                        <p className="text-xs text-muted-foreground mt-1">{(project.files || []).length} files</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatBytes(projectUsedBytes)} of {formatBytes(quotaBytes)} ({formatQuotaPercent(projectUsedBytes, quotaBytes)} of quota)
                        </p>
                      </button>
                      <div className="shrink-0 relative w-9 h-9" title={`${formatQuotaPercent(projectUsedBytes, quotaBytes)} of quota`}>
                        <svg viewBox="0 0 36 36" className="w-9 h-9 -rotate-90">
                          <circle cx="18" cy="18" r={circleRadius} fill="none" stroke="hsl(var(--muted))" strokeWidth={circleStroke} />
                          <circle
                            cx="18"
                            cy="18"
                            r={circleRadius}
                            fill="none"
                            stroke="hsl(var(--primary))"
                            strokeWidth={circleStroke}
                            strokeLinecap="round"
                            strokeDasharray={circumference}
                            strokeDashoffset={dashOffset}
                          />
                        </svg>
                        <span className="absolute inset-0 flex items-center justify-center text-[9px] font-medium">
                          {projectPercent < 1 && projectPercent > 0 ? "<1" : Math.round(projectPercent)}
                        </span>
                      </div>
                      {project.canDelete && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => void deleteProject(project.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Files className="w-4 h-4" />
              {selectedProject ? selectedProject.name : "Storage"}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              {selectedProject?.canDelete && (
                <Button type="button" variant="secondary" onClick={openManageAccessDialog} className="w-full sm:w-auto">
                  <ShieldCheck className="w-4 h-4" />
                  Manage Access
                </Button>
              )}
              <label className="inline-flex w-full sm:w-auto">
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleUpload}
                  disabled={!selectedProject || !selectedProject.canEdit || isUploading || isLoading}
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,image/*"
                />
                <Button
                  asChild
                  type="button"
                  variant={selectedProject?.canEdit ? "default" : "outline"}
                  className={`w-full sm:w-auto ${!selectedProject || !selectedProject.canEdit ? "bg-muted text-muted-foreground border-border opacity-100" : ""}`}
                  disabled={!selectedProject || !selectedProject.canEdit || isUploading || isLoading}
                >
                  <span>
                    <Upload className="w-4 h-4" />
                    {isUploading ? "Uploading..." : "Add Files"}
                  </span>
                </Button>
              </label>
            </div>
          </CardHeader>

          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading shared storage...</p>
            ) : !hasStorageAccess ? (
              <p className="text-sm text-muted-foreground">Storage tab is disabled for your account.</p>
            ) : !selectedProject ? (
              <p className="text-sm text-muted-foreground">Create or choose a project to start.</p>
            ) : selectedProject.files.length === 0 ? (
              <div className="space-y-2">
                {!selectedProject.canEdit && (
                  <p className="text-xs text-muted-foreground">View-only access: Add/Delete actions are disabled for this project.</p>
                )}
                <p className="text-sm text-muted-foreground">No files yet. Upload documents, images, or PDFs.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {!selectedProject.canEdit && (
                  <p className="text-xs text-muted-foreground">View-only access: Add/Delete actions are disabled for this project.</p>
                )}
                {selectedProject.files.map((file) => (
                  <div key={file.id} className="rounded-lg border p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium flex items-center gap-2 truncate">
                        {getFileIcon(file)}
                        <span className="truncate">{file.name}</span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatBytes(file.size)} • {file.createdAt ? new Date(file.createdAt).toLocaleString() : "-"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => openFile(file)}>
                        <Eye className="w-4 h-4" />
                        View
                      </Button>
                      <a href={file.dataUrl} download={file.name} className="w-full sm:w-auto">
                        <Button size="sm" variant="secondary" type="button" className="w-full sm:w-auto">
                          <Download className="w-4 h-4" />
                          Download
                        </Button>
                      </a>
                      {selectedProject.canEdit && (
                        <Button size="sm" variant="destructive" className="w-full sm:w-auto" onClick={() => void deleteFile(file.id)}>
                          <Trash2 className="w-4 h-4" />
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {createDialogOpen && (
        <div className="fixed inset-0 z-[210] bg-black/60 p-3 sm:p-4 flex items-start sm:items-center justify-center overflow-y-auto" onClick={() => setCreateDialogOpen(false)}>
          <div
            className="w-full sm:w-[95vw] max-w-2xl max-h-[95vh] overflow-y-auto rounded-lg border bg-background p-4 sm:p-6 mt-6 sm:mt-0"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-3">Create Project</h3>
            <div className="space-y-3">
              <Input
                placeholder="Project name"
                value={createProjectName}
                onChange={(e) => {
                  setCreateProjectName(e.target.value);
                  if (createProjectError) setCreateProjectError("");
                }}
              />
              {createProjectError && <p className="text-xs text-destructive">{createProjectError}</p>}

              <p className="text-sm font-medium">Allow Users (View/Edit)</p>
              {renderAccessPicker(createAccessMap, setCreateAccessMap)}

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
                <Button variant="outline" className="w-full sm:w-auto" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
                <Button className="w-full sm:w-auto" onClick={() => void createProject()}>Create</Button>
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
            <h3 className="text-lg font-semibold mb-1">Manage Project Access</h3>
            <p className="text-sm text-muted-foreground mb-3">Project: {selectedProject.name}</p>
            {renderAccessPicker(manageAccessMap, setManageAccessMap)}
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-3">
              <Button variant="outline" className="w-full sm:w-auto" onClick={() => setAccessDialogOpen(false)}>Cancel</Button>
              <Button className="w-full sm:w-auto" onClick={() => void saveManageAccess()}>Save Access</Button>
            </div>
          </div>
        </div>
      )}

      {previewFile && (
        <div className="fixed inset-0 z-[200] bg-black/60 p-4 flex items-center justify-center" onClick={() => setPreviewFile(null)}>
          <div
            className="w-[95vw] max-w-5xl max-h-[90vh] overflow-y-auto rounded-lg border bg-background p-4 sm:p-6 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="absolute right-3 top-3 rounded-md p-1 hover:bg-muted"
              onClick={() => setPreviewFile(null)}
              aria-label="Close preview"
            >
              <X className="w-4 h-4" />
            </button>
            <h3 className="text-lg font-semibold truncate pr-10 mb-3">{previewFile.name}</h3>
            {renderPreview()}
          </div>
        </div>
      )}
    </>
  );
}
