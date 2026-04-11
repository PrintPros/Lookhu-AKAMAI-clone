import type { Channel, Playlist, Media, CloudflareConfig, ChannelManifest, AdConfig, ManifestProgram } from "../types.ts";

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
  cloudflareConfigs: CloudflareConfig[],
  adConfig: AdConfig
): ChannelManifest {
  // Backward compatibility: if items is missing but mediaIds exists
  if (!playlist.items && playlist.mediaIds) {
    playlist.items = playlist.mediaIds.map(id => {
      if (id === "__AD_BREAK__") {
        return { id: Math.random().toString(36).substring(7), isAdBreak: true };
      }
      return { id: Math.random().toString(36).substring(7), mediaId: id, isAdBreak: false };
    });
  }

  const channelSlug = channel.channelSlug || slugify(channel.name);

  // Filter for ready media and order by playlist.items
  const readyMedia = mediaItems.filter((m) => m.status === "ready");
  
  let totalDurationSeconds = 0;
  const programs: ManifestProgram[] = [];

  for (let i = 0; i < playlist.items.length; i++) {
    const item = playlist.items[i];
    if (item.isAdBreak) continue;

    const m = readyMedia.find((m) => m.id === item.mediaId);
    if (!m) continue;

    const config = cloudflareConfigs.find((c) => c.bucketName === m.bucketName) || 
                   cloudflareConfigs.find((c) => c.isActive);
    
    const duration = m.duration || 0;
    totalDurationSeconds += duration;

    // Check if the next item is an ad break
    const nextItem = playlist.items[i + 1];
    const adBreakAfter = !!nextItem?.isAdBreak;

    programs.push({
      id: (m.artistName && m.songTitle)
        ? slugify(`${m.artistName}-${m.songTitle}`)
        : (m.r2Path?.split("/").pop() || m.id),
      bucket: m.bucketName || config?.bucketName || "",
      publicBaseUrl: config?.publicBaseUrl || "",
      path: m.r2Path || `streams/${m.name}`,
      segments: m.segmentCount || 0,
      prefix: m.segmentPrefix || "segment_",
      pad: m.segmentPad || 4,
      adBreakAfter
    });
  }

  return {
    channel: channelSlug,
    // @ts-ignore
    channelId: channel.id,
    segmentDuration: channel.segmentDuration || 6,
    window: channel.window || 10,
    updatedAt: new Date().toISOString(),
    // @ts-ignore
    totalDurationSeconds,
    programs,
    adConfig: {
      enabled: adConfig.enabled,
      adPodSize: adConfig.adPodSize,
      breakDurationSeconds: adConfig.breakDurationSeconds
    }
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
