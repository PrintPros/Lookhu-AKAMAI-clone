import { auth, db } from "../firebase";
import { collection, query, where, getDocs, limit, addDoc, updateDoc, doc } from "firebase/firestore";

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB

export async function uploadVideoToR2(
  file: File,
  metadata: any,
  onProgress: (phase: string, percent: number, message: string) => void
) {
  if (!auth.currentUser) throw new Error("User not authenticated");

  onProgress("uploading", 5, "Validating file...");

  // REQUIREMENT 1 — File validation
  if (file.type !== "video/mp4" && !file.name.toLowerCase().endsWith(".mp4")) {
    throw new Error("Only MP4 files are accepted.");
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `File too large (${(file.size / 1024 / 1024).toFixed(0)}MB). Maximum size is 500MB.`
    );
  }

  onProgress("uploading", 10, "Fetching bucket configuration...");

  // 1. Get active bucket config ID
  const cfQ = query(
    collection(db, "cloudflareConfigs"),
    where("userId", "==", auth.currentUser.uid),
    where("isActive", "==", true),
    limit(1)
  );
  const cfSnap = await getDocs(cfQ);
  if (cfSnap.empty) {
    throw new Error("No active R2 bucket connected. Go to Cloudflare Settings and add one first.");
  }
  const configId = cfSnap.docs[0].id;

  onProgress("uploading", 20, "Generating upload URL...");

  // 2. Get presigned URL for original MP4
  const videoId = `${Date.now()}-${(metadata.artistName || "unknown")
    .toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 20)}`;
  const mp4Key = `uploads/${videoId}.mp4`;

  const cfData = cfSnap.docs[0].data();
  const idToken = await auth.currentUser.getIdToken();

  // STEP 1 — Save Firestore placeholder document BEFORE starting the upload
  const mediaRef = await addDoc(collection(db, "media"), {
    name: metadata.songTitle || file.name,
    songTitle: metadata.songTitle || "",
    artistName: metadata.artistName || "",
    genre: metadata.genre || "",
    instagramUrl: metadata.instagramUrl || "",
    twitterUrl: metadata.twitterUrl || "",
    youtubeUrl: metadata.youtubeUrl || "",
    websiteUrl: metadata.websiteUrl || "",
    adBreakAfter: metadata.adBreakAfter || false,
    status: "uploading",
    userId: auth.currentUser.uid,
    createdAt: new Date().toISOString(),
    bucketName: cfData.bucketName,
    r2Path: `streams/${videoId}`,
    videoId,
    m3u8Url: "",
    segmentCount: 0,
    duration: 0,
  });
  const mediaId = mediaRef.id;

  try {
    onProgress("uploading", 20, "Generating upload URL...");

    // 2. Get presigned URL for original MP4
    const presignResp = await fetch("/api/r2/presign-secure", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      configId,
      accountId: cfData.accountId,
      r2AccessKeyId: cfData.r2AccessKeyId,
      r2SecretAccessKey: cfData.r2SecretAccessKey,
      bucketName: cfData.bucketName,
      keys: [{ key: mp4Key, contentType: "video/mp4" }]
    }),
  });

  if (!presignResp.ok) throw new Error("Failed to get upload URL");
  const { urls } = await presignResp.json();
  const { uploadUrl } = urls[0];

  // After presign succeeds, update status:
  await updateDoc(doc(db, "media", mediaId), { status: "uploading" });

  onProgress("uploading", 30, "Uploading MP4 to R2...");

  // 3. Upload MP4 to R2
  const uploadResp = await fetch(uploadUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": "video/mp4" },
  });

  if (!uploadResp.ok) throw new Error("Failed to upload video to R2");

  // After R2 upload succeeds, update status:
  await updateDoc(doc(db, "media", mediaId), { status: "transcoding" });

  onProgress("processing", 50, "Transcoding video... (this may take a few minutes)");

  // 4. Call /api/transcode
  const transcodeResp = await fetch("/api/transcode", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      mp4Key,
      mediaId, // Pass mediaId to transcode endpoint
      configId,
      accountId: cfData.accountId,
      r2AccessKeyId: cfData.r2AccessKeyId,
      r2SecretAccessKey: cfData.r2SecretAccessKey,
      bucketName: cfData.bucketName,
      publicBaseUrl: cfData.publicBaseUrl,
      userId: auth.currentUser!.uid,
      metadata: {
        ...metadata,
        name: file.name,
      }
    }),
  });

  if (!transcodeResp.ok) {
    const errorData = await transcodeResp.json();
    throw new Error(errorData.error || "Transcoding failed");
  }

  onProgress("done", 100, "Upload complete!");

  return { videoId, mp4Key, mediaId };
} catch (err: any) {
  // If any error occurs, update status to error:
  if (mediaId) {
    await updateDoc(doc(db, "media", mediaId), {
      status: "error",
      errorMessage: err.message
    });
  }
  throw err;
}
}
