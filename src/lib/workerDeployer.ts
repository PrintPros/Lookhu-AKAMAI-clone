/**
 * Cloudflare Worker template for HLS playout.
 */
const CHANNEL_WORKER_TEMPLATE = `
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (pathname === "/health" || pathname === "/") {
      return handleHealth(env, ctx, corsHeaders);
    }
    if (pathname === "/live.m3u8" || pathname === "/index.m3u8" || pathname.endsWith(".m3u8")) {
      return handlePlaylist(request, env, ctx, corsHeaders);
    }
    if (pathname === "/now.json") {
      return handleNow(env, ctx, corsHeaders);
    }
    if (pathname === "/epg.xml") {
      return handleEPG(env, ctx, corsHeaders);
    }
    if (pathname.startsWith("/segments/")) {
      return handleSegment(request, env, ctx, corsHeaders);
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }
};

async function getManifest(env, ctx) {
  const cache = caches.default;
  const manifestUrl = \`\${env.MANIFEST_BUCKET_URL}/channels/\${env.CHANNEL_SLUG}/manifest.json\`;
  let response = await cache.match(manifestUrl);
  if (!response) {
    response = await fetch(manifestUrl);
    if (!response.ok) throw new Error(\`Manifest fetch failed: \${response.status}\`);
    const cloned = new Response(response.body, response);
    cloned.headers.set("Cache-Control", "public, max-age=30");
    ctx.waitUntil(cache.put(manifestUrl, cloned.clone()));
    return cloned.json();
  }
  return response.json();
}

function getCurrentPosition(manifest, env) {
  const epoch = parseInt(env.EPOCH || "0");
  const now = Math.floor(Date.now() / 1000);
  const elapsed = now - epoch;
  const segDur = manifest.segmentDuration || 6;

  const allSegments = [];
  for (const program of manifest.programs) {
    for (let i = 0; i < program.segments; i++) {
      allSegments.push({ program, segIndex: i });
    }
  }

  const totalSegments = allSegments.length;
  const loopDuration = totalSegments * segDur;
  const loopPosition = elapsed % loopDuration;
  const currentFlatIndex = Math.floor(loopPosition / segDur);
  const globalSeq = Math.floor(elapsed / segDur);

  return { allSegments, totalSegments, currentFlatIndex, globalSeq, now, epoch, elapsed, segDur, loopDuration };
}

async function handlePlaylist(request, env, ctx, corsHeaders) {
  const DVR_SEGMENTS = 30; // 3 minute DVR window — minimum for FAST distributors

  try {
    const manifest = await getManifest(env, ctx);
    const { allSegments, totalSegments, currentFlatIndex, globalSeq, now, segDur } = getCurrentPosition(manifest, env);

    if (totalSegments === 0) {
      return new Response("#EXTM3U\\n# No content", {
        headers: { ...corsHeaders, "Content-Type": "application/x-mpegURL" }
      });
    }

    // Sequence numbers derived purely from globalSeq — monotonically increasing, never wraps
    const startGlobalSeq = globalSeq - DVR_SEGMENTS;
    const startSeq = Math.max(0, startGlobalSeq);

    let playlist = "#EXTM3U\\n";
    playlist += "#EXT-X-VERSION:3\\n";
    playlist += \`#EXT-X-TARGETDURATION:\${segDur}\\n\`;
    playlist += \`#EXT-X-MEDIA-SEQUENCE:\${startSeq}\\n\`;

 // Count discontinuities per full loop including wrap boundary
    let discsPerLoop = 0;
    for (let i = 1; i < totalSegments; i++) {
      if (allSegments[i].program.id !== allSegments[i - 1].program.id) discsPerLoop++;
    }
    if (allSegments[totalSegments - 1].program.id !== allSegments[0].program.id) discsPerLoop++;

    const safeStart = Math.max(0, startGlobalSeq);
    const fullLoops = Math.floor(safeStart / totalSegments);
    const remainder = safeStart % totalSegments;
    let partialDiscs = 0;
    if (remainder > 0 && allSegments[0].program.id !== allSegments[totalSegments - 1].program.id) {
      partialDiscs++;
    }
    for (let i = 1; i < remainder; i++) {
      if (allSegments[i].program.id !== allSegments[i - 1].program.id) partialDiscs++;
    }
    const discontinuityCount = (fullLoops * discsPerLoop) + partialDiscs;
    playlist += \`#EXT-X-DISCONTINUITY-SEQUENCE:\${discontinuityCount}\\n\`;

    let lastProgram = null;
    let segmentTime = now - (DVR_SEGMENTS * segDur);

    for (let i = 0; i < DVR_SEGMENTS; i++) {
      const seq = startGlobalSeq + i;
      const flatIndex = ((seq % totalSegments) + totalSegments) % totalSegments;
      const { program, segIndex } = allSegments[flatIndex];

      // Add discontinuity and date-time at program boundaries
      if (lastProgram !== null && program.id !== lastProgram.id) {
        playlist += "#EXT-X-DISCONTINUITY\\n";
      }

      // EXT-X-PROGRAM-DATE-TIME required by Tubi/Pluto/Samsung
      const dt = new Date(segmentTime * 1000).toISOString();
      playlist += \`#EXT-X-PROGRAM-DATE-TIME:\${dt}\\n\`;

      const pad = program.pad || 4;
      const prefix = program.prefix || "segment_";
      const segNum = segIndex.toString().padStart(pad, "0");

      playlist += \`#EXTINF:\${segDur}.000,\\n\`;
      playlist += \`/segments/\${program.id}/\${prefix}\${segNum}.ts\\n\`;

      lastProgram = program;
      segmentTime += segDur;
    }

    return new Response(playlist, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/x-mpegURL",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "X-Channel": env.CHANNEL_SLUG,
      }
    });

  } catch (err) {
    return new Response(\`#EXTM3U\\n# Error: \${err.message}\`, {
      headers: { ...corsHeaders, "Content-Type": "application/x-mpegURL" }
    });
  }
}

async function handleNow(env, ctx, corsHeaders) {
  try {
    const manifest = await getManifest(env, ctx);
    const { allSegments, currentFlatIndex, segDur, now } = getCurrentPosition(manifest, env);
    const { program, segIndex } = allSegments[currentFlatIndex];
    return new Response(JSON.stringify({
      now,
      artistName: program.artistName,
      songTitle: program.songTitle,
      segmentIndex: segIndex,
      program: program.id,
    }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}

async function handleEPG(env, ctx, corsHeaders) {
  try {
    const manifest = await getManifest(env, ctx);
    const { allSegments, totalSegments, epoch, segDur } = getCurrentPosition(manifest, env);

    if (totalSegments === 0) {
      return new Response('<?xml version="1.0"?><tv></tv>', {
        headers: { ...corsHeaders, "Content-Type": "application/xml" }
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - 3600;
    const windowEnd = now + 86400;

    const channelId = \`fastfasts-\${env.CHANNEL_SLUG}\`;
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\\n';
    xml += '<tv generator-info-name="FastFasts">\\n';
    xml += \`  <channel id="\${channelId}">\\n\`;
    xml += \`    <display-name>\${env.CHANNEL_SLUG}</display-name>\\n\`;
    xml += \`  </channel>\\n\`;

    let t = windowStart;
    while (t < windowEnd) {
      const elapsed = t - epoch;
      const loopDuration = totalSegments * segDur;
      const loopPos = ((elapsed % loopDuration) + loopDuration) % loopDuration;
      const flatIndex = Math.floor(loopPos / segDur);
      const { program } = allSegments[flatIndex];
      const programDuration = program.segments * segDur;

      const startStr = new Date(t * 1000).toISOString().replace(/[-:]/g, "").replace("T", "").split(".")[0] + " +0000";
      const endStr = new Date((t + programDuration) * 1000).toISOString().replace(/[-:]/g, "").replace("T", "").split(".")[0] + " +0000";

      xml += \`  <programme start="\${startStr}" stop="\${endStr}" channel="\${channelId}">\\n\`;
      xml += \`    <title>\${(program.songTitle || program.id).replace(/&/g, "&amp;")}</title>\\n\`;
      xml += \`    <desc>\${(program.artistName || "Unknown Artist").replace(/&/g, "&amp;")}</desc>\\n\`;
      xml += \`    <category>Music</category>\\n\`;
      if (program.thumbnailUrl) {
        xml += \`    <icon src="\${program.thumbnailUrl}" />\\n\`;
      }
      xml += \`  </programme>\\n\`;

      t += programDuration;
    }

    xml += "</tv>";
    return new Response(xml, {
      headers: { ...corsHeaders, "Content-Type": "application/xml", "Cache-Control": "public, max-age=60" }
    });
  } catch (err) {
    return new Response(\`<?xml version="1.0"?><tv><!-- Error: \${err.message} --></tv>\`, {
      headers: { ...corsHeaders, "Content-Type": "application/xml" }
    });
  }
}

async function handleSegment(request, env, ctx, corsHeaders) {
  try {
    const manifest = await getManifest(env, ctx);
    const parts = request.url.split("/segments/")[1].split("/");
    if (parts.length < 2) {
      return new Response("Invalid segment path", { status: 400, headers: corsHeaders });
    }
    const programId = parts[0];
    const fileName = parts[1];
    const program = manifest.programs.find(p => p.id === programId);
    if (!program) {
      return new Response("Program not found", { status: 404, headers: corsHeaders });
    }
    const segmentUrl = \`\${program.publicBaseUrl}/\${program.path}/\${fileName}\`;
    const cache = caches.default;
    let response = await cache.match(segmentUrl);
    if (!response) {
      response = await fetch(segmentUrl);
      if (!response.ok) {
        return new Response("Segment not found", { status: 404, headers: corsHeaders });
      }
      const cached = new Response(response.body, response);
      cached.headers.set("Cache-Control", "public, max-age=31536000, immutable");
      cached.headers.set("Access-Control-Allow-Origin", "*");
      ctx.waitUntil(cache.put(segmentUrl, cached.clone()));
      return cached;
    }
    return response;
  } catch (err) {
    return new Response(\`Segment error: \${err.message}\`, { status: 500, headers: corsHeaders });
  }
}

async function handleHealth(env, ctx, corsHeaders) {
  try {
    const manifest = await getManifest(env, ctx);
    const pos = getCurrentPosition(manifest, env);
    return new Response(JSON.stringify({
      status: "ok",
      channel: env.CHANNEL_SLUG,
      programs: manifest.programs.length,
      totalSegments: pos.totalSegments,
      loopDuration: pos.loopDuration,
      currentSegment: pos.currentFlatIndex,
    }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ status: "error", error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}
`;

