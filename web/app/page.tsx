"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  FolderKanban, Database, HardDrive, Clock,
  CheckCircle, XCircle, Loader2, Activity,
  BarChart3, PieChart
} from "lucide-react";
import {
  PieChart as RePie, Pie, Cell, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line, Legend
} from "recharts";

interface Stats {
  total_repositories: number;
  total_jobs: number;
  active_jobs: number;
  total_snapshots: number;
  total_storage_bytes: number;
  recent_runs: number;
}

interface Job {
  id: string; name: string; status: string; source_path: string; created_at: string;
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

const COLORS = ["#22c55e", "#ef4444", "#eab308", "#3b82f6"];

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    api.getStats().then(r => r.json()).then(setStats);
    api.listJobs().then(r => r.json()).then(setJobs);
  }, []);

  const jobStatusData = [
    { name: "Active", value: stats?.active_jobs ?? 0 },
    { name: "Inactive", value: (stats?.total_jobs ?? 0) - (stats?.active_jobs ?? 0) },
  ];

  const storageData = [
    { name: "Used", bytes: stats?.total_storage_bytes ?? 0 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Activity className="h-4 w-4 text-green-500" />
          System Operational
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Jobs</CardTitle>
            <FolderKanban className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats?.total_jobs ?? 0}</p>
            <p className="text-xs text-muted-foreground">{stats?.active_jobs ?? 0} active</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Repositories</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats?.total_repositories ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Storage Used</CardTitle>
            <HardDrive className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatBytes(stats?.total_storage_bytes ?? 0)}</p>
            <p className="text-xs text-muted-foreground">{stats?.total_snapshots ?? 0} snapshots</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">24h Runs</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats?.recent_runs ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChart className="h-5 w-5" /> Job Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <RePie>
                <Pie data={jobStatusData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                  {jobStatusData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                </Pie>
                <Tooltip />
              </RePie>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" /> Storage Overview
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={storageData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis tickFormatter={(v) => formatBytes(v)} />
                <Tooltip formatter={(v: any) => [formatBytes(v as number), "Storage"]} />
                <Bar dataKey="bytes" fill="#3b82f6" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Recent Jobs</CardTitle></CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No jobs configured yet.</p>
          ) : (
            <div className="space-y-2">
              {jobs.slice(0, 5).map(job => (
                <div key={job.id} className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex items-center gap-3">
                    {job.status === "active" ? <CheckCircle className="h-4 w-4 text-green-500" /> :
                     job.status === "failed" ? <XCircle className="h-4 w-4 text-red-500" /> :
                     <Loader2 className="h-4 w-4 animate-spin" />}
                    <div>
                      <p className="font-medium">{job.name}</p>
                      <p className="text-xs text-muted-foreground">{job.source_path}</p>
                    </div>
                  </div>
                  <Badge variant={job.status === "active" ? "default" : "secondary"}>{job.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
