// ── existing types (keep as-is) ──────────────────────────────────────────────

export interface Media {
  id: string;
  name: string;
  m3u8Url: string;
  status: "uploading" | "transcoding" | "ready" | "error";
  duration?: number;          // seconds
  createdAt: string;
  userId: string;
  public?: boolean;
  // FastFasts music video fields (all optional so existing code still compiles)
  artistName?: string;
  songTitle?: string;
  genre?: string;             // "hiphop" | "rock" | "edm" | "rnb" | "latin" | "other"
  instagramUrl?: string;
  twitterUrl?: string;
  youtubeUrl?: string;
  websiteUrl?: string;
  thumbnailUrl?: string;
  submissionStatus?: "pending" | "approved" | "rejected";
  submittedBy?: string;       // artist email
  adBreakAfter?: boolean;     // insert ad break after this video plays
  // R2 storage location
  bucketName?: string;         // which R2 bucket this lives in
  r2Path?: string;             // e.g. "streams/abc123"
  segmentCount?: number;       // total .ts segments
  segmentPrefix?: string;      // "segment_"
  segmentPad?: number;         // 4
  segmentDuration?: number;    // seconds per segment (6)
}

export interface Channel {
  id: string;
  name: string;
  channelSlug: string;
  description?: string;
  playlistId?: string;
  status: "online" | "offline";
  createdAt: string;
  userId: string;
  genre?: string;
  workerManifestUrl?: string; // the Cloudflare Worker .m3u8 URL for this channel
  r2BucketName?: string;      // which R2 bucket this channel's segments live in
  segmentDuration?: number;   // default 6
  window?: number;            // default 90
  embedSettings?: {
    width: string;
    height: string;
    autoPlay: boolean;
    muted: boolean;
    controls: boolean;
    skin?: "default" | "v1";
  };
  lastPublishedAt?: string;
  workerDeployed?: boolean;
  workerNeedsRedeploy?: boolean;
  epoch?: number; // Unix timestamp (seconds) when the loop started
}

export interface PlaylistItem {
  id: string; // unique ID
  mediaId?: string;
  isAdBreak?: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  items: PlaylistItem[];
  mediaIds?: string[]; // deprecated
  createdAt: string;
  userId: string;
  genre?: string;
  totalDuration?: number;     // sum of all clip durations in seconds
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
}

// ── new types ─────────────────────────────────────────────────────────────────

export interface ArtistSubmission {
  id: string;
  artistName: string;
  songTitle: string;
  genre: string;
  email: string;
  instagramUrl?: string;
  twitterUrl?: string;
  youtubeUrl?: string;
  websiteUrl?: string;
  videoFileUrl: string;       // temporary upload URL or R2 path
  mp4Key?: string;            // R2 key for the uploaded MP4
  configId?: string;          // Cloudflare config used for upload
  m3u8Url?: string;           // populated after transcoding
  thumbnailUrl?: string;
  status: "pending" | "approved" | "rejected";
  submittedAt: string;
  reviewedAt?: string;
  reviewNotes?: string;
  duration?: number;
}

export interface EPGEntry {
  mediaId: string;
  startTime: number;          // Unix timestamp (seconds) when this video starts in loop
  endTime: number;
  artistName: string;
  songTitle: string;
  genre: string;
  instagramUrl?: string;
  twitterUrl?: string;
  youtubeUrl?: string;
  thumbnailUrl?: string;
  isAdBreak?: boolean;
}

export interface CloudflareConfig {
  id: string;
  label: string;
  accountId: string;
  // Token 1: Cloudflare API Token (manages account — create buckets, deploy workers)
  cfApiToken: string;
  // Token 2: R2 S3-compatible credentials (read/write files in buckets)
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  bucketName: string;
  publicBaseUrl: string;   // https://pub-xxx.r2.dev or custom domain
  usedBytes: number;
  maxBytes: number;        // 10737418240 = 10GB
  isActive: boolean;       // true = new uploads go here
  isFull?: boolean;         // true = bucket is at capacity
  userId: string;
}

export interface AdConfig {
  id: string;
  preRollUrl: string;
  midRollUrl: string;
  adPodSize: number;
  breakDurationSeconds: number;
  enabled: boolean;
  label?: string;
}

export interface ManifestProgram {
  id: string;
  bucket: string;
  publicBaseUrl: string;
  path: string;
  segments: number;
  prefix: string;
  pad: number;
  adBreakAfter?: boolean;
}

export interface ChannelManifest {
  channel: string;
  segmentDuration: number;
  window: number;
  updatedAt: string;
  programs: ManifestProgram[];
  adConfig: {
    enabled: boolean;
    adPodSize: number;
    breakDurationSeconds: number;
  };
}

export interface ScheduledPublish {
  id: string;
  channelId: string;
  channelSlug: string;
  playlistId: string;
  playlistName: string;
  scheduledAt: string;
  status: "pending" | "published" | "failed" | "cancelled";
  createdAt: string;
  createdBy: string;
  publishedAt?: string;
  error?: string;
  workerUrl?: string;
}
