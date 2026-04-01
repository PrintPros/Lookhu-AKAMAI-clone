import type { Channel, Playlist, Media, CloudflareConfig, ChannelManifest } from "../types.ts";

/**
 * Slugifies a string: lowercase, replaces spaces and special chars with hyphens, trims.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Builds the manifest.json object for a channel's HLS playout.
 */
export function buildManifest(
  channel: Channel,
  playlist: Playlist,
  mediaItems: Media[],
  cloudflareConfigs: CloudflareConfig[]
): ChannelManifest {
  const channelSlug = channel.channelSlug || slugify(channel.name);

  // Filter for ready media and order by playlist.mediaIds
  const readyMedia = mediaItems.filter((m) => m.status === "ready");
  const orderedMedia = playlist.mediaIds
    .map((id) => readyMedia.find((m) => m.id === id))
    .filter((m): m is Media => !!m);

  let totalDurationSeconds = 0;

  const programs = orderedMedia.map((m) => {
    const config = cloudflareConfigs.find((c) => c.bucketName === m.bucketName) || 
                   cloudflareConfigs.find((c) => c.isActive);
    
    const duration = m.duration || 0;
    totalDurationSeconds += duration;

    return {
      id: (m.artistName && m.songTitle)
        ? slugify(`${m.artistName}-${m.songTitle}`)
        : (m.r2Path?.split("/").pop() || m.id),
      artistName: m.artistName || "Unknown Artist",
      songTitle: m.songTitle || m.name,
      bucket: m.bucketName || config?.bucketName || "",
      publicBaseUrl: config?.publicBaseUrl || "",
      path: m.r2Path || `streams/${m.name}`,
      segments: m.segmentCount || 0,
      prefix: m.segmentPrefix || "segment_",
      pad: m.segmentPad || 4,
      durationSeconds: duration
    };
  });

  return {
    channel: channelSlug,
    // @ts-ignore - Adding channelId as requested by prompt even if not in types.ts interface yet
    channelId: channel.id,
    segmentDuration: channel.segmentDuration || 6,
    window: channel.window || 10,
    updatedAt: new Date().toISOString(),
    // @ts-ignore - Adding totalDurationSeconds as requested by prompt
    totalDurationSeconds,
    programs
  };
}

/**
 * Validates a manifest object.
 */
export function validateManifest(manifest: ChannelManifest): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!manifest.programs || manifest.programs.length === 0) {
    errors.push("Manifest must have at least 1 program.");
  }

  manifest.programs.forEach((p, i) => {
    if (p.segments <= 0) {
      errors.push(`Program ${i + 1} (${p.id}) has 0 or negative segments.`);
    }
    if (!p.publicBaseUrl) {
      errors.push(`Program ${i + 1} (${p.id}) is missing a publicBaseUrl.`);
    }
  });

  // @ts-ignore
  if ((manifest.totalDurationSeconds || 0) <= 0) {
    errors.push("Total duration must be greater than 0.");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
