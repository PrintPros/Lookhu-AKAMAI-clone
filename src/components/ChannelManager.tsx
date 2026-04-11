import { useState, useEffect } from "react";
import { Radio, Plus, Play, Pause, Trash2, ExternalLink, Settings2, MonitorPlay, StopCircle, Copy, Check, Loader2, Save, X, LayoutList, Megaphone, Calendar, Code, Share2, Info, Zap, Clock, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "./ui/Button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { Input } from "./ui/Input";
import { Channel, Playlist, Media, ScheduledPublish } from "../types";
import { collection, query, where, onSnapshot, addDoc, deleteDoc, doc, updateDoc, orderBy, limit, getDoc } from "firebase/firestore";
import { db, auth } from "../firebase";
import { VideoPlayer } from "./VideoPlayer";
import { Dialog } from "./ui/Dialog";
import { EPGViewer } from "./EPGViewer";
import { AdSettings } from "./AdSettings";
import { handleFirestoreError, OperationType } from "../lib/firestore-errors";
import { cn } from "../lib/utils";
import { toast } from "sonner";

interface ChannelManagerProps {
  setActiveTab?: (tab: string) => void;
  profile: any;
}

export function ChannelManager({ setActiveTab, profile }: ChannelManagerProps) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [scheduledPublishes, setScheduledPublishes] = useState<ScheduledPublish[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [newChannel, setNewChannel] = useState({
    name: "",
    genre: "Hip Hop",
    workerManifestUrl: "",
    r2BucketName: ""
  });
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [activeSettingsTab, setActiveSettingsTab] = useState<"general" | "epg" | "ads" | "embed">("general");
  const [previewChannel, setPreviewChannel] = useState<Channel | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [cloudflareConfigs, setCloudflareConfigs] = useState<any[]>([]);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [adSettings, setAdSettings] = useState<any>(null);

  useEffect(() => {
    const fetchAdSettings = async () => {
      const snap = await getDoc(doc(db, "settings", "ads"));
      if (snap.exists()) {
        setAdSettings(snap.data());
      }
    };
    fetchAdSettings();
  }, []);

  // Scheduling state
  const [schedulingChannel, setSchedulingChannel] = useState<Channel | null>(null);
  const [scheduleTime, setScheduleTime] = useState("");

  const handleUpdateChannel = async () => {
    if (!editingChannel || !auth.currentUser) return;

    try {
      const { id, ...data } = editingChannel;
      await updateDoc(doc(db, "channels", id), data);
      toast.success("Channel updated successfully");
      setEditingChannel(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `channels/${editingChannel.id}`);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  useEffect(() => {
    if (!auth.currentUser || !profile) return;

    const isMaster = profile.role === "master_admin";
    const targetUserId = isMaster ? null : (profile.ownerUserId || auth.currentUser.uid);

    let channelsQ = query(collection(db, "channels"));
    let playlistsQ = query(collection(db, "playlists"));
    let mediaQ = query(collection(db, "media"));
    let cloudflareQ = query(collection(db, "cloudflareConfigs"));
    let scheduledQ = query(collection(db, "scheduledPublishes"), orderBy("scheduledAt", "desc"), limit(20));

    if (targetUserId) {
      channelsQ = query(channelsQ, where("userId", "==", targetUserId));
      playlistsQ = query(playlistsQ, where("userId", "==", targetUserId));
      mediaQ = query(mediaQ, where("userId", "==", targetUserId));
      cloudflareQ = query(cloudflareQ, where("userId", "==", targetUserId));
      scheduledQ = query(scheduledQ, where("createdBy", "==", targetUserId));
    }

    const unsubscribeChannels = onSnapshot(channelsQ, (snapshot) => {
      setChannels(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id })) as Channel[]);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "channels");
    });

    const unsubscribePlaylists = onSnapshot(playlistsQ, (snapshot) => {
      setPlaylists(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id })) as Playlist[]);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "playlists");
    });

    const unsubscribeMedia = onSnapshot(mediaQ, (snapshot) => {
      setMedia(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id })) as Media[]);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "media");
    });

    const unsubscribeCloudflare = onSnapshot(cloudflareQ, (snapshot) => {
      setCloudflareConfigs(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id })));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "cloudflareConfigs");
    });

    const unsubscribeScheduled = onSnapshot(scheduledQ, (snapshot) => {
      setScheduledPublishes(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id })) as ScheduledPublish[]);
    }, (error) => {
      // Fallback if index is missing
      if (error.code === "failed-precondition") {
        console.warn("Scheduled publishes index missing, falling back to simple query");
        const simpleQ = query(collection(db, "scheduledPublishes"), where("createdBy", "==", auth.currentUser?.uid));
        onSnapshot(simpleQ, (s) => setScheduledPublishes(s.docs.map(d => ({ ...d.data(), id: d.id })) as ScheduledPublish[]));
      } else {
        handleFirestoreError(error, OperationType.GET, "scheduledPublishes");
      }
    });

    return () => {
      unsubscribeChannels();
      unsubscribePlaylists();
      unsubscribeMedia();
      unsubscribeCloudflare();
      unsubscribeScheduled();
    };
  }, [profile]);

  const getChannelStreamUrl = (channel: Channel) => {
    if (channel.workerManifestUrl) return channel.workerManifestUrl;
    if (!channel.playlistId) return null;
    const playlist = playlists.find(p => p.id === channel.playlistId);
    if (!playlist || !playlist.mediaIds || playlist.mediaIds.length === 0) return null;
    const firstMediaId = playlist.mediaIds[0];
    const firstMedia = media.find(m => m.id === firstMediaId);
    return firstMedia?.m3u8Url || null;
  };

  const handleCreateChannel = async () => {
    if (!newChannel.name || !auth.currentUser) return;

    try {
      await addDoc(collection(db, "channels"), {
        ...newChannel,
        status: "offline",
        userId: auth.currentUser.uid,
        createdAt: new Date().toISOString(),
        workerDeployed: false,
        workerNeedsRedeploy: true,
        channelSlug: newChannel.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")
      });
      setNewChannel({
        name: "",
        genre: "Hip Hop",
        workerManifestUrl: "",
        r2BucketName: ""
      });
      setIsCreating(false);
      toast.success("Channel created!");
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, "channels");
    }
  };

  const handlePublishNow = async (channel: Channel) => {
    if (!channel.playlistId) {
      toast.error("Please assign a playlist to this channel first");
      return;
    }
    setPublishing(channel.id);
    try {
      const idToken = await auth.currentUser?.getIdToken();

      // Get playlist
      const playlist = playlists.find(p => p.id === channel.playlistId);
      if (!playlist) throw new Error("Playlist not found");

      // Get active cloudflare config
      const activeConfig = cloudflareConfigs?.find(c => c.isActive);
      if (!activeConfig) throw new Error("No active Cloudflare config. Add one in Settings.");

      // Get media items in playlist
      const playlistMedia = playlist.mediaIds
        .map(id => media.find(m => m.id === id))
        .filter(Boolean);

      const response = await fetch("/api/publish/now", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          channelId: channel.id,
          userId: auth.currentUser?.uid,
          channel,
          playlist,
          mediaItems: playlistMedia,
          cfConfig: activeConfig,
        }),
      });

      const data = await response.json();
      if (response.ok) {
        // Update channel status in Firestore directly from client
        await updateDoc(doc(db, "channels", channel.id), {
          status: "online",
          lastPublishedAt: new Date().toISOString(),
          workerDeployed: true,
          workerNeedsRedeploy: false,
          workerManifestUrl: `${data.workerUrl}/live.m3u8`,
        });
        toast.success("Channel is LIVE! 🎉");
      } else {
        toast.error("Publish failed: " + data.error);
      }
    } catch (error: any) {
      toast.error("Publish failed: " + error.message);
    } finally {
      setPublishing(null);
    }
  };

  const handleSchedulePublish = async () => {
    if (!schedulingChannel || !scheduleTime || !auth.currentUser) return;

    try {
      await addDoc(collection(db, "scheduledPublishes"), {
        channelId: schedulingChannel.id,
        playlistId: schedulingChannel.playlistId,
        scheduledAt: new Date(scheduleTime).toISOString(),
        status: "pending",
        createdBy: auth.currentUser.uid,
        createdAt: new Date().toISOString()
      });
      toast.success("Publish scheduled successfully");
      setSchedulingChannel(null);
      setScheduleTime("");
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, "scheduledPublishes");
    }
  };

  const toggleStatus = async (channel: Channel) => {
    const newStatus = channel.status === "online" ? "offline" : "online";
    try {
      await updateDoc(doc(db, "channels", channel.id), {
        status: newStatus,
      });
      if (newStatus === "online") {
        handlePublishNow(channel);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `channels/${channel.id}`);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, "channels", id));
      toast.success("Channel deleted");
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `channels/${id}`);
    }
  };

  function relativeTime(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  const assignPlaylist = async (channelId: string, playlistId: string) => {
    try {
      await updateDoc(doc(db, "channels", channelId), {
        playlistId,
        workerNeedsRedeploy: true
      });
      toast.success("Playlist assigned. Channel needs redeploy.");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `channels/${channelId}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900">Channels</h2>
          <p className="text-zinc-500">Manage your linear playout channels and Cloudflare Workers.</p>
        </div>
        <Button onClick={() => setIsCreating(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Channel
        </Button>
      </div>

      {isCreating && (
        <Card className="border-zinc-900 shadow-lg">
          <CardHeader>
            <CardTitle>New Channel</CardTitle>
            <CardDescription>Configure your new playout channel.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Channel Name</label>
              <Input
                placeholder="e.g. Aura 24/7 News"
                value={newChannel.name}
                onChange={(e) => setNewChannel(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Genre</label>
              <select 
                className="w-full h-10 px-3 py-2 bg-white border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                value={newChannel.genre}
                onChange={(e) => setNewChannel(prev => ({ ...prev, genre: e.target.value }))}
              >
                {["Hip Hop", "Rock", "EDM", "R&B", "Latin", "Other"].map(g => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>
          </CardContent>
          <CardFooter className="justify-end gap-2">
            <Button variant="ghost" onClick={() => setIsCreating(false)}>Cancel</Button>
            <Button onClick={handleCreateChannel}>Create Channel</Button>
          </CardFooter>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {channels.map((channel) => (
          <Card key={channel.id} className="group hover:border-zinc-400 transition-colors">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  <Badge variant={channel.status === "online" ? "success" : "secondary"}>
                    {channel.status === "online" ? "LIVE" : "OFFLINE"}
                  </Badge>
                  {channel.workerDeployed ? (
                    <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Worker
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-zinc-400 border-zinc-200">
                      <AlertCircle className="h-3 w-3 mr-1" /> No Worker
                    </Badge>
                  )}
                  {channel.workerNeedsRedeploy && (
                    <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50 animate-pulse">
                      Update
                    </Badge>
                  )}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button 
                    size="icon" 
                    variant="ghost" 
                    className="h-8 w-8"
                    onClick={() => setEditingChannel(channel)}
                  >
                    <Settings2 className="h-4 w-4" />
                  </Button>
                  <Button 
                    size="icon" 
                    variant="ghost" 
                    className="h-8 w-8 text-red-500 hover:text-red-600"
                    onClick={() => handleDelete(channel.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <CardTitle className="mt-2 flex items-center gap-2">
                <Radio className="h-5 w-5 text-zinc-400" />
                {channel.name}
              </CardTitle>
              {channel.workerManifestUrl && (
                <div className="mt-2 flex items-center gap-2 p-1.5 bg-zinc-50 rounded border border-zinc-100 group/url">
                  <code className="text-[10px] text-zinc-500 truncate flex-1">{channel.workerManifestUrl}</code>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-5 w-5"
                    onClick={() => handleCopy(channel.workerManifestUrl!, channel.id)}
                  >
                    {copiedId === channel.id ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              )}
              <div className="flex items-center justify-between text-xs text-zinc-500 mt-2">
                <span>Playlist:</span>
                <select 
                  className="bg-transparent border-none text-zinc-900 font-medium focus:ring-0 p-0 h-auto cursor-pointer"
                  value={channel.playlistId || ""}
                  onChange={(e) => assignPlaylist(channel.id, e.target.value)}
                >
                  <option value="">None Assigned</option>
                  {playlists.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              {channel.lastPublishedAt
                ? <p className="text-xs text-zinc-400 mt-1">
                    Published {relativeTime(channel.lastPublishedAt)}
                  </p>
                : <span className="text-xs text-zinc-400">Not yet published</span>
              }
            </CardHeader>
            <CardContent>
              <div className="aspect-video bg-zinc-900 rounded-lg flex items-center justify-center relative overflow-hidden">
                {channel.status === "online" ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-full h-full bg-zinc-800 animate-pulse flex items-center justify-center">
                      <Play className="h-12 w-12 text-zinc-600" />
                    </div>
                  </div>
                ) : (
                  <div className="text-zinc-500 text-sm font-mono uppercase tracking-widest">
                    No Signal
                  </div>
                )}
              </div>
            </CardContent>
            <CardFooter className="gap-2 flex-wrap">
              <Button 
                variant={channel.status === "online" ? "outline" : "default"}
                className="flex-1 min-w-[120px]"
                onClick={() => toggleStatus(channel)}
                disabled={publishing === channel.id}
              >
                {publishing === channel.id ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Publishing...</>
                ) : channel.status === "online" ? (
                  <><StopCircle className="mr-2 h-4 w-4" /> Stop Stream</>
                ) : (
                  <><Play className="mr-2 h-4 w-4" /> Go Live</>
                )}
              </Button>
              <div className="flex gap-2 w-full">
                <Button 
                  variant="outline" 
                  className="flex-1 text-xs h-8"
                  onClick={() => handlePublishNow(channel)}
                  disabled={publishing === channel.id || !channel.playlistId}
                >
                  <Zap className="h-3 w-3 mr-1 text-amber-500" />
                  Publish Now
                </Button>
                <Button 
                  variant="outline" 
                  className="flex-1 text-xs h-8"
                  onClick={() => setSchedulingChannel(channel)}
                  disabled={!channel.playlistId}
                >
                  <Clock className="h-3 w-3 mr-1 text-blue-500" />
                  Schedule
                </Button>
                <Button 
                  variant="outline" 
                  size="icon"
                  className="h-8 w-8"
                  disabled={channel.status !== "online" && !channel.workerDeployed}
                  onClick={() => setPreviewChannel(channel)}
                >
                  <MonitorPlay className="h-4 w-4" />
                </Button>
              </div>
            </CardFooter>
          </Card>
        ))}
      </div>

      {/* Scheduler Dialog */}
      {schedulingChannel && (
        <Dialog
          isOpen={!!schedulingChannel}
          onClose={() => setSchedulingChannel(null)}
          title={`Schedule Publish: ${schedulingChannel.name}`}
          description="Pick a date and time to automatically publish this channel."
        >
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Scheduled Time</label>
              <Input
                type="datetime-local"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
              />
            </div>
            <div className="p-4 bg-zinc-50 rounded-lg border border-zinc-200 text-xs text-zinc-500">
              <p className="flex items-center gap-2">
                <Info className="h-3 w-3" />
                The scheduler worker checks every minute for due publishes.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <Button variant="ghost" onClick={() => setSchedulingChannel(null)}>Cancel</Button>
            <Button 
              onClick={handleSchedulePublish}
              disabled={!scheduleTime}
            >
              Schedule Publish
            </Button>
          </div>
        </Dialog>
      )}

      {/* Settings Dialog */}
      <Dialog 
        isOpen={!!editingChannel} 
        onClose={() => setEditingChannel(null)}
        title={`Edit Channel: ${editingChannel?.name}`}
        description="Configure your channel settings, EPG, and advertising."
        className="max-w-[95vw] w-full h-[95vh] flex flex-col"
      >
        <div className="flex-1 flex flex-col min-h-0 space-y-6">
          <div className="flex items-center gap-1 p-1 bg-zinc-100 rounded-lg shrink-0">
            {["general", "epg", "ads", "embed"].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveSettingsTab(tab as any)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-2 text-[10px] font-bold rounded-md transition-all uppercase",
                  activeSettingsTab === tab ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                )}
              >
                {tab === "general" && <LayoutList className="h-3.5 w-3.5" />}
                {tab === "epg" && <Calendar className="h-3.5 w-3.5" />}
                {tab === "ads" && <Megaphone className="h-3.5 w-3.5" />}
                {tab === "embed" && <Code className="h-3.5 w-3.5" />}
                {tab}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto pr-2 min-h-0">
            {activeSettingsTab === "general" && editingChannel && (
              <div className="space-y-6 py-2">
                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Channel Name</label>
                    <Input
                      value={editingChannel.name}
                      onChange={(e) => setEditingChannel({ ...editingChannel, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Genre</label>
                    <select 
                      className="w-full h-10 px-3 py-2 bg-white border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                      value={editingChannel.genre}
                      onChange={(e) => setEditingChannel({ ...editingChannel, genre: e.target.value })}
                    >
                      {["Hip Hop", "Rock", "EDM", "R&B", "Latin", "Other"].map(g => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Assigned Playlist</label>
                  <select 
                    className="w-full h-10 px-3 py-2 bg-white border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                    value={editingChannel.playlistId || ""}
                    onChange={(e) => setEditingChannel({ ...editingChannel, playlistId: e.target.value })}
                  >
                    <option value="">None Assigned</option>
                    {playlists.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Worker Manifest URL</label>
                  <Input
                    placeholder="https://rag-worker.rag.workers.dev/channel-name.m3u8"
                    value={editingChannel.workerManifestUrl || ""}
                    onChange={(e) => setEditingChannel({ ...editingChannel, workerManifestUrl: e.target.value })}
                  />
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Segment Duration (s)</label>
                    <Input
                      type="number"
                      value={editingChannel.segmentDuration || 6}
                      readOnly
                      className="bg-zinc-50 cursor-not-allowed"
                    />
                    <p className="text-[10px] text-zinc-400 italic">Locked for optimal performance</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Window (segments)</label>
                    <Input
                      type="number"
                      value={editingChannel.window || 90}
                      readOnly
                      className="bg-zinc-50 cursor-not-allowed"
                    />
                    <p className="text-[10px] text-zinc-400 italic">Locked for optimal performance</p>
                  </div>
                </div>
              </div>
            )}

            {activeSettingsTab === "epg" && editingChannel && (
              <div className="py-2">
                <EPGViewer channelId={editingChannel.id} profile={profile} />
              </div>
            )}

            {activeSettingsTab === "ads" && (
              <div className="py-2">
                <AdSettings />
              </div>
            )}

            {activeSettingsTab === "embed" && editingChannel && (
              <div className="space-y-8 py-2">
                <div className="grid gap-8 lg:grid-cols-2">
                  <div className="space-y-6">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase">Embed Width</label>
                        <Input 
                          value={editingChannel.embedSettings?.width || "100%"}
                          onChange={(e) => setEditingChannel({
                            ...editingChannel,
                            embedSettings: { ...(editingChannel.embedSettings || { height: "100%", autoPlay: true, muted: true, controls: true }), width: e.target.value }
                          })}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase">Embed Height</label>
                        <Input 
                          value={editingChannel.embedSettings?.height || "100%"}
                          onChange={(e) => setEditingChannel({
                            ...editingChannel,
                            embedSettings: { ...(editingChannel.embedSettings || { width: "100%", autoPlay: true, muted: true, controls: true }), height: e.target.value }
                          })}
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-4">
                      {["autoPlay", "muted", "controls"].map((key) => (
                        <label key={key} className="flex items-center gap-2 cursor-pointer">
                          <input 
                            type="checkbox"
                            checked={(editingChannel.embedSettings as any)?.[key] ?? true}
                            onChange={(e) => setEditingChannel({
                              ...editingChannel,
                              embedSettings: { ...(editingChannel.embedSettings || { width: "100%", height: "100%" }), [key]: e.target.checked }
                            })}
                            className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                          />
                          <span className="text-sm font-medium capitalize">{key}</span>
                        </label>
                      ))}
                    </div>

                    <Card className="bg-zinc-50 border-zinc-200">
                      <CardHeader className="pb-2">
                        <div className="flex items-center gap-2">
                          <Code className="h-4 w-4 text-zinc-400" />
                          <CardTitle className="text-sm">Embed Code</CardTitle>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="relative">
                          <pre className="p-3 bg-zinc-900 text-zinc-100 rounded-lg text-[10px] font-mono overflow-x-auto whitespace-pre-wrap">
                            {`<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;max-width:100%;">
  <iframe 
    src="https://fastfasts-embed-worker.lookhu.workers.dev/?worker=${encodeURIComponent(editingChannel.workerManifestUrl?.replace(/\/(index|live)\.m3u8$/, '') || '')}&name=${encodeURIComponent(editingChannel.name)}&autoplay=${editingChannel.embedSettings?.autoPlay ?? true}&muted=${editingChannel.embedSettings?.muted ?? true}&controls=${editingChannel.embedSettings?.controls ?? true}&adsEnabled=${adSettings?.enabled ?? false}&preRollUrl=${encodeURIComponent(adSettings?.preRollUrl || '')}&midRollUrl=${encodeURIComponent(adSettings?.midRollUrl || '')}&channelId=${editingChannel.id}" 
    style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" 
    allowfullscreen
  ></iframe>
</div>`}
                          </pre>
                          <Button 
                            className="absolute top-2 right-2 h-7 px-2 text-[10px]" 
                            size="sm" 
                            onClick={() => {
                              const code = `<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;max-width:100%;">
  <iframe 
    src="https://fastfasts-embed-worker.lookhu.workers.dev/?worker=${encodeURIComponent(editingChannel.workerManifestUrl?.replace(/\/(index|live)\.m3u8$/, '') || '')}&name=${encodeURIComponent(editingChannel.name)}&autoplay=${editingChannel.embedSettings?.autoPlay ?? true}&muted=${editingChannel.embedSettings?.muted ?? true}&controls=${editingChannel.embedSettings?.controls ?? true}&adsEnabled=${adSettings?.enabled ?? false}&preRollUrl=${encodeURIComponent(adSettings?.preRollUrl || '')}&midRollUrl=${encodeURIComponent(adSettings?.midRollUrl || '')}&channelId=${editingChannel.id}" 
    style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" 
    allowfullscreen
  ></iframe>
</div>`;
                              navigator.clipboard.writeText(code);
                              toast.success("Embed code copied!");
                            }}
                          >
                            <Copy className="h-3 w-3 mr-1" />
                            Copy
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-zinc-900 uppercase">Preview</h3>
                    <div className="aspect-video bg-black rounded-xl overflow-hidden border border-zinc-200 shadow-inner flex items-center justify-center">
                      {getChannelStreamUrl(editingChannel) ? (
                        <VideoPlayer 
                          src={getChannelStreamUrl(editingChannel)!} 
                          className="w-full h-full"
                          autoPlay={editingChannel.embedSettings?.autoPlay ?? true}
                          muted={editingChannel.embedSettings?.muted ?? true}
                          controls={editingChannel.embedSettings?.controls ?? true}
                        />
                      ) : (
                        <div className="text-zinc-500 text-xs">No active stream to preview</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t shrink-0">
            <Button variant="ghost" onClick={() => setEditingChannel(null)}>Cancel</Button>
            <Button onClick={handleUpdateChannel}>
              <Save className="h-4 w-4 mr-2" />
              Save Changes
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog 
        isOpen={!!previewChannel} 
        onClose={() => setPreviewChannel(null)}
        title={`${previewChannel?.name} - Live Preview`}
        description="Real-time HLS stream preview."
      >
        <div className="aspect-video bg-black rounded-lg overflow-hidden border border-zinc-800 flex items-center justify-center">
          {previewChannel && getChannelStreamUrl(previewChannel) ? (
            <VideoPlayer 
              src={getChannelStreamUrl(previewChannel)!} 
              className="w-full h-full"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-500">
              No content available to stream.
            </div>
          )}
        </div>
      </Dialog>
    </div>
  );
}
