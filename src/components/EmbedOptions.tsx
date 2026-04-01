import React, { useState, useEffect } from "react";
import { Code, Copy, ExternalLink, Share2, MonitorPlay, Check, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "./ui/Card";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Channel, Playlist, Media } from "../types";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db, auth } from "../firebase";
import { Badge } from "./ui/Badge";

import { VideoPlayer } from "./VideoPlayer";

interface EmbedOptionsProps {}

export function EmbedOptions() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!auth.currentUser) return;

    const channelsQ = query(
      collection(db, "channels"),
      where("userId", "==", auth.currentUser.uid)
    );

    const playlistsQ = query(
      collection(db, "playlists"),
      where("userId", "==", auth.currentUser.uid)
    );

    const mediaQ = query(
      collection(db, "media"),
      where("userId", "==", auth.currentUser.uid)
    );

    const unsubscribeChannels = onSnapshot(channelsQ, (snapshot) => {
      const docs = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id })) as Channel[];
      setChannels(docs);
      if (docs.length > 0 && !selectedChannelId) setSelectedChannelId(docs[0].id);
    });

    const unsubscribePlaylists = onSnapshot(playlistsQ, (snapshot) => {
      setPlaylists(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id })) as Playlist[]);
    });

    const unsubscribeMedia = onSnapshot(mediaQ, (snapshot) => {
      setMedia(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id })) as Media[]);
    });

    return () => {
      unsubscribeChannels();
      unsubscribePlaylists();
      unsubscribeMedia();
    };
  }, []);

  const selectedChannel = channels.find(c => c.id === selectedChannelId);

  const getChannelStreamUrl = (channel: Channel) => {
    if (!channel.playlistId) return null;
    const playlist = playlists.find(p => p.id === channel.playlistId);
    if (!playlist || !playlist.mediaIds || playlist.mediaIds.length === 0) return null;
    const firstMediaId = playlist.mediaIds[0];
    const firstMedia = media.find(m => m.id === firstMediaId);
    return firstMedia?.m3u8Url || null;
  };

  const streamUrl = selectedChannel ? getChannelStreamUrl(selectedChannel) : null;
  const settings = selectedChannel?.embedSettings || { width: "100%", height: "100%", autoPlay: true, muted: true, controls: true };

  const embedCode = `<iframe 
  src="${window.location.origin}/embed/${selectedChannelId}?autoplay=${settings.autoPlay ?? true}&muted=${settings.muted ?? true}&controls=${settings.controls ?? true}" 
  width="${settings.width || "100%"}" 
  height="${settings.height || "100%"}" 
  frameborder="0" 
  allowfullscreen
></iframe>`;

  const handleCopy = () => {
    navigator.clipboard.writeText(embedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900 font-sans">Embed Options</h2>
        <p className="text-zinc-500">Generate embed codes to share your streams on any website.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Select Channel</CardTitle>
              <CardDescription>Choose the channel you want to embed.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {channels.map((channel) => (
                  <div 
                    key={channel.id}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                      selectedChannelId === channel.id 
                        ? "border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900" 
                        : "border-zinc-200 hover:border-zinc-300"
                    }`}
                    onClick={() => setSelectedChannelId(channel.id)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{channel.name}</span>
                      <Badge variant={channel.status === "online" ? "success" : "secondary"}>
                        {channel.status === "online" ? "LIVE" : "OFFLINE"}
                      </Badge>
                    </div>
                  </div>
                ))}
                {channels.length === 0 && (
                  <p className="text-sm text-zinc-500 text-center py-4">No channels created yet.</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Stream Links</CardTitle>
              <CardDescription>Direct URLs for external players.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">HLS / M3U8 URL</label>
                <div className="flex gap-2">
                  <Input 
                    value={streamUrl || "No stream available"} 
                    readOnly 
                    className="font-mono text-[10px] bg-zinc-50" 
                  />
                  <Button 
                    variant="outline" 
                    size="icon" 
                    onClick={() => streamUrl && navigator.clipboard.writeText(streamUrl)}
                    disabled={!streamUrl}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <Card className="border-zinc-900">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Code className="h-5 w-5 text-zinc-400" />
                <CardTitle>IFrame Embed Code</CardTitle>
              </div>
              <CardDescription>Copy this code to your website's HTML.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <pre className="p-4 bg-zinc-900 text-zinc-100 rounded-lg text-xs font-mono overflow-x-auto whitespace-pre-wrap">
                  {embedCode}
                </pre>
                <Button 
                  className="absolute top-2 right-2" 
                  size="sm" 
                  onClick={handleCopy}
                >
                  {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                  {copied ? "Copied" : "Copy Code"}
                </Button>
              </div>
            </CardContent>
            <CardFooter className="bg-zinc-50 border-t border-zinc-100 py-3">
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <Info className="h-4 w-4" />
                <span>Responsive embed. Adjust width and height as needed.</span>
              </div>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Preview</CardTitle>
              <CardDescription>How the embed will look on your site.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="aspect-video bg-black rounded-lg overflow-hidden flex items-center justify-center border border-zinc-200">
                {streamUrl ? (
                  <VideoPlayer src={streamUrl} className="w-full h-full" />
                ) : (
                  <div className="text-zinc-500 text-sm">Select an active channel to see preview.</div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
