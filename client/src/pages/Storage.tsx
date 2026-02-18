import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { api, buildUrl } from "@shared/routes";
import { apiRequest } from "@/lib/queryClient";
import { FileImage, FileText, Files, FolderPlus, Upload, Eye, Download, Trash2, X } from "lucide-react";

type StoredFile = {
  id: number;
  projectId: number;
  name: string;
  type: string;
  size: number;
  createdAt: string | Date | null;
  dataUrl: string;
};

type StorageProject = {
  id: number;
  name: string;
  createdAt: string | Date | null;
  files: StoredFile[];
};

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

  const [projects, setProjects] = useState<StorageProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [projectNameError, setProjectNameError] = useState("");
  const [previewFile, setPreviewFile] = useState<StoredFile | null>(null);
  const [quotaBytes, setQuotaBytes] = useState<number>(1024 * 1024 * 1024);
  const [usedBytes, setUsedBytes] = useState<number>(0);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null;

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
          return;
        }
        throw new Error("Failed to load storage");
      }

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

  const createProject = async () => {
    const name = newProjectName.trim();
    if (!name) {
      setProjectNameError("Project name is required.");
      return;
    }

    try {
      const res = await apiRequest(api.storage.createProject.method, api.storage.createProject.path, { name });
      const created = await res.json() as { id: number };
      setNewProjectName("");
      setProjectNameError("");
      await loadStorage(created?.id ?? null);
    } catch (err: any) {
      toast({
        title: "Create failed",
        description: err?.message || "Could not create project.",
        variant: "destructive",
      });
    }
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    if (!fileList || !selectedProject) return;

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
    if (!project) return;

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
    if (!selectedProject) return;
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

  return (
    <>
      <div className="grid gap-4 md:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Projects</CardTitle>
            <p className="text-xs text-muted-foreground">
              Used by app: {formatBytes(usedBytes)} of {formatBytes(quotaBytes)} ({formatQuotaPercent(usedBytes, quotaBytes)})
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="New project name"
                value={newProjectName}
                onChange={(e) => {
                  setNewProjectName(e.target.value);
                  if (projectNameError) setProjectNameError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createProject();
                }}
              />
              <Button type="button" size="icon" onClick={() => void createProject()} disabled={!newProjectName.trim()}>
                <FolderPlus className="w-4 h-4" />
              </Button>
            </div>
            {projectNameError && <p className="text-xs text-destructive">{projectNameError}</p>}

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
                          <circle
                            cx="18"
                            cy="18"
                            r={circleRadius}
                            fill="none"
                            stroke="hsl(var(--muted))"
                            strokeWidth={circleStroke}
                          />
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
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => void deleteProject(project.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Files className="w-4 h-4" />
              {selectedProject ? selectedProject.name : "Storage"}
            </CardTitle>
            <label className="inline-flex">
              <input
                type="file"
                multiple
                className="hidden"
                onChange={handleUpload}
                disabled={!selectedProject || isUploading || isLoading}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,image/*"
              />
              <Button asChild type="button" disabled={!selectedProject || isUploading || isLoading}>
                <span>
                  <Upload className="w-4 h-4" />
                  {isUploading ? "Uploading..." : "Add Files"}
                </span>
              </Button>
            </label>
          </CardHeader>

          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading shared storage...</p>
            ) : !selectedProject ? (
              <p className="text-sm text-muted-foreground">Create or choose a project to start.</p>
            ) : selectedProject.files.length === 0 ? (
              <p className="text-sm text-muted-foreground">No files yet. Upload documents, images, or PDFs.</p>
            ) : (
              <div className="space-y-2">
                {selectedProject.files.map((file) => (
                  <div key={file.id} className="rounded-lg border p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium flex items-center gap-2 truncate">
                        {getFileIcon(file)}
                        <span className="truncate">{file.name}</span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatBytes(file.size)} • {file.createdAt ? new Date(file.createdAt).toLocaleString() : "-"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => openFile(file)}>
                        <Eye className="w-4 h-4" />
                        View
                      </Button>
                      <a href={file.dataUrl} download={file.name}>
                        <Button size="sm" variant="secondary" type="button">
                          <Download className="w-4 h-4" />
                          Download
                        </Button>
                      </a>
                      <Button size="sm" variant="destructive" onClick={() => void deleteFile(file.id)}>
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {previewFile && (
        <div
          className="fixed inset-0 z-[200] bg-black/60 p-4 flex items-center justify-center"
          onClick={() => setPreviewFile(null)}
        >
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
