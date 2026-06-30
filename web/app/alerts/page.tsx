"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bell } from "lucide-react";

export default function AlertsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Alerts</h1>
      <Card>
        <CardHeader><CardTitle>Notifications</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Bell className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No alerts yet.</p>
            <p className="text-sm text-muted-foreground">Notifications about backup jobs will appear here.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
