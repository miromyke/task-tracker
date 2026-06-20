import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FileText, Loader2, Play, X } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { api, type Asset, type AssetKind } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
      className="group relative aspect-square overflow-hidden rounded-lg border bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
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
        <span className="flex h-full flex-col items-center justify-center gap-2 p-3 text-zinc-500">
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

// FilesView is the Files tab of the overview: a grid of uploaded assets scoped to
// the page's selected project (projectId undefined = all projects). Project
// selection and tag filtering are owned by the overview; tags don't apply here.
export function FilesView({ projectId }: { projectId?: number }) {
  const { i18n } = useLingui();
  const [kind, setKind] = useState<AssetKind | "">("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);

  // Reload from the first page whenever the project or kind filter changes.
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
  }, [projectId, kind]);

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
      {/* kind tabs */}
      <div className="inline-flex rounded-md border p-0.5">
        {KIND_TABS.map(({ value, label }) => (
          <button
            key={value || "all"}
            type="button"
            onClick={() => setKind(value)}
            className={cn(
              "rounded px-3 py-1 text-sm font-medium transition-colors",
              kind === value ? "bg-zinc-900 text-white" : "text-zinc-500 hover:text-zinc-900"
            )}
          >
            {i18n._(label)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
        </div>
      ) : assets.length === 0 ? (
        <p className="py-16 text-center text-sm text-zinc-500">
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
    </div>
  );
}
