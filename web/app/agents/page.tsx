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
import { Plus, Server, Wifi, WifiOff } from "lucide-react";

interface Agent {
  id: string; name: string; hostname: string; address: string; port: number;
  version: string; status: string; last_seen_at: string;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", address: "", port: 50051, version: "" });

  const load = () => api.listAgents().then((r: any) => r.json()).then(setAgents);
  useEffect(() => { load(); }, []);

  const register = async () => {
    const res = await api.registerAgent(form);
    if (res.ok) { toast.success("Agent registered"); setOpen(false); load(); }
    else toast.error("Failed to register agent");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Agents</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger>
            <Button><Plus className="mr-2 h-4 w-4" /> Register Agent</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Register Agent</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
              <div><Label>Address</Label><Input value={form.address} onChange={e => setForm({...form, address: e.target.value})} placeholder="192.168.1.100" /></div>
              <div><Label>Port</Label><Input type="number" value={form.port} onChange={e => setForm({...form, port: +e.target.value})} /></div>
              <Button onClick={register}>Register</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {agents.map(agent => (
          <Card key={agent.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Server className="h-4 w-4" /> {agent.name}
                </CardTitle>
                {agent.status === "online" ?
                  <Wifi className="h-4 w-4 text-green-500" /> :
                  <WifiOff className="h-4 w-4 text-muted-foreground" />
                }
              </div>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="text-muted-foreground">{agent.address}:{agent.port}</p>
              {agent.hostname && <p className="text-muted-foreground">{agent.hostname}</p>}
              {agent.version && <p className="text-xs text-muted-foreground">v{agent.version}</p>}
              <Badge variant={agent.status === "online" ? "default" : "secondary"}>{agent.status}</Badge>
            </CardContent>
          </Card>
        ))}
        {agents.length === 0 && (
          <div className="col-span-full py-12 text-center text-muted-foreground">
            <Server className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No agents registered yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
