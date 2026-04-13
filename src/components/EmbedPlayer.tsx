import React, { useState, useEffect, useMemo, useRef } from "react";
import { doc, getDoc, collection, query, where, getDocs, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { Channel, Playlist, Media, EPGEntry } from "../types";
import { VideoPlayer } from "./VideoPlayer";
import { Loader2, AlertCircle, Play, Pause, Volume2, Maximize, Settings, Menu, Radio, Clock, ChevronRight, RefreshCw, Search, Music, Users, ChevronLeft } from "lucide-react";
import { Button } from "./ui/Button";
import { cn } from "../lib/utils";

const EPOCH = 1711929600; // April 1, 2024

interface EmbedPlayerProps {
  channelId: string;
  skin?: "default" | "v1";
}

export function EmbedPlayer({ channelId, skin: skinProp }: EmbedPlayerProps) {
  const [channel, setChannel] = useState<Channel | null>(null);
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [mediaItems, setMediaItems] = useState<Media[]>([]);
  const [allChannels, setAllChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(Math.floor(Date.now() / 1000));
  const [skin, setSkin] = useState<"default" | "v1">(skinProp || "default");
  const [showSidebar, setShowSidebar] = useState(true);
  
  const [settings, setSettings] = useState({
    autoPlay: true,
    muted: true,
    controls: true
  });
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(true);

  const handlePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) {
      video.pause();
    } else {
      video.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleFullscreen = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.requestFullscreen) video.requestFullscreen();
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const skinParam = params.get("skin") as "default" | "v1";
    if (skinProp) setSkin(skinProp);
    else if (skinParam) setSkin(skinParam);
    
    // 1. Subscribe to Channel
    const unsubscribeChannel = onSnapshot(doc(db, "channels", channelId), async (snapshot) => {
      if (!snapshot.exists()) {
        setError("Channel not found");
        setLoading(false);
        return;
      }
      const cData = { ...snapshot.data(), id: snapshot.id } as Channel;
      setChannel(cData);

      // Use channel settings as defaults, override with query params
      const defaultSettings = cData.embedSettings || { autoPlay: true, muted: true, controls: true };
      
      setSettings({
        autoPlay: params.has("autoplay") ? params.get("autoplay") === "true" : (defaultSettings.autoPlay ?? true),
        muted: params.has("muted") ? params.get("muted") === "true" : (defaultSettings.muted ?? true),
        controls: params.has("controls") ? params.get("controls") === "true" : (defaultSettings.controls ?? true),
      });

      setIsMuted(params.has("muted") ? params.get("muted") === "true" : (defaultSettings.muted ?? true));

      if (cData.status !== "online") {
        setError("Channel is currently offline");
        setLoading(false);
        return;
      }
      setError(null);

      if (cData.playlistId) {
        // 2. Fetch Playlist
        const playlistDoc = await getDoc(doc(db, "playlists", cData.playlistId));
        if (playlistDoc.exists()) {
          const pData = { ...playlistDoc.data(), id: playlistDoc.id } as Playlist;
          setPlaylist(pData);

          const mediaIds = pData.items 
            ? pData.items.filter(i => !i.isAdBreak).map(i => i.mediaId).filter(Boolean) as string[]
            : (pData.mediaIds || []);

          if (mediaIds.length > 0) {
            // 3. Fetch Media Items
            const mediaPromises = [];
            for (let i = 0; i < mediaIds.length; i += 10) {
              const chunk = mediaIds.slice(i, i + 10);
              const q = query(collection(db, "media"), where("__name__", "in", chunk));
              mediaPromises.push(getDocs(q));
            }
            const snapshots = await Promise.all(mediaPromises);
            const fetchedMedia = snapshots.flatMap(snap => snap.docs.map(d => ({ id: d.id, ...d.data() } as Media)));
            const sortedMedia = mediaIds.map(id => fetchedMedia.find(item => item.id === id)).filter(Boolean) as Media[];
            setMediaItems(sortedMedia);
          }
        }
      }
      setLoading(false);
    }, (err) => {
      console.error("Channel snapshot error:", err);
      setError("Failed to load channel");
      setLoading(false);
    });

    // 4. Fetch all online channels for sidebar
    const channelsQ = query(collection(db, "channels"), where("status", "==", "online"));
    const unsubscribeAllChannels = onSnapshot(channelsQ, (snapshot) => {
      setAllChannels(snapshot.docs.map(d => ({ ...d.data(), id: d.id } as Channel)));
    });

    return () => {
      unsubscribeChannel();
      unsubscribeAllChannels();
    };
  }, [channelId]);

  const derivedEpg = useMemo(() => {
    if (!playlist || mediaItems.length === 0) return [];
    const totalDuration = mediaItems.reduce((acc, curr) => acc + (curr.duration || 0), 0);
    if (totalDuration === 0) return [];

    const startEpoch = channel?.epoch || EPOCH;
    const timeSinceEpoch = currentTime - startEpoch;
    const loopStartOffset = Math.floor(timeSinceEpoch / totalDuration) * totalDuration;
    
    const entries: EPGEntry[] = [];
    let runningTime = startEpoch + loopStartOffset;

    // Generate 2 loops to ensure we have enough data for "Up Next"
    for (let i = 0; i < 2; i++) {
      for (const media of mediaItems) {
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
  }, [playlist, mediaItems, currentTime]);

  const { nowPlaying, comingUp } = useMemo(() => {
    const now = derivedEpg.find(e => currentTime >= e.startTime && currentTime < e.endTime);
    const future = derivedEpg.filter(e => e.startTime > currentTime).slice(0, 4);
    return { nowPlaying: now, comingUp: future };
  }, [derivedEpg, currentTime]);

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-black text-zinc-400 p-4 text-center">
        <AlertCircle className="h-10 w-10 mb-2 text-zinc-600" />
        <p className="text-sm font-medium">{error}</p>
      </div>
    );
  }

  if (skin === "v1") {
    return (
      <div className="w-full h-full bg-[#0a0a0a] text-white font-sans flex flex-col overflow-hidden select-none">
        {/* Main Content Area */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Player Section */}
            <div className="flex-1 relative bg-black group">
              {channel?.workerManifestUrl ? (
                <VideoPlayer 
                  src={channel.workerManifestUrl} 
                  className="w-full h-full object-contain"
                  autoPlay={settings.autoPlay && isPlaying}
                  muted={isMuted}
                  controls={false} // Custom controls
                  onError={(err) => {
                    console.error("Player error:", err);
                    setError("Media playback error. Try reloading.");
                  }}
                />
              ) : nowPlaying ? (
                <VideoPlayer 
                  src={mediaItems.find(m => m.id === nowPlaying.mediaId)?.m3u8Url || ""} 
                  className="w-full h-full object-contain"
                  autoPlay={settings.autoPlay && isPlaying}
                  muted={isMuted}
                  controls={false} // Custom controls
                  onError={(err) => {
                    console.error("Player error:", err);
                    setError("Media playback error. Try reloading.");
                  }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Radio className="h-12 w-12 text-zinc-800 animate-pulse" />
                </div>
              )}

              {error && (
                <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center p-6 text-center z-50">
                  <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
                  <h2 className="text-xl font-bold mb-2">Playback Error</h2>
                  <p className="text-zinc-400 mb-6 max-w-md">{error}</p>
                  <Button onClick={() => window.location.reload()} variant="outline">
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Reload Player
                  </Button>
                </div>
              )}

              {/* Top Overlay Info */}
              <div className="absolute top-0 left-0 right-0 p-8 bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
                <div className="flex items-start gap-4">
                  <div className="bg-red-600 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                    Live
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold tracking-tight">{channel?.name}</h1>
                    {nowPlaying && (
                      <div className="mt-1">
                        <p className="text-zinc-400 text-sm">{nowPlaying.artistName}</p>
                        <p className="text-xl font-medium mt-1">{nowPlaying.songTitle}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Bottom Controls Overlay */}
              <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                {/* Progress Bar */}
                <div className="relative h-1.5 bg-white/20 rounded-full overflow-hidden mb-4">
                  {nowPlaying && (
                    <div 
                      className="absolute top-0 left-0 h-full bg-blue-500"
                      style={{ 
                        width: `${((currentTime - nowPlaying.startTime) / (nowPlaying.endTime - nowPlaying.startTime)) * 100}%` 
                      }}
                    />
                  )}
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-6">
                    <button 
                      onClick={handlePlayPause}
                      className="hover:text-blue-400 transition-colors"
                    >
                      {isPlaying ? <Pause className="h-6 w-6 fill-current" /> : <Play className="h-6 w-6 fill-current" />}
                    </button>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setIsMuted(!isMuted)}>
                        <Volume2 className={cn("h-5 w-5 transition-colors", isMuted ? "text-zinc-600" : "text-zinc-400 hover:text-white")} />
                      </button>
                      <div className="w-20 h-1 bg-white/20 rounded-full relative cursor-pointer">
                        <div 
                          className="h-full bg-white rounded-full" 
                          style={{ width: isMuted ? "0%" : `${volume * 100}%` }} 
                        />
                      </div>
                    </div>
                  </div>
                
                <div className="flex items-center gap-4">
                  <button className="text-zinc-400 hover:text-white transition-colors">
                    <Settings className="h-5 w-5" />
                  </button>
                  <button onClick={handleFullscreen} className="text-zinc-400 hover:text-white transition-colors">
                    <Maximize className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar Channels */}
          {showSidebar && (
            <div className="w-80 bg-[#121212] border-l border-white/5 flex flex-col">
              <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-lg font-bold">Channels</h2>
                <button onClick={() => setShowSidebar(false)} className="text-zinc-500 hover:text-white">
                  <Menu className="h-5 w-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {allChannels.map(c => (
                  <div 
                    key={c.id}
                    className={cn(
                      "p-3 rounded-xl flex items-center gap-3 transition-all cursor-pointer group",
                      c.id === channelId ? "bg-white/10 ring-1 ring-white/20" : "hover:bg-white/5"
                    )}
                    onClick={() => {
                      if (c.id !== channelId) {
                        window.location.href = `/embed/${c.id}${window.location.search}`;
                      }
                    }}
                  >
                    <div className="w-12 h-12 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0 overflow-hidden relative">
                      {c.id === channelId && (
                        <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center">
                          <div className="flex gap-0.5 items-end h-3">
                            <div className="w-0.5 bg-blue-400 animate-[music-bar_0.8s_ease-in-out_infinite]" />
                            <div className="w-0.5 bg-blue-400 animate-[music-bar_1.2s_ease-in-out_infinite]" />
                            <div className="w-0.5 bg-blue-400 animate-[music-bar_1s_ease-in-out_infinite]" />
                          </div>
                        </div>
                      )}
                      <Radio className="h-5 w-5 text-zinc-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold truncate">{c.name}</p>
                      <p className="text-[10px] text-zinc-500 truncate uppercase tracking-wider">{c.genre || "Music"}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-zinc-700 group-hover:text-zinc-400 transition-colors" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Bottom Schedule Area */}
        <div className="h-48 bg-[#0a0a0a] border-t border-white/5 p-6 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-8">
              <button className="text-xs font-bold uppercase tracking-widest text-blue-500 border-b-2 border-blue-500 pb-1">Now Playing</button>
              <button className="text-xs font-bold uppercase tracking-widest text-zinc-500 hover:text-white transition-colors pb-1">Up Next</button>
            </div>
            <div className="text-[10px] text-zinc-600 font-mono uppercase tracking-widest">US 30</div>
          </div>
          
          <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar">
            {/* Now Playing Card */}
            {nowPlaying && (
              <div className="min-w-[320px] bg-blue-600/10 rounded-2xl border border-blue-500/30 p-4 flex gap-4 relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="w-24 h-16 rounded-lg bg-zinc-800 shrink-0 overflow-hidden relative">
                  {nowPlaying.thumbnailUrl ? (
                    <img src={nowPlaying.thumbnailUrl} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-zinc-900">
                      <Radio className="h-6 w-6 text-zinc-700" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold truncate">{nowPlaying.songTitle}</p>
                  <p className="text-xs text-zinc-400 truncate">{nowPlaying.artistName}</p>
                  <p className="text-[10px] text-zinc-500 mt-2 font-mono">
                    {new Date(nowPlaying.startTime * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - 
                    {new Date(nowPlaying.endTime * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            )}

            {/* Up Next Cards */}
            {comingUp.map((item, idx) => (
              <div key={idx} className="min-w-[280px] bg-white/5 rounded-2xl border border-white/5 p-4 flex gap-4 hover:bg-white/10 transition-colors">
                <div className="w-24 h-16 rounded-lg bg-zinc-900 shrink-0 overflow-hidden relative">
                  {item.thumbnailUrl ? (
                    <img src={item.thumbnailUrl} className="w-full h-full object-cover opacity-60" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Radio className="h-6 w-6 text-zinc-800" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold truncate text-zinc-300">{item.songTitle}</p>
                  <p className="text-xs text-zinc-500 truncate">{item.artistName}</p>
                  <p className="text-[10px] text-zinc-600 mt-2 font-mono">
                    {new Date(item.startTime * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <style dangerouslySetInnerHTML={{ __html: `
          @keyframes music-bar {
            0%, 100% { height: 4px; }
            50% { height: 12px; }
          }
          .no-scrollbar::-webkit-scrollbar {
            display: none;
          }
          .no-scrollbar {
            -ms-overflow-style: none;
            scrollbar-width: none;
          }
        `}} />
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-black">
      {channel?.workerManifestUrl ? (
        <VideoPlayer 
          src={channel.workerManifestUrl} 
          className="w-full h-full" 
          autoPlay={settings.autoPlay && isPlaying}
          muted={isMuted}
          controls={settings.controls}
        />
      ) : nowPlaying ? (
        <VideoPlayer 
          src={mediaItems.find(m => m.id === nowPlaying.mediaId)?.m3u8Url || ""} 
          className="w-full h-full" 
          autoPlay={settings.autoPlay && isPlaying}
          muted={isMuted}
          controls={settings.controls}
        />
      ) : null}
    </div>
  );
}
