import { useState, useEffect } from "react";
import { db, auth } from "../firebase";
import { 
  doc, 
  getDoc, 
  setDoc,
  collection,
  query,
  where,
  getDocs,
  limit
} from "firebase/firestore";
import { AdConfig } from "../types";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Badge } from "./ui/Badge";
import { 
  PlayCircle, 
  Clock, 
  Save, 
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  ToggleLeft,
  ToggleRight
} from "lucide-react";
import { motion } from "framer-motion";
import { handleFirestoreError, OperationType } from "../lib/firestore-errors";
import { toast } from "sonner";

export function AdSettings() {
  const [config, setConfig] = useState<AdConfig>({
    id: "global",
    preRollUrl: "",
    midRollUrl: "",
    adPodSize: 3,
    breakDurationSeconds: 30,
    enabled: false,
    houseAds: [],
    useFallback: false,
    forceFrequency: 0
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error", text: string } | null>(null);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const docRef = doc(db, "settings", "ads");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setConfig({
            ...data,
            adPodSize: data.adPodSize || (data as any).midRollFrequency || 3,
            breakDurationSeconds: data.breakDurationSeconds || 30,
          } as AdConfig);
        }
        setLoading(false);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, "settings/ads");
        setLoading(false);
      }
    };

    fetchConfig();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const docRef = doc(db, "settings", "ads");
      await setDoc(docRef, config);
      setMessage({ type: "success", text: "Ad settings updated successfully." });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, "settings/ads");
      setMessage({ type: "error", text: "Failed to save ad settings." });
    } finally {
      setSaving(false);
    }
  };

  const handleUploadHouseAd = async (file: File) => {
    setSaving(true);
    try {
      // 0. Read duration via temporary video element
      const videoEl = document.createElement('video');
      videoEl.preload = 'metadata';
      videoEl.src = URL.createObjectURL(file);
      const duration = await new Promise<number>((resolve, reject) => {
        videoEl.onloadedmetadata = () => {
          const d = videoEl.duration;
          URL.revokeObjectURL(videoEl.src);
          if (!isFinite(d) || isNaN(d) || d <= 0) reject(new Error('Could not read duration'));
          else resolve(d);
        };
        videoEl.onerror = () => reject(new Error('Failed to load metadata'));
        setTimeout(() => reject(new Error('Timeout')), 10000);
      });

      // Validate duration matches break duration ± 2 seconds
      const expectedDuration = config.breakDurationSeconds || 30;
      if (Math.abs(duration - expectedDuration) > 2) {
        const validDurations = [15, 30, 60, 90, 120];
        const closest = validDurations.reduce((prev, curr) => 
          Math.abs(curr - duration) < Math.abs(prev - duration) ? curr : prev
        );
        toast.error(`House ad must be approximately ${expectedDuration}s to match your break duration. This file is ${duration.toFixed(1)}s. Standard durations are 15, 30, or 60 seconds. Closest standard: ${closest}s.`);
        setSaving(false);
        return;
      }

      // 1. Get active bucket config
      const cfQ = query(
        collection(db, "cloudflareConfigs"),
        where("userId", "==", auth.currentUser?.uid),
        where("isActive", "==", true),
        limit(1)
      );
      const cfSnap = await getDocs(cfQ);
      if (cfSnap.empty) {
        setMessage({ type: "error", text: "No active R2 bucket connected." });
        return;
      }
      const cfData = cfSnap.docs[0].data();
      const configId = cfSnap.docs[0].id;

      // 2. Get presigned URL
      const idToken = await auth.currentUser!.getIdToken();
      const mp4Key = `house-ads/${Date.now()}-${file.name.replace(/[^a-z0-9]/g, "-")}`;
      
      const presignResp = await fetch("/api/r2/presign-secure", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          configId,
          accountId: cfData.accountId,
          r2AccessKeyId: cfData.r2AccessKeyId,
          r2SecretAccessKey: cfData.r2SecretAccessKey,
          bucketName: cfData.bucketName,
          keys: [{ key: mp4Key, contentType: "video/mp4" }]
        }),
      });

      if (!presignResp.ok) {
        setMessage({ type: "error", text: "Failed to get upload URL" });
        return;
      }
      const { urls } = await presignResp.json();
      const { uploadUrl } = urls[0];

      // 3. Upload MP4 to R2
      const uploadResp = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": "video/mp4" },
      });

      if (!uploadResp.ok) {
        setMessage({ type: "error", text: "Failed to upload video to R2" });
        return;
      }

      // 4. Update config
      const newAd = {
        id: Date.now().toString(),
        name: file.name,
        type: 'promo' as const,
        url: `${cfData.publicBaseUrl}/${mp4Key}`,
        duration: duration, 
        weight: 5
      };
      setConfig({ ...config, houseAds: [...(config.houseAds || []), newAd] });
      setMessage({ type: "success", text: "House ad uploaded successfully." });
    } catch (error) {
      console.error(error);
      setMessage({ type: "error", text: "Failed to upload house ad." });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveHouseAd = async (index: number) => {
    const adToRemove = config.houseAds?.[index];
    if (!adToRemove) return;

    setSaving(true);
    try {
      // 1. Get active bucket config
      const cfQ = query(
        collection(db, "cloudflareConfigs"),
        where("userId", "==", auth.currentUser?.uid),
        where("isActive", "==", true),
        limit(1)
      );
      const cfSnap = await getDocs(cfQ);
      if (!cfSnap.empty) {
        const cfData = cfSnap.docs[0].data();
        const idToken = await auth.currentUser!.getIdToken();
        
        // Extract key from URL
        const urlParts = adToRemove.url.split("/");
        const key = `house-ads/${urlParts[urlParts.length - 1]}`;

        await fetch("/api/r2/delete-file", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            accountId: cfData.accountId,
            r2AccessKeyId: cfData.r2AccessKeyId,
            r2SecretAccessKey: cfData.r2SecretAccessKey,
            bucketName: cfData.bucketName,
            key
          }),
        });
      }

      const newAds = (config.houseAds || []).filter((_, i) => i !== index);
      setConfig({ ...config, houseAds: newAds });
      setMessage({ type: "success", text: "House ad removed." });
    } catch (error) {
      console.error(error);
      setMessage({ type: "error", text: "Failed to remove house ad." });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black text-zinc-900 tracking-tight">ADVERTISING SETTINGS</h2>
          <p className="text-zinc-500">Configure VAST/VMAP ad tags for your fast channels.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-zinc-100 p-1 rounded-full px-3">
            <span className="text-xs font-bold text-zinc-500 uppercase">Status</span>
            <button 
              onClick={() => setConfig({ ...config, enabled: !config.enabled })}
              className={`transition-colors ${config.enabled ? 'text-green-600' : 'text-zinc-400'}`}
            >
              {config.enabled ? <ToggleRight className="h-8 w-8" /> : <ToggleLeft className="h-8 w-8" />}
            </button>
          </div>
          <Button 
            onClick={handleSave} 
            disabled={saving}
            className="bg-zinc-900 text-white hover:bg-zinc-800"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save Changes
          </Button>
        </div>
      </div>

      {message && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-4 rounded-xl flex items-center gap-3 ${
            message.type === "success" ? "bg-green-50 text-green-700 border border-green-100" : "bg-red-50 text-red-700 border border-red-100"
          }`}
        >
          {message.type === "success" ? <CheckCircle2 className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
          <p className="text-sm font-medium">{message.text}</p>
        </motion.div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Pre-roll Config */}
        <Card className="p-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center">
              <PlayCircle className="h-6 w-6" />
            </div>
            <div>
              <h3 className="font-bold text-zinc-900">Pre-roll Ads</h3>
              <p className="text-xs text-zinc-500">Plays before the stream starts.</p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">VAST/VMAP URL</label>
            <Input 
              placeholder="https://ads.example.com/vast?..."
              value={config.preRollUrl || ""}
              onChange={(e) => setConfig({ ...config, preRollUrl: e.target.value })}
              className="bg-zinc-50 border-zinc-200"
            />
            <p className="text-[10px] text-zinc-400">
              Supports standard VAST 3.0/4.0 and VMAP tags.
            </p>
          </div>
        </Card>

        {/* Mid-roll Config */}
        <Card className="p-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center">
              <Clock className="h-6 w-6" />
            </div>
            <div>
              <h3 className="font-bold text-zinc-900">Mid-roll Ads</h3>
              <p className="text-xs text-zinc-500">Plays during the stream loop.</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">VAST/VMAP URL</label>
              <Input 
                placeholder="https://ads.example.com/midroll?..."
                value={config.midRollUrl || ""}
                onChange={(e) => setConfig({ ...config, midRollUrl: e.target.value })}
                className="bg-zinc-50 border-zinc-200"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Ads per break (pod size)</label>
                <Input 
                  type="number"
                  min={1}
                  max={20}
                  value={config.adPodSize || 3}
                  onChange={(e) => setConfig({ ...config, adPodSize: parseInt(e.target.value) })}
                  className="bg-zinc-50 border-zinc-200"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Break duration (sec)</label>
                <Input 
                  type="number"
                  min={10}
                  max={300}
                  value={config.breakDurationSeconds || 30}
                  onChange={(e) => setConfig({ ...config, breakDurationSeconds: parseInt(e.target.value) })}
                  className="bg-zinc-50 border-zinc-200"
                />
              </div>
            </div>
            <p className="text-[10px] text-zinc-400">Ad break positions are set in the Playlists editor. This setting controls how many ads play during each break.</p>
          </div>
        </Card>

        {/* House Ads Config */}
        <Card className="p-6 space-y-6 md:col-span-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center">
                <PlayCircle className="h-6 w-6" />
              </div>
              <div>
                <h3 className="font-bold text-zinc-900">House Ads & Station IDs</h3>
                <p className="text-xs text-zinc-500">Plays when SpringServe has no fill OR every Nth break.</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-zinc-500 uppercase">Use as Fallback</span>
                <button 
                  onClick={() => setConfig({ ...config, useFallback: !config.useFallback })}
                  className={`transition-colors ${config.useFallback ? 'text-green-600' : 'text-zinc-400'}`}
                >
                  {config.useFallback ? <ToggleRight className="h-6 w-6" /> : <ToggleLeft className="h-6 w-6" />}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-zinc-500 uppercase">Force Rotation (every N breaks)</span>
                <Input 
                  type="number"
                  min={0}
                  value={config.forceFrequency || 0}
                  onChange={(e) => setConfig({ ...config, forceFrequency: parseInt(e.target.value) })}
                  className="w-16 bg-zinc-50 border-zinc-200"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider">Upload House Ad (MP4)</label>
            <Input 
              type="file"
              accept="video/mp4"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  handleUploadHouseAd(e.target.files[0]);
                }
              }}
              className="bg-zinc-50 border-zinc-200"
            />
          </div>

          <div className="space-y-2">
            {config.houseAds?.map((ad, index) => (
              <div key={ad.id} className="flex items-center gap-4 p-3 bg-zinc-50 rounded-lg">
                <div className="h-10 w-10 bg-zinc-200 rounded flex items-center justify-center">
                  <PlayCircle className="h-5 w-5 text-zinc-500" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold">{ad.name}</p>
                  <p className="text-xs text-zinc-500">{ad.type}</p>
                </div>
                <div className="w-32">
                  <label className="text-[10px] text-zinc-500">Weight</label>
                  <Input 
                    type="range"
                    min={1}
                    max={10}
                    value={ad.weight}
                    onChange={(e) => {
                      const newAds = [...(config.houseAds || [])];
                      newAds[index].weight = parseInt(e.target.value);
                      setConfig({ ...config, houseAds: newAds });
                    }}
                  />
                </div>
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => handleRemoveHouseAd(index)}
                >
                  Delete
                </Button>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Preview/Info Section */}
      <Card className="p-8 bg-zinc-900 text-white border-none overflow-hidden relative">
        <div className="relative z-10 space-y-6">
          <div className="flex items-center gap-2">
            <Badge className="bg-zinc-800 text-zinc-400 border-none">PRO TIP</Badge>
            <h3 className="font-bold">Monetization Strategy</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="space-y-2">
              <div className="text-zinc-500 text-xs font-bold uppercase">Fill Rate</div>
              <p className="text-sm text-zinc-300">Use a waterfall of ad providers to ensure 100% fill rate for your music video channel.</p>
            </div>
            <div className="space-y-2">
              <div className="text-zinc-500 text-xs font-bold uppercase">User Experience</div>
              <p className="text-sm text-zinc-300">We recommend 1 ad break every 3-5 music videos to maintain high viewer retention.</p>
            </div>
            <div className="space-y-2">
              <div className="text-zinc-500 text-xs font-bold uppercase">Compliance</div>
              <p className="text-sm text-zinc-300">Ensure your ad tags are CORS-enabled for the FastFasts domain to prevent playback errors.</p>
            </div>
          </div>

          <div className="pt-4 border-t border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2 text-zinc-500 text-xs">
              <AlertCircle className="h-4 w-4" />
              <span>Ad settings apply to all active channels unless overridden.</span>
            </div>
            <a 
              href="https://docs.fastfasts.com/monetization" 
              target="_blank" 
              rel="noreferrer"
              className="text-xs font-bold text-white hover:underline flex items-center gap-1"
            >
              View Documentation
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>

        {/* Decorative background element */}
        <div className="absolute -right-20 -bottom-20 h-64 w-64 bg-zinc-800 rounded-full blur-3xl opacity-20" />
      </Card>
    </div>
  );
}
