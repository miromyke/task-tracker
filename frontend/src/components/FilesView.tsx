import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, Play, Upload } from "lucide-react";
import { Trans, useLingui, Plural } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { api, type Asset, type AssetKind, type Project, type User } from "@/lib/api";
import { useAuth } from "@/context/auth";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Lightbox } from "@/components/Lightbox";
import { displayName } from "@/lib/format";
import { cn } from "@/lib/utils";

// Sentinel for the "No project" choice in the upload picker (Select needs a
// non-empty string value).
const NO_PROJECT = "none";

// Filter Select values (Select needs non-empty strings): "all" = every kind,
// "deleted" = the admin soft-delete queue.
const ALL_KINDS = "all";
const DELETED = "deleted";

// Kind filter tabs. "" = all kinds.
const KIND_TABS: { value: AssetKind | ""; label: MessageDescriptor }[] = [
  { value: "", label: msg`All` },
  { value: "image", label: msg`Images` },
  { value: "video", label: msg`Videos` },
  { value: "document", label: msg`Docs` },
];

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
    setProject(projectId ? String(projectId) : NO_PROJECT);
    setFiles([]);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }, [open, projectId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // projectId (page is scoped to a project) wins; otherwise use the picker,
    // where NO_PROJECT means "upload without attaching to a project".
    const choice = projectId ? String(projectId) : project;
    if (!choice) return setError(t`Pick a project`);
    if (files.length === 0) return setError(t`Choose at least one file`);
    setBusy(true);
    setError(null);
    try {
      if (choice === NO_PROJECT) await api.uploadOrphanAssets(files);
      else await api.uploadAssets(Number(choice), files);
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
                  <SelectItem value={NO_PROJECT}>
                    <Trans>No project</Trans>
                  </SelectItem>
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

// FilesToolbar is the Files view's controls — the kind/Deleted filter strip plus
// the Add files button. It lives up in the page header (next to the project
// selector) rather than inside FilesView's body, so the page owns its state.
export function FilesToolbar({
  kind,
  pending,
  isAdmin,
  onKindChange,
  onPendingChange,
  onAdd,
}: {
  kind: AssetKind | "";
  pending: boolean;
  isAdmin: boolean;
  onKindChange: (k: AssetKind | "") => void;
  onPendingChange: (p: boolean) => void;
  onAdd: () => void;
}) {
  const { i18n } = useLingui();
  // "deleted" picks the admin soft-delete queue; otherwise a kind (or "all").
  const value = pending ? DELETED : kind || ALL_KINDS;
  function onChange(v: string) {
    if (v === DELETED) {
      onPendingChange(true);
      onKindChange("");
    } else {
      onPendingChange(false);
      onKindChange(v === ALL_KINDS ? "" : (v as AssetKind));
    }
  }
  return (
    <div className="flex items-center gap-2">
      {/* kind + deleted filter — desktop only; mobile keeps just the upload
          button. "Deleted" (admin only) shows the soft-delete queue. */}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="hidden h-9 w-36 sm:flex">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {KIND_TABS.map(({ value, label }) => (
            <SelectItem key={value || ALL_KINDS} value={value || ALL_KINDS}>
              {i18n._(label)}
            </SelectItem>
          ))}
          {isAdmin && (
            <SelectItem value={DELETED}>
              <Trans>Deleted</Trans>
            </SelectItem>
          )}
        </SelectContent>
      </Select>
      {!pending && (
        <Button onClick={onAdd}>
          <Upload className="h-4 w-4" />
          <Trans>Add files</Trans>
        </Button>
      )}
    </div>
  );
}

// FilesView is the Files tab of the overview: a grid of uploaded assets scoped to
// the page's selected project (projectId undefined = all projects). Project
// selection, the kind/Deleted filter, and the Add files action are owned by the
// page (see FilesToolbar) and passed in; tags don't apply here.
export function FilesView({
  projectId,
  projects,
  usersById,
  kind,
  pending,
  addOpen,
  onAddOpenChange,
}: {
  projectId?: number;
  projects: Project[];
  usersById?: Map<number, User>;
  kind: AssetKind | "";
  pending: boolean;
  addOpen: boolean;
  onAddOpenChange: (o: boolean) => void;
}) {
  const { t } = useLingui();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [assets, setAssets] = useState<Asset[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState<Asset | null>(null);
  const [confirmPurge, setConfirmPurge] = useState<Asset | null>(null);

  // Reload from the first page whenever the view/project/kind filter changes.
  // The lightbox indexes into the loaded list, so close it on any filter change.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLightbox(null);
    api
      .listAssets({ projectId, kind: kind || undefined, pending, page: 0 })
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
  }, [projectId, kind, pending, refreshKey]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const r = await api.listAssets({ projectId, kind: kind || undefined, pending, page });
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

  // Drop an asset from the current view after it moves out of it (deleted,
  // restored, or purged) and close the lightbox if it was showing.
  function removeFromView(id: number) {
    setAssets((prev) => prev.filter((a) => a.id !== id));
    setLightbox(null);
  }

  async function restore(a: Asset) {
    await api.restoreAsset(a.id);
    removeFromView(a.id);
  }

  return (
    <div className="space-y-4">
      {pending && assets.length > 0 && (
        <p className="text-sm text-muted-foreground">
          <Trans>
            These files are queued for deletion. Restore one to put it back, or delete it permanently to remove the
            file for good.
          </Trans>
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : assets.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          {pending ? <Trans>No deleted files.</Trans> : <Trans>No files yet.</Trans>}
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

      {lightbox !== null && assets[lightbox] && (
        <Lightbox
          assets={assets}
          index={lightbox}
          pending={pending}
          isAdmin={!!isAdmin}
          requesterName={(() => {
            const u = assets[lightbox].deletionRequestedBy
              ? usersById?.get(assets[lightbox].deletionRequestedBy!)
              : undefined;
            return u ? displayName(u) : undefined;
          })()}
          uploaderName={(() => {
            const u = usersById?.get(assets[lightbox].uploadedBy);
            return u ? displayName(u) : undefined;
          })()}
          projectName={
            assets[lightbox].projectId
              ? projects.find((p) => p.id === assets[lightbox].projectId)?.name
              : undefined
          }
          onClose={() => setLightbox(null)}
          onMove={moveLightbox}
          onRequestDelete={setConfirmDelete}
          onRestore={(a) => void restore(a)}
          onPurge={setConfirmPurge}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={t`Delete this file?`}
        description={t`It will be removed from Files.`}
        confirmLabel={t`Delete`}
        destructive
        onConfirm={async () => {
          if (!confirmDelete) return;
          await api.requestDeleteAsset(confirmDelete.id);
          removeFromView(confirmDelete.id);
        }}
      />

      <ConfirmDialog
        open={!!confirmPurge}
        onOpenChange={(o) => !o && setConfirmPurge(null)}
        title={t`Delete this file permanently?`}
        description={t`This removes the file and its data for good. This cannot be undone.`}
        confirmLabel={t`Delete permanently`}
        destructive
        onConfirm={async () => {
          if (!confirmPurge) return;
          await api.purgeAsset(confirmPurge.id);
          removeFromView(confirmPurge.id);
        }}
      />

      <AddFilesDialog
        open={addOpen}
        onOpenChange={onAddOpenChange}
        projectId={projectId}
        projects={projects}
        onUploaded={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}
