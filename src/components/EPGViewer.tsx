import React, { useState, useEffect, useMemo } from "react";
import { auth, db } from "../firebase";
import { toast } from "sonner";
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc,
  getDoc,
  getDocs
} from "firebase/firestore";
import { EPGEntry, Channel, Playlist, Media } from "../types";
import { Card } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { 
  Music, 
  Clock, 
  ChevronDown, 
  ChevronUp, 
  Upload, 
  Trash2, 
  Instagram, 
  Twitter, 
  Youtube, 
  Radio,
  Loader2
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { handleFirestoreError, OperationType } from "../lib/firestore-errors";
import { cn } from "../lib/utils";

interface EPGViewerProps {
  channelId?: string;
  epgData?: EPGEntry[];
  profile: any;
}

const EPOCH = 1704067200; // Jan 1 2024 00:00:00 UTC

export function EPGViewer({ channelId, epgData: externalEpg, profile }: EPGViewerProps) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(channelId || null);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [mediaItems, setMediaItems] = useState<Media[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [importedEpg, setImportedEpg] = useState<EPGEntry[] | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [currentTime, setCurrentTime] = useState(Date.now() / 1000);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [allMedia, setAllMedia] = useState<Media[]>([]);
  const [viewMode, setViewMode] = useState<"cards" | "grid">("grid");

  // Sync selectedChannelId with prop
  useEffect(() => {
    if (channelId) {
      setSelectedChannelId(channelId);
    }
  }, [channelId]);

  // Update clock every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now() / 1000), 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch all channels, playlists, and media for high-level view
  useEffect(() => {
    if (!auth.currentUser || !profile) return;

    const isMaster = profile.role === "master_admin";
    const targetUserId = isMaster ? null : (profile.ownerUserId || auth.currentUser.uid);

    let channelsQ = query(collection(db, "channels"));
    let playlistsQ = query(collection(db, "playlists"));
    let mediaQ = query(collection(db, "media"));

    if (targetUserId) {
      channelsQ = query(channelsQ, where("userId", "==", targetUserId));
      playlistsQ = query(playlistsQ, where("userId", "==", targetUserId));
      mediaQ = query(mediaQ, where("userId", "==", targetUserId));
    }

    const unsubChannels = onSnapshot(channelsQ, (snap) => {
      setChannels(snap.docs.map(d => ({ id: d.id, ...d.data() } as Channel)));
      setChannelsLoading(false);
    }, (error) => {
      console.error("Channels fetch error:", error);
      setChannelsLoading(false);
    });

    const unsubPlaylists = onSnapshot(playlistsQ, (snap) => {
      setPlaylists(snap.docs.map(d => ({ id: d.id, ...d.data() } as Playlist)));
    });

    const unsubMedia = onSnapshot(mediaQ, (snap) => {
      setAllMedia(snap.docs.map(d => ({ id: d.id, ...d.data() } as Media)));
    });

    return () => {
      unsubChannels();
      unsubPlaylists();
      unsubMedia();
    };
  }, [profile]);

  useEffect(() => {
    if (!selectedChannelId) {
      setChannel(null);
      setPlaylist(null);
      setMediaItems([]);
      setDetailsLoading(false);
      return;
    }

    setDetailsLoading(true);
    const fetchChannelData = async () => {
      try {
        const channelDoc = await getDoc(doc(db, "channels", selectedChannelId));
        if (channelDoc.exists()) {
          const cData = { id: channelDoc.id, ...channelDoc.data() } as Channel;
          setChannel(cData);
          
          if (cData.playlistId) {
            const playlistDoc = await getDoc(doc(db, "playlists", cData.playlistId));
            if (playlistDoc.exists()) {
              const pData = { id: playlistDoc.id, ...playlistDoc.data() } as Playlist;
              setPlaylist(pData);
              
              if (pData.items && pData.items.length > 0) {
                const mediaPromises = [];
                const mediaIds = pData.items.map(i => i.mediaId).filter(Boolean) as string[];
                for (let i = 0; i < mediaIds.length; i += 10) {
                  const chunk = mediaIds.slice(i, i + 10);
                  const q = query(collection(db, "media"), where("__name__", "in", chunk));
                  mediaPromises.push(getDocs(q));
                }
                const snapshots = await Promise.all(mediaPromises);
                const fetchedMedia = snapshots.flatMap(snap => snap.docs.map(d => ({ id: d.id, ...d.data() } as Media)));
                const sortedMedia = mediaIds.map(id => fetchedMedia.find(item => item.id === id)).filter(Boolean) as Media[];
                setMediaItems(sortedMedia);
              } else {
                setMediaItems([]);
              }
            } else {
              setPlaylist(null);
              setMediaItems([]);
            }
          } else {
            setPlaylist(null);
            setMediaItems([]);
          }
        }
      } catch (error) {
        console.error("EPG details fetch error:", error);
      } finally {
        setDetailsLoading(false);
      }
    };

    fetchChannelData();
  }, [selectedChannelId]);

  const loading = selectedChannelId ? detailsLoading : channelsLoading;

  const getDerivedEpg = (p: Playlist | null, mItems: Media[]) => {
    if (!p || mItems.length === 0) return [];
    const totalDuration = mItems.reduce((acc, curr) => acc + (curr.duration || 0), 0);
    if (totalDuration === 0) return [];

    const startEpoch = channel?.epoch || EPOCH;
    const timeSinceEpoch = currentTime - startEpoch;
    const loopStartOffset = Math.floor(timeSinceEpoch / totalDuration) * totalDuration;
    
    const entries: EPGEntry[] = [];
    let runningTime = startEpoch + loopStartOffset;

    for (let i = 0; i < 2; i++) {
      for (const media of mItems) {
        const duration = media.duration || 0;
        entries.push({
          mediaId: media.id,
          startTime: runningTime,
          endTime: runningTime + duration,
          artistName: media.artistName || "Unknown Artist",
          songTitle: media.songTitle || media.name,
          genre: media.genre || "other",
          instagramUrl: media.instagramUrl,
          twitterUrl: media.twitterUrl,
          youtubeUrl: media.youtubeUrl,
          thumbnailUrl: media.thumbnailUrl,
          isAdBreak: media.adBreakAfter
        });
        runningTime += duration;
      }
    }
    return entries;
  };

  const derivedEpg = useMemo(() => {
    if (externalEpg) return externalEpg;
    if (importedEpg) return importedEpg;
    return getDerivedEpg(playlist, mediaItems);
  }, [playlist, mediaItems, currentTime, externalEpg, importedEpg]);

  const getNowAndNext = (epg: EPGEntry[]) => {
    const now = epg.find(e => currentTime >= e.startTime && currentTime < e.endTime);
    const future = epg.filter(e => e.startTime > currentTime).slice(0, 3);
    return { nowPlaying: now, comingUp: future };
  };

  const { nowPlaying, comingUp } = useMemo(() => getNowAndNext(derivedEpg), [derivedEpg, currentTime]);

  const displayName = (e: EPGEntry) => e.artistName && e.songTitle 
    ? `${e.artistName} — ${e.songTitle}` 
    : e.songTitle || e.artistName || "Unknown Program";

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        setImportedEpg(json);
      } catch (err) {
        toast.error("Invalid JSON file format.");
      }
    };
    reader.readAsText(file);
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleTimeString([], { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const formatTimeRemaining = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <Loader2 className="h-10 w-10 animate-spin text-zinc-900" />
        <p className="text-zinc-500 font-medium animate-pulse">Loading Program Guide...</p>
      </div>
    );
  }

  // High-level view for all active channels
  if (!selectedChannelId) {
    const activeChannels = channels.filter(c => c.status === "online");
    
    // Grid Time Slots (3 hours in 30min increments)
    const gridStart = Math.floor(currentTime / 1800) * 1800;
    const gridEnd = gridStart + (4 * 3600); // 4 hours
    const timeSlots = [];
    for (let t = gridStart; t < gridEnd; t += 1800) {
      timeSlots.push(t);
    }

    return (
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-zinc-900">Electronic Program Guide</h2>
            <p className="text-zinc-500">Live schedules for all active channels.</p>
          </div>
          <div className="flex items-center gap-2 bg-zinc-100 p-1 rounded-lg">
            <Button 
              variant={viewMode === "grid" ? "default" : "ghost"} 
              size="sm" 
              onClick={() => setViewMode("grid")}
              className="text-xs h-8"
            >
              Grid View
            </Button>
            <Button 
              variant={viewMode === "cards" ? "default" : "ghost"} 
              size="sm" 
              onClick={() => setViewMode("cards")}
              className="text-xs h-8"
            >
              Card View
            </Button>
          </div>
        </div>

        {viewMode === "grid" ? (
          <Card className="overflow-hidden border-zinc-200">
            <div className="overflow-x-auto">
              <div className="min-w-[1200px]">
                {/* Time Header */}
                <div className="flex border-b border-zinc-200 bg-zinc-50">
                  <div className="w-48 shrink-0 p-4 border-r border-zinc-200 font-bold text-xs text-zinc-400 uppercase tracking-wider">
                    Channels
                  </div>
                  <div className="flex-1 flex relative">
                    {timeSlots.map(t => (
                      <div key={t} className="w-[200px] shrink-0 p-4 text-xs font-bold text-zinc-500 border-r border-zinc-100">
                        {formatTime(t)}
                      </div>
                    ))}
                    {/* Current Time Indicator */}
                    <div 
                      className="absolute top-0 bottom-0 w-px bg-red-500 z-20"
                      style={{ left: `${((currentTime - gridStart) / (gridEnd - gridStart)) * 100}%` }}
                    >
                      <div className="absolute top-0 -left-1 w-2 h-2 bg-red-500 rounded-full" />
                    </div>
                  </div>
                </div>

                {/* Channel Rows */}
                <div className="divide-y divide-zinc-100">
                  {activeChannels.map(c => {
                    const p = playlists.find(pl => pl.id === c.playlistId);
                    const mItems = (p?.items || []).map(item => allMedia.find(m => m.id === item.mediaId)).filter(Boolean) as Media[];
                    const epg = getDerivedEpg(p || null, mItems);
                    
                    // Filter programs that overlap with our grid window
                    const gridPrograms = epg.filter(entry => 
                      (entry.startTime >= gridStart && entry.startTime < gridEnd) ||
                      (entry.endTime > gridStart && entry.endTime <= gridEnd) ||
                      (entry.startTime <= gridStart && entry.endTime >= gridEnd)
                    );

                    return (
                      <div key={c.id} className="flex group hover:bg-zinc-50/50 transition-colors">
                        <div className="w-48 shrink-0 p-4 border-r border-zinc-200 flex items-center gap-3 bg-white sticky left-0 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.02)]">
                          <div className="h-8 w-8 rounded bg-zinc-900 text-white flex items-center justify-center font-bold text-xs shrink-0">
                            {c.name.charAt(0)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-zinc-900 truncate">{c.name}</p>
                            <p className="text-[10px] text-zinc-400 font-medium uppercase tracking-tighter">Channel {c.channelSlug}</p>
                          </div>
                        </div>
                        
                        <div className="flex-1 flex relative h-20 overflow-hidden">
                          {gridPrograms.map((entry, idx) => {
                            const start = Math.max(entry.startTime, gridStart);
                            const end = Math.min(entry.endTime, gridEnd);
                            const left = ((start - gridStart) / (gridEnd - gridStart)) * 100;
                            const width = ((end - start) / (gridEnd - gridStart)) * 100;
                            const isNow = currentTime >= entry.startTime && currentTime < entry.endTime;

                            return (
                              <div 
                                key={`${entry.mediaId}-${idx}`}
                                className={cn(
                                  "absolute top-0 bottom-0 border-r border-zinc-100 p-3 flex flex-col justify-center cursor-pointer transition-all",
                                  isNow ? "bg-zinc-900 text-white z-10" : "bg-white hover:bg-zinc-50"
                                )}
                                style={{ left: `${left}%`, width: `${width}%` }}
                                onClick={() => setSelectedChannelId(c.id)}
                              >
                                <p className={cn("text-xs font-bold truncate", isNow ? "text-white" : "text-zinc-900")}>
                                  {displayName(entry)}
                                </p>
                                <p className={cn("text-[10px] truncate", isNow ? "text-zinc-400" : "text-zinc-500")}>
                                  {formatTime(entry.startTime)} - {formatTime(entry.endTime)}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </Card>
        ) : (
          <div className="grid gap-6">
            {activeChannels.map(c => {
            const p = playlists.find(pl => pl.id === c.playlistId);
            const mItems = (p?.items || []).map(item => allMedia.find(m => m.id === item.mediaId)).filter(Boolean) as Media[];
            const epg = getDerivedEpg(p || null, mItems);
            const { nowPlaying: now, comingUp: next } = getNowAndNext(epg);

            return (
              <Card key={c.id} className="overflow-hidden border-zinc-200 hover:border-zinc-400 transition-all group">
                <div className="flex flex-col md:flex-row h-full">
                  <div className="w-full md:w-64 aspect-video bg-zinc-900 relative shrink-0">
                    {now?.thumbnailUrl ? (
                      <img src={now.thumbnailUrl} alt="" className="w-full h-full object-cover opacity-60" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-zinc-700">
                        <Radio className="h-12 w-12" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent flex flex-col justify-end p-4">
                      <Badge className="w-fit mb-2 bg-red-600 border-none">LIVE</Badge>
                      <h3 className="text-white font-bold truncate">{c.name}</h3>
                    </div>
                  </div>
                  
                  <div className="flex-1 p-6 flex flex-col justify-between">
                    <div className="space-y-4">
                      <div>
                        <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Now Playing</span>
                        <h4 className="text-lg font-bold text-zinc-900 truncate">
                          {now ? displayName(now) : "No Program Data"}
                        </h4>
                        {now && (
                          <>
                            <div className="flex items-center gap-2 mt-1">
                              <div className="flex-1 h-1 bg-zinc-100 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-zinc-900" 
                                  style={{ width: `${((currentTime - now.startTime) / (now.endTime - now.startTime)) * 100}%` }}
                                />
                              </div>
                              <span className="text-[10px] font-mono text-zinc-500">
                                {formatTime(now.startTime)} - {formatTime(now.endTime)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <div className="flex-1 h-1 bg-zinc-100 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-zinc-900" 
                                  style={{ width: `${((currentTime - now.startTime) / (now.endTime - now.startTime)) * 100}%` }}
                                />
                              </div>
                              <span className="text-[10px] font-mono text-zinc-500">
                                -{formatTimeRemaining(now.endTime - currentTime)}
                              </span>
                            </div>
                          </>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {next.slice(0, 2).map((entry, i) => (
                          <div key={i} className="flex items-center gap-3 p-2 bg-zinc-50 rounded-lg border border-zinc-100">
                            <div className="w-10 h-10 rounded bg-zinc-200 shrink-0 overflow-hidden">
                              {entry.thumbnailUrl && <img src={entry.thumbnailUrl} className="w-full h-full object-cover" referrerPolicy="no-referrer" />}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center justify-between">
                                <p className="text-[10px] font-bold text-zinc-400 uppercase">Next</p>
                                <span className="text-[10px] font-mono text-zinc-500">{formatTime(entry.startTime)}</span>
                              </div>
                              <p className="text-xs font-medium text-zinc-900 truncate">{displayName(entry)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex justify-end mt-4">
                      <Button variant="outline" size="sm" onClick={() => setSelectedChannelId(c.id)}>
                        View Full Schedule
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}

          {activeChannels.length === 0 && (
            <div className="py-24 text-center bg-zinc-50 rounded-2xl border border-zinc-200 border-dashed">
              <Radio className="h-12 w-12 mx-auto text-zinc-200 mb-4" />
              <p className="text-zinc-500">No active channels currently broadcasting.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

  return (
    <div className="space-y-8">
      {/* Channel Selector / Back Button */}
      <div className="flex items-center gap-4">
        {!channelId && (
          <Button variant="ghost" size="sm" onClick={() => setSelectedChannelId(null)}>
            ← Back to All Channels
          </Button>
        )}
        <div className="flex-1 flex items-center gap-4 bg-white p-4 rounded-xl border border-zinc-200">
          <Radio className="h-5 w-5 text-zinc-400" />
          <select 
            className="flex-1 bg-transparent border-none focus:ring-0 font-medium text-zinc-900"
            value={selectedChannelId || ""}
            onChange={(e) => setSelectedChannelId(e.target.value)}
          >
            <option value="" disabled>Select a channel to view guide...</option>
            {channels.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Now Playing Section */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
          <h2 className="text-lg font-bold text-zinc-900 uppercase tracking-wider">Now Playing</h2>
        </div>

        {nowPlaying ? (
          <Card className="p-8 bg-zinc-900 text-white overflow-hidden relative">
            <div className="flex flex-col md:flex-row gap-8 items-center">
              <div className="w-full md:w-80 aspect-video bg-zinc-800 rounded-xl overflow-hidden shadow-2xl shrink-0">
                {nowPlaying.thumbnailUrl ? (
                  <img 
                    src={nowPlaying.thumbnailUrl} 
                    alt={nowPlaying.songTitle}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-700 bg-gradient-to-br from-zinc-800 to-zinc-900">
                    <Music className="h-16 w-16" />
                  </div>
                )}
              </div>

              <div className="flex-1 space-y-4 text-center md:text-left">
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-3">
                  <Badge className="bg-red-600 text-white border-none animate-pulse">LIVE</Badge>
                  <Badge variant="outline" className="text-zinc-400 border-zinc-700">
                    {nowPlaying.genre.toUpperCase()}
                  </Badge>
                </div>

                <div>
                  <h3 className="text-4xl font-black tracking-tight mb-1">{displayName(nowPlaying)}</h3>
                </div>

                <div className="flex justify-center md:justify-start gap-4">
                  {nowPlaying.instagramUrl && (
                    <a href={nowPlaying.instagramUrl} target="_blank" rel="noreferrer" className="text-zinc-500 hover:text-white transition-colors">
                      <Instagram className="h-6 w-6" />
                    </a>
                  )}
                  {nowPlaying.twitterUrl && (
                    <a href={nowPlaying.twitterUrl} target="_blank" rel="noreferrer" className="text-zinc-500 hover:text-white transition-colors">
                      <Twitter className="h-6 w-6" />
                    </a>
                  )}
                  {nowPlaying.youtubeUrl && (
                    <a href={nowPlaying.youtubeUrl} target="_blank" rel="noreferrer" className="text-zinc-500 hover:text-white transition-colors">
                      <Youtube className="h-6 w-6" />
                    </a>
                  )}
                </div>

                <div className="space-y-2 pt-4">
                  <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-red-600"
                      initial={false}
                      animate={{ width: `${((currentTime - nowPlaying.startTime) / (nowPlaying.endTime - nowPlaying.startTime)) * 100}%` }}
                      transition={{ duration: 1, ease: "linear" }}
                    />
                  </div>
                  <div className="flex justify-between text-xs font-mono text-zinc-500">
                    <span>{formatTimeRemaining(currentTime - nowPlaying.startTime)}</span>
                    <span>-{formatTimeRemaining(nowPlaying.endTime - currentTime)}</span>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        ) : (
          <Card className="p-12 text-center bg-zinc-100">
            <p className="text-zinc-500 italic">No program data available for this time.</p>
          </Card>
        )}
      </section>

      {/* Full Schedule Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-zinc-400" />
            <h2 className="text-lg font-bold text-zinc-900 uppercase tracking-wider">Full Schedule</h2>
          </div>
          <Badge variant="outline" className="text-zinc-400 border-zinc-200">
            {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
          </Badge>
        </div>

        <Card className="overflow-hidden border-zinc-200">
          <div className="divide-y divide-zinc-100">
            {derivedEpg.map((entry, idx) => {
              const isNow = currentTime >= entry.startTime && currentTime < entry.endTime;
              const isPast = currentTime > entry.endTime;
              
              return (
                <div 
                  key={`${entry.mediaId}-${idx}`} 
                  className={cn(
                    "flex items-center gap-6 p-4 transition-colors",
                    isNow ? "bg-zinc-900 text-white" : "bg-white hover:bg-zinc-50",
                    isPast && "opacity-50"
                  )}
                >
                  <div className="w-24 shrink-0 font-mono text-sm font-bold">
                    {formatTime(entry.startTime)}
                  </div>
                  
                  <div className="w-16 h-10 rounded bg-zinc-100 shrink-0 overflow-hidden border border-zinc-200">
                    {entry.thumbnailUrl ? (
                      <img src={entry.thumbnailUrl} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-zinc-300">
                        <Music className="h-4 w-4" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className={cn("font-bold truncate", isNow ? "text-white" : "text-zinc-900")}>
                        {displayName(entry)}
                      </h4>
                      {isNow && <Badge className="bg-red-600 border-none text-[10px] h-4">LIVE</Badge>}
                    </div>
                    <p className={cn("text-xs", isNow ? "text-zinc-400" : "text-zinc-500")}>
                      {entry.genre.toUpperCase()} • {Math.round((entry.endTime - entry.startTime) / 60)} min
                    </p>
                  </div>

                  <div className="hidden md:flex items-center gap-3">
                    {entry.instagramUrl && (
                      <a href={entry.instagramUrl} target="_blank" rel="noreferrer" className={isNow ? "text-zinc-500 hover:text-white" : "text-zinc-300 hover:text-zinc-600"}>
                        <Instagram className="h-4 w-4" />
                      </a>
                    )}
                    {entry.twitterUrl && (
                      <a href={entry.twitterUrl} target="_blank" rel="noreferrer" className={isNow ? "text-zinc-500 hover:text-white" : "text-zinc-300 hover:text-zinc-600"}>
                        <Twitter className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
            {derivedEpg.length === 0 && (
              <div className="p-12 text-center text-zinc-400 italic">
                No scheduled programming found for this channel.
              </div>
            )}
          </div>
        </Card>
      </section>

      {/* EPG Import Section */}
      <section className="border-t border-zinc-200 pt-8">
        <button 
          onClick={() => setShowImport(!showImport)}
          className="flex items-center gap-2 text-zinc-500 hover:text-zinc-900 transition-colors font-medium"
        >
          {showImport ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          Advanced EPG Management
        </button>

        <AnimatePresence>
          {showImport && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-6 p-6 bg-zinc-50 rounded-2xl border border-zinc-200 space-y-6">
                <div>
                  <h3 className="font-bold text-zinc-900 mb-2">Import External EPG</h3>
                  <p className="text-sm text-zinc-500 mb-4">
                    Upload a custom JSON file to override the derived schedule. 
                    Format must match the EPGEntry schema.
                  </p>
                  
                  <div className="flex flex-wrap gap-4">
                    <div className="relative">
                      <input 
                        type="file" 
                        accept=".json"
                        onChange={handleFileUpload}
                        className="absolute inset-0 opacity-0 cursor-pointer"
                      />
                      <Button variant="outline">
                        <Upload className="h-4 w-4 mr-2" />
                        Load EPG File
                      </Button>
                    </div>
                    
                    {importedEpg && (
                      <Button 
                        variant="ghost" 
                        className="text-red-600 hover:bg-red-50"
                        onClick={() => setImportedEpg(null)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Clear EPG
                      </Button>
                    )}
                  </div>
                </div>

                <div className="bg-zinc-900 rounded-lg p-4">
                  <p className="text-xs font-mono text-zinc-400 mb-2 uppercase">Expected JSON Format</p>
                  <pre className="text-[10px] font-mono text-zinc-300 overflow-x-auto">
{`[
  {
    "mediaId": "abc123",
    "artistName": "Artist Name",
    "songTitle": "Song Title",
    "genre": "hiphop",
    "instagramUrl": "https://instagram.com/...",
    "startTime": 1700000000,
    "endTime": 1700000213
  }
]`}
                  </pre>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}
