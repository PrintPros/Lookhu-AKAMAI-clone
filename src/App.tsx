import { useState, useEffect } from "react";
import { db, auth } from "./firebase";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { Sidebar } from "./components/Sidebar";
import { Dashboard } from "./components/Dashboard";
import { ChannelManager } from "./components/ChannelManager";
import { MediaLibrary } from "./components/MediaLibrary";
import { PlaylistEditor } from "./components/PlaylistEditor";
import { PlatformSettings } from "./components/PlatformSettings";
import { EmbedOptions } from "./components/EmbedOptions";
import { EmbedPlayer } from "./components/EmbedPlayer";
import { ArtistSubmissions } from "./components/ArtistSubmissions";
import { CloudflareSettings } from "./components/CloudflareSettings";
import { EPGViewer } from "./components/EPGViewer";
import { AdSettings } from "./components/AdSettings";
import { Auth } from "./components/Auth";
import { ArtistPortal } from "./components/ArtistPortal";
import { motion, AnimatePresence } from "framer-motion";
import { Toaster } from "sonner";

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [pendingCount, setPendingCount] = useState(0);

  // Handle routes
  const isEmbed = window.location.pathname.startsWith("/embed/");
  const embedId = isEmbed ? window.location.pathname.split("/")[2] : null;
  const isSubmitPortal = window.location.pathname === "/submit";

  useEffect(() => {
    console.log("Setting up onAuthStateChanged listener...");

    // Timeout fallback — if auth doesn't respond in 5 seconds, stop loading
    const timeout = setTimeout(() => {
      console.warn("Auth timeout — proceeding without auth");
      setLoading(false);
    }, 5000);

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      console.log("Auth state changed. User:", u ? u.uid : "null");
      clearTimeout(timeout);
      setUser(u);
      setLoading(false);
    });

    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) return;

    // Listen for pending submissions count
    const submissionsQ = query(
      collection(db, "submissions"),
      where("status", "==", "pending")
    );
    const unsubscribe = onSnapshot(submissionsQ, (snap) => {
      setPendingCount(snap.size);
    });
    return () => unsubscribe();
  }, [user]);

  const handleLogout = async () => {
    await signOut(auth);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-zinc-900"></div>
      </div>
    );
  }

  if (isSubmitPortal) {
    return <ArtistPortal />;
  }

  if (isEmbed && embedId) {
    return (
      <div className="w-screen h-screen bg-black overflow-hidden">
        <EmbedPlayer channelId={embedId} />
      </div>
    );
  }

  if (!user) {
    return <Auth onSuccess={() => {}} />;
  }

  const renderContent = () => {
    switch (activeTab) {
      case "dashboard":
        return <Dashboard />;
      case "channels":
        return <ChannelManager setActiveTab={setActiveTab} />;
      case "media":
        return <MediaLibrary />;
      case "playlists":
        return <PlaylistEditor />;
      case "embed":
        return <EmbedOptions />;
      case "submissions":
        return <ArtistSubmissions />;
      case "cloudflare":
        return <CloudflareSettings />;
      case "epg":
        return <EPGViewer />;
      case "ads":
        return <AdSettings />;
      case "settings":
        return <PlatformSettings />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="flex h-screen bg-zinc-50 overflow-hidden">
      <Toaster position="top-right" richColors />
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        onLogout={handleLogout} 
        pendingSubmissions={pendingCount}
      />
      
      <main className="flex-1 overflow-y-auto p-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="mx-auto max-w-7xl"
          >
            {renderContent()}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
