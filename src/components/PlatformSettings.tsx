import React, { useState } from "react";
import { Server, Database, Shield, HardDrive, Activity, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/Card";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { cn } from "../lib/utils";
import { CloudflareSettings } from "./CloudflareSettings";
import { AdSettings } from "./AdSettings";

interface PlatformSettingsProps {}

export function PlatformSettings({}: PlatformSettingsProps) {
  const [storageUsage] = useState({ used: 4.5, total: 10 });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  return (
    <div className="space-y-8 pb-12">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900 font-sans">Platform Settings</h2>
        <p className="text-zinc-500">Configure your FastFasts instance and monitor system health.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Server className="h-5 w-5 text-zinc-400" />
                <CardTitle>System Health</CardTitle>
              </div>
              <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={isRefreshing}>
                <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
              </Button>
            </div>
            <CardDescription>Real-time status of your streaming infrastructure.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-zinc-50 rounded-lg border border-zinc-100">
              <div className="flex items-center gap-3">
                <Activity className="h-4 w-4 text-green-500" />
                <span className="text-sm font-medium">Transcoding Engine</span>
              </div>
              <Badge variant="success">Operational</Badge>
            </div>
            <div className="flex items-center justify-between p-3 bg-zinc-50 rounded-lg border border-zinc-100">
              <div className="flex items-center gap-3">
                <Database className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-medium">Database Connection</span>
              </div>
              <Badge variant="success">Connected</Badge>
            </div>
            <div className="flex items-center justify-between p-3 bg-zinc-50 rounded-lg border border-zinc-100">
              <div className="flex items-center gap-3">
                <HardDrive className="h-4 w-4 text-orange-500" />
                <span className="text-sm font-medium">Storage Node</span>
              </div>
              <div className="text-right">
                <div className="text-xs text-zinc-500 mb-1">{storageUsage.used}GB / {storageUsage.total}GB</div>
                <div className="w-32 h-1.5 bg-zinc-200 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-orange-500 transition-all duration-500" 
                    style={{ width: `${(storageUsage.used / storageUsage.total) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-zinc-400" />
              <CardTitle>Security & Access</CardTitle>
            </div>
            <CardDescription>Control who can access and manage your streams.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Firebase Authentication</h4>
              <p className="text-xs text-zinc-500">Access to the dashboard is protected by Google and Email/Password authentication.</p>
              <Badge variant="secondary">Active</Badge>
            </div>
            <div className="space-y-2">
              <h4 className="text-sm font-medium">IP Whitelisting</h4>
              <p className="text-xs text-zinc-500">Restrict dashboard access to specific IP ranges.</p>
              <Button variant="link" className="h-auto p-0 text-xs">Configure Rules</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <CloudflareSettings />
      <AdSettings />
    </div>
  );
}
