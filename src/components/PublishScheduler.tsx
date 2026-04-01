import { useState, useEffect } from "react";
import { Calendar, Clock, Play, Trash2, History, AlertCircle, CheckCircle2, Loader2, Timer } from "lucide-react";
import { Button } from "./ui/Button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { Input } from "./ui/Input";
import { db, auth } from "../firebase";
import { handleFirestoreError, OperationType } from "../lib/firestore-errors";
import { collection, query, where, orderBy, limit, onSnapshot, addDoc, updateDoc, doc, getDocs } from "firebase/firestore";
import { Playlist } from "../types";
import { toast } from "sonner";
import { format, formatDistanceToNow, isAfter, addHours, startOfHour, setHours } from "date-fns";

interface PublishSchedulerProps {
  channelId: string;
  channelName: string;
  currentPlaylistId?: string;
  onPublishNow: () => Promise<void>;
}

interface ScheduledPublish {
  id: string;
  channelId: string;
  channelName: string;
  channelSlug: string;
  playlistId: string;
  playlistName: string;
  scheduledAt: string;
  status: "pending" | "published" | "cancelled" | "failed";
  createdAt: string;
  createdBy: string;
  publishedAt?: string;
  error?: string;
}

export function PublishScheduler({ channelId, channelName, currentPlaylistId, onPublishNow }: PublishSchedulerProps) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [pendingSchedules, setPendingSchedules] = useState<ScheduledPublish[]>([]);
  const [history, setHistory] = useState<ScheduledPublish[]>([]);
  const [isScheduling, setIsScheduling] = useState(false);
  const [isPublishingNow, setIsPublishingNow] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Form state
  const [selectedPlaylistId, setSelectedPlaylistId] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");

  // Countdown state
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!auth.currentUser) return;

    // Fetch playlists
    const playlistsQ = query(
      collection(db, "playlists"),
      where("userId", "==", auth.currentUser.uid)
    );
    getDocs(playlistsQ).then((snap) => {
      setPlaylists(snap.docs.map(d => ({ ...d.data(), id: d.id })) as Playlist[]);
    });

    // Listen for pending schedules
    const pendingQ = query(
      collection(db, "scheduledPublishes"),
      where("channelId", "==", channelId),
      where("createdBy", "==", auth.currentUser.uid),
      where("status", "==", "pending"),
      orderBy("scheduledAt", "asc")
    );
    const unsubscribePending = onSnapshot(pendingQ, (snap) => {
      setPendingSchedules(snap.docs.map(d => ({ ...d.data(), id: d.id })) as ScheduledPublish[]);
    });

    // Listen for history
    const historyQ = query(
      collection(db, "scheduledPublishes"),
      where("channelId", "==", channelId),
      where("createdBy", "==", auth.currentUser.uid),
      where("status", "!=", "pending"),
      orderBy("scheduledAt", "desc"),
      limit(10)
    );
    const unsubscribeHistory = onSnapshot(historyQ, (snap) => {
      setHistory(snap.docs.map(d => ({ ...d.data(), id: d.id })) as ScheduledPublish[]);
    }, (error) => {
      if (error.code === "failed-precondition") {
        console.warn("History index missing, falling back to simple query");
        const simpleHistoryQ = query(
          collection(db, "scheduledPublishes"),
          where("channelId", "==", channelId),
          where("createdBy", "==", auth.currentUser.uid),
          limit(20)
        );
        onSnapshot(simpleHistoryQ, (snap) => {
          const filtered = snap.docs
            .map(d => ({ ...d.data(), id: d.id })) as ScheduledPublish[];
          setHistory(filtered.filter(s => s.status !== "pending").sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt)).slice(0, 10));
        });
      } else {
        handleFirestoreError(error, OperationType.GET, "scheduledPublishes (history)");
      }
    });

    return () => {
      unsubscribePending();
      unsubscribeHistory();
    };
  }, [channelId]);

  // Default to next 2am
  useEffect(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const next2am = setHours(tomorrow, 2);
    setScheduledDate(format(next2am, "yyyy-MM-dd"));
    setScheduledTime("02:00");
  }, []);

  const handleSchedule = async () => {
    if (!selectedPlaylistId || !scheduledDate || !scheduledTime || !auth.currentUser) {
      toast.error("Please fill in all fields.");
      return;
    }

    const scheduledAt = new Date(`${scheduledDate}T${scheduledTime}`);
    const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);

    if (!isAfter(scheduledAt, fiveMinutesFromNow)) {
      toast.error("Scheduled time must be at least 5 minutes in the future.");
      return;
    }

    setIsScheduling(true);
    try {
      const playlist = playlists.find(p => p.id === selectedPlaylistId);
      const channelSlug = channelName.toLowerCase().replace(/\s+/g, "-");

      await addDoc(collection(db, "scheduledPublishes"), {
        channelId,
        channelName,
        channelSlug,
        playlistId: selectedPlaylistId,
        playlistName: playlist?.name || "Unknown Playlist",
        scheduledAt: scheduledAt.toISOString(),
        status: "pending",
        createdAt: new Date().toISOString(),
        createdBy: auth.currentUser.uid
      });

      toast.success("Publish scheduled successfully.");
      setSelectedPlaylistId("");
    } catch (error) {
      console.error("Error scheduling publish:", error);
      toast.error("Failed to schedule publish.");
    } finally {
      setIsScheduling(false);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await updateDoc(doc(db, "scheduledPublishes", id), {
        status: "cancelled"
      });
      toast.success("Schedule cancelled.");
    } catch (error) {
      toast.error("Failed to cancel schedule.");
    }
  };

  const getCountdown = (scheduledAt: string) => {
    const target = new Date(scheduledAt);
    const diff = target.getTime() - now.getTime();
    if (diff <= 0) return "Starting...";

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    return `in \${hours}h \${minutes}m \${seconds}s`;
  };

  const isPeakHours = () => {
    if (!scheduledTime) return false;
    const hour = parseInt(scheduledTime.split(":")[0]);
    return hour >= 18 && hour <= 23;
  };

  const currentPlaylist = playlists.find(p => p.id === currentPlaylistId);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* CURRENT STATUS */}
        <Card className="bg-zinc-900 text-white border-zinc-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="w-5 h-5 text-green-400" />
              Current Status
            </CardTitle>
            <CardDescription className="text-zinc-400">What's currently live on {channelName}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
              <div className="text-sm text-zinc-400 mb-1">Active Playlist</div>
              <div className="text-lg font-medium">{currentPlaylist?.name || "None"}</div>
              {history.find(h => h.status === "published") && (
                <div className="text-xs text-zinc-500 mt-2">
                  Last published: {format(new Date(history.find(h => h.status === "published")!.publishedAt!), "MMM d, h:mm a")}
                </div>
              )}
            </div>
            <Button 
              className="w-full bg-white text-black hover:bg-zinc-200"
              onClick={async () => {
                setIsPublishingNow(true);
                try {
                  await onPublishNow();
                  toast.success("Publishing now...");
                } finally {
                  setIsPublishingNow(false);
                }
              }}
              disabled={isPublishingNow}
            >
              {isPublishingNow ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
              Publish Changes Now
            </Button>
          </CardContent>
        </Card>

        {/* SCHEDULE NEW */}
        <Card className="border-zinc-200 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-zinc-600" />
              Schedule New
            </CardTitle>
            <CardDescription>Plan a future playlist update</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700">Select Playlist</label>
              <select 
                className="w-full h-10 px-3 rounded-md border border-zinc-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                value={selectedPlaylistId}
                onChange={(e) => setSelectedPlaylistId(e.target.value)}
              >
                <option value="">Choose a playlist...</option>
                {playlists.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700">Date</label>
                <Input 
                  type="date" 
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700">Time</label>
                <Input 
                  type="time" 
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                />
              </div>
            </div>

            {isPeakHours() && (
              <div className="p-3 rounded-md bg-amber-50 border border-amber-200 flex gap-2 text-amber-800 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Scheduling during peak hours (6pm-12am) may impact more viewers.</span>
              </div>
            )}

            <Button 
              className="w-full bg-zinc-900 text-white hover:bg-zinc-800"
              onClick={handleSchedule}
              disabled={isScheduling}
            >
              {isScheduling ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Clock className="w-4 h-4 mr-2" />}
              Schedule Publish
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* PENDING SCHEDULES */}
      <Card className="border-zinc-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Timer className="w-5 h-5 text-zinc-600" />
            Pending Schedules
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pendingSchedules.length === 0 ? (
            <div className="text-center py-8 text-zinc-500 text-sm">No pending schedules for this channel.</div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {pendingSchedules.map(s => (
                <div key={s.id} className="py-4 flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="font-medium text-zinc-900">{s.playlistName}</div>
                    <div className="text-xs text-zinc-500 flex items-center gap-2">
                      <Calendar className="w-3 h-3" />
                      {format(new Date(s.scheduledAt), "EEEE, MMM d 'at' h:mm a")}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-sm font-mono font-medium text-zinc-900">{getCountdown(s.scheduledAt)}</div>
                      <div className="text-[10px] text-zinc-400 uppercase tracking-wider">Countdown</div>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="text-zinc-400 hover:text-red-600 hover:bg-red-50"
                      onClick={() => handleCancel(s.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* HISTORY */}
      <div className="space-y-2">
        <Button 
          variant="ghost" 
          className="w-full flex items-center justify-between text-zinc-500 hover:text-zinc-900"
          onClick={() => setShowHistory(!showHistory)}
        >
          <div className="flex items-center gap-2">
            <History className="w-4 h-4" />
            History
          </div>
          <Badge variant="secondary" className="bg-zinc-100 text-zinc-600">{history.length}</Badge>
        </Button>

        {showHistory && (
          <Card className="border-zinc-200 shadow-sm">
            <CardContent className="p-0">
              <div className="divide-y divide-zinc-100">
                {history.map(h => (
                  <div key={h.id} className="p-4 flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-zinc-900">{h.playlistName}</div>
                      <div className="text-xs text-zinc-500">
                        Scheduled for {format(new Date(h.scheduledAt), "MMM d, h:mm a")}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {h.status === "published" && (
                        <Badge className="bg-green-50 text-green-700 border-green-200 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Published
                        </Badge>
                      )}
                      {h.status === "cancelled" && (
                        <Badge variant="secondary" className="bg-zinc-100 text-zinc-500 border-zinc-200">
                          Cancelled
                        </Badge>
                      )}
                      {h.status === "failed" && (
                        <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          Failed
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
                {history.length === 0 && (
                  <div className="p-8 text-center text-zinc-500 text-sm">No history yet.</div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
