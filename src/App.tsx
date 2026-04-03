import { useState, useEffect } from "react";
import { db, auth } from "./firebase";
import { collection, query, where, onSnapshot, doc, getDoc, setDoc } from "firebase/firestore";
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
import { AdminDashboard } from "./components/AdminDashboard";
import { InviteManager } from "./components/InviteManager";
import { InvitationList } from "./components/InvitationList";
import { UserProfile } from "./components/UserProfile";
import { motion, AnimatePresence } from "framer-motion";
import { Toaster } from "sonner";

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingInvites, setPendingInvites] = useState(0);

  // Handle routes
  const isEmbed = window.location.pathname.startsWith("/embed/");
  const embedId = isEmbed ? window.location.pathname.split("/")[2] : null;
  const isSubmitPortal = window.location.pathname === "/submit";

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const userDoc = await getDoc(doc(db, "users", u.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          if (u.email === "lookhumaster@gmail.com" || u.email === "rpduece@gmail.com") {
            data.role = "master_admin";
          }
          setProfile(data);
        } else {
          // If the user document doesn't exist, create a default one
          const defaultProfile = { 
            role: (u.email && (u.email === "lookhumaster@gmail.com" || u.email === "rpduece@gmail.com")) ? "master_admin" : "user",
            email: u.email,
            uid: u.uid,
            createdAt: new Date().toISOString()
          };
          setProfile(defaultProfile);
          // Also create it in Firestore
          await setDoc(doc(db, "users", u.uid), defaultProfile);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    // Listen for pending submissions count
    const submissionsQ = query(
      collection(db, "submissions"),
      where("status", "==", "pending")
    );
    const unsubSubmissions = onSnapshot(submissionsQ, (snap) => {
      setPendingCount(snap.size);
    });

    // Listen for pending invitations for this user
    const invitesQ = query(
      collection(db, "invitations"),
      where("email", "==", user.email),
      where("status", "==", "pending")
    );
    const unsubInvites = onSnapshot(invitesQ, (snap) => {
      setPendingInvites(snap.size);
    });

    return () => {
      unsubSubmissions();
      unsubInvites();
    };
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
      case "admin":
        return <AdminDashboard />;
      case "profile":
        return <UserProfile user={user} />;
      case "invites":
        return <InviteManager accountId={profile?.accountId} />;
      case "my-invites":
        return <InvitationList userEmail={user.email} />;
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
        pendingInvites={pendingInvites}
        role={profile?.role}
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
