import { useState, useEffect } from "react";
import { db, auth } from "../firebase";
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc,
  getDoc,
  where,
  getDocs,
  limit
} from "firebase/firestore";
import { ArtistSubmission, Media, Playlist } from "../types";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { Dialog } from "./ui/Dialog";
import { Input } from "./ui/Input";
import { VideoPlayer } from "./VideoPlayer";
import { 
  Check, 
  X, 
  Play, 
  Instagram, 
  Twitter, 
  Youtube, 
  Globe, 
  Mail, 
  Calendar,
  Filter,
  Loader2,
  Music
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { handleFirestoreError, OperationType } from "../lib/firestore-errors";

const GENRE_COLORS: Record<string, string> = {
  hiphop: "bg-purple-100 text-purple-700 border-purple-200",
  rock: "bg-red-100 text-red-700 border-red-200",
  edm: "bg-blue-100 text-blue-700 border-blue-200",
  rnb: "bg-pink-100 text-pink-700 border-pink-200",
  latin: "bg-amber-100 text-amber-700 border-amber-200",
  other: "bg-zinc-100 text-zinc-700 border-zinc-200",
};

export function ArtistSubmissions() {
  const [submissions, setSubmissions] = useState<ArtistSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"pending" | "all">("pending");
  const [filterGenre, setFilterGenre] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    // Submissions are global for admins
    const q = query(collection(db, "submissions"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as ArtistSubmission[];
      setSubmissions(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "submissions");
    });

    return () => unsubscribe();
  }, []);

  const handleApprove = async (submission: ArtistSubmission) => {
    try {
      // 1. Get the Cloudflare config used for this submission
      let configData: any = null;
      if (submission.configId) {
        const configSnap = await getDoc(doc(db, "cloudflareConfigs", submission.configId));
        if (configSnap.exists()) {
          configData = configSnap.data();
        }
      }

      const mediaData: Omit<Media, "id"> = {
        name: `${submission.artistName} - ${submission.songTitle}`,
        m3u8Url: submission.m3u8Url || "", // Will be populated by transcoder
        status: submission.mp4Key ? "transcoding" : "ready",
        duration: submission.duration || 0,
        createdAt: new Date().toISOString(),
        userId: auth.currentUser?.uid || "admin",
        artistName: submission.artistName,
        songTitle: submission.songTitle,
        genre: submission.genre,
        instagramUrl: submission.instagramUrl,
        twitterUrl: submission.twitterUrl,
        youtubeUrl: submission.youtubeUrl,
        websiteUrl: submission.websiteUrl,
        thumbnailUrl: submission.thumbnailUrl,
        submissionStatus: "approved",
        submittedBy: submission.email,
        bucketName: configData?.bucketName,
      };

      // 2. Add to media
      const mediaRef = await addDoc(collection(db, "media"), mediaData);
      
      // 3. Trigger transcoding if we have an MP4 key
      if (submission.mp4Key && configData) {
        const idToken = await auth.currentUser?.getIdToken();
        fetch("/api/transcode", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${idToken}`
          },
          body: JSON.stringify({
            mp4Key: submission.mp4Key,
            mediaId: mediaRef.id,
            accountId: configData.accountId,
            r2AccessKeyId: configData.r2AccessKeyId,
            r2SecretAccessKey: configData.r2SecretAccessKey,
            bucketName: configData.bucketName,
            publicBaseUrl: configData.publicBaseUrl,
            userId: auth.currentUser?.uid,
            metadata: {
              artistName: submission.artistName,
              songTitle: submission.songTitle
            }
          })
        })
        .then(async (res) => {
          if (!res.ok) throw new Error("Transcoding failed");
          const data = await res.json();
          const videoId = submission.mp4Key?.split('/')[1] || mediaRef.id;
          await updateDoc(doc(db, "media", mediaRef.id), {
            status: "ready",
            m3u8Url: `${configData.publicBaseUrl}/streams/${videoId}/index.m3u8`,
            segmentCount: data.segmentCount,
            duration: data.duration,
            segmentDuration: 6,
            segmentPrefix: "segment_",
            segmentPad: 4,
            r2Path: `streams/${videoId}`,
            bucketName: configData.bucketName,
          });
        })
        .catch(async (err) => {
          console.error("Transcode trigger failed:", err);
          await updateDoc(doc(db, "media", mediaRef.id), {
            status: "error",
            errorMessage: err.message
          });
        });
      }

      // 4. Update submission
      await updateDoc(doc(db, "submissions", submission.id), {
        status: "approved",
        reviewedAt: new Date().toISOString()
      });

      // 5. Add to genre playlist
      const q = query(
        collection(db, "playlists"), 
        where("genre", "==", submission.genre),
        where("userId", "==", auth.currentUser?.uid),
        limit(1)
      );
      const playlistSnap = await getDocs(q);
      if (!playlistSnap.empty) {
        const playlistDoc = playlistSnap.docs[0];
        const playlistData = playlistDoc.data() as Playlist;
        await updateDoc(playlistDoc.ref, {
          mediaIds: [...playlistData.mediaIds, mediaRef.id]
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `submissions/${submission.id}`);
    }
  };

  const handleReject = async (submission: ArtistSubmission) => {
    const notes = reviewNotes[submission.id] || "";
    
    try {
      await updateDoc(doc(db, "submissions", submission.id), {
        status: "rejected",
        reviewedAt: new Date().toISOString(),
        reviewNotes: notes
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `submissions/${submission.id}`);
    }
  };

  const filteredSubmissions = submissions.filter(s => {
    const matchesGenre = filterGenre === "all" || s.genre === filterGenre;
    const matchesStatus = filterStatus === "all" || s.status === filterStatus;
    const isPendingTab = activeTab === "pending" ? s.status === "pending" : true;
    return matchesGenre && matchesStatus && isPendingTab;
  });

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold text-zinc-900">Artist Submissions</h2>
          <p className="text-zinc-500">Moderate incoming music video submissions for the platform.</p>
        </div>
        
        <div className="flex bg-zinc-100 p-1 rounded-lg">
          <button
            onClick={() => setActiveTab("pending")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === "pending" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
            }`}
          >
            Pending Review
          </button>
          <button
            onClick={() => setActiveTab("all")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === "all" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
            }`}
          >
            All Submissions
          </button>
        </div>
      </div>

      {activeTab === "all" && (
        <div className="flex flex-wrap gap-4 bg-white p-4 rounded-xl border border-zinc-200 shadow-sm">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-zinc-400" />
            <select 
              className="text-sm border-none bg-transparent focus:ring-0"
              value={filterGenre}
              onChange={(e) => setFilterGenre(e.target.value)}
            >
              <option value="all">All Genres</option>
              <option value="hiphop">Hip Hop</option>
              <option value="rock">Rock</option>
              <option value="edm">EDM</option>
              <option value="rnb">R&B</option>
              <option value="latin">Latin</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="h-4 w-4 rounded-full p-0" />
            <select 
              className="text-sm border-none bg-transparent focus:ring-0"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
        </div>
      )}

      <div className="grid gap-6">
        <AnimatePresence mode="popLayout">
          {filteredSubmissions.map((submission) => (
            <motion.div
              key={submission.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              layout
            >
              <Card className="p-6 overflow-hidden">
                <div className="flex flex-col lg:flex-row gap-6">
                  {/* Thumbnail / Preview Area */}
                  <div className="w-full lg:w-64 h-36 bg-zinc-100 rounded-lg overflow-hidden relative group shrink-0">
                    {submission.thumbnailUrl ? (
                      <img 
                        src={submission.thumbnailUrl} 
                        alt={submission.songTitle}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-zinc-300">
                        <Music className="h-12 w-12" />
                      </div>
                    )}
                    
                    <Dialog 
                      isOpen={!!reviewNotes[submission.id + "_preview"]} 
                      onClose={() => setReviewNotes(prev => ({ ...prev, [submission.id + "_preview"]: "" }))}
                      title={`${submission.artistName} - ${submission.songTitle}`}
                    >
                      <div className="aspect-video bg-black rounded-lg overflow-hidden">
                        {submission.videoFileUrl || submission.m3u8Url ? (
                          <VideoPlayer src={submission.videoFileUrl || submission.m3u8Url || ""} />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-zinc-500 gap-4">
                            <Loader2 className="h-12 w-12 animate-spin" />
                            <p>Video is still processing...</p>
                          </div>
                        )}
                      </div>
                    </Dialog>

                    <button 
                      onClick={() => setReviewNotes(prev => ({ ...prev, [submission.id + "_preview"]: "true" }))}
                      className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                    >
                      <Play className="h-10 w-10 text-white fill-white" />
                    </button>
                  </div>

                  {/* Content Area */}
                  <div className="flex-1 space-y-4">
                    <div className="flex flex-wrap justify-between items-start gap-4">
                      <div>
                        <h3 className="text-xl font-bold text-zinc-900">
                          {submission.artistName} <span className="text-zinc-400 font-normal mx-1">—</span> {submission.songTitle}
                        </h3>
                        <div className="flex flex-wrap items-center gap-3 mt-2">
                          <Badge className={GENRE_COLORS[submission.genre] || GENRE_COLORS.other}>
                            {submission.genre.toUpperCase()}
                          </Badge>
                          <div className="flex items-center gap-1 text-xs text-zinc-500">
                            <Mail className="h-3 w-3" />
                            {submission.email}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-zinc-500">
                            <Calendar className="h-3 w-3" />
                            {new Date(submission.submittedAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        {submission.instagramUrl && (
                          <a href={submission.instagramUrl} target="_blank" rel="noreferrer" className="p-2 text-zinc-400 hover:text-pink-600 transition-colors">
                            <Instagram className="h-5 w-5" />
                          </a>
                        )}
                        {submission.twitterUrl && (
                          <a href={submission.twitterUrl} target="_blank" rel="noreferrer" className="p-2 text-zinc-400 hover:text-blue-400 transition-colors">
                            <Twitter className="h-5 w-5" />
                          </a>
                        )}
                        {submission.youtubeUrl && (
                          <a href={submission.youtubeUrl} target="_blank" rel="noreferrer" className="p-2 text-zinc-400 hover:text-red-600 transition-colors">
                            <Youtube className="h-5 w-5" />
                          </a>
                        )}
                        {submission.websiteUrl && (
                          <a href={submission.websiteUrl} target="_blank" rel="noreferrer" className="p-2 text-zinc-400 hover:text-zinc-900 transition-colors">
                            <Globe className="h-5 w-5" />
                          </a>
                        )}
                      </div>
                    </div>

                    {submission.status === "pending" ? (
                      <div className="flex flex-col sm:flex-row gap-4 pt-4 border-t border-zinc-100">
                        <div className="flex-1">
                          <Input 
                            placeholder="Optional rejection notes..."
                            className="text-sm"
                            value={reviewNotes[submission.id] || ""}
                            onChange={(e) => setReviewNotes({ ...reviewNotes, [submission.id]: e.target.value })}
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button 
                            variant="outline" 
                            className="border-red-200 text-red-600 hover:bg-red-50"
                            onClick={() => handleReject(submission)}
                          >
                            <X className="h-4 w-4 mr-2" />
                            Reject
                          </Button>
                          <Button 
                            className="bg-green-600 text-white hover:bg-green-700"
                            onClick={() => handleApprove(submission)}
                          >
                            <Check className="h-4 w-4 mr-2" />
                            Approve
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="pt-4 border-t border-zinc-100 flex items-center justify-between">
                        <Badge className={
                          submission.status === "approved" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                        }>
                          {submission.status.toUpperCase()}
                        </Badge>
                        {submission.reviewNotes && (
                          <p className="text-sm text-zinc-500 italic">"{submission.reviewNotes}"</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>

        {filteredSubmissions.length === 0 && (
          <div className="py-20 text-center bg-white rounded-2xl border border-zinc-200 border-dashed">
            <Music className="h-12 w-12 mx-auto text-zinc-200 mb-4" />
            <p className="text-zinc-500">No submissions found in this category.</p>
          </div>
        )}
      </div>
    </div>
  );
}
