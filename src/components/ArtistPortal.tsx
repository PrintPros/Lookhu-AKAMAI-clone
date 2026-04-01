import React, { useState, useEffect, useRef } from "react";
import { 
  Music, 
  Upload, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Instagram, 
  Twitter, 
  Youtube, 
  Globe,
  FileVideo,
  Settings
} from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Card } from "./ui/Card";
import { motion, AnimatePresence } from "framer-motion";
import { db, auth } from "../firebase";
import { collection, addDoc, query, where, getDocs, limit } from "firebase/firestore";
import { handleFirestoreError, OperationType } from "../lib/firestore-errors";
import { toast } from "sonner";
import { CloudflareConfig } from "../types";

export function ArtistPortal() {
  const [step, setStep] = useState<"form" | "uploading" | "success">("form");
  const [formData, setFormData] = useState({
    artistName: "",
    songTitle: "",
    genre: "hiphop",
    email: "",
    instagramUrl: "",
    twitterUrl: "",
    youtubeUrl: "",
    websiteUrl: "",
    rightsConfirmed: false
  });
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [activeConfig, setActiveConfig] = useState<CloudflareConfig | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.size > 500 * 1024 * 1024) {
        toast.error("File size exceeds 500MB limit.");
        return;
      }
      setFile(selectedFile);
    }
  };

  useEffect(() => {
    const fetchActiveConfig = async () => {
      try {
        const q = query(
          collection(db, "cloudflareConfigs"),
          where("isActive", "==", true),
          limit(1)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          setActiveConfig({ id: snap.docs[0].id, ...snap.docs[0].data() } as CloudflareConfig);
        }
      } catch (err) {
        console.error("Error fetching CF config:", err);
      } finally {
        setIsLoadingConfig(false);
      }
    };
    fetchActiveConfig();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !formData.rightsConfirmed || !activeConfig) return;

    setStep("uploading");
    setError(null);
    setUploadProgress(0);

    try {
      setStatus("Submitting information...");
      
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/submission", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          ...formData,
          configId: activeConfig.id,
          // Note: File upload will be handled in a future step
          // For now we just submit the metadata
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Submission failed");
      }

      setStep("success");

    } catch (err: any) {
      console.error("Submission Error:", err);
      setError(err.message);
      setStep("form");
    }
  };

  if (isLoadingConfig) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="h-12 w-12 text-white animate-spin" />
      </div>
    );
  }

  if (!activeConfig) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6 text-white">
        <Card className="max-w-md w-full p-8 bg-zinc-900 border-zinc-800 text-center space-y-6">
          <Settings className="h-16 w-16 text-zinc-700 mx-auto" />
          <h2 className="text-2xl font-black uppercase tracking-tight">Submissions Unavailable</h2>
          <p className="text-zinc-400">
            {auth.currentUser 
              ? "You need to set up and activate a Cloudflare R2 configuration in Settings before you can submit videos."
              : "We are currently not accepting new submissions. Please check back later."}
          </p>
          {auth.currentUser && (
            <Button 
              onClick={() => window.location.href = "/settings"}
              className="w-full bg-white text-black hover:bg-zinc-200 font-bold"
            >
              Go to Settings
            </Button>
          )}
        </Card>
      </div>
    );
  }

  if (step === "success") {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="max-w-md w-full text-center space-y-6"
        >
          <div className="h-20 w-20 bg-green-500/20 text-green-500 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-12 w-12" />
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight">SUBMISSION RECEIVED!</h1>
          <p className="text-zinc-400">
            Your video has been submitted for review. We'll be in touch at <span className="text-white font-bold">{formData.email}</span> once our curators have reviewed your work.
          </p>
          <Button 
            onClick={() => window.location.reload()}
            className="bg-white text-black hover:bg-zinc-200 w-full py-6 text-lg font-bold"
          >
            Submit Another Video
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white selection:bg-white selection:text-black">
      {/* Header */}
      <header className="p-8 border-b border-zinc-900">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-white text-black flex items-center justify-center rounded-lg font-black text-xl">R</div>
            <h1 className="text-2xl font-black tracking-tighter">RAG.ORG <span className="text-zinc-500 font-medium tracking-normal text-sm ml-2">ARTIST PORTAL</span></h1>
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm font-bold text-zinc-500 uppercase tracking-widest">
            <a href="#" className="hover:text-white transition-colors">Guidelines</a>
            <a href="#" className="hover:text-white transition-colors">FAQ</a>
            <a href="#" className="hover:text-white transition-colors">Contact</a>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto py-16 px-6">
        {step === "uploading" ? (
          <div className="py-20 text-center space-y-8">
            <div className="relative h-32 w-32 mx-auto">
              <Loader2 className="h-32 w-32 text-white animate-spin opacity-20" />
              <div className="absolute inset-0 flex items-center justify-center">
                <FileVideo className="h-12 w-12 text-white" />
              </div>
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-black uppercase tracking-tight">{status}</h2>
              <p className="text-zinc-500">Please do not close this window until the process is complete.</p>
            </div>
            <div className="max-w-xs mx-auto h-1.5 bg-zinc-900 rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-white"
                animate={{ width: ["0%", "100%"] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-12">
            <div className="space-y-4">
              <h2 className="text-5xl font-black tracking-tighter leading-none">SUBMIT YOUR <br/>MUSIC VIDEO.</h2>
              <p className="text-xl text-zinc-400 max-w-xl">
                Join the RAG.org network. We broadcast the best independent music videos to thousands of viewers worldwide.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-10">
              {/* Basic Info */}
              <section className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Artist / Band Name *</label>
                    <Input 
                      required
                      value={formData.artistName}
                      onChange={e => setFormData({...formData, artistName: e.target.value})}
                      className="bg-zinc-900 border-zinc-800 h-14 text-lg focus:border-white transition-colors"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Song Title *</label>
                    <Input 
                      required
                      value={formData.songTitle}
                      onChange={e => setFormData({...formData, songTitle: e.target.value})}
                      className="bg-zinc-900 border-zinc-800 h-14 text-lg focus:border-white transition-colors"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Genre *</label>
                    <select 
                      required
                      value={formData.genre}
                      onChange={e => setFormData({...formData, genre: e.target.value})}
                      className="w-full bg-zinc-900 border-zinc-800 h-14 rounded-md px-4 text-lg focus:border-white transition-colors appearance-none"
                    >
                      <option value="hiphop">Hip Hop</option>
                      <option value="rock">Rock</option>
                      <option value="edm">EDM</option>
                      <option value="rnb">R&B</option>
                      <option value="latin">Latin</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Your Email *</label>
                    <Input 
                      required
                      type="email"
                      value={formData.email}
                      onChange={e => setFormData({...formData, email: e.target.value})}
                      className="bg-zinc-900 border-zinc-800 h-14 text-lg focus:border-white transition-colors"
                    />
                  </div>
                </div>
              </section>

              {/* Socials */}
              <section className="space-y-6">
                <h3 className="text-sm font-bold text-zinc-700 uppercase tracking-[0.3em]">Social Links (Optional)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="relative">
                    <Instagram className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-zinc-600" />
                    <Input 
                      placeholder="Instagram URL"
                      value={formData.instagramUrl}
                      onChange={e => setFormData({...formData, instagramUrl: e.target.value})}
                      className="bg-zinc-900 border-zinc-800 h-14 pl-12 focus:border-white transition-colors"
                    />
                  </div>
                  <div className="relative">
                    <Twitter className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-zinc-600" />
                    <Input 
                      placeholder="Twitter / X URL"
                      value={formData.twitterUrl}
                      onChange={e => setFormData({...formData, twitterUrl: e.target.value})}
                      className="bg-zinc-900 border-zinc-800 h-14 pl-12 focus:border-white transition-colors"
                    />
                  </div>
                  <div className="relative">
                    <Youtube className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-zinc-600" />
                    <Input 
                      placeholder="YouTube URL"
                      value={formData.youtubeUrl}
                      onChange={e => setFormData({...formData, youtubeUrl: e.target.value})}
                      className="bg-zinc-900 border-zinc-800 h-14 pl-12 focus:border-white transition-colors"
                    />
                  </div>
                  <div className="relative">
                    <Globe className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-zinc-600" />
                    <Input 
                      placeholder="Website URL"
                      value={formData.websiteUrl}
                      onChange={e => setFormData({...formData, websiteUrl: e.target.value})}
                      className="bg-zinc-900 border-zinc-800 h-14 pl-12 focus:border-white transition-colors"
                    />
                  </div>
                </div>
              </section>

              {/* File Upload */}
              <section className="space-y-6">
                <h3 className="text-sm font-bold text-zinc-700 uppercase tracking-[0.3em]">Video File</h3>
                <div className="relative group">
                  <input 
                    type="file" 
                    accept="video/mp4"
                    onChange={handleFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                  <div className={`p-12 border-2 border-dashed rounded-2xl transition-all flex flex-col items-center justify-center gap-4 ${
                    file ? 'border-white bg-white/5' : 'border-zinc-800 group-hover:border-zinc-600'
                  }`}>
                    <Upload className={`h-10 w-10 ${file ? 'text-white' : 'text-zinc-700'}`} />
                    <div className="text-center">
                      <p className="text-lg font-bold">{file ? file.name : "Select MP4 Video"}</p>
                      <p className="text-sm text-zinc-500">Max file size: 500MB</p>
                    </div>
                  </div>
                </div>
              </section>

              {/* Confirmation */}
              <section className="space-y-6">
                <label className="flex items-start gap-4 cursor-pointer group">
                  <input 
                    type="checkbox" 
                    required
                    checked={formData.rightsConfirmed}
                    onChange={e => setFormData({...formData, rightsConfirmed: e.target.checked})}
                    className="mt-1 h-5 w-5 rounded border-zinc-800 bg-zinc-900 text-white focus:ring-white"
                  />
                  <span className="text-sm text-zinc-400 group-hover:text-zinc-300 transition-colors">
                    I confirm that I own all necessary rights to this music video and grant RAG.org permission to broadcast it on their network.
                  </span>
                </label>

                {error && (
                  <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl flex items-center gap-3">
                    <AlertCircle className="h-5 w-5" />
                    <p className="text-sm font-bold">{error}</p>
                  </div>
                )}

                <Button 
                  type="submit"
                  disabled={!file || !formData.rightsConfirmed}
                  className="w-full h-16 bg-white text-black hover:bg-zinc-200 text-xl font-black uppercase tracking-tighter disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Submit for Review
                </Button>
              </section>
            </form>
          </div>
        )}
      </main>

      <footer className="py-20 border-t border-zinc-900 text-center">
        <p className="text-zinc-600 text-sm">© 2026 RAG.ORG FAST CHANNEL PLATFORM. ALL RIGHTS RESERVED.</p>
      </footer>
    </div>
  );
}
