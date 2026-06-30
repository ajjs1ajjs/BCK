"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Snapshot {
  id: string;
  repository_id: string;
  snapshot_path: string;
  total_size_bytes: number;
  file_count: number;
  CreatedAt: string;
}

interface Repo {
  id: string;
  name: string;
}

export default function RestorePage() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState("");
  const [targetPath, setTargetPath] = useState("");

  useEffect(() => {
    api.listRepos().then((r) => r.json()).then(setRepos);
    api.listSnapshots().then((r) => r.json()).then(setSnapshots);
  }, []);

  const startRestore = async () => {
    if (!selectedSnapshot || !targetPath) {
      toast.error("Select a snapshot and target path");
      return;
    }
    const res = await api.startRestore({
      snapshot_id: selectedSnapshot,
      target_path: targetPath,
    });
    if (res.ok) toast.success("Restore started");
    else toast.error("Failed to start restore");
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Restore</h1>

      <Card>
        <CardHeader><CardTitle>Select Snapshot</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Snapshot</Label>
            <Select value={selectedSnapshot} onValueChange={(v) => setSelectedSnapshot(v ?? "")}>
              <SelectTrigger><SelectValue placeholder="Choose snapshot..." /></SelectTrigger>
              <SelectContent>
                {snapshots.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.snapshot_path} ({s.file_count} files, {(s.total_size_bytes / 1024 / 1024).toFixed(1)} MB)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Target Path</Label>
            <Input value={targetPath} onChange={(e) => setTargetPath(e.target.value)} placeholder="/restore/path" />
          </div>
          <Button onClick={startRestore}>Start Restore</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Available Snapshots</CardTitle></CardHeader>
        <CardContent>
          {snapshots.length === 0 ? (
            <p className="text-sm text-muted-foreground">No snapshots available.</p>
          ) : (
            <div className="space-y-2">
              {snapshots.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p className="font-mono text-sm">{s.snapshot_path}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.file_count} files / {(s.total_size_bytes / 1024 / 1024).toFixed(1)} MB
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => { setSelectedSnapshot(s.id); }}>
                    Select
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
