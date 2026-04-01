import React, { useState, useEffect, useMemo } from "react";
import { db } from "../firebase";
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

interface EPGViewerProps {
  channelId?: string;
  epgData?: EPGEntry[];
}

const EPOCH = 1704067200; // Jan 1 2024 00:00:00 UTC

export function EPGViewer({ channelId, epgData: externalEpg }: EPGViewerProps) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(channelId || null);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [mediaItems, setMediaItems] = useState<Media[]>([]);
  const [loading, setLoading] = useState(true);
  const [importedEpg, setImportedEpg] = useState<EPGEntry[] | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [currentTime, setCurrentTime] = useState(Date.now() / 1000);

  // Update clock every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now() / 1000), 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch all channels for selector
  useEffect(() => {
    const q = query(collection(db, "channels"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Channel));
      setChannels(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "channels");
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!selectedChannelId) {
      setLoading(false);
      setChannel(null);
      setPlaylist(null);
      setMediaItems([]);
      return;
    }

    setLoading(true);

    // Firestore fetch
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
              
              if (pData.mediaIds && pData.mediaIds.length > 0) {
                // Fetch media items in chunks of 10 (Firestore limit for 'in' query)
                const mediaPromises = [];
                for (let i = 0; i < pData.mediaIds.length; i += 10) {
                  const chunk = pData.mediaIds.slice(i, i + 10);
                  const q = query(collection(db, "media"), where("__name__", "in", chunk));
                  mediaPromises.push(getDocs(q));
                }
                const snapshots = await Promise.all(mediaPromises);
                const allMedia = snapshots.flatMap(snap => snap.docs.map(d => ({ id: d.id, ...d.data() } as Media)));
                // Sort to match playlist order
                const sortedMedia = (pData.mediaIds || []).map(id => allMedia.find(item => item.id === id)).filter(Boolean) as Media[];
                setMediaItems(sortedMedia);
              }
            }
          }
        }
        setLoading(false);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, `channels/${selectedChannelId}`);
        setLoading(false);
      }
    };

    fetchChannelData();
  }, [selectedChannelId]);

  const derivedEpg = useMemo(() => {
    if (externalEpg) return externalEpg;
    if (importedEpg) return importedEpg;
    if (!playlist || mediaItems.length === 0) return [];

    const totalDuration = mediaItems.reduce((acc, curr) => acc + (curr.duration || 0), 0);
    if (totalDuration === 0) return [];

    const timeSinceEpoch = currentTime - EPOCH;
    const loopStartOffset = Math.floor(timeSinceEpoch / totalDuration) * totalDuration;
    
    const entries: EPGEntry[] = [];
    let runningTime = EPOCH + loopStartOffset;

    // Generate enough entries to cover current time + next few hours
    // We'll generate 2 full loops to be safe
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
          isAdBreak: media.adBreakAfter // This is a simplification
        });
        runningTime += duration;
      }
    }

    return entries;
  }, [playlist, mediaItems, currentTime, externalEpg, importedEpg]);

  const { nowPlaying, comingUp } = useMemo(() => {
    const now = derivedEpg.find(e => currentTime >= e.startTime && currentTime < e.endTime);
    const future = derivedEpg.filter(e => e.startTime > currentTime).slice(0, 3);
    return { nowPlaying: now, comingUp: future };
  }, [derivedEpg, currentTime]);

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

  const formatTimeRemaining = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!channel || !playlist) {
    return (
      <div className="py-12 text-center bg-zinc-50 rounded-2xl border border-zinc-200 border-dashed">
        <Radio className="h-12 w-12 mx-auto text-zinc-200 mb-4" />
        <p className="text-zinc-500">Select a channel to view the program guide.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Channel Selector */}
      {!channelId && (
        <div className="flex items-center gap-4 bg-white p-4 rounded-xl border border-zinc-200">
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
      )}

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

      {/* Coming Up Next Section */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Clock className="h-5 w-5 text-zinc-400" />
          <h2 className="text-lg font-bold text-zinc-900 uppercase tracking-wider">Coming Up Next</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {comingUp.map((entry, idx) => (
            <Card key={`${entry.mediaId}-${idx}`} className="p-4 bg-white hover:shadow-md transition-shadow">
              <div className="aspect-video bg-zinc-100 rounded-lg mb-4 overflow-hidden">
                {entry.thumbnailUrl ? (
                  <img 
                    src={entry.thumbnailUrl} 
                    alt={entry.songTitle}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-300">
                    <Music className="h-8 w-8" />
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-zinc-900 truncate">{displayName(entry)}</h4>
                <div className="pt-2 flex items-center justify-between">
                  <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
                    {entry.genre.toUpperCase()}
                  </Badge>
                  <span className="text-xs font-medium text-zinc-400">
                    in {formatTimeRemaining(entry.startTime - currentTime)}
                  </span>
                </div>
              </div>
            </Card>
          ))}
          {comingUp.length === 0 && (
            <div className="col-span-full py-8 text-center text-zinc-400 italic">
              End of scheduled programming.
            </div>
          )}
        </div>
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
