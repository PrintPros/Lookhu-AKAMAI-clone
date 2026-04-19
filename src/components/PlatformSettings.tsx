import React, { useState, useEffect } from "react";
import { Server, Database, Shield, HardDrive, Activity, RefreshCw, FileJson } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/Card";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Input } from "./ui/Input";
import { cn } from "../lib/utils";
import { AdSettings } from "./AdSettings";
import { db } from "../firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { toast } from "sonner";

interface PlatformSettingsProps {
  profile: any;
}

export function PlatformSettings({ profile }: PlatformSettingsProps) {
  const [storageUsage] = useState({ used: 4.5, total: 10 });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const res = await fetch("/api/health");
        const data = await res.json();
        setHealth(data);
      } catch (error) {
        console.error("Health check failed:", error);
      }
    };
    fetchHealth();
  }, []);

  return (
    <div className="space-y-8 pb-12">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900 font-sans">Platform Settings</h2>
        <p className="text-zinc-500">Configure your FasterFasts instance and monitor system health.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Server className="h-5 w-5 text-zinc-400" />
                <CardTitle>System Health</CardTitle>
              </div>
              <Button variant="ghost" size="icon" onClick={() => window.location.reload()} disabled={isRefreshing}>
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
              <Badge variant={health?.transcoding?.working ? "success" : "destructive"}>
                {health?.transcoding?.working ? "Operational" : "Offline"}
              </Badge>
            </div>
            <div className="flex items-center justify-between p-3 bg-zinc-50 rounded-lg border border-zinc-100">
              <div className="flex items-center gap-3">
                <Database className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-medium">Database Connection</span>
              </div>
              <Badge variant={health?.firebase?.dbAdmin ? "success" : "destructive"}>
                {health?.firebase?.dbAdmin ? "Connected" : "Disconnected"}
              </Badge>
            </div>
            <div className="flex items-center justify-between p-3 bg-zinc-50 rounded-lg border border-zinc-100">
              <div className="flex items-center gap-3">
                <Shield className="h-4 w-4 text-purple-500" />
                <span className="text-sm font-medium">Firebase Auth</span>
              </div>
              <Badge variant={health?.firebase?.authAdmin ? "success" : "destructive"}>
                {health?.firebase?.authAdmin ? "Active" : "Inactive"}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-zinc-400" />
              <CardTitle>Security & Access</CardTitle>
            </div>
            <CardDescription>Manage your connections and storage access.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Media Buckets</h4>
              <p className="text-xs text-zinc-500">Manage your R2 storage buckets.</p>
              <Badge variant="success">Connected</Badge>
            </div>
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Manifest Storage</h4>
              <p className="text-xs text-zinc-500">Storage for global manifest.json.</p>
              <Badge variant="success">Managed in Cloudflare Settings</Badge>
            </div>
          </CardContent>
        </Card>

      </div>

      <AdSettings />
    </div>
  );
}
