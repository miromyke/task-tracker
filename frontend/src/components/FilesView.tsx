import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FileText, Loader2, Play, Upload, X } from "lucide-react";
import { Trans, useLingui, Plural } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { api, type Asset, type AssetKind, type Project } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

// Kind filter tabs. "" = all kinds.
const KIND_TABS: { value: AssetKind | ""; label: MessageDescriptor }[] = [
  { value: "", label: msg`All` },
  { value: "image", label: msg`Images` },
  { value: "video", label: msg`Videos` },
  { value: "document", label: msg`Docs` },
];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

// A single tile in the grid: image/video thumbnail or a document card.
function AssetTile({ asset, onOpen }: { asset: Asset; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative aspect-square overflow-hidden rounded-lg border bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {asset.kind === "image" ? (
        <img src={asset.path} alt={asset.filename} loading="lazy" className="h-full w-full object-cover" />
      ) : asset.kind === "video" ? (
        <>
          <video src={asset.path} preload="metadata" muted playsInline className="h-full w-full object-cover" />
          <span className="absolute inset-0 grid place-items-center">
            <span className="rounded-full bg-black/50 p-2.5 text-white">
              <Play className="h-5 w-5 fill-current" />
            </span>
          </span>
        </>
      ) : (
        <span className="flex h-full flex-col items-center justify-center gap-2 p-3 text-muted-foreground">
          <FileText className="h-8 w-8" />
          <span className="line-clamp-2 break-all text-center text-[11px] leading-tight">{asset.filename}</span>
        </span>
      )}
      {/* filename caption */}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 text-left text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">
        {asset.filename}
      </span>
    </button>
  );
}

// Fullscreen viewer for a single asset, with prev/next across the loaded list.
function Lightbox({
  assets,
  index,
  onClose,
  onMove,
}: {
  assets: Asset[];
  index: number;
  onClose: () => void;
  onMove: (dir: 1 | -1) => void;
}) {
  const asset = assets[index];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") onMove(1);
      else if (e.key === "ArrowLeft") onMove(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onMove]);

  if (!asset) return null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        hideClose
        className="flex h-[92vh] max-w-5xl flex-col gap-0 border-0 bg-neutral-900 p-0 text-neutral-50"
      >
        {/* top bar */}
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <DialogTitle className="truncate text-sm font-semibold">{asset.filename}</DialogTitle>
            <div className="text-xs text-white/60">
              {formatBytes(asset.size)} · {formatDateTime(asset.createdAt)}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <a
              href={`${asset.path}?download=1`}
              className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white"
              aria-label="Download"
            >
              <Download className="h-5 w-5" />
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* media */}
        <div className="relative min-h-0 flex-1">
          {asset.kind === "image" ? (
            <img src={asset.path} alt={asset.filename} className="absolute inset-0 m-auto max-h-full max-w-full object-contain" />
          ) : asset.kind === "video" ? (
            <video src={asset.path} controls autoPlay playsInline className="absolute inset-0 m-auto max-h-full max-w-full object-contain" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
              <FileText className="h-16 w-16 text-white/50" />
              <a href={`${asset.path}?download=1`}>
                <Button variant="secondary">
                  <Download className="h-4 w-4" />
                  <Trans>Download file</Trans>
                </Button>
              </a>
            </div>
          )}

          {index > 0 && (
            <button
              type="button"
              onClick={() => onMove(-1)}
              aria-label="Previous"
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white/90 hover:bg-white/20"
            >
              <ChevronLeft className="h-7 w-7" />
            </button>
          )}
          {index < assets.length - 1 && (
            <button
              type="button"
              onClick={() => onMove(1)}
              aria-label="Next"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white/90 hover:bg-white/20"
            >
              <ChevronRight className="h-7 w-7" />
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// AddFilesDialog uploads one or more files to a project. When no project is
// selected on the page (all-projects view), it asks which project to add to.
function AddFilesDialog({
  open,
  onOpenChange,
  projectId,
  projects,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId?: number;
  projects: Project[];
  onUploaded: () => void;
}) {
  const { t } = useLingui();
  const [project, setProject] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setProject(projectId ? String(projectId) : "");
    setFiles([]);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }, [open, projectId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pid = projectId || Number(project);
    if (!pid) return setError(t`Pick a project`);
    if (files.length === 0) return setError(t`Choose at least one file`);
    setBusy(true);
    setError(null);
    try {
      await api.uploadAssets(pid, files);
      onUploaded();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not upload files`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>Add files</Trans>
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          {!projectId && (
            <div className="space-y-2">
              <Label>
                <Trans>Project</Trans>
              </Label>
              <Select value={project} onValueChange={setProject}>
                <SelectTrigger>
                  <SelectValue placeholder={t`Select a project`} />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="files">
              <Trans>Files</Trans>
            </Label>
            <input
              id="files"
              ref={inputRef}
              type="file"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
            />
            {files.length > 0 && (
              <p className="text-xs text-muted-foreground">
                <Plural value={files.length} one="# file selected" other="# files selected" />
              </p>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              <Trans>Cancel</Trans>
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              <Trans>Upload</Trans>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// FilesView is the Files tab of the overview: a grid of uploaded assets scoped to
// the page's selected project (projectId undefined = all projects). Project
// selection and tag filtering are owned by the overview; tags don't apply here.
export function FilesView({ projectId, projects }: { projectId?: number; projects: Project[] }) {
  const { i18n } = useLingui();
  const [kind, setKind] = useState<AssetKind | "">("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Reload from the first page whenever the project/kind filter or refresh changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listAssets({ projectId, kind: kind || undefined, page: 0 })
      .then((r) => {
        if (cancelled) return;
        setAssets(r.assets);
        setHasMore(r.hasMore);
        setPage(1);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, kind, refreshKey]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const r = await api.listAssets({ projectId, kind: kind || undefined, page });
      setAssets((prev) => [...prev, ...r.assets]);
      setHasMore(r.hasMore);
      setPage((p) => p + 1);
    } finally {
      setLoadingMore(false);
    }
  }

  function moveLightbox(dir: 1 | -1) {
    setLightbox((i) => {
      if (i === null) return i;
      const n = i + dir;
      return n >= 0 && n < assets.length ? n : i;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        {/* kind tabs */}
        <div className="inline-flex rounded-md border p-0.5">
          {KIND_TABS.map(({ value, label }) => (
            <button
              key={value || "all"}
              type="button"
              onClick={() => setKind(value)}
              className={cn(
                "rounded px-3 py-1 text-sm font-medium transition-colors",
                kind === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {i18n._(label)}
            </button>
          ))}
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Upload className="h-4 w-4" />
          <span className="hidden sm:inline">
            <Trans>Add files</Trans>
          </span>
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : assets.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          <Trans>No files yet.</Trans>
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 md:grid-cols-6">
            {assets.map((a, i) => (
              <AssetTile key={a.id} asset={a} onOpen={() => setLightbox(i)} />
            ))}
          </div>
          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                <Trans>Load more</Trans>
              </Button>
            </div>
          )}
        </>
      )}

      {lightbox !== null && (
        <Lightbox assets={assets} index={lightbox} onClose={() => setLightbox(null)} onMove={moveLightbox} />
      )}

      <AddFilesDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        projectId={projectId}
        projects={projects}
        onUploaded={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}
