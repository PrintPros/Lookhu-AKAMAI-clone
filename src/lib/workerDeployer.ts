/**
 * Cloudflare Worker template for HLS playout.
 */
const CHANNEL_WORKER_TEMPLATE = `
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const channelSlug = env.CHANNEL_SLUG;
    const manifestUrl = \`\${env.MANIFEST_BUCKET_URL}/channels/\${channelSlug}/manifest.json\`;
    const epoch = parseInt(env.EPOCH || "0");

    // 1. Fetch the manifest
    const manifestResponse = await fetch(manifestUrl, { cf: { cacheTtl: 60 } });
    if (!manifestResponse.ok) {
      return new Response("Manifest not found", { status: 404 });
    }
    const manifest = await manifestResponse.json();

    // 2. Handle health check
    if (url.pathname === "/health") {
      const now = Math.floor(Date.now() / 1000);
      const elapsed = now - epoch;
      const totalDuration = manifest.programs.reduce((acc, p) => acc + (p.durationSeconds || (p.segments * manifest.segmentDuration)), 0);
      const loopPosition = elapsed % totalDuration;
      return new Response(JSON.stringify({
        status: "ok",
        channel: manifest.channel,
        now,
        epoch,
        elapsed,
        totalDuration,
        loopPosition
      }), { headers: { "Content-Type": "application/json" } });
    }

    // 3. Handle M3U8 playlist request
    if (url.pathname.endsWith(".m3u8")) {
      const now = Math.floor(Date.now() / 1000);
      const elapsed = now - epoch;
      
      const segmentDuration = manifest.segmentDuration || 6;
      const windowSize = manifest.window || 10;
      
      // Calculate total duration
      let totalDuration = 0;
      const programs = manifest.programs.map(p => {
        const duration = p.durationSeconds || (p.segments * segmentDuration);
        const startOffset = totalDuration;
        totalDuration += duration;
        return { ...p, startOffset, duration };
      });

      const loopPosition = elapsed % totalDuration;
      const currentGlobalSegment = Math.floor(elapsed / segmentDuration);
      
      let playlist = "#EXTM3U\\n";
      playlist += "#EXT-X-VERSION:3\\n";
      playlist += \`#EXT-X-TARGETDURATION:\${segmentDuration}\\n\`;
      playlist += \`#EXT-X-MEDIA-SEQUENCE:\${currentGlobalSegment}\\n\\n\`;

      for (let i = 0; i < windowSize; i++) {
        const segmentIndex = currentGlobalSegment + i;
        const segmentTime = segmentIndex * segmentDuration;
        const segmentLoopTime = segmentTime % totalDuration;
        
        // Find which program this segment belongs to
        let activeProgram = programs[0];
        for (const p of programs) {
          if (segmentLoopTime >= p.startOffset && segmentLoopTime < p.startOffset + p.duration) {
            activeProgram = p;
            break;
          }
        }

        const programSegmentIndex = Math.floor((segmentLoopTime - activeProgram.startOffset) / segmentDuration);
        
        // Add discontinuity if this is the first segment of a program AND NOT the first segment of the playlist
        if (programSegmentIndex === 0 && i > 0) {
          playlist += "#EXT-X-DISCONTINUITY\\n";
        }

        const segmentFilename = \`\${activeProgram.prefix}\${String(programSegmentIndex).padStart(activeProgram.pad, "0")}.ts\`;
        playlist += \`#EXTINF:\${segmentDuration},\\n\`;
        playlist += \`\${url.origin}/segments/\${activeProgram.id}/\${segmentFilename}\\n\`;
      }

      return new Response(playlist, {
        headers: {
          "Content-Type": "application/x-mpegURL",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=2"
        }
      });
    }

    // 4. Handle segment proxying
    if (url.pathname.startsWith("/segments/")) {
      const parts = url.pathname.split("/");
      const programId = parts[2];
      const filename = parts[3];

      const program = manifest.programs.find(p => p.id === programId);
      if (!program) return new Response("Program not found", { status: 404 });

      const segmentUrl = \`\${program.publicBaseUrl}/\${program.path}/\${filename}\`;
      const segmentResponse = await fetch(segmentUrl, { cf: { cacheTtl: 3600 } });
      
      const headers = new Headers(segmentResponse.headers);
      headers.set("Access-Control-Allow-Origin", "*");
      
      return new Response(segmentResponse.body, {
        status: segmentResponse.status,
        headers
      });
    }

    return new Response("Not Found", { status: 404 });
  }
};
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
  const scriptName = `rag-${channelSlug}`;

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

    // 4. Get account subdomain to construct URL
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
  const scriptName = `rag-${channelSlug}`;
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
  const scriptName = `rag-${channelSlug}`;
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
  const scriptName = "rag-scheduler";

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
