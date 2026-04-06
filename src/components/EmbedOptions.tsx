import React, { useState, useEffect } from "react";
import { Code, Copy, ExternalLink, Share2, MonitorPlay, Check, Info, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "./ui/Card";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Channel, Playlist, Media } from "../types";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db, auth } from "../firebase";
import { Badge } from "./ui/Badge";

import { VideoPlayer } from "./VideoPlayer";
import { EmbedPlayer } from "./EmbedPlayer";

interface EmbedOptionsProps {
  profile: any;
}

export function EmbedOptions({ profile }: EmbedOptionsProps) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string>("");
  const [selectedSkin, setSelectedSkin] = useState<"default" | "v1">("default");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!auth.currentUser || !profile) return;
    const effectiveUserId = profile?.ownerUserId || auth.currentUser.uid;

    const channelsQ = query(
      collection(db, "channels"),
      where("userId", "==", effectiveUserId)
    );

    const playlistsQ = query(
      collection(db, "playlists"),
      where("userId", "==", effectiveUserId)
    );

    const mediaQ = query(
      collection(db, "media"),
      where("userId", "==", effectiveUserId)
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
  const settings = selectedChannel?.embedSettings || { width: "100%", height: "100%", autoPlay: true, muted: true, controls: true, skin: "default" };

  const getPublicOrigin = () => {
    const origin = window.location.origin;
    if (origin.includes("ais-dev-")) {
      return origin.replace("ais-dev-", "ais-pre-");
    }
    return origin;
  };

  const publicOrigin = getPublicOrigin();
  const isDevOrigin = window.location.origin.includes("ais-dev-");

  const embedCode = `<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;max-width:100%;">
  <iframe 
    src="https://fastfasts-embed.pages.dev/?id=${selectedChannelId}&skin=${selectedSkin}&autoplay=${settings.autoPlay ?? true}&muted=${settings.muted ?? true}&controls=${settings.controls ?? true}" 
    style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" 
    allowfullscreen
  ></iframe>
</div>`;

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
              <CardTitle>Player Skin</CardTitle>
              <CardDescription>Choose the look and feel of your player.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                <div 
                  className={`p-3 rounded-lg border cursor-pointer transition-all flex flex-col items-center gap-2 ${
                    selectedSkin === "default" 
                      ? "border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900" 
                      : "border-zinc-200 hover:border-zinc-300"
                  }`}
                  onClick={() => setSelectedSkin("default")}
                >
                  <div className="w-full aspect-video bg-zinc-200 rounded border border-zinc-300 flex items-center justify-center">
                    <MonitorPlay className="h-6 w-6 text-zinc-400" />
                  </div>
                  <span className="text-xs font-medium">Default Skin</span>
                </div>
                <div 
                  className={`p-3 rounded-lg border cursor-pointer transition-all flex flex-col items-center gap-2 ${
                    selectedSkin === "v1" 
                      ? "border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900" 
                      : "border-zinc-200 hover:border-zinc-300"
                  }`}
                  onClick={() => setSelectedSkin("v1")}
                >
                  <div className="w-full aspect-video bg-zinc-900 rounded border border-zinc-800 flex items-center justify-center overflow-hidden relative">
                    <div className="absolute top-1 left-1 w-2 h-1 bg-red-500 rounded-full" />
                    <div className="absolute bottom-1 left-1 right-1 h-0.5 bg-zinc-700" />
                    <div className="absolute right-0 top-0 bottom-0 w-1/4 bg-zinc-800" />
                    <MonitorPlay className="h-6 w-6 text-zinc-600" />
                  </div>
                  <span className="text-xs font-medium">V1 Pro Skin</span>
                </div>
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
              {isDevOrigin && (
                <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                  <AlertCircle className="h-6 w-6 text-red-600 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-red-900">CRITICAL: Public Access Required</p>
                    <p className="text-xs text-red-700 leading-relaxed">
                      You are currently on a <span className="font-bold underline">Development URL</span>. 
                      Embed codes from this URL <span className="font-bold">WILL NOT WORK</span> on external websites (403 Error).
                    </p>
                    <div className="text-xs text-red-700 leading-relaxed mt-2">
                      To fix this:
                      <ol className="list-decimal ml-4 mt-1 space-y-1">
                        <li>Click the <span className="font-bold">Share</span> button in the top right of AI Studio.</li>
                        <li>Open the <span className="font-bold underline text-blue-700">Shared App URL</span> provided.</li>
                        <li>Copy the embed code from that page instead.</li>
                      </ol>
                    </div>
                  </div>
                </div>
              )}
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
                {selectedChannelId ? (
                  <div className="w-full h-full scale-[0.25] origin-top-left" style={{ width: '400%', height: '400%' }}>
                    <EmbedPlayer channelId={selectedChannelId} skin={selectedSkin} />
                  </div>
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
