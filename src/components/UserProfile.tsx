import React, { useState, useEffect } from "react";
import { db } from "../firebase";
import { collection, query, where, getDocs, onSnapshot } from "firebase/firestore";
import { User, Video, Radio, Mail } from "lucide-react";
import { InvitationList } from "./InvitationList";

interface UserProfileProps {
  user: any;
}

export function UserProfile({ user }: UserProfileProps) {
  const [videoCount, setVideoCount] = useState(0);
  const [channels, setChannels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) return;

    const fetchData = async () => {
      setLoading(true);
      
      // Fetch videos
      const videosQ = query(collection(db, "media"), where("userId", "==", user.uid));
      const videosSnap = await getDocs(videosQ);
      setVideoCount(videosSnap.size);

      // Fetch channels
      const channelsQ = query(collection(db, "channels"), where("userId", "==", user.uid));
      const unsubscribeChannels = onSnapshot(channelsQ, (snap) => {
        setChannels(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      });

      setLoading(false);
      return () => unsubscribeChannels();
    };

    fetchData();
  }, [user?.uid]);

  if (loading) return <div className="animate-pulse">Loading profile...</div>;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-black tracking-tight text-zinc-900 uppercase">My Profile</h2>
        <p className="text-sm text-zinc-500">Manage your account information and view your activity.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl border border-zinc-200 shadow-sm col-span-1">
          <div className="flex items-center gap-4 mb-6">
            <div className="h-16 w-16 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-400">
              <User className="h-8 w-8" />
            </div>
            <div>
              <h3 className="font-bold text-zinc-900">{user.displayName || "Anonymous"}</h3>
              <p className="text-sm text-zinc-500">{user.email}</p>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-bold text-zinc-500 uppercase">User ID</p>
            <p className="text-sm font-mono bg-zinc-100 p-2 rounded">{user.uid}</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-zinc-200 shadow-sm col-span-1">
          <div className="flex items-center gap-3 mb-4">
            <Video className="h-5 w-5 text-zinc-500" />
            <h3 className="font-bold text-zinc-900">Videos</h3>
          </div>
          <p className="text-4xl font-black text-zinc-900">{videoCount}</p>
          <p className="text-sm text-zinc-500">Total videos uploaded</p>
        </div>

        <div className="bg-white p-6 rounded-xl border border-zinc-200 shadow-sm col-span-1">
          <div className="flex items-center gap-3 mb-4">
            <Radio className="h-5 w-5 text-zinc-500" />
            <h3 className="font-bold text-zinc-900">Channels</h3>
          </div>
          <p className="text-4xl font-black text-zinc-900">{channels.length}</p>
          <p className="text-sm text-zinc-500">Channels managed</p>
        </div>
      </div>

      <InvitationList userEmail={user.email} />
    </div>
  );
}
