export interface UploadProgress {
  uploaded: number;
  total: number;
  percent: number;
  currentFile: string;
}

export interface R2UploadResult {
  videoId: string;
  r2Path: string;
  publicBaseUrl: string;
  bucketName: string;
  segmentCount: number;
  segmentDuration: number;
  prefix: string;
  pad: number;
  totalDuration: number;
  estimatedBytes: number;
}

export async function uploadToR2(
  segments: Array<{ name: string; data: Uint8Array; duration: number }>,
  bucketConfig: {
    accountId: string;
    r2AccessKeyId: string;
    r2SecretAccessKey: string;
    bucketName: string;
    publicBaseUrl: string;
  },
  videoId: string,
  onProgress: (p: UploadProgress) => void
): Promise<R2UploadResult> {
  const total = segments.length;
  let uploaded = 0;

  onProgress({ uploaded: 0, total, percent: 0, currentFile: "Getting upload URLs..." });

  // Get all presigned URLs in one server call
  const keysPayload = segments.map(s => ({
    key: `streams/${videoId}/${s.name}`,
    contentType: "video/mp2t",
  }));

  const presignRes = await fetch("/api/r2/presign-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId: bucketConfig.accountId,
      r2AccessKeyId: bucketConfig.r2AccessKeyId,
      r2SecretAccessKey: bucketConfig.r2SecretAccessKey,
      bucketName: bucketConfig.bucketName,
      keys: keysPayload,
    }),
  });

  if (!presignRes.ok) throw new Error("Failed to get presigned URLs");
  const { urls } = await presignRes.json();
  const urlMap = new Map(urls.map((u: any) => [u.key.split("/").pop(), u.uploadUrl]));

  // Upload in parallel batches of 5
  const BATCH = 5;
  for (let i = 0; i < segments.length; i += BATCH) {
    const batch = segments.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (seg) => {
        const uploadUrl = urlMap.get(seg.name);
        if (!uploadUrl) throw new Error(`No URL for ${seg.name}`);
        onProgress({
          uploaded,
          total,
          percent: Math.round((uploaded / total) * 100),
          currentFile: seg.name,
        });
        const resp = await fetch(uploadUrl as string, {
          method: "PUT",
          body: seg.data,
          headers: { "Content-Type": "video/mp2t" },
        });
        if (!resp.ok) throw new Error(`Upload failed for ${seg.name}: ${resp.status}`);
        uploaded++;
      })
    );
  }

  onProgress({ uploaded: total, total, percent: 100, currentFile: "All segments uploaded" });

  const estimatedBytes = segments.reduce((sum, s) => sum + s.data.length, 0);

  return {
    videoId,
    r2Path: `streams/${videoId}`,
    publicBaseUrl: bucketConfig.publicBaseUrl,
    bucketName: bucketConfig.bucketName,
    segmentCount: segments.length,
    segmentDuration: 6,
    prefix: "segment_",
    pad: 4,
    totalDuration: segments.length * 6,
    estimatedBytes,
  };
}
