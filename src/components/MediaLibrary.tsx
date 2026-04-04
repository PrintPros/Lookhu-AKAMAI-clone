import React, { useState, useEffect } from "react";
import { Upload, FileVideo, Play, Trash2, CheckCircle2, Clock, AlertCircle, Library, Pencil } from "lucide-react";
import { Button } from "./ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { CloudflareConfig, Media } from "../types";
import { collection, query, where, onSnapshot, addDoc, deleteDoc, doc, updateDoc, limit, getDocs } from "firebase/firestore";
import { db, auth } from "../firebase";
import { handleFirestoreError, OperationType } from "../lib/firestore-errors";
import { Dialog } from "./ui/Dialog";
import { VideoPlayer } from "./VideoPlayer";
import { Input } from "./ui/Input";
import { CardDescription, CardFooter } from "./ui/Card";
import { cn } from "../lib/utils";
import { uploadVideoToR2 } from "../lib/uploader";
import { toast } from "sonner";

export function MediaLibrary({ profile }: { profile: any }) {
  const [deleteTarget, setDeleteTarget] = useState<Media | null>(null);
  const [deletingR2, setDeletingR2] = useState(false);
  const [media, setMedia] = useState<Media[]>([]);
  const [uploading, setUploading] = useState(false);
  const [previewMedia, setPreviewMedia] = useState<Media | null>(null);
  const [editingMedia, setEditingMedia] = useState<Media | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [cfConfigs, setCfConfigs] = useState<CloudflareConfig[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadMetadata, setUploadMetadata] = useState({
    songTitle: "",
    artistName: "",
    genre: "Hip Hop",
    instagramUrl: "",
    twitterUrl: "",
    youtubeUrl: "",
    websiteUrl: "",
    adBreakAfter: false
  });

  const [transcodePhase, setTranscodePhase] =
    useState<"idle"|"uploading"|"processing"|"done"|"error">("idle");
  const [transcodeProgress, setTranscodeProgress] = useState(0);
  const [transcodeMessage, setTranscodeMessage] = useState("");
  const [segUpload, setSegUpload] =
    useState<{ uploaded: number; total: number; percent: number }>({
      uploaded: 0, total: 0, percent: 0
    });

  useEffect(() => {
    if (!auth.currentUser || !profile) return;

    const isMaster = profile.role === "master_admin";
    const targetUserId = isMaster ? null : (profile.ownerUserId || auth.currentUser.uid);

    let q = query(collection(db, "media"));
    if (targetUserId) {
      q = query(q, where("userId", "==", targetUserId));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const mediaData = snapshot.docs.map((doc) => ({
        ...doc.data(),
        id: doc.id,
      })) as Media[];
      setMedia(mediaData.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "media");
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!auth.currentUser) return;
    const q = query(collection(db, "cloudflareConfigs"), where("userId", "==", auth.currentUser.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setCfConfigs(snapshot.docs.map(d => ({ ...d.data(), id: d.id })) as CloudflareConfig[]);
    });
    return () => unsubscribe();
  }, []);

  const handleRepairDurations = async () => {
    const missing = media.filter(m => !m.duration && m.bucketName && m.r2Path);
    if (missing.length === 0) {
      toast.info("No media items need repairing.");
      return;
    }

    setRepairing(true);
    let repaired = 0;
    let failed = 0;

    try {
      for (const item of missing) {
        const config = cfConfigs.find(c => c.bucketName === item.bucketName);
        if (!config) {
          failed++;
          continue;
        }

        try {
          const key = item.r2Path ? `${item.r2Path}/index.m3u8` : "index.m3u8";
          const response = await fetch("/api/r2/metadata", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accountId: config.accountId,
              r2AccessKeyId: config.r2AccessKeyId,
              r2SecretAccessKey: config.r2SecretAccessKey,
              bucketName: config.bucketName,
              key: key
            })
          });

          if (!response.ok) throw new Error("Failed to fetch metadata");
          const data = await response.json();
          
          if (data.duration) {
            await updateDoc(doc(db, "media", item.id), {
              duration: data.duration
            });
            repaired++;
          } else {
            failed++;
          }
        } catch (err) {
          console.error(`Failed to repair ${item.id}:`, err);
          failed++;
        }
      }

      toast.success(`Repaired ${repaired} items. ${failed > 0 ? `${failed} failed.` : ""}`);
    } catch (err: any) {
      toast.error(err.message || "Repair failed");
    } finally {
      setRepairing(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setUploadMetadata(prev => ({ ...prev, songTitle: file.name.replace(/\.[^/.]+$/, "") }));
      setShowUploadForm(true);
    }
  };

  const handleUploadSubmit = async () => {
    if (!selectedFile) {
      toast.error("Please select a file first.");
      return;
    }
    if (!uploadMetadata.songTitle || !uploadMetadata.artistName) {
      toast.error("Please fill in song title and artist name.");
      return;
    }

    setUploading(true);
    setTranscodePhase("uploading");
    setTranscodeProgress(0);
    setTranscodeMessage("Starting upload...");

    try {
      await uploadVideoToR2(
        selectedFile,
        uploadMetadata,
        (phase: string, percent: number, message: string) => {
          setTranscodePhase(phase as any);
          setTranscodeProgress(percent);
          setTranscodeMessage(message);
        }
      );

      setTranscodePhase("done");
      setTranscodeMessage("Upload complete!");
      toast.success("Video uploaded and transcoding started!");

      setTimeout(() => {
        setTranscodePhase("idle");
        setShowUploadForm(false);
        setSelectedFile(null);
        setUploadMetadata({
          songTitle: "",
          artistName: "",
          genre: "Hip Hop",
          instagramUrl: "",
          twitterUrl: "",
          youtubeUrl: "",
          websiteUrl: "",
          adBreakAfter: false,
        });
      }, 2500);

    } catch (err: any) {
      setTranscodePhase("error");
      setTranscodeMessage(err.message || "Upload failed");
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (deleteFromR2: boolean) => {
    if (!deleteTarget) return;
    setDeletingR2(true);
    try {
      if (deleteFromR2 && deleteTarget.r2Path && deleteTarget.bucketName) {
        const config = cfConfigs.find(c => c.bucketName === deleteTarget.bucketName);
        if (config) {
          await fetch("/api/r2/delete-folder", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accountId: config.accountId,
              r2AccessKeyId: config.r2AccessKeyId,
              r2SecretAccessKey: config.r2SecretAccessKey,
              bucketName: deleteTarget.bucketName,
              prefix: deleteTarget.r2Path,
            }),
          });
        }
      }
      await deleteDoc(doc(db, "media", deleteTarget.id));
      toast.success(deleteFromR2 ? "Deleted from library and R2" : "Deleted from library only");
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `media/${deleteTarget.id}`);
    } finally {
      setDeletingR2(false);
      setDeleteTarget(null);
    }
  };

  const getStatusBadge = (status: Media["status"]) => {
    switch (status) {
      case "ready":
        return <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Ready</Badge>;
      case "uploading":
        return <Badge variant="secondary" className="gap-1 animate-pulse"><Upload className="h-3 w-3" /> Uploading</Badge>;
      case "transcoding":
        return <Badge variant="secondary" className="gap-1 animate-pulse"><Clock className="h-3 w-3" /> Transcoding...</Badge>;
      case "error":
        return <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" /> Error</Badge>;
      default:
        return <Badge variant="outline">Processing</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900">Media Library</h2>
          <p className="text-zinc-500">Manage and upload your music video assets.</p>
        </div>
        <div className="flex items-center gap-2">
          {media.some(m => !m.duration && m.bucketName && m.r2Path) && (
            <Button 
              variant="outline" 
              onClick={handleRepairDurations} 
              disabled={repairing}
              className="border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:text-amber-800"
            >
              <Clock className={cn("mr-2 h-4 w-4", repairing && "animate-spin")} />
              {repairing ? "Repairing..." : "Repair Durations"}
            </Button>
          )}
          <div className="relative">
            <input
              type="file"
              id="file-upload"
              className="hidden"
              accept="video/mp4"
              onChange={handleFileSelect}
              disabled={uploading}
            />
            <label htmlFor="file-upload">
              <Button asChild disabled={uploading} className="cursor-pointer">
                <span>
                  <Upload className="mr-2 h-4 w-4" />
                  {uploading ? "Uploading..." : "Upload Video"}
                </span>
              </Button>
            </label>
          </div>
        </div>
      </div>

      {showUploadForm && (
        <Card className="border-zinc-900 shadow-lg">
          <CardHeader>
            <CardTitle>Media Metadata</CardTitle>
            <CardDescription>Enter details for the new music video.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {transcodePhase === "idle" ? (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Song Title *</label>
                    <Input 
                      value={uploadMetadata.songTitle}
                      onChange={e => setUploadMetadata(prev => ({ ...prev, songTitle: e.target.value }))}
                      placeholder="Enter song title"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Artist Name *</label>
                    <Input 
                      value={uploadMetadata.artistName}
                      onChange={e => setUploadMetadata(prev => ({ ...prev, artistName: e.target.value }))}
                      placeholder="Enter artist name"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Genre</label>
                    <select 
                      className="w-full h-10 px-3 py-2 bg-white border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                      value={uploadMetadata.genre}
                      onChange={e => setUploadMetadata(prev => ({ ...prev, genre: e.target.value }))}
                    >
                      {["Hip Hop", "Rock", "EDM", "R&B", "Latin", "Other"].map(g => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Instagram URL</label>
                    <Input 
                      value={uploadMetadata.instagramUrl}
                      onChange={e => setUploadMetadata(prev => ({ ...prev, instagramUrl: e.target.value }))}
                      placeholder="https://instagram.com/..."
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Twitter/X URL</label>
                    <Input 
                      value={uploadMetadata.twitterUrl}
                      onChange={e => setUploadMetadata(prev => ({ ...prev, twitterUrl: e.target.value }))}
                      placeholder="https://twitter.com/..."
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">YouTube URL</label>
                    <Input 
                      value={uploadMetadata.youtubeUrl}
                      onChange={e => setUploadMetadata(prev => ({ ...prev, youtubeUrl: e.target.value }))}
                      placeholder="https://youtube.com/..."
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Website URL</label>
                    <Input 
                      value={uploadMetadata.websiteUrl}
                      onChange={e => setUploadMetadata(prev => ({ ...prev, websiteUrl: e.target.value }))}
                      placeholder="https://..."
                    />
                  </div>
                  <div className="flex items-center space-x-2 pt-8">
                    <input 
                      type="checkbox"
                      id="adBreak"
                      checked={uploadMetadata.adBreakAfter}
                      onChange={e => setUploadMetadata(prev => ({ ...prev, adBreakAfter: e.target.checked }))}
                      className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                    />
                    <label htmlFor="adBreak" className="text-sm font-medium">Ad break after this video?</label>
                  </div>
                </div>

                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg flex gap-3">
                  <Clock className="h-5 w-5 text-blue-600 shrink-0" />
                  <div className="text-sm text-blue-800">
                    <p className="font-bold">Server-side Processing</p>
                    <p>Your video will be uploaded and then processed on our servers. You can continue using the app while it's being prepared.</p>
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setShowUploadForm(false)}>Cancel</Button>
                  <Button onClick={handleUploadSubmit} disabled={!uploadMetadata.songTitle || !uploadMetadata.artistName || uploading}>
                    {uploading ? "Processing..." : "Upload & Transcode"}
                  </Button>
                </div>
              </>
            ) : transcodePhase === "uploading" ? (
              <div className="py-12 flex flex-col items-center text-center space-y-4">
                <div className="h-16 w-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center animate-pulse">
                  <Upload className="h-10 w-10" />
                </div>
                <h3 className="text-xl font-bold text-zinc-900">Uploading Video...</h3>
                <p className="text-zinc-500">Sending your original MP4 to Cloudflare R2.</p>
                <p className="text-xs text-zinc-400">This may take a moment depending on your connection.</p>
              </div>
            ) : transcodePhase === "processing" ? (
              <div className="py-12 flex flex-col items-center text-center space-y-4">
                <div className="h-16 w-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center animate-spin">
                  <Clock className="h-10 w-10" />
                </div>
                <h3 className="text-xl font-bold text-zinc-900">Processing on Server...</h3>
                <p className="text-zinc-500">We're transcoding your video for HLS streaming. You can close this window now.</p>
                <Button variant="outline" onClick={() => { setTranscodePhase("idle"); setShowUploadForm(false); }}>Close & Continue</Button>
              </div>
            ) : transcodePhase === "done" ? (
              <div className="py-12 flex flex-col items-center text-center space-y-4">
                <div className="h-16 w-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center">
                  <CheckCircle2 className="h-10 w-10" />
                </div>
                <h3 className="text-xl font-bold text-zinc-900">Success!</h3>
                <p className="text-zinc-500">Video uploaded and ready for broadcast.</p>
              </div>
            ) : (
              <div className="py-12 flex flex-col items-center text-center space-y-4">
                <div className="h-16 w-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center">
                  <AlertCircle className="h-10 w-10" />
                </div>
                <h3 className="text-xl font-bold text-zinc-900">Error</h3>
                <p className="text-red-600">{transcodeMessage}</p>
                <Button variant="outline" onClick={() => setTranscodePhase("idle")}>Try Again</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {media.map((item) => {
          const displayName = item.artistName && item.songTitle
            ? `${item.artistName} — ${item.songTitle}`
            : item.songTitle || item.artistName || item.name;

          const secondaryLine = item.duration
            ? `${Math.floor(item.duration / 60)} min`
            : item.segmentCount ? `${item.segmentCount} segments` : "No duration";

          return (
            <Card key={item.id} className="overflow-hidden group">
              <div 
                className="aspect-video bg-zinc-100 flex items-center justify-center relative"
                onMouseEnter={() => setHoveredId(item.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                {hoveredId === item.id && item.status === "ready" ? (
                  <div className="absolute inset-0 z-0">
                    <VideoPlayer 
                      src={item.m3u8Url} 
                      className="w-full h-full object-cover" 
                      muted 
                      autoPlay 
                      loop 
                      controls={false}
                    />
                  </div>
                ) : (
                  <FileVideo className="h-12 w-12 text-zinc-300" />
                )}
                
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 z-10">
                  {item.status === "ready" && (
                    <Button 
                      size="icon" 
                      variant="secondary" 
                      className="rounded-full"
                      onClick={() => setPreviewMedia(item)}
                    >
                      <Play className="h-4 w-4 fill-current" />
                    </Button>
                  )}
                  <Button 
                    size="icon" 
                    variant="ghost" 
                    className="rounded-full h-8 w-8 text-white hover:text-red-500"
                    onClick={() => setDeleteTarget(item)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="absolute top-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    size="icon"
                    variant="secondary"
                    className="h-8 w-8 rounded-full shadow-lg"
                    onClick={() => setEditingMedia(item)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="absolute top-2 left-2 z-20">
                  <Badge className={cn(
                    "border-none text-white",
                    item.genre === "Hip Hop" ? "bg-purple-600" :
                    item.genre === "Rock" ? "bg-red-600" :
                    item.genre === "EDM" ? "bg-blue-600" :
                    item.genre === "R&B" ? "bg-pink-600" :
                    item.genre === "Latin" ? "bg-amber-600" : "bg-zinc-600"
                  )}>
                    {item.genre || "Other"}
                  </Badge>
                </div>
              </div>
              <CardHeader className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-sm font-bold truncate" title={displayName}>
                      {displayName}
                    </CardTitle>
                    <p className="text-[10px] text-zinc-500 truncate">{secondaryLine}</p>
                  </div>
                  {getStatusBadge(item.status)}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex gap-1.5">
                    {item.instagramUrl && (
                      <a href={item.instagramUrl} target="_blank" rel="noreferrer" className="text-zinc-400 hover:text-zinc-900 transition-colors">
                        <svg className="h-3 w-3 fill-current" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 1.366.062 2.633.334 3.608 1.308.975.975 1.247 2.242 1.308 3.608.058 1.266.07 1.646.07 4.85s-.012 3.584-.07 4.85c-.062 1.366-.334 2.633-1.308 3.608-.975.975-2.242 1.247-3.608 1.308-1.266.058-1.646.07-4.85.07s-3.584-.012-4.85-.07c-1.366-.062-2.633-.334-3.608-1.308-.975-.975-1.247-2.242-1.308-3.608-.058-1.266-.07-1.646-.07-4.85s.012-3.584.07-4.85c.062-1.366.334-2.633 1.308-3.608.975-.975 2.242-1.247 3.608-1.308 1.266-.058 1.646-.07 4.85-.07zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948s.014 3.667.072 4.947c.2 4.337 2.617 6.78 6.979 6.98 1.281.058 1.689.072 4.948.072s3.667-.014 4.947-.072c4.351-.2 6.785-2.614 6.98-6.98.058-1.28.072-1.689.072-4.948s-.014-3.667-.072-4.947c-.196-4.354-2.617-6.78-6.979-6.98-1.281-.058-1.69-.072-4.949-.072zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
                      </a>
                    )}
                    {item.twitterUrl && (
                      <a href={item.twitterUrl} target="_blank" rel="noreferrer" className="text-zinc-400 hover:text-zinc-900 transition-colors">
                        <svg className="h-3 w-3 fill-current" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                      </a>
                    )}
                    {item.youtubeUrl && (
                      <a href={item.youtubeUrl} target="_blank" rel="noreferrer" className="text-zinc-400 hover:text-zinc-900 transition-colors">
                        <svg className="h-3 w-3 fill-current" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                      </a>
                    )}
                  </div>
                  <p className="text-[10px] text-zinc-500 font-mono">
                    {new Date(item.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </CardHeader>
            </Card>
          );
        })}

        {media.length === 0 && !uploading && (
          <div className="col-span-full flex flex-col items-center justify-center py-20 border-2 border-dashed border-zinc-200 rounded-xl bg-zinc-50">
            <Library className="h-12 w-12 text-zinc-300 mb-4" />
            <h3 className="text-lg font-medium text-zinc-900">No media found</h3>
            <p className="text-zinc-500">Upload your first MP4 to get started.</p>
          </div>
        )}
      </div>

      <Dialog
        isOpen={!!previewMedia}
        onClose={() => setPreviewMedia(null)}
        title={`Preview: ${previewMedia?.name}`}
        description="Media playback preview."
      >
        <div className="aspect-video bg-black rounded-lg overflow-hidden">
          {previewMedia && (
            <VideoPlayer 
              src={previewMedia.m3u8Url} 
              className="w-full h-full" 
            />
          )}
        </div>
      </Dialog>

      <Dialog
        isOpen={!!editingMedia}
        onClose={() => setEditingMedia(null)}
        title="Edit Video Details"
        description="Update the metadata for this music video."
      >
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Song Title *</label>
            <Input 
              value={editingMedia?.songTitle || ""}
              onChange={e => setEditingMedia(prev => prev ? { ...prev, songTitle: e.target.value } : null)}
              placeholder="Enter song title"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Artist Name</label>
            <Input 
              value={editingMedia?.artistName || ""}
              onChange={e => setEditingMedia(prev => prev ? { ...prev, artistName: e.target.value } : null)}
              placeholder="Enter artist name"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Genre</label>
            <select 
              className="w-full h-10 px-3 py-2 bg-white border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
              value={editingMedia?.genre || "Other"}
              onChange={e => setEditingMedia(prev => prev ? { ...prev, genre: e.target.value } : null)}
            >
              {["Hip Hop", "Rock", "EDM", "R&B", "Latin", "Other"].map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Instagram URL</label>
              <Input 
                value={editingMedia?.instagramUrl || ""}
                onChange={e => setEditingMedia(prev => prev ? { ...prev, instagramUrl: e.target.value } : null)}
                placeholder="https://instagram.com/..."
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Twitter/X URL</label>
              <Input 
                value={editingMedia?.twitterUrl || ""}
                onChange={e => setEditingMedia(prev => prev ? { ...prev, twitterUrl: e.target.value } : null)}
                placeholder="https://twitter.com/..."
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">YouTube URL</label>
              <Input 
                value={editingMedia?.youtubeUrl || ""}
                onChange={e => setEditingMedia(prev => prev ? { ...prev, youtubeUrl: e.target.value } : null)}
                placeholder="https://youtube.com/..."
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Website URL</label>
              <Input 
                value={editingMedia?.websiteUrl || ""}
                onChange={e => setEditingMedia(prev => prev ? { ...prev, websiteUrl: e.target.value } : null)}
                placeholder="https://..."
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="ghost" onClick={() => setEditingMedia(null)}>Cancel</Button>
            <Button onClick={async () => {
              if (editingMedia) {
                try {
                  await updateDoc(doc(db, "media", editingMedia.id), { ...editingMedia });
                  setEditingMedia(null);
                } catch (error) {
                  handleFirestoreError(error, OperationType.UPDATE, `media/${editingMedia.id}`);
                }
              }
            }}>Save Changes</Button>
          </div>
        </div>
      </Dialog>
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-zinc-900">Delete Media</h3>
            <p className="text-zinc-600 text-sm">
              Delete <span className="font-semibold">{deleteTarget.artistName} — {deleteTarget.songTitle}</span> from the library?
            </p>
            {deleteTarget.r2Path && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                Also delete the HLS segments from R2 storage? This frees up storage space but cannot be undone.
              </div>
            )}
            <div className="flex flex-col gap-2 pt-2">
              {deleteTarget.r2Path && (
                <Button
                  className="w-full bg-red-600 hover:bg-red-700 text-white"
                  onClick={() => handleDelete(true)}
                  disabled={deletingR2}
                >
                  {deletingR2 ? "Deleting..." : "Delete from Library + R2 Storage"}
                </Button>
              )}
              <Button
                variant="outline"
                className="w-full"
                onClick={() => handleDelete(false)}
                disabled={deletingR2}
              >
                Delete from Library Only
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setDeleteTarget(null)}
                disabled={deletingR2}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