/**
 * Deploys a channel Worker to Cloudflare.
 */
export async function deployChannelWorker(params: {
  accountId: string;
  cfApiToken: string;
  channelSlug: string;
  manifestBucketUrl: string;
  epoch: number;
}) {
  const { accountId, cfApiToken, channelSlug, manifestBucketUrl, epoch } = params;
  const scriptName = `fastfasts-${channelSlug}`;

  try {
    // 1. Prepare metadata with bindings
    const metadata = {
      main_module: "index.js",
      bindings: [
        { type: "plain_text", name: "MANIFEST_BUCKET_URL", text: manifestBucketUrl },
        { type: "plain_text", name: "CHANNEL_SLUG", text: channelSlug },
        { type: "plain_text", name: "EPOCH", text: epoch.toString() }
      ]
    };

    // 2. Prepare multipart form data
    const formData = new FormData();
    formData.append("metadata", JSON.stringify(metadata));
    formData.append("script", new Blob([CHANNEL_WORKER_TEMPLATE], { type: "application/javascript+module" }), "index.js");

    // 3. Upload script
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}`,
      {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${cfApiToken}`
        },
        body: formData
      }
    );

    const result = await response.json();
    if (!result.success) {
      return { success: false, error: result.errors?.[0]?.message || "Failed to upload script" };
    }

    // 4. Enable workers.dev subdomain route
    await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}/subdomain`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${cfApiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ enabled: true }),
      }
    );

    // 5. Get account subdomain to construct URL
    const subdomainResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
      {
        headers: { "Authorization": `Bearer ${cfApiToken}` }
      }
    );
    const subdomainResult = await subdomainResponse.json();
    const subdomain = subdomainResult.result?.subdomain;

    if (!subdomain) {
      return { success: false, error: "Cloudflare Workers subdomain not set for this account." };
    }

    return {
      success: true,
      workerUrl: `https://${scriptName}.${subdomain}.workers.dev`
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Deletes a channel Worker from Cloudflare.
 */
