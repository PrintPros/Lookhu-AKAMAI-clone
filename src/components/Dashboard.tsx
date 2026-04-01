import React, { useState, useEffect } from "react";
import { Activity, Radio, Library, ListMusic, TrendingUp, Users, Inbox, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/Card";
import { collection, query, where, onSnapshot, orderBy, limit } from "firebase/firestore";
import { db, auth } from "../firebase";
import { Channel, Media } from "../types";
import { handleFirestoreError, OperationType } from "../lib/firestore-errors";

const relativeTime = (dateStr: string): string => {
  if (!dateStr) return "Just now";
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return "Just now";
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;
    const diffInDays = Math.floor(diffInHours / 24);
    return `${diffInDays}d ago`;
  } catch (e) {
    return "Recently";
  }
};

export function Dashboard() {
  const [stats, setStats] = useState({
    channels: 0,
    media: 0,
    playlists: 0,
    liveChannels: 0,
    pendingSubmissions: 0,
    totalArtists: 0
  });

  const [recentEvents, setRecentEvents] = useState<any[]>([]);

  useEffect(() => {
    if (!auth.currentUser) return;

    const channelsQ = query(
      collection(db, "channels"),
      where("userId", "==", auth.currentUser.uid)
    );
    const mediaQ = query(
      collection(db, "media"),
      where("userId", "==", auth.currentUser.uid),
      orderBy("createdAt", "desc")
    );
    const playlistsQ = query(
      collection(db, "playlists"),
      where("userId", "==", auth.currentUser.uid)
    );
    const submissionsQ = query(collection(db, "submissions"));

    const unsubChannels = onSnapshot(channelsQ, (snapshot) => {
      const channels = snapshot.docs.map(d => d.data() as Channel);
      setStats(prev => ({ 
        ...prev, 
        channels: channels.length,
        liveChannels: channels.filter(c => c.status === "online").length
      }));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "channels");
    });

    const unsubMedia = onSnapshot(mediaQ, (snapshot) => {
      const mediaDocs = snapshot.docs.map(d => d.data() as Media);
      const uniqueArtists = new Set(mediaDocs.map(m => m.artistName).filter(Boolean));
      
      setStats(prev => ({ 
        ...prev, 
        media: snapshot.docs.length,
        totalArtists: uniqueArtists.size
      }));

      // Store 4 most recent media docs as events
      const recent = snapshot.docs.slice(0, 4).map(doc => {
        const m = doc.data() as Media;
        return {
          event: "Video Uploaded",
          target: `${m.artistName || "Unknown"} — ${m.songTitle || m.name}`,
          time: relativeTime(m.createdAt),
          type: "info"
        };
      });
      setRecentEvents(recent);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "media");
    });

    const unsubPlaylists = onSnapshot(playlistsQ, (snapshot) => {
      setStats(prev => ({ ...prev, playlists: snapshot.docs.length }));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "playlists");
    });

    const unsubSubmissions = onSnapshot(submissionsQ, (snapshot) => {
      const submissions = snapshot.docs.map(d => d.data());
      setStats(prev => ({ 
        ...prev, 
        pendingSubmissions: submissions.filter(s => s.status === "pending").length 
      }));
    });

    return () => {
      unsubChannels();
      unsubMedia();
      unsubPlaylists();
      unsubSubmissions();
    };
  }, []);

  const statCards = [
    { label: "Live Channels", value: stats.liveChannels, icon: Radio, color: "text-emerald-500", bg: "bg-emerald-50" },
    { label: "Total Media", value: stats.media, icon: Library, color: "text-blue-500", bg: "bg-blue-50" },
    { label: "Playlists", value: stats.playlists, icon: ListMusic, color: "text-purple-500", bg: "bg-purple-50" },
    { label: "Pending Submissions", value: stats.pendingSubmissions, icon: Inbox, color: "text-amber-500", bg: "bg-amber-50" },
    { label: "Total Artists", value: stats.totalArtists, icon: Users, color: "text-pink-500", bg: "bg-pink-50" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900 font-sans">Dashboard Overview</h2>
        <p className="text-zinc-500">Welcome back to the RAG.org Fast Channel Platform.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {statCards.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wider text-zinc-500">{stat.label}</CardTitle>
              <div className={`${stat.bg} p-2 rounded-lg`}>
                <stat.icon className={`h-4 w-4 ${stat.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-zinc-400" />
              Platform Activity
            </CardTitle>
            <CardDescription>Real-time analytics will appear here once channels are live.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[240px] flex items-center justify-center border-2 border-dashed border-zinc-100 rounded-lg bg-zinc-50/50">
              <div className="text-center">
                <p className="text-sm text-zinc-500">Real-time analytics will appear here once channels are live.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-zinc-400" />
              Recent Events
            </CardTitle>
            <CardDescription>System logs and submission updates.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {recentEvents.length > 0 ? (
              recentEvents.map((log, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <div className={`mt-1 h-2 w-2 rounded-full ${
                    log.type === "success" ? "bg-emerald-500" : 
                    log.type === "warning" ? "bg-amber-500" : "bg-blue-500"
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-zinc-900">{log.event}</p>
                    <p className="text-zinc-500 truncate">{log.target}</p>
                  </div>
                  <span className="text-xs text-zinc-400">{log.time}</span>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-zinc-500 text-sm">
                No recent activity found.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
