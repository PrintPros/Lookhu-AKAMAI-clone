import { useState, useEffect } from "react";
import { db } from "../firebase";
import { 
  doc, 
  getDoc, 
  setDoc
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

export function AdSettings() {
  const [config, setConfig] = useState<AdConfig>({
    id: "global",
    preRollUrl: "",
    midRollUrl: "",
    midRollFrequency: 3,
    enabled: false
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
          setConfig(docSnap.data() as AdConfig);
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

            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Frequency</label>
              <div className="flex items-center gap-3">
                <Input 
                  type="number"
                  min={1}
                  max={20}
                  value={config.midRollFrequency || 3}
                  onChange={(e) => setConfig({ ...config, midRollFrequency: parseInt(e.target.value) })}
                  className="w-24 bg-zinc-50 border-zinc-200"
                />
                <span className="text-sm text-zinc-500">videos between ad breaks</span>
              </div>
            </div>
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
