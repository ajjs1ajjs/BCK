"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Plus } from "lucide-react";

interface Job {
  id: string;
  name: string;
  source_path: string;
  repository_id: string;
  cron_expression: string;
  status: string;
  created_at: string;
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    source_path: "",
    repository_id: "",
    cron_expression: "",
  });

  const load = () => api.listJobs().then((r) => r.json()).then(setJobs);
  useEffect(() => { load(); }, []);

  const create = async () => {
    const res = await api.createJob(form);
    if (res.ok) {
      toast.success("Job created");
      setOpen(false);
      load();
    } else {
      toast.error("Failed to create job");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Backup Jobs</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger>
            <Button><Plus className="mr-2 h-4 w-4" /> New Job</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Backup Job</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label>Source Path</Label>
                <Input value={form.source_path} onChange={(e) => setForm({ ...form, source_path: e.target.value })} />
              </div>
              <div>
                <Label>Repository ID</Label>
                <Input value={form.repository_id} onChange={(e) => setForm({ ...form, repository_id: e.target.value })} />
              </div>
              <div>
                <Label>Cron Expression (optional)</Label>
                <Input value={form.cron_expression} onChange={(e) => setForm({ ...form, cron_expression: e.target.value })} placeholder="0 0 * * *" />
              </div>
              <Button onClick={create}>Create</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-3">
        {jobs.map((job) => (
          <Link key={job.id} href={`/jobs/${job.id}`}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer">
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <p className="font-medium">{job.name}</p>
                  <p className="text-sm text-muted-foreground">{job.source_path}</p>
                </div>
                <div className="flex items-center gap-3">
                  {job.cron_expression && (
                    <span className="text-xs text-muted-foreground">{job.cron_expression}</span>
                  )}
                  <Badge variant={job.status === "active" ? "default" : "secondary"}>{job.status}</Badge>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
