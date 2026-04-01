import React, { useState, useEffect } from "react";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { Channel, Playlist, Media } from "../types";
import { VideoPlayer } from "./VideoPlayer";
import { Loader2, AlertCircle } from "lucide-react";

interface EmbedPlayerProps {
  channelId: string;
}

export function EmbedPlayer({ channelId }: EmbedPlayerProps) {
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState({
    autoPlay: true,
    muted: true,
    controls: true
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    
    async function fetchStream() {
      try {
        // 1. Fetch Channel
        const channelDoc = await getDoc(doc(db, "channels", channelId));
        if (!channelDoc.exists()) {
          throw new Error("Channel not found");
        }
        const channel = { ...channelDoc.data(), id: channelDoc.id } as Channel;

        // Use channel settings as defaults, override with query params
        const defaultSettings = channel.embedSettings || { autoPlay: true, muted: true, controls: true };
        
        setSettings({
          autoPlay: params.has("autoplay") ? params.get("autoplay") === "true" : (defaultSettings.autoPlay ?? true),
          muted: params.has("muted") ? params.get("muted") === "true" : (defaultSettings.muted ?? true),
          controls: params.has("controls") ? params.get("controls") === "true" : (defaultSettings.controls ?? true),
        });

        if (channel.status !== "online") {
          throw new Error("Channel is currently offline");
        }

        if (!channel.playlistId) {
          throw new Error("No playlist assigned to this channel");
        }

        // 2. Fetch Playlist
        const playlistDoc = await getDoc(doc(db, "playlists", channel.playlistId));
        if (!playlistDoc.exists()) {
          throw new Error("Playlist not found");
        }
        const playlist = { ...playlistDoc.data(), id: playlistDoc.id } as Playlist;

        if (!playlist.mediaIds || playlist.mediaIds.length === 0) {
          throw new Error("Playlist is empty");
        }

        // 3. Fetch First Media
        const firstMediaId = playlist.mediaIds[0];
        const mediaDoc = await getDoc(doc(db, "media", firstMediaId));
        if (!mediaDoc.exists()) {
          throw new Error("Media not found");
        }
        const media = { ...mediaDoc.data(), id: mediaDoc.id } as Media;

        if (!media.m3u8Url) {
          throw new Error("Stream URL not available");
        }

        setStreamUrl(media.m3u8Url);
      } catch (err: any) {
        console.error("Embed fetch error:", err);
        setError(err.message || "Failed to load stream");
      } finally {
        setLoading(false);
      }
    }

    fetchStream();
  }, [channelId]);

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

  return (
    <div className="w-full h-full bg-black">
      {streamUrl && (
        <VideoPlayer 
          src={streamUrl} 
          className="w-full h-full" 
          autoPlay={settings.autoPlay}
          muted={settings.muted}
          controls={settings.controls}
        />
      )}
    </div>
  );
}
