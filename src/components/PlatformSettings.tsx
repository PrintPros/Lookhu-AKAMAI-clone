import React, { useState, useEffect } from "react";
import { Server, Database, Shield, HardDrive, Activity, RefreshCw, FileJson } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/Card";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Input } from "./ui/Input";
import { cn } from "../lib/utils";
import { CloudflareSettings } from "./CloudflareSettings";
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
  const [manifestSettings, setManifestSettings] = useState({
    accountId: "",
    r2AccessKeyId: "",
    r2SecretAccessKey: "",
    bucketName: "",
    publicBaseUrl: "",
  });
  const [savingManifest, setSavingManifest] = useState(false);

  useEffect(() => {
    const fetchManifest = async () => {
      const docRef = doc(db, "settings", "manifest");
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setManifestSettings(docSnap.data() as any);
      }
    };
    fetchManifest();
  }, []);

  const handleSaveManifest = async () => {
    setSavingManifest(true);
    try {
      await setDoc(doc(db, "settings", "manifest"), manifestSettings);
      toast.success("Manifest settings saved");
    } catch (error) {
      toast.error("Failed to save manifest settings");
    } finally {
      setSavingManifest(false);
    }
  };

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

        <Card className="md:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileJson className="h-5 w-5 text-zinc-400" />
              <CardTitle>Manifest Storage</CardTitle>
            </div>
            <CardDescription>Configure credentials for storing the global manifest.json.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Account ID</label>
                <Input value={manifestSettings.accountId} onChange={(e) => setManifestSettings({...manifestSettings, accountId: e.target.value})} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Bucket Name</label>
                <Input value={manifestSettings.bucketName} onChange={(e) => setManifestSettings({...manifestSettings, bucketName: e.target.value})} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Public Base URL</label>
                <Input value={manifestSettings.publicBaseUrl} onChange={(e) => setManifestSettings({...manifestSettings, publicBaseUrl: e.target.value})} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">R2 Access Key ID</label>
                <Input value={manifestSettings.r2AccessKeyId} onChange={(e) => setManifestSettings({...manifestSettings, r2AccessKeyId: e.target.value})} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">R2 Secret Access Key</label>
                <Input type="password" value={manifestSettings.r2SecretAccessKey} onChange={(e) => setManifestSettings({...manifestSettings, r2SecretAccessKey: e.target.value})} />
              </div>
            </div>
            <Button onClick={handleSaveManifest} disabled={savingManifest}>
              {savingManifest ? "Saving..." : "Save Manifest Settings"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <CloudflareSettings profile={profile} />
      <AdSettings />
    </div>
  );
}
