"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";

export default function SettingsPage() {
  const { user } = useAuth();
  const [apiUrl, setApiUrl] = useState(process.env.NEXT_PUBLIC_API_URL || "http://localhost:8050/api/v1");
  const [darkMode, setDarkMode] = useState(true);

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Username</Label>
            <Input value={user?.username ?? ""} disabled />
          </div>
          <div>
            <Label>Email</Label>
            <Input value={user?.email ?? ""} disabled />
          </div>
          <div>
            <Label>Role</Label>
            <Input value={user?.role ?? ""} disabled />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>API Connection</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>API URL</Label>
            <Input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
          </div>
          <Button onClick={() => toast.success("Settings saved")}>Save</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Appearance</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <Label>Dark Mode</Label>
            <Switch checked={darkMode} onCheckedChange={setDarkMode} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
