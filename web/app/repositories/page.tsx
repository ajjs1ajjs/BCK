"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Plus, HardDrive } from "lucide-react";

interface Repo {
  id: string;
  name: string;
  description: string;
  storage_type: string;
  status: string;
  total_size_bytes: number;
  total_snapshots: number;
}

export default function RepositoriesPage() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", storage_type: "local" });

  const load = () => api.listRepos().then((r) => r.json()).then(setRepos);
  useEffect(() => { load(); }, []);

  const create = async () => {
    const res = await api.createRepo(form);
    if (res.ok) { toast.success("Repository created"); setOpen(false); load(); }
    else toast.error("Failed to create repository");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Repositories</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger>
            <Button><Plus className="mr-2 h-4 w-4" /> New Repository</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Repository</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <Button onClick={create}>Create</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {repos.map((repo) => (
          <Card key={repo.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{repo.name}</CardTitle>
                <Badge variant={repo.status === "active" ? "default" : "secondary"}>{repo.status}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground">{repo.description || "No description"}</p>
              <div className="flex items-center gap-1 text-muted-foreground">
                <HardDrive className="h-3 w-3" /> {repo.storage_type}
              </div>
              <div className="flex justify-between text-xs">
                <span>{(repo.total_size_bytes / 1024 / 1024).toFixed(1)} MB</span>
                <span>{repo.total_snapshots} snapshots</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
