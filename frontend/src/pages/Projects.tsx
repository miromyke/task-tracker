import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Plus } from "lucide-react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { api, type Project } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

function CreateProjectDialog({ onCreated }: { onCreated: (p: Project) => void }) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const p = await api.createProject(name.trim(), description.trim());
      onCreated(p);
      setName("");
      setDescription("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="rounded-full">
          <Plus className="h-4 w-4" />
          <Trans>New project</Trans>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>New project</Trans>
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pname">
              <Trans>Name</Trans>
            </Label>
            <Input id="pname" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t`e.g. Kitchen Remodel`} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pdesc">
              <Trans>Description</Trans>
            </Label>
            <Textarea id="pdesc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              <Trans>Create</Trans>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listProjects()
      .then(setProjects)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            <Trans>Projects</Trans>
          </h1>
          <p className="text-sm text-muted-foreground">
            <Trans>House renovation · shared workspace</Trans>
          </p>
        </div>
        <CreateProjectDialog onCreated={(p) => setProjects((prev) => [p, ...prev])} />
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : projects.length === 0 ? (
        <Card className="py-12 text-center text-muted-foreground">
          <Trans>No projects yet. Create your first one to get started.</Trans>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} className="group">
              <Card className="h-full overflow-hidden transition-shadow hover:shadow-md">
                <div className="ds-placeholder aspect-[4/3] w-full" />
                <div className="space-y-1 p-3">
                  <h3 className="font-semibold leading-tight">{p.name}</h3>
                  {p.description && <p className="line-clamp-2 text-xs text-muted-foreground">{p.description}</p>}
                  <p className="pt-1 text-xs text-muted-foreground">
                    <Plural value={p.taskCount} one="# task" other="# tasks" />
                  </p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
