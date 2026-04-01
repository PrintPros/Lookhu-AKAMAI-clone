import { useState, useEffect } from "react";
import { db, auth } from "../firebase";
import { 
  collection, 
  query, 
  where,
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc,
  updateDoc 
} from "firebase/firestore";
import { CloudflareConfig, Channel } from "../types";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Input } from "./ui/Input";
import { Badge } from "./ui/Badge";
import { Dialog } from "./ui/Dialog";
import { 
  Cloud, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  AlertCircle, 
  ExternalLink, 
  Database,
  Loader2,
  Settings,
  Zap,
  RefreshCw,
  Globe,
  Clock
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { handleFirestoreError, OperationType } from "../lib/firestore-errors";
import { toast } from "sonner";

async function deployChannelWorker(params: any) {
  const response = await fetch("/api/deploy/channel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return response.json();
}

async function deploySchedulerWorker(params: any) {
  const response = await fetch("/api/deploy/scheduler", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return response.json();
}

export function CloudflareSettings() {
  const [configs, setConfigs] = useState<CloudflareConfig[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Scheduler state
  const [deployingScheduler, setDeployingScheduler] = useState(false);
  const [schedulerSecret, setSchedulerSecret] = useState("");
  const [appUrl, setAppUrl] = useState(window.location.origin);

  // Channel worker state
  const [deployingChannelId, setDeployingChannelId] = useState<string | null>(null);

  // Form state
  const [newConfig, setNewConfig] = useState({
    label: "",
    accountId: "",
    cfApiToken: "",
    r2AccessKeyId: "",
    r2SecretAccessKey: "",
    bucketName: "",
    publicBaseUrl: "",
  });

  const [scanning, setScanning] = useState<string | null>(null);
  const [scanResults, setScanResults] = useState<any[]>([]);
  const [showScanDialog, setShowScanDialog] = useState(false);
  const [selectedForImport, setSelectedForImport] = useState<Set<string>>(new Set());
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  async function fetchBucketUsage(config: CloudflareConfig) {
    try {
      const res = await fetch("/api/r2/bucket-usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: config.accountId,
          r2AccessKeyId: config.r2AccessKeyId,
          r2SecretAccessKey: config.r2SecretAccessKey,
          bucketName: config.bucketName,
        }),
      });
      const data = await res.json();
      if (data.success) {
        await updateDoc(doc(db, "cloudflareConfigs", config.id), {
          usedBytes: data.usedBytes,
        });
      }
    } catch (e) {
      console.error("Failed to fetch bucket usage:", e);
    }
  }

  useEffect(() => {
    if (!auth.currentUser) return;

    // Listen to configs
    const qConfigs = query(
      collection(db, "cloudflareConfigs"),
      where("userId", "==", auth.currentUser.uid)
    );

    const unsubConfigs = onSnapshot(qConfigs, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as CloudflareConfig[];
      setConfigs(data);
      setLoading(false);
      data.forEach(c => fetchBucketUsage(c));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "cloudflareConfigs");
    });

    // Listen to channels
    const qChannels = query(
      collection(db, "channels"),
      where("userId", "==", auth.currentUser.uid)
    );

    const unsubChannels = onSnapshot(qChannels, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Channel[];
      setChannels(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "channels");
    });

    return () => {
      unsubConfigs();
      unsubChannels();
    };
  }, []);

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await fetch("/api/r2/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: newConfig.accountId,
          r2AccessKeyId: newConfig.r2AccessKeyId,
          r2SecretAccessKey: newConfig.r2SecretAccessKey,
          bucketName: newConfig.bucketName,
        })
      });
      const data = await response.json();
      if (response.ok) {
        setTestResult({ success: true, message: "Connection successful!" });
      } else {
        setTestResult({ success: false, message: data.error || "Connection failed" });
      }
    } catch (error) {
      setTestResult({ success: false, message: "Network error" });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!auth.currentUser) return;

    const configData = {
      label: newConfig.label,
      accountId: newConfig.accountId,
      cfApiToken: newConfig.cfApiToken,
      r2AccessKeyId: newConfig.r2AccessKeyId,
      r2SecretAccessKey: newConfig.r2SecretAccessKey,
      bucketName: newConfig.bucketName,
      publicBaseUrl: newConfig.publicBaseUrl,
      usedBytes: 0,
      maxBytes: 10737418240,
      isActive: configs.length === 0,
      userId: auth.currentUser?.uid,
    };

    try {
      await addDoc(collection(db, "cloudflareConfigs"), configData);
      setNewConfig({
        label: "",
        accountId: "",
        cfApiToken: "",
        r2AccessKeyId: "",
        r2SecretAccessKey: "",
        bucketName: "",
        publicBaseUrl: "",
      });
      setTestResult(null);
      toast.success("Bucket configuration saved");
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, "cloudflareConfigs");
    }
  };

  const handleDeployScheduler = async () => {
    if (!schedulerSecret) {
      toast.error("Please provide a Scheduler Secret");
      return;
    }

    const activeConfig = configs.find(c => c.isActive);
    if (!activeConfig) {
      toast.error("Please set an active Cloudflare configuration first");
      return;
    }

    setDeployingScheduler(true);
    try {
      const result = await deploySchedulerWorker({
        accountId: activeConfig.accountId,
        cfApiToken: activeConfig.cfApiToken,
        appUrl: appUrl,
        schedulerSecret: schedulerSecret
      });

      if (result.success) {
        toast.success("Scheduler Worker deployed successfully!");
      } else {
        toast.error("Failed to deploy Scheduler: " + result.error);
      }
    } catch (error: any) {
      toast.error("Deployment error: " + error.message);
    } finally {
      setDeployingScheduler(false);
    }
  };

  const handleDeployChannelWorker = async (channel: Channel) => {
    const config = configs.find(c => c.isActive);
    if (!config) {
      toast.error("No active Cloudflare configuration found");
      return;
    }

    setDeployingChannelId(channel.id);
    try {
      const result = await deployChannelWorker({
        accountId: config.accountId,
        cfApiToken: config.cfApiToken,
        channelSlug: channel.channelSlug,
        manifestBucketUrl: config.publicBaseUrl,
        epoch: Math.floor(Date.now() / 1000)
      });

      if (result.success) {
        await updateDoc(doc(db, "channels", channel.id), {
          workerDeployed: true,
          workerNeedsRedeploy: false,
          workerManifestUrl: `${result.workerUrl}/index.m3u8`
        });
        toast.success(`Worker for ${channel.name} deployed!`);
      } else {
        toast.error("Failed to deploy worker: " + result.error);
      }
    } catch (error: any) {
      toast.error("Deployment error: " + error.message);
    } finally {
      setDeployingChannelId(null);
    }
  };

  const handleScanBucket = async (config: CloudflareConfig) => {
    setScanning(config.id);
    try {
      const response = await fetch("/api/r2/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: config.accountId,
          r2AccessKeyId: config.r2AccessKeyId,
          r2SecretAccessKey: config.r2SecretAccessKey,
          bucketName: config.bucketName,
          publicBaseUrl: config.publicBaseUrl,
        }),
      });
      const data = await response.json();
      if (response.ok) {
        setScanResults(data.programs);
        
        const estimatedBytes = data.programs.reduce(
          (sum: number, p: any) => sum + (p.segments * 300 * 1024),
          0
        );

        try {
          await updateDoc(doc(db, "cloudflareConfigs", config.id), {
            usedBytes: estimatedBytes,
          });
          fetchBucketUsage(config);
        } catch (e) {
          console.error("Failed to update storage estimate:", e);
        }

        setSelectedForImport(new Set(data.programs.map((p: any) => p.id)));
        setShowScanDialog(true);
      } else {
        toast.error(data.error || "Scan failed");
      }
    } catch (error) {
      toast.error("Network error during scan");
    } finally {
      setScanning(null);
    }
  };

  const handleImport = async (config: CloudflareConfig) => {
    if (!auth.currentUser) return;
    const toImport = scanResults.filter(p => selectedForImport.has(p.id));
    
    try {
      for (const program of toImport) {
        await addDoc(collection(db, "media"), {
          name: program.id,
          songTitle: program.id.replace(/-/g, " "),
          artistName: "Unknown Artist",
          m3u8Url: program.m3u8Url,
          status: "ready",
          userId: auth.currentUser?.uid,
          createdAt: new Date().toISOString(),
          bucketName: config.bucketName,
          r2Path: program.path,
          segmentCount: program.segments,
          segmentDuration: 6,
          segmentPrefix: program.prefix,
          segmentPad: program.pad,
          genre: "other",
        });
      }

      const importedBytes = toImport.reduce(
        (sum: number, p: any) => sum + (p.segments * 300 * 1024),
        0
      );
      await updateDoc(doc(db, "cloudflareConfigs", config.id), {
        usedBytes: importedBytes,
      });

      toast.success(`Imported ${toImport.length} videos`);
      setShowScanDialog(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, "media");
    }
  };

  const handleSetActive = async (id: string) => {
    if (!auth.currentUser) return;
    try {
      const batch: any[] = [];
      configs.forEach(c => {
        batch.push(updateDoc(doc(db, "cloudflareConfigs", c.id), {
          isActive: c.id === id
        }));
      });
      await Promise.all(batch);
      toast.success("Active bucket updated");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, "cloudflareConfigs");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, "cloudflareConfigs", id));
      toast.success("Bucket connection deleted");
      setDeleteConfirmId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `cloudflareConfigs/${id}`);
    }
  };

  const getStorageColor = (used: number, max: number) => {
    const percentage = (used / max) * 100;
    if (percentage < 70) return "bg-green-500";
    if (percentage < 90) return "bg-amber-500";
    return "bg-red-500";
  };

  const formatBytes = (bytes: number) => {
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  };

  const totalUsed = configs.reduce((acc, curr) => acc + curr.usedBytes, 0);
  const totalMax = configs.length * 10737418240;

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="space-y-12 pb-20">
      {/* Section A: Connected Buckets */}
      <section id="connected-buckets">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-zinc-900 flex items-center gap-2">
            <Cloud className="h-6 w-6" />
            Connected Buckets
          </h2>
          <Badge variant="outline">{configs.length} Buckets</Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <AnimatePresence mode="popLayout">
            {configs.map((config) => (
              <motion.div
                key={config.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                layout
              >
                <Card className="p-6 relative group overflow-hidden">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-bold text-lg">{config.label}</h3>
                      <p className="text-sm text-zinc-500 font-mono">{config.bucketName}</p>
                    </div>
                    <div className="flex gap-2">
                      {config.usedBytes > 9.5 * 1024 * 1024 * 1024 ? (
                        <Badge variant="destructive">Bucket full</Badge>
                      ) : config.usedBytes > 9 * 1024 * 1024 * 1024 ? (
                        <Badge className="bg-amber-100 text-amber-700 border-amber-200">Approaching limit</Badge>
                      ) : null}
                      {config.isActive && (
                        <Badge className="bg-green-100 text-green-700 border-green-200">Active</Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-zinc-400 hover:text-red-600"
                        onClick={() => setDeleteConfirmId(config.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between text-xs font-medium">
                      <span>Storage Usage</span>
                      <span>{formatBytes(config.usedBytes)} / 10 GB</span>
                    </div>
                    <div className="h-2 w-full bg-zinc-100 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${(config.usedBytes / config.maxBytes) * 100}%` }}
                        className={`h-full ${getStorageColor(config.usedBytes, config.maxBytes)}`}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                      <ExternalLink className="h-3 w-3" />
                      <a 
                        href={config.publicBaseUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="hover:text-zinc-900 truncate max-w-[150px]"
                      >
                        {config.publicBaseUrl}
                      </a>
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="h-7 text-[10px]"
                        onClick={() => handleScanBucket(config)}
                        disabled={scanning === config.id}
                      >
                        {scanning === config.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Database className="h-3 w-3 mr-1" />}
                        Scan Bucket
                      </Button>
                      <Button 
                        variant={config.isActive ? "secondary" : "outline"} 
                        size="sm" 
                        className="h-7 text-[10px]"
                        onClick={() => handleSetActive(config.id)}
                        disabled={config.isActive || config.usedBytes > 9.5 * 1024 * 1024 * 1024}
                      >
                        {config.isActive ? "Active" : "Set Active"}
                      </Button>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </section>

      {/* Section B: Scheduler Worker Deployment */}
      <section id="scheduler-worker">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-zinc-900 flex items-center gap-2">
            <Clock className="h-6 w-6" />
            Scheduler Worker
          </h2>
          <Badge variant="outline">Cloudflare Cron</Badge>
        </div>

        <Card className="p-8">
          <div className="grid gap-8 md:grid-cols-2">
            <div className="space-y-4">
              <p className="text-sm text-zinc-600">
                The Scheduler Worker runs every minute on Cloudflare to check for pending publishes.
                It requires a shared secret to authenticate with this platform.
              </p>
              <div className="space-y-2">
                <label className="text-sm font-medium">Scheduler Secret</label>
                <Input
                  type="password"
                  placeholder="Enter SCHEDULER_SECRET from your .env"
                  value={schedulerSecret}
                  onChange={(e) => setSchedulerSecret(e.target.value)}
                />
                <p className="text-[10px] text-zinc-500">
                  This must match the <code>SCHEDULER_SECRET</code> in your server's environment.
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">App URL</label>
                <Input
                  placeholder="https://your-app.run.app"
                  value={appUrl}
                  onChange={(e) => setAppUrl(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-col justify-center items-center p-6 bg-zinc-50 rounded-xl border border-zinc-200">
              <Zap className={`h-12 w-12 mb-4 ${deployingScheduler ? "text-amber-500 animate-pulse" : "text-zinc-300"}`} />
              <h3 className="font-bold mb-2">Deploy Cron Trigger</h3>
              <p className="text-xs text-zinc-500 text-center mb-6">
                This will create a Worker named <code>rag-scheduler</code> in your active Cloudflare account.
              </p>
              <Button 
                onClick={handleDeployScheduler}
                disabled={deployingScheduler || !schedulerSecret || !configs.some(c => c.isActive)}
                className="w-full"
              >
                {deployingScheduler ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Deploying...
                  </>
                ) : (
                  "Deploy Scheduler"
                )}
              </Button>
            </div>
          </div>
        </Card>
      </section>

      {/* Section C: Channel Workers */}
      <section id="channel-workers">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-zinc-900 flex items-center gap-2">
            <Globe className="h-6 w-6" />
            Channel Workers
          </h2>
          <Badge variant="outline">{channels.length} Channels</Badge>
        </div>

        <div className="grid gap-4">
          {channels.map((channel) => (
            <Card key={channel.id} className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-lg bg-zinc-100 flex items-center justify-center">
                  <Globe className="h-5 w-5 text-zinc-400" />
                </div>
                <div>
                  <h3 className="font-bold text-sm">{channel.name}</h3>
                  <p className="text-xs text-zinc-500 font-mono">/{channel.slug}</p>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="flex flex-col items-end">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-bold mb-1">Status</span>
                  {channel.workerDeployed ? (
                    <div className="flex items-center gap-1 text-green-600">
                      <CheckCircle2 className="h-3 w-3" />
                      <span className="text-xs font-medium">Deployed</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-zinc-400">
                      <AlertCircle className="h-3 w-3" />
                      <span className="text-xs font-medium">Not Deployed</span>
                    </div>
                  )}
                </div>

                {channel.workerNeedsRedeploy && (
                  <Badge className="bg-amber-100 text-amber-700 border-amber-200">Update Needed</Badge>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDeployChannelWorker(channel)}
                  disabled={deployingChannelId === channel.id || !configs.some(c => c.isActive)}
                >
                  {deployingChannelId === channel.id ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="h-3 w-3 mr-2" />
                  )}
                  {channel.workerDeployed ? "Redeploy" : "Deploy Worker"}
                </Button>
              </div>
            </Card>
          ))}
          {channels.length === 0 && (
            <div className="py-12 text-center border-2 border-dashed border-zinc-200 rounded-xl">
              <p className="text-zinc-500">No channels found. Create one to manage its worker.</p>
            </div>
          )}
        </div>
      </section>

      {/* Section D: Add New Cloudflare Account */}
      <section id="add-new-account" className="bg-white p-8 rounded-2xl border border-zinc-200 shadow-sm">
        <h2 className="text-2xl font-bold text-zinc-900 mb-6 flex items-center gap-2">
          <Plus className="h-6 w-6" />
          Add New Cloudflare Account
        </h2>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Label</label>
              <Input
                placeholder="e.g. RAG Primary"
                value={newConfig.label}
                onChange={(e) => setNewConfig({ ...newConfig, label: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Account ID</label>
              <Input
                placeholder="Cloudflare Account ID"
                value={newConfig.accountId}
                onChange={(e) => setNewConfig({ ...newConfig, accountId: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Cloudflare API Token</label>
              <Input
                type="password"
                placeholder="Cloudflare API Token"
                value={newConfig.cfApiToken}
                onChange={(e) => setNewConfig({ ...newConfig, cfApiToken: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">R2 Access Key ID</label>
              <Input
                placeholder="R2 Access Key ID"
                value={newConfig.r2AccessKeyId}
                onChange={(e) => setNewConfig({ ...newConfig, r2AccessKeyId: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">R2 Secret Access Key</label>
              <Input
                type="password"
                placeholder="R2 Secret Access Key"
                value={newConfig.r2SecretAccessKey}
                onChange={(e) => setNewConfig({ ...newConfig, r2SecretAccessKey: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Bucket Name</label>
              <Input
                placeholder="my-r2-bucket"
                value={newConfig.bucketName}
                onChange={(e) => setNewConfig({ ...newConfig, bucketName: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Public Base URL</label>
              <Input
                placeholder="https://pub-xxx.r2.dev"
                value={newConfig.publicBaseUrl}
                onChange={(e) => setNewConfig({ ...newConfig, publicBaseUrl: e.target.value })}
              />
            </div>

            <div className="pt-4 flex flex-col gap-4">
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={handleTestConnection}
                  disabled={testing || !newConfig.r2SecretAccessKey}
                >
                  {testing ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Database className="h-4 w-4 mr-2" />
                  )}
                  Test Connection
                </Button>
                <Button
                  className="flex-1 bg-zinc-900 text-white hover:bg-zinc-800"
                  onClick={handleSave}
                  disabled={!newConfig.label || !newConfig.bucketName}
                >
                  Save Bucket
                </Button>
              </div>

              {testResult && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`p-3 rounded-lg flex items-center gap-2 text-sm ${
                    testResult.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                  }`}
                >
                  {testResult.success ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                  {testResult.message}
                </motion.div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Section E: R2 Storage Overview */}
      <section className="bg-zinc-900 text-white p-8 rounded-2xl shadow-xl">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Database className="h-6 w-6 text-zinc-400" />
              R2 Storage Overview
            </h2>
            <p className="text-zinc-400 text-sm">
              Total storage across all accounts: <span className="text-white font-bold">{formatBytes(totalUsed)}</span> / {configs.length * 10} GB
            </p>
          </div>
          
          <Button 
            className="bg-white text-zinc-900 hover:bg-zinc-100"
            onClick={() => document.getElementById("add-new-account")?.scrollIntoView({ behavior: "smooth" })}
          >
            Add Another Account
          </Button>
        </div>

        <div className="mt-8 h-4 w-full bg-zinc-800 rounded-full overflow-hidden flex">
          {configs.map((config) => (
            <div
              key={config.id}
              style={{ width: `${(config.usedBytes / totalMax) * 100}%` }}
              className={`${getStorageColor(config.usedBytes, config.maxBytes)} border-r border-zinc-900 last:border-0`}
              title={`${config.label}: ${formatBytes(config.usedBytes)}`}
            />
          ))}
        </div>
      </section>

      {/* Dialogs */}
      {showScanDialog && (
        <Dialog
          isOpen={showScanDialog}
          onClose={() => setShowScanDialog(false)}
          title={`Found ${scanResults.length} videos`}
          description="Select videos to import into your library."
        >
          <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
            {scanResults.map((p) => (
              <div key={p.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <p className="font-bold text-sm">{p.id}</p>
                  <p className="text-xs text-zinc-500">{p.segments} segments • {p.path}</p>
                </div>
                <input 
                  type="checkbox" 
                  checked={selectedForImport.has(p.id)}
                  onChange={() => {
                    const next = new Set(selectedForImport);
                    if (next.has(p.id)) next.delete(p.id);
                    else next.add(p.id);
                    setSelectedForImport(next);
                  }}
                  className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
              </div>
            ))}
            {scanResults.length === 0 && (
              <p className="text-center py-8 text-zinc-500 italic">No HLS streams found in this bucket.</p>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <Button variant="ghost" onClick={() => setShowScanDialog(false)}>Cancel</Button>
            <Button 
              onClick={() => handleImport(configs.find(c => c.id === scanning) || configs[0])}
              disabled={selectedForImport.size === 0}
            >
              Import {selectedForImport.size} Selected
            </Button>
          </div>
        </Dialog>
      )}

      {deleteConfirmId && (
        <Dialog
          isOpen={!!deleteConfirmId}
          onClose={() => setDeleteConfirmId(null)}
          title="Delete Bucket Connection?"
          description="This will remove the connection to this bucket. No files will be deleted from Cloudflare."
        >
          <div className="flex justify-end gap-2 mt-6">
            <Button variant="ghost" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
            <Button 
              variant="destructive"
              onClick={() => handleDelete(deleteConfirmId)}
            >
              Delete Connection
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