export async function deleteChannelWorker(accountId: string, cfApiToken: string, channelSlug: string) {
  const scriptName = `fastfasts-${channelSlug}`;
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}`,
      {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${cfApiToken}` }
      }
    );
    const result = await response.json();
    return { success: result.success, error: result.errors?.[0]?.message };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Checks the status of a Cloudflare Worker.
 */
export async function getWorkerStatus(accountId: string, cfApiToken: string, channelSlug: string) {
  const scriptName = `fastfasts-${channelSlug}`;
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}`,
      {
        headers: { "Authorization": `Bearer ${cfApiToken}` }
      }
    );
    const result = await response.json();
    if (result.success) {
      return {
        exists: true,
        createdAt: result.result?.created_on,
        modifiedAt: result.result?.modified_on
      };
    }
    return { exists: false };
  } catch (error) {
    return { exists: false };
  }
}

/**
 * Deploys the scheduler cron Worker to Cloudflare.
 */
export async function deploySchedulerWorker(params: {
  accountId: string;
  cfApiToken: string;
  appUrl: string;
  schedulerSecret: string;
}) {
  const { accountId, cfApiToken, appUrl, schedulerSecret } = params;
  const scriptName = "fastfasts-scheduler";

  const schedulerScript = `
export default {
  async fetch(request, env) {
    return new Response("Scheduler is active.");
  },
  async scheduled(event, env, ctx) {
    console.log("Cron tick: Checking for scheduled publishes...");
    try {
      const response = await fetch(\`\${env.APP_URL}/api/scheduler/check\`, {
        method: "POST",
        headers: {
          "Authorization": \`Bearer \${env.SCHEDULER_SECRET}\`,
          "Content-Type": "application/json"
        }
      });
      const data = await response.json();
      console.log("Scheduler check result:", JSON.stringify(data));
    } catch (error) {
      console.error("Scheduler check failed:", error.message);
    }
  }
};
`;

  try {
    // 1. Upload script
    const metadata = {
      main_module: "index.js",
      bindings: [
        { type: "plain_text", name: "APP_URL", text: appUrl },
        { type: "plain_text", name: "SCHEDULER_SECRET", text: schedulerSecret }
      ]
    };

    const formData = new FormData();
    formData.append("metadata", JSON.stringify(metadata));
    formData.append("script", new Blob([schedulerScript], { type: "application/javascript+module" }), "index.js");

    const uploadResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}`,
      {
        method: "PUT",
        headers: { "Authorization": `Bearer ${cfApiToken}` },
        body: formData
      }
    );

    const uploadResult = await uploadResponse.json();
    if (!uploadResult.success) {
      return { success: false, error: uploadResult.errors?.[0]?.message };
    }

    // 2. Set cron trigger
    const triggerResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}/schedules`,
      {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${cfApiToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify([{ cron: "* * * * *" }])
      }
    );

    const triggerResult = await triggerResponse.json();
    return { success: triggerResult.success, error: triggerResult.errors?.[0]?.message };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
