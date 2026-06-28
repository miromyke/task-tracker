import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Download, FileText, RotateCcw, Trash2, X } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { Asset } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/format";

export function formatBytes(n: number): string {
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

// UploadContext renders where a file came from — a link to its task or the chat,
// the project name, or a plain "Files" for a direct upload. Context is inferred
// from the asset's ids (task/project) and its source marker ("chat").
function UploadContext({ asset, projectName }: { asset: Asset; projectName?: string }) {
  const linkCls = "underline decoration-white/30 underline-offset-2 hover:text-white";
  if (asset.taskId) {
    return (
      <Link to={`/tasks/${asset.taskId}`} className={linkCls}>
        <Trans>Task</Trans>
      </Link>
    );
  }
  if (asset.projectId) {
    return projectName ? (
      <span>
        <Trans>Project: {projectName}</Trans>
      </span>
    ) : (
      <Trans>Project</Trans>
    );
  }
  if (asset.source === "chat") {
    return <Trans>Chat</Trans>;
  }
  return <Trans>Files</Trans>;
}

// Fullscreen viewer for a single asset. Navigation (prev/next across `assets`) is
// enabled only when `onMove` is supplied; the soft-delete/restore/purge actions
// only render when their callbacks are supplied (the Files view passes them, chat
// does not). This keeps one viewer shared across the Files page and chat.
export function Lightbox({
  assets,
  index,
  onClose,
  onMove,
  uploaderName,
  projectName,
  pending,
  isAdmin,
  requesterName,
  onRequestDelete,
  onRestore,
  onPurge,
}: {
  assets: Asset[];
  index: number;
  onClose: () => void;
  onMove?: (dir: 1 | -1) => void;
  uploaderName?: string;
  projectName?: string;
  pending?: boolean;
  isAdmin?: boolean;
  requesterName?: string;
  onRequestDelete?: (a: Asset) => void;
  onRestore?: (a: Asset) => void;
  onPurge?: (a: Asset) => void;
}) {
  const { t } = useLingui();
  const asset = assets[index];

  useEffect(() => {
    if (!onMove) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") onMove!(1);
      else if (e.key === "ArrowLeft") onMove!(-1);
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
              {uploaderName && (
                <>
                  {" · "}
                  <Trans>Uploaded by {uploaderName}</Trans>
                </>
              )}
              {" · "}
              <UploadContext asset={asset} projectName={projectName} />
              {pending && asset.deletionRequestedAt && (
                <>
                  {" · "}
                  <span className="text-amber-300/80">
                    {requesterName ? (
                      <Trans>Deletion requested by {requesterName}</Trans>
                    ) : (
                      <Trans>Deletion requested</Trans>
                    )}
                  </span>
                </>
              )}
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
            {pending ? (
              <>
                {onRestore && (
                  <button
                    type="button"
                    onClick={() => onRestore(asset)}
                    className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white"
                    aria-label={t`Restore`}
                    title={t`Restore`}
                  >
                    <RotateCcw className="h-5 w-5" />
                  </button>
                )}
                {isAdmin && onPurge && (
                  <button
                    type="button"
                    onClick={() => onPurge(asset)}
                    className="rounded-full p-2 text-red-300 hover:bg-red-500/20 hover:text-red-200"
                    aria-label={t`Delete permanently`}
                    title={t`Delete permanently`}
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                )}
              </>
            ) : (
              onRequestDelete && (
                <button
                  type="button"
                  onClick={() => onRequestDelete(asset)}
                  className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white"
                  aria-label={t`Delete`}
                  title={t`Delete`}
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              )
            )}
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

          {onMove && index > 0 && (
            <button
              type="button"
              onClick={() => onMove(-1)}
              aria-label="Previous"
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white/90 hover:bg-white/20"
            >
              <ChevronLeft className="h-7 w-7" />
            </button>
          )}
          {onMove && index < assets.length - 1 && (
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
