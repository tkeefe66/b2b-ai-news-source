import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Folder, FileText, Presentation, Film, ChevronLeft, Loader2 } from "lucide-react";
import { SiGoogledrive } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: string;
  modifiedTime: string;
  iconLink: string;
}

interface GoogleDrivePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFileSelected: (file: File) => void;
  accept?: string[];
}

function formatFileSize(bytes: string): string {
  const b = parseInt(bytes);
  if (!b || isNaN(b)) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(d: string): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getFileIcon(mimeType: string) {
  if (mimeType === "application/vnd.google-apps.folder") return <Folder className="h-4 w-4 text-blue-500" />;
  if (mimeType.includes("presentation") || mimeType.includes("google-apps.presentation")) return <Presentation className="h-4 w-4 text-orange-500" />;
  if (mimeType.includes("video")) return <Film className="h-4 w-4 text-purple-500" />;
  return <FileText className="h-4 w-4 text-blue-600" />;
}

function isFolder(mimeType: string) {
  return mimeType === "application/vnd.google-apps.folder";
}

export function GoogleDrivePickerButton({
  onFileSelected,
  accept,
  variant = "outline",
  size = "sm",
  className = "",
  children,
}: {
  onFileSelected: (file: File) => void;
  accept?: string[];
  variant?: "outline" | "default" | "ghost";
  size?: "sm" | "default" | "lg" | "icon";
  className?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        onClick={() => setOpen(true)}
        data-testid="button-google-drive-picker"
      >
        {children || (
          <>
            <SiGoogledrive className="h-3.5 w-3.5 mr-1.5" />
            Google Drive
          </>
        )}
      </Button>
      <GoogleDrivePicker
        open={open}
        onOpenChange={setOpen}
        onFileSelected={onFileSelected}
        accept={accept}
      />
    </>
  );
}

export function GoogleDrivePicker({ open, onOpenChange, onFileSelected, accept }: GoogleDrivePickerProps) {
  const { toast } = useToast();
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);
  const [folderStack, setFolderStack] = useState<Array<{ id: string; name: string }>>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  const currentFolderId = folderStack.length > 0 ? folderStack[folderStack.length - 1].id : undefined;

  const fetchFiles = useCallback(async (query?: string, folderId?: string, pageToken?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (folderId) params.set("folderId", folderId);
      if (pageToken) params.set("pageToken", pageToken);
      const res = await fetch(`/api/google-drive/files?${params.toString()}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to load files");
      }
      const data = await res.json();
      if (pageToken) {
        setFiles(prev => [...prev, ...data.files]);
      } else {
        setFiles(data.files);
      }
      setNextPageToken(data.nextPageToken);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setFiles([]);
      setSearchQuery("");
      setFolderStack([]);
      setNextPageToken(undefined);
      fetchFiles();
    }
  }, [open, fetchFiles]);

  const handleSearch = (value: string) => {
    setSearchQuery(value);
    if (searchTimeout) clearTimeout(searchTimeout);
    const timeout = setTimeout(() => {
      setFiles([]);
      setNextPageToken(undefined);
      fetchFiles(value || undefined, currentFolderId);
    }, 400);
    setSearchTimeout(timeout);
  };

  const navigateToFolder = (file: DriveFile) => {
    setFolderStack(prev => [...prev, { id: file.id, name: file.name }]);
    setFiles([]);
    setSearchQuery("");
    setNextPageToken(undefined);
    fetchFiles(undefined, file.id);
  };

  const navigateBack = () => {
    const newStack = folderStack.slice(0, -1);
    setFolderStack(newStack);
    setFiles([]);
    setSearchQuery("");
    setNextPageToken(undefined);
    const parentId = newStack.length > 0 ? newStack[newStack.length - 1].id : undefined;
    fetchFiles(undefined, parentId);
  };

  const isFileAccepted = (file: DriveFile): boolean => {
    if (!accept || accept.length === 0) return true;
    const name = file.name.toLowerCase();
    const mime = file.mimeType;
    return accept.some(a => {
      if (a.startsWith(".")) return name.endsWith(a);
      return mime.includes(a);
    });
  };

  const selectFile = async (file: DriveFile) => {
    if (!isFileAccepted(file) && !isFolder(file.mimeType)) {
      toast({ title: "Unsupported file type", description: `This upload accepts: ${accept?.join(", ")}`, variant: "destructive" });
      return;
    }
    setDownloading(file.id);
    try {
      const res = await fetch("/api/google-drive/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: file.id }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Download failed");
      }
      const data = await res.json();
      const binaryStr = atob(data.data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: data.mimeType });
      const localFile = new File([blob], data.name, { type: data.mimeType });

      onFileSelected(localFile);
      onOpenChange(false);
      toast({ title: "File imported from Google Drive", description: data.name });
    } catch (err: any) {
      toast({ title: "Failed to import file", description: err.message, variant: "destructive" });
    } finally {
      setDownloading(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SiGoogledrive className="h-4 w-4" />
            Import from Google Drive
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2">
          {folderStack.length > 0 && (
            <Button variant="ghost" size="sm" onClick={navigateBack} className="shrink-0" aria-label="Back to parent folder" data-testid="button-drive-back">
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder={folderStack.length > 0 ? `Search in ${folderStack[folderStack.length - 1].name}...` : "Search Google Drive..."}
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
              aria-label="Search Google Drive"
              data-testid="input-drive-search"
            />
          </div>
        </div>

        {folderStack.length > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <button type="button" className="cursor-pointer hover:text-foreground" onClick={() => { setFolderStack([]); setFiles([]); setNextPageToken(undefined); fetchFiles(); }}>
              My Drive
            </button>
            {folderStack.map((f, i) => (
              <span key={f.id} className="flex items-center gap-1">
                <span>/</span>
                {i === folderStack.length - 1 ? (
                  <span className="text-foreground font-medium">{f.name}</span>
                ) : (
                  <button
                    type="button"
                    className="cursor-pointer hover:text-foreground"
                    onClick={() => {
                      const newStack = folderStack.slice(0, i + 1);
                      setFolderStack(newStack);
                      setFiles([]);
                      setNextPageToken(undefined);
                      fetchFiles(undefined, newStack[newStack.length - 1].id);
                    }}
                  >
                    {f.name}
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-auto min-h-[200px] max-h-[400px]">
          {error ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-4">
              <p className="text-sm text-destructive mb-2">{error}</p>
              <Button variant="outline" size="sm" onClick={() => fetchFiles(searchQuery || undefined, currentFolderId)}>
                Retry
              </Button>
            </div>
          ) : loading && files.length === 0 ? (
            <div className="space-y-2 p-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-2">
                  <Skeleton className="h-4 w-4 rounded" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-4">
              <p className="text-sm text-muted-foreground">No files found</p>
            </div>
          ) : (
            <div className="space-y-0.5 p-1">
              {files.map((file) => {
                const accepted = isFolder(file.mimeType) || isFileAccepted(file);
                return (
                <button
                  key={file.id}
                  className={`w-full flex items-center gap-3 p-2 rounded-md transition-colors text-left ${accepted ? "hover:bg-muted/50" : "opacity-40 cursor-not-allowed"} disabled:opacity-50`}
                  onClick={() => isFolder(file.mimeType) ? navigateToFolder(file) : selectFile(file)}
                  disabled={downloading !== null || !accepted}
                  data-testid={`drive-file-${file.id}`}
                >
                  {downloading === file.id ? (
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  ) : (
                    getFileIcon(file.mimeType)
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{file.name}</p>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      {file.modifiedTime && <span>{formatDate(file.modifiedTime)}</span>}
                      {!isFolder(file.mimeType) && file.size !== "0" && (
                        <span>{formatFileSize(file.size)}</span>
                      )}
                    </div>
                  </div>
                  {isFolder(file.mimeType) && (
                    <Badge variant="outline" className="text-[9px] shrink-0">Folder</Badge>
                  )}
                </button>
                );
              })}
              {nextPageToken && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full mt-2"
                  onClick={() => fetchFiles(searchQuery || undefined, currentFolderId, nextPageToken)}
                  disabled={loading}
                  data-testid="button-drive-load-more"
                >
                  {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                  Load more
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
