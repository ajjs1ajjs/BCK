"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { ArrowLeft, Play } from "lucide-react";
import Link from "next/link";

interface JobRun {
  id: string;
  status: string;
  started_at: string;
  finished_at: string;
  duration_seconds: number;
  bytes_processed: number;
  files_processed: number;
  error_message: string;
}

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<any>(null);
  const [runs, setRuns] = useState<JobRun[]>([]);

  useEffect(() => {
    api.getJob(id).then((r) => r.json()).then(setJob);
    api.listJobRuns(id).then((r) => r.json()).then(setRuns);
  }, [id]);

  const runNow = async () => {
    const res = await api.runJob(id);
    if (res.ok) {
      toast.success("Job triggered");
      api.listJobRuns(id).then((r) => r.json()).then(setRuns);
    } else {
      toast.error("Failed to trigger job");
    }
  };

  if (!job) return <div>Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/jobs"><ArrowLeft className="h-5 w-5" /></Link>
          <h1 className="text-2xl font-bold">{job.name}</h1>
          <Badge variant={job.status === "active" ? "default" : "secondary"}>{job.status}</Badge>
        </div>
        <Button onClick={runNow}><Play className="mr-2 h-4 w-4" /> Run Now</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card><CardContent className="py-3"><p className="text-xs text-muted-foreground">Source</p><p className="font-mono text-sm truncate">{job.source_path}</p></CardContent></Card>
        <Card><CardContent className="py-3"><p className="text-xs text-muted-foreground">Schedule</p><p className="font-mono text-sm">{job.cron_expression || "Manual"}</p></CardContent></Card>
        <Card><CardContent className="py-3"><p className="text-xs text-muted-foreground">Chunk Size</p><p className="text-sm">{job.chunk_size_bytes / (1024*1024)} MB</p></CardContent></Card>
        <Card><CardContent className="py-3"><p className="text-xs text-muted-foreground">Compression</p><p className="text-sm">Level {job.compression_level}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Run History</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Files</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>
                    <Badge variant={
                      run.status === "success" ? "default" :
                      run.status === "failed" ? "destructive" :
                      run.status === "running" ? "outline" : "secondary"
                    }>{run.status}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">{run.started_at ? new Date(run.started_at).toLocaleString() : "-"}</TableCell>
                  <TableCell>{run.duration_seconds ? `${run.duration_seconds.toFixed(1)}s` : "-"}</TableCell>
                  <TableCell>{run.files_processed}</TableCell>
                  <TableCell>{run.bytes_processed} B</TableCell>
                  <TableCell className="text-xs text-red-500 max-w-[150px] truncate">{run.error_message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
