var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/lib/workerDeployer.ts
var workerDeployer_exports = {};
__export(workerDeployer_exports, {
  deleteChannelWorker: () => deleteChannelWorker,
  deployChannelWorker: () => deployChannelWorker,
  deploySchedulerWorker: () => deploySchedulerWorker,
  getWorkerStatus: () => getWorkerStatus
});
async function deployChannelWorker(params) {
  const { accountId, cfApiToken, channelSlug, manifestBucketUrl, epoch } = params;
  const scriptName = `fastfasts-${channelSlug}`;
  try {
    const metadata = {
      main_module: "index.js",
      bindings: [
        { type: "plain_text", name: "MANIFEST_BUCKET_URL", text: manifestBucketUrl },
        { type: "plain_text", name: "CHANNEL_SLUG", text: channelSlug },
        { type: "plain_text", name: "EPOCH", text: epoch.toString() }
      ]
    };
    const formData = new FormData();
    formData.append("metadata", JSON.stringify(metadata));
    formData.append("script", new Blob([CHANNEL_WORKER_TEMPLATE], { type: "application/javascript+module" }), "index.js");
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
      console.error("Cloudflare API error:", JSON.stringify(result));
      return { success: false, error: result.errors?.[0]?.message || "Failed to upload script" };
    }
    await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}/subdomain`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${cfApiToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ enabled: true })
      }
    );
    let workerUrl = "";
    if (params.workerBaseDomain) {
      const baseDomain = params.workerBaseDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
      const hostname = `${channelSlug}.${baseDomain}`;
      workerUrl = `https://${hostname}`;
      let zoneId = "";
      try {
        const zoneRes = await fetch(
          `https://api.cloudflare.com/client/v4/zones?name=${baseDomain}`,
          { headers: { "Authorization": `Bearer ${cfApiToken}` } }
        );
        const zoneData = await zoneRes.json();
        if (zoneData.success && zoneData.result && zoneData.result.length > 0) {
          zoneId = zoneData.result[0].id;
        }
      } catch (e) {
        console.warn("Could not auto-discover Zone ID for custom domain:", e);
      }
      if (zoneId) {
        await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/domains`,
          {
            method: "PUT",
            headers: {
              "Authorization": `Bearer ${cfApiToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              environment: "production",
              hostname,
              service: scriptName,
              zone_id: zoneId
            })
          }
        );
      } else {
        console.warn(`Could not set up custom domain automatically. Zone ID for ${baseDomain} not found or token lacks permissions.`);
      }
    } else {
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
      workerUrl = `https://${scriptName}.${subdomain}.workers.dev`;
    }
    return {
      success: true,
      workerUrl
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
async function deleteChannelWorker(accountId, cfApiToken, channelSlug) {
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
  } catch (error) {
    return { success: false, error: error.message };
  }
}
async function getWorkerStatus(accountId, cfApiToken, channelSlug) {
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
async function deploySchedulerWorker(params) {
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
  } catch (error) {
    return { success: false, error: error.message };
  }
}
var CHANNEL_WORKER_TEMPLATE;
var init_workerDeployer = __esm({
  "src/lib/workerDeployer.ts"() {
    CHANNEL_WORKER_TEMPLATE = `
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
  const DVR_SEGMENTS = 30; // 3 minute DVR window \u2014 minimum for FAST distributors

  try {
    const manifest = await getManifest(env, ctx);
    const { allSegments, totalSegments, currentFlatIndex, globalSeq, now, segDur } = getCurrentPosition(manifest, env);

    if (totalSegments === 0) {
      return new Response("#EXTM3U\\n# No content", {
        headers: { ...corsHeaders, "Content-Type": "application/x-mpegURL" }
      });
    }

    // Sequence numbers derived purely from globalSeq \u2014 monotonically increasing, never wraps
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

    for (let i = 0; i < DVR_SEGMENTS; i++) {
      const seq = startGlobalSeq + i;
      const flatIndex = ((seq % totalSegments) + totalSegments) % totalSegments;
      const { program, segIndex } = allSegments[flatIndex];

      // Detect program boundary
      const isProgramBoundary = lastProgram !== null && program.id !== lastProgram.id;
      
      if (isProgramBoundary) {
        playlist += '#EXT-X-DISCONTINUITY\\n';
        
        // Did we just end an ad break and return to content?
        if (lastProgram.isAdBreak && !program.isAdBreak) {
          playlist += '#EXT-X-CUE-IN\\n';
        }
        
        // Are we starting an ad break now?
        if (!lastProgram.isAdBreak && program.isAdBreak && manifest.adConfig?.enabled) {
          const breakDuration = program.breakDurationSeconds || manifest.adConfig.breakDurationSeconds || 30;
          const breakId = \`ad-break-\${program.id}-\${seq}\`;
          playlist += \`#EXT-X-DATERANGE:ID="\${breakId}",START-DATE="\${new Date().toISOString()}",DURATION=\${breakDuration},SCTE35-OUT=0xFC00\\n\`;
          playlist += \`#EXT-X-CUE-OUT:\${breakDuration}\\n\`;
        }
      }

      const pad = program.pad || 4;
      const prefix = program.prefix || "segment_";
      const segNum = segIndex.toString().padStart(pad, "0");

      playlist += \`#EXTINF:\${segDur}.000,\\n\`;
      playlist += \`/segments/\${program.id}/\${prefix}\${segNum}.ts\\n\`;

      lastProgram = program;
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
    xml += '<tv generator-info-name="FasterFasts">\\n';
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
    const fileName = parts[1].split("?")[0]; // strip query params
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
  }
});

// server.ts
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import multer from "multer";
import ffmpegStatic from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  DeleteObjectCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getApps } from "firebase-admin/app";
import { FieldValue } from "firebase-admin/firestore";

// src/lib/manifestBuilder.ts
function slugify(name) {
  return name.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
function buildManifest(channel, playlist, mediaItems, cloudflareConfigs, adConfig) {
  if (!playlist.items && playlist.mediaIds) {
    playlist.items = playlist.mediaIds.map((id) => {
      if (id === "__AD_BREAK__") {
        return { id: Math.random().toString(36).substring(7), isAdBreak: true };
      }
      return { id: Math.random().toString(36).substring(7), mediaId: id, isAdBreak: false };
    });
  }
  const channelSlug = channel.channelSlug || slugify(channel.name);
  const readyMedia = mediaItems.filter((m) => m.status === "ready");
  let totalDurationSeconds = 0;
  const programs = [];
  for (let i = 0; i < playlist.items.length; i++) {
    const item = playlist.items[i];
    if (item.isAdBreak) {
      if (adConfig.enabled && adConfig.houseAds && adConfig.houseAds.length > 0) {
        const breakDurationSeconds = item.duration || adConfig.breakDurationSeconds || 30;
        const matchingAds = adConfig.houseAds.filter((a) => a.duration === breakDurationSeconds);
        const ad = matchingAds.length > 0 ? matchingAds[0] : adConfig.houseAds[0];
        if (ad.r2Path && ad.bucketName && ad.segmentCount) {
          totalDurationSeconds += ad.duration;
          const config2 = cloudflareConfigs.find((c) => c.bucketName === ad.bucketName) || cloudflareConfigs.find((c) => c.isActive);
          programs.push({
            id: `ad-${slugify(ad.name)}-${item.id}`,
            bucket: ad.bucketName,
            publicBaseUrl: config2?.publicBaseUrl || "",
            path: ad.r2Path,
            segments: ad.segmentCount,
            prefix: "segment_",
            pad: 4,
            isAdBreak: true,
            breakDurationSeconds
          });
        }
      }
      continue;
    }
    const m = readyMedia.find((m2) => m2.id === item.mediaId);
    if (!m) continue;
    const config = cloudflareConfigs.find((c) => c.bucketName === m.bucketName) || cloudflareConfigs.find((c) => c.isActive);
    const duration = m.duration || 0;
    totalDurationSeconds += duration;
    programs.push({
      id: m.artistName && m.songTitle ? slugify(`${m.artistName}-${m.songTitle}`) : m.r2Path?.split("/").pop() || m.id,
      bucket: m.bucketName || config?.bucketName || "",
      publicBaseUrl: config?.publicBaseUrl || "",
      path: m.r2Path || `streams/${m.name}`,
      // Should map to streams/[videoId]
      segments: m.segmentCount || 0,
      prefix: m.segmentPrefix || "segment_",
      pad: m.segmentPad || 4,
      isAdBreak: false
    });
  }
  return {
    channel: channelSlug,
    // @ts-ignore
    channelId: channel.id,
    segmentDuration: channel.segmentDuration || 6,
    window: channel.window || 10,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
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
function validateManifest(manifest) {
  const errors = [];
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
  if ((manifest.totalDurationSeconds || 0) <= 0) {
    errors.push("Total duration must be greater than 0.");
  }
  return {
    valid: errors.length === 0,
    errors
  };
}

// server.ts
init_workerDeployer();
ffmpeg.setFfmpegPath(ffmpegStatic);
var configPath = path.join(process.cwd(), "firebase-applet-config.json");
var firebaseConfig = {};
if (fs.existsSync(configPath)) {
  firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  console.log("Firebase config loaded:", firebaseConfig);
} else {
  console.error("Firebase config file not found at:", configPath);
}
var dbAdmin = null;
var authAdmin = null;
function createR2Client(accountId, accessKeyId, secretAccessKey) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true
  });
}
var PORT = Number(process.env.PORT) || 3e3;
async function initializeFirebaseAdmin() {
  try {
    const { initializeApp: initializeApp2, getApps: getApps2 } = await import("firebase-admin/app");
    const { getFirestore: getFirestore2 } = await import("firebase-admin/firestore");
    const { getAuth } = await import("firebase-admin/auth");
    const apps = getApps2();
    let adminApp;
    if (apps.length === 0) {
      if (!firebaseConfig.projectId) {
        console.error("Firebase Admin initialization failed: projectId is missing in firebase-applet-config.json");
      } else {
        adminApp = initializeApp2({ projectId: firebaseConfig.projectId });
        console.log("Firebase Admin initialized with project ID:", firebaseConfig.projectId);
      }
    } else {
      adminApp = apps[0];
      console.log("Firebase Admin using existing app");
    }
    if (adminApp) {
      dbAdmin = getFirestore2(adminApp, firebaseConfig.firestoreDatabaseId || "(default)");
      authAdmin = getAuth(adminApp);
      console.log("Firebase Admin ready. Using database:", firebaseConfig.firestoreDatabaseId || "(default)");
    }
  } catch (err) {
    console.error("Firebase Admin initialization error:", err);
  }
}
async function startServer() {
  const app = express();
  app.set("trust proxy", true);
  app.use((req, res, next) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    next();
  });
  process.env.GOOGLE_CLOUD_PROJECT = "ai-studio-applet-webapp-c9661";
  app.use(cors());
  app.use(express.json());
  const uploadsDir = path.join(process.cwd(), "uploads");
  const streamsDir = path.join(process.cwd(), "streams");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
  if (!fs.existsSync(streamsDir)) fs.mkdirSync(streamsDir);
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, "uploads/");
    },
    filename: (req, file, cb) => {
      const id = uuidv4();
      cb(null, `${id}-${file.originalname}`);
    }
  });
  const upload = multer({ storage });
  app.get("/api/health", (req, res) => {
    const transcodingWorking = !!ffmpeg.getAvailableFormats;
    res.json({
      status: "ok",
      firebase: {
        initialized: getApps().length > 0,
        projectId: firebaseConfig.projectId,
        dbAdmin: !!dbAdmin,
        authAdmin: !!authAdmin
      },
      transcoding: {
        working: transcodingWorking
      }
    });
  });
  const isMasterAdmin = async (uid) => {
    if (!dbAdmin) {
      console.error("isMasterAdmin: dbAdmin is null");
      return false;
    }
    try {
      const userDoc = await dbAdmin.collection("users").doc(uid).get();
      if (!userDoc.exists) {
        console.log(`isMasterAdmin: User ${uid} not found`);
        return false;
      }
      const userData = userDoc.data();
      const isMaster = userData.role === "master_admin" || userData.email === "lookhumaster@gmail.com" || userData.email === "rpduece@gmail.com";
      if (!isMaster) {
        console.log(`isMasterAdmin: User ${uid} is not master admin. Role: ${userData.role}, Email: ${userData.email}`);
      }
      return isMaster;
    } catch (err) {
      console.error("isMasterAdmin error:", err);
      return false;
    }
  };
  const isAccountAdmin = async (uid, accountId) => {
    if (!dbAdmin) return false;
    if (await isMasterAdmin(uid)) return true;
    const userDoc = await dbAdmin.collection("users").doc(uid).get();
    if (!userDoc.exists) return false;
    const userData = userDoc.data();
    return userData.role === "admin" && userData.accountId === accountId;
  };
  app.get("/api/admin/accounts", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    const idToken = authHeader.split("Bearer ")[1];
    try {
      if (!authAdmin) {
        console.error("authAdmin is null");
        return res.status(500).json({ error: "authAdmin is null" });
      }
      const decodedToken = await authAdmin.verifyIdToken(idToken);
      if (!await isMasterAdmin(decodedToken.uid)) return res.status(403).json({ error: "Forbidden" });
      if (!dbAdmin) {
        console.error("dbAdmin is null");
        return res.status(500).json({ error: "dbAdmin is null" });
      }
      const snapshot = await dbAdmin.collection("accounts").get();
      const accounts = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      res.json(accounts);
    } catch (err) {
      console.error("Error in /api/admin/accounts:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/admin/users", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    const idToken = authHeader.split("Bearer ")[1];
    try {
      if (!authAdmin) {
        console.error("authAdmin is null");
        return res.status(500).json({ error: "authAdmin is null" });
      }
      const decodedToken = await authAdmin.verifyIdToken(idToken);
      if (!await isMasterAdmin(decodedToken.uid)) return res.status(403).json({ error: "Forbidden" });
      if (!dbAdmin) {
        console.error("dbAdmin is null");
        return res.status(500).json({ error: "dbAdmin is null" });
      }
      const snapshot = await dbAdmin.collection("users").get();
      const users = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      res.json(users);
    } catch (err) {
      console.error("Error in /api/admin/users:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/admin/users/update-role", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    const idToken = authHeader.split("Bearer ")[1];
    const { userId, role } = req.body;
    try {
      const decodedToken = await authAdmin.verifyIdToken(idToken);
      if (!await isMasterAdmin(decodedToken.uid)) return res.status(403).json({ error: "Forbidden" });
      await dbAdmin.collection("users").doc(userId).update({ role });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/admin/accounts", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    const idToken = authHeader.split("Bearer ")[1];
    const { name, ownerId } = req.body;
    try {
      const decodedToken = await authAdmin.verifyIdToken(idToken);
      if (!await isMasterAdmin(decodedToken.uid)) return res.status(403).json({ error: "Forbidden" });
      const accountRef = await dbAdmin.collection("accounts").add({
        name,
        ownerId,
        members: [ownerId],
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      await dbAdmin.collection("users").doc(ownerId).update({ accountId: accountRef.id, role: "admin" });
      res.json({ id: accountRef.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/invites/send", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    const idToken = authHeader.split("Bearer ")[1];
    const { email, accountId, role } = req.body;
    try {
      const decodedToken = await authAdmin.verifyIdToken(idToken);
      if (!await isAccountAdmin(decodedToken.uid, accountId)) return res.status(403).json({ error: "Forbidden" });
      const inviteRef = await dbAdmin.collection("invitations").add({
        email,
        accountId,
        role: role || "user",
        status: "pending",
        invitedBy: decodedToken.uid,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      res.json({ id: inviteRef.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/invites/accept", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    const idToken = authHeader.split("Bearer ")[1];
    const { inviteId } = req.body;
    try {
      const decodedToken = await authAdmin.verifyIdToken(idToken);
      const inviteDoc = await dbAdmin.collection("invitations").doc(inviteId).get();
      if (!inviteDoc.exists) return res.status(404).json({ error: "Invitation not found" });
      const inviteData = inviteDoc.data();
      if (inviteData.email !== decodedToken.email) return res.status(403).json({ error: "Email mismatch" });
      if (inviteData.status !== "pending") return res.status(400).json({ error: "Invitation already processed" });
      await dbAdmin.collection("users").doc(decodedToken.uid).update({
        accountId: inviteData.accountId,
        role: inviteData.role,
        ownerUserId: inviteData.invitedBy
      });
      await dbAdmin.collection("accounts").doc(inviteData.accountId).update({
        members: FieldValue.arrayUnion(decodedToken.uid)
      });
      await inviteDoc.ref.update({ status: "accepted" });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/r2/test", async (req, res) => {
    const { accountId, r2AccessKeyId, r2SecretAccessKey, bucketName } = req.body;
    if (!accountId || !r2AccessKeyId || !r2SecretAccessKey || !bucketName) {
      return res.status(400).json({ error: "Missing credentials" });
    }
    try {
      const r2 = createR2Client(accountId, r2AccessKeyId, r2SecretAccessKey);
      const cmd = new ListObjectsV2Command({ Bucket: bucketName, MaxKeys: 1 });
      await r2.send(cmd);
      res.json({ success: true, message: "Connection verified successfully" });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
  app.post("/api/r2/delete-folder", async (req, res) => {
    const { accountId, r2AccessKeyId, r2SecretAccessKey, bucketName, prefix } = req.body;
    if (!accountId || !r2AccessKeyId || !r2SecretAccessKey || !bucketName || !prefix) {
      return res.status(400).json({ error: "Missing fields" });
    }
    try {
      const r2 = createR2Client(accountId, r2AccessKeyId, r2SecretAccessKey);
      let continuationToken;
      let deleted = 0;
      do {
        const list = await r2.send(new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken
        }));
        const keys = (list.Contents || []).map((o) => o.Key).filter(Boolean);
        for (const key of keys) {
          await r2.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
          deleted++;
        }
        continuationToken = list.IsTruncated ? list.NextContinuationToken : void 0;
      } while (continuationToken);
      res.json({ success: true, deleted });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  app.post("/api/r2/delete-file", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const idToken = authHeader.split("Bearer ")[1];
    if (!idToken || idToken.length < 20) {
      return res.status(401).json({ error: "Invalid token" });
    }
    const { accountId, r2AccessKeyId, r2SecretAccessKey, bucketName, key } = req.body;
    if (!accountId || !r2AccessKeyId || !r2SecretAccessKey || !bucketName || !key) {
      return res.status(400).json({ error: "Missing fields" });
    }
    try {
      const r2 = createR2Client(accountId, r2AccessKeyId, r2SecretAccessKey);
      await r2.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  app.post("/api/r2/presign-secure", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const idToken = authHeader.split("Bearer ")[1];
    if (!idToken || idToken.length < 20) {
      return res.status(401).json({ error: "Invalid token" });
    }
    const { configId, keys, accountId, r2AccessKeyId, r2SecretAccessKey, bucketName } = req.body;
    if (!Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ error: "Missing keys" });
    }
    if (!accountId || !r2AccessKeyId || !r2SecretAccessKey || !bucketName) {
      return res.status(400).json({ error: "Missing R2 credentials" });
    }
    try {
      const r2 = createR2Client(accountId, r2AccessKeyId, r2SecretAccessKey);
      const urls = await Promise.all(
        keys.map(async ({ key, contentType }) => {
          const cmd = new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            ContentType: contentType
          });
          const uploadUrl = await getSignedUrl(r2, cmd, { expiresIn: 7200 });
          return { key, uploadUrl };
        })
      );
      res.json({ urls });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/r2/presign-batch", async (req, res) => {
    const {
      accountId,
      r2AccessKeyId,
      r2SecretAccessKey,
      bucketName,
      keys
    } = req.body;
    if (!accountId || !r2AccessKeyId || !r2SecretAccessKey || !bucketName || !Array.isArray(keys)) {
      return res.status(400).json({ error: "Missing fields" });
    }
    try {
      const r2 = createR2Client(accountId, r2AccessKeyId, r2SecretAccessKey);
      const urls = await Promise.all(
        keys.map(async ({ key, contentType }) => {
          const cmd = new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            ContentType: contentType || "video/mp2t"
          });
          const uploadUrl = await getSignedUrl(r2, cmd, { expiresIn: 7200 });
          return { key, uploadUrl };
        })
      );
      res.json({ urls });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/r2/metadata", async (req, res) => {
    const { accountId, r2AccessKeyId, r2SecretAccessKey, bucketName, key } = req.body;
    if (!accountId || !r2AccessKeyId || !r2SecretAccessKey || !bucketName || !key) {
      return res.status(400).json({ error: "Missing fields" });
    }
    try {
      const r2 = createR2Client(accountId, r2AccessKeyId, r2SecretAccessKey);
      const getCmd = new GetObjectCommand({ Bucket: bucketName, Key: key });
      const obj = await r2.send(getCmd);
      const body = await obj.Body?.transformToString();
      if (!body) throw new Error("Empty manifest");
      const lines = body.split("\n");
      let duration = 0;
      lines.forEach((line) => {
        if (line.startsWith("#EXTINF:")) {
          const val = parseFloat(line.replace("#EXTINF:", "").split(",")[0]);
          if (!isNaN(val)) duration += val;
        }
      });
      res.json({ duration: Math.round(duration) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/r2/scan", async (req, res) => {
    const {
      accountId,
      r2AccessKeyId,
      r2SecretAccessKey,
      bucketName,
      publicBaseUrl
    } = req.body;
    if (!accountId || !r2AccessKeyId || !r2SecretAccessKey || !bucketName) {
      return res.status(400).json({ error: "Missing credentials" });
    }
    try {
      const r2 = createR2Client(accountId, r2AccessKeyId, r2SecretAccessKey);
      const found = [];
      let continuationToken;
      do {
        const cmd = new ListObjectsV2Command({
          Bucket: bucketName,
          ContinuationToken: continuationToken
        });
        const result = await r2.send(cmd);
        const objects = result.Contents || [];
        const manifests = objects.filter((o) => o.Key && o.Key.endsWith("index.m3u8"));
        for (const m of manifests) {
          const key = m.Key;
          const dirPath = key.includes("/") ? key.substring(0, key.lastIndexOf("/")) : "";
          const pathParts = dirPath ? dirPath.split("/") : ["root"];
          const id = dirPath ? dirPath.replace(/\//g, "-") : "root";
          const name = dirPath ? pathParts.slice(-3).join(" / ") : "Root Folder";
          try {
            const getCmd = new GetObjectCommand({ Bucket: bucketName, Key: key });
            const obj = await r2.send(getCmd);
            const body = await obj.Body?.transformToString();
            if (body) {
              const lines = body.split("\n");
              const segmentLines = lines.filter(
                (l) => l.trim() && !l.startsWith("#")
              );
              let duration = 0;
              lines.forEach((line) => {
                if (line.startsWith("#EXTINF:")) {
                  const val = parseFloat(line.replace("#EXTINF:", "").split(",")[0]);
                  if (!isNaN(val)) duration += val;
                }
              });
              const segmentCount = segmentLines.length;
              const firstSeg = segmentLines[0]?.split("/").pop() || "";
              const match = firstSeg.match(/^([a-zA-Z_-]+?)(\d+)\.ts$/);
              const prefix = match ? match[1] : "segment_";
              const pad = match ? match[2].length : 4;
              found.push({
                id,
                name,
                path: dirPath,
                segments: segmentCount,
                duration: Math.round(duration),
                prefix,
                pad,
                m3u8Url: `${publicBaseUrl}/${key}`,
                bucketName
              });
            }
          } catch {
          }
        }
        continuationToken = result.IsTruncated ? result.NextContinuationToken : void 0;
      } while (continuationToken);
      res.json({ programs: found, total: found.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/r2/publish-manifest", async (req, res) => {
    const {
      accountId,
      r2AccessKeyId,
      r2SecretAccessKey,
      bucketName,
      publicBaseUrl,
      manifest,
      manifestKey
    } = req.body;
    if (!accountId || !r2AccessKeyId || !r2SecretAccessKey || !bucketName || !manifest) {
      return res.status(400).json({ error: "Missing fields" });
    }
    try {
      const r2 = createR2Client(accountId, r2AccessKeyId, r2SecretAccessKey);
      const key = manifestKey || "manifest.json";
      const cmd = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: JSON.stringify(manifest, null, 2),
        ContentType: "application/json",
        CacheControl: "no-store"
      });
      await r2.send(cmd);
      res.json({
        success: true,
        key,
        manifestUrl: `${publicBaseUrl}/${key}`
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/r2/create-bucket", async (req, res) => {
    const { accountId, cfApiToken, bucketName } = req.body;
    if (!accountId || !cfApiToken || !bucketName) {
      return res.status(400).json({ error: "Missing fields" });
    }
    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cfApiToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ name: bucketName })
        }
      );
      const data = await response.json();
      if (data.success) {
        res.json({ success: true, bucket: data.result });
      } else {
        res.status(400).json({
          success: false,
          error: data.errors?.[0]?.message || "Failed to create bucket"
        });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/r2/bucket-usage", async (req, res) => {
    const { accountId, r2AccessKeyId, r2SecretAccessKey, bucketName } = req.body;
    if (!accountId || !r2AccessKeyId || !r2SecretAccessKey || !bucketName) {
      return res.status(400).json({ error: "Missing fields" });
    }
    try {
      const r2 = createR2Client(accountId, r2AccessKeyId, r2SecretAccessKey);
      let totalBytes = 0;
      let objectCount = 0;
      let continuationToken;
      do {
        const cmd = new ListObjectsV2Command({
          Bucket: bucketName,
          ContinuationToken: continuationToken
        });
        const result = await r2.send(cmd);
        for (const obj of result.Contents || []) {
          totalBytes += obj.Size || 0;
          objectCount++;
        }
        continuationToken = result.IsTruncated ? result.NextContinuationToken : void 0;
      } while (continuationToken);
      res.json({ success: true, usedBytes: totalBytes, objectCount });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  app.post("/api/transcode", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const idToken = authHeader.split("Bearer ")[1];
    if (!idToken || idToken.length < 20) {
      return res.status(401).json({ error: "Invalid token" });
    }
    const {
      mp4Key,
      mediaId,
      accountId,
      r2AccessKeyId,
      r2SecretAccessKey,
      bucketName,
      publicBaseUrl,
      userId,
      metadata
    } = req.body;
    if (!accountId || !r2AccessKeyId || !bucketName || !mp4Key) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const rawVideoId = mp4Key.replace("uploads/", "").replace(".mp4", "");
    const artist = metadata?.artistName || "";
    const title = metadata?.songTitle || "";
    const slugBase = artist && title ? `${artist}-${title}` : artist || title || rawVideoId;
    const videoId = slugBase.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-").replace(/^-+|-+$/g, "").substring(0, 60) + "-" + rawVideoId.split("-")[0];
    const tmpDir = path.join(process.cwd(), "uploads", videoId);
    const rawPath = path.join(tmpDir, "original.mp4");
    const segDir = path.join(tmpDir, "segments");
    fs.mkdirSync(segDir, { recursive: true });
    const r2 = createR2Client(accountId, r2AccessKeyId, r2SecretAccessKey);
    try {
      const { Body } = await r2.send(new GetObjectCommand({
        Bucket: bucketName,
        Key: mp4Key
      }));
      const writeStream = fs.createWriteStream(rawPath);
      await new Promise((resolve, reject) => {
        Body.pipe(writeStream);
        writeStream.on("finish", resolve);
        writeStream.on("error", reject);
      });
      const m3u8Path = path.join(segDir, "index.m3u8");
      await new Promise((resolve, reject) => {
        ffmpeg(rawPath).outputOptions([
          "-c:v libx264",
          "-profile:v high",
          "-level 4.1",
          "-pix_fmt yuv420p",
          "-b:v 4000k",
          "-maxrate 4500k",
          "-bufsize 9000k",
          "-vf scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30",
          "-c:a aac",
          "-ar 48000",
          "-ac 2",
          "-b:a 128k",
          "-af aresample=48000",
          "-g 180",
          "-keyint_min 180",
          "-sc_threshold 0",
          "-flags +cgop",
          "-video_track_timescale 90000",
          "-hls_time 6",
          "-hls_list_size 0",
          "-hls_flags independent_segments",
          "-hls_segment_type mpegts",
          `-hls_segment_filename ${path.join(segDir, "segment_%04d.ts")}`,
          "-f hls"
        ]).output(m3u8Path).on("end", () => resolve()).on("error", (err) => reject(err)).run();
      });
      const m3u8Content = fs.readFileSync(m3u8Path, "utf-8");
      const extinfMatches = m3u8Content.match(/#EXTINF:([\d.]+)/g) || [];
      const duration = extinfMatches.reduce((sum, line) => {
        return sum + parseFloat(line.replace("#EXTINF:", ""));
      }, 0);
      const files = fs.readdirSync(segDir);
      const BATCH_SIZE = 10;
      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (file) => {
          const filePath = path.join(segDir, file);
          const fileContent = fs.readFileSync(filePath);
          await r2.send(new PutObjectCommand({
            Bucket: bucketName,
            Key: `streams/${videoId}/${file}`,
            Body: fileContent,
            ContentType: file.endsWith(".m3u8") ? "application/x-mpegURL" : "video/mp2t"
          }));
        }));
      }
      const segmentCount = files.filter((f) => f.endsWith(".ts")).length;
      if (mediaId && dbAdmin) {
        console.log("Attempting Firestore write to media/", mediaId, "with dbAdmin:", !!dbAdmin);
        try {
          await dbAdmin.collection("media").doc(mediaId).set({
            status: "ready",
            m3u8Url: `${publicBaseUrl}/streams/${videoId}/index.m3u8`,
            segmentCount,
            duration,
            segmentDuration: 6,
            segmentPrefix: "segment_",
            segmentPad: 4,
            r2Path: `streams/${videoId}`,
            bucketName
          }, { merge: true });
          console.log("Firestore write successful");
        } catch (e) {
          console.error("Firestore write failed:", e);
          throw e;
        }
      } else {
        console.warn("Skipping Firestore update \u2014 dbAdmin unavailable or no mediaId");
      }
      try {
        await r2.send(new DeleteObjectCommand({
          Bucket: bucketName,
          Key: mp4Key
        }));
      } catch (e) {
        console.warn("Could not delete original MP4:", e);
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
      res.json({
        success: true,
        mediaId: mediaId || "new",
        segmentCount,
        duration,
        m3u8Url: `${publicBaseUrl}/streams/${videoId}/index.m3u8`,
        r2Path: `streams/${videoId}`
      });
    } catch (err) {
      console.error("Transcode error:", err);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/scheduler/check", async (req, res) => {
    const authHeader = req.headers.authorization;
    const secret = process.env.SCHEDULER_SECRET;
    if (!secret || authHeader !== `Bearer ${secret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!dbAdmin) return res.status(503).json({ error: "Admin SDK unavailable" });
    try {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const snap = await dbAdmin.collection("scheduledPublishes").where("status", "==", "pending").where("scheduledAt", "<=", now).get();
      if (snap.empty) {
        return res.json({ checked: 0, published: 0, errors: [] });
      }
      let publishedCount = 0;
      const errors = [];
      for (const d of snap.docs) {
        const publish = { ...d.data(), id: d.id };
        try {
          const channelSnap = await dbAdmin.collection("channels").doc(publish.channelId).get();
          if (!channelSnap.exists) throw new Error("Channel not found");
          const channel = { ...channelSnap.data(), id: channelSnap.id };
          const playlistSnap = await dbAdmin.collection("playlists").doc(publish.playlistId).get();
          if (!playlistSnap.exists) throw new Error("Playlist not found");
          const playlist = { ...playlistSnap.data(), id: playlistSnap.id };
          const mediaSnap = await dbAdmin.collection("media").where("userId", "==", channel.userId).get();
          const mediaItems = mediaSnap.docs.map((m) => ({ ...m.data(), id: m.id }));
          const cfSnap = await dbAdmin.collection("cloudflareConfigs").where("userId", "==", channel.userId).get();
          const cfConfigs = cfSnap.docs.map((c) => ({ ...c.data(), id: c.id }));
          const activeConfig = cfConfigs.find((c) => c.isActive);
          if (!activeConfig) throw new Error("No active Cloudflare config");
          const adSettingsSnap = await dbAdmin.collection("settings").doc("ads").get();
          const adSettingsData = adSettingsSnap.exists ? adSettingsSnap.data() : null;
          const adConfig = {
            id: "global",
            preRollUrl: adSettingsData?.preRollUrl || "",
            midRollUrl: adSettingsData?.midRollUrl || "",
            enabled: adSettingsData?.enabled || false,
            adPodSize: adSettingsData?.adPodSize || adSettingsData?.midRollFrequency || 2,
            breakDurationSeconds: adSettingsData?.breakDurationSeconds || 30,
            houseAds: adSettingsData?.houseAds || []
          };
          const manifest = buildManifest(channel, playlist, mediaItems, cfConfigs, adConfig);
          const validation = validateManifest(manifest);
          if (!validation.valid) throw new Error(`Invalid manifest: ${validation.errors.join(", ")}`);
          const manifestSettingsSnap = await dbAdmin.collection("settings").doc("manifest").get();
          const manifestSettings = manifestSettingsSnap.exists ? manifestSettingsSnap.data() : null;
          if (!manifestSettings?.r2AccessKeyId) throw new Error("Manifest bucket not configured in Settings");
          const manifestR2 = createR2Client(
            manifestSettings.accountId,
            manifestSettings.r2AccessKeyId,
            manifestSettings.r2SecretAccessKey
          );
          const channelSlug = channel.channelSlug || slugify(channel.name);
          const manifestKey = `channels/${channelSlug}/manifest.json`;
          await manifestR2.send(new PutObjectCommand({
            Bucket: manifestSettings.bucketName,
            Key: manifestKey,
            Body: JSON.stringify(manifest, null, 2),
            ContentType: "application/json",
            CacheControl: "no-store"
          }));
          const epoch = Math.floor(Date.now() / 1e3);
          const workerUrl = `https://rag-${channelSlug}.${manifestSettings.accountId}.workers.dev`;
          const channelUpdate = {
            lastPublishedAt: (/* @__PURE__ */ new Date()).toISOString(),
            workerManifestUrl: `${workerUrl}/index.m3u8`,
            epoch
          };
          if (channel.workerNeedsRedeploy) {
            const deployResult = await deployChannelWorker({
              accountId: manifestSettings.accountId,
              cfApiToken: manifestSettings.cfApiToken,
              channelSlug,
              manifestBucketUrl: manifestSettings.publicBaseUrl,
              epoch,
              workerBaseDomain: manifestSettings.workerBaseDomain
            });
            if (deployResult.success) {
              channelUpdate.workerDeployed = true;
              channelUpdate.workerNeedsRedeploy = false;
              channelUpdate.workerManifestUrl = `${deployResult.workerUrl}/index.m3u8`;
            } else {
              errors.push(`Worker deploy failed for ${channelSlug}: ${deployResult.error}`);
            }
          } else {
            let wUrl = "";
            if (manifestSettings.workerBaseDomain) {
              const baseDomain = manifestSettings.workerBaseDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
              wUrl = `https://${channelSlug}.${baseDomain}`;
            } else {
              wUrl = channel.workerManifestUrl ? channel.workerManifestUrl.replace("/index.m3u8", "").replace("/live.m3u8", "") : `https://fastfasts-${channelSlug}.workers.dev`;
            }
            channelUpdate.workerManifestUrl = `${wUrl}/index.m3u8`;
          }
          await dbAdmin.collection("channels").doc(channel.id).update(channelUpdate);
          await dbAdmin.collection("scheduledPublishes").doc(publish.id).update({
            status: "published",
            publishedAt: (/* @__PURE__ */ new Date()).toISOString(),
            workerUrl: channelUpdate.workerManifestUrl.replace("/index.m3u8", "")
          });
          publishedCount++;
        } catch (err) {
          console.error(`Failed to process schedule ${publish.id}:`, err);
          await dbAdmin.collection("scheduledPublishes").doc(publish.id).update({
            status: "failed",
            error: err.message
          });
          errors.push(`Schedule ${publish.id} failed: ${err.message}`);
        }
      }
      res.json({ checked: snap.size, published: publishedCount, errors });
    } catch (err) {
      console.error("Scheduler Check Error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  async function deployEmbedPlayer(accountId, cfApiToken) {
    const htmlPath = path.join(process.cwd(), "src/embed/index.html");
    const htmlContent = fs.readFileSync(htmlPath, "utf-8");
    const workerScript = `
export default {
  async fetch(request) {
    const url = new URL(request.url);
    return new Response(${JSON.stringify(htmlContent)}, {
      headers: {
        "Content-Type": "text/html",
        "Content-Security-Policy": "frame-ancestors *;",
        "Access-Control-Allow-Origin": "*",
      }
    });
  }
};`;
    const formData = new FormData();
    formData.append("metadata", JSON.stringify({ main_module: "index.js" }));
    formData.append("script", new Blob([workerScript], { type: "application/javascript+module" }), "index.js");
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/fastfasts-embed-worker`,
      { method: "PUT", headers: { "Authorization": `Bearer ${cfApiToken}` }, body: formData }
    );
    const result = await response.json();
    console.log("Worker upload result:", JSON.stringify(result));
    if (!result.success) throw new Error(JSON.stringify(result.errors));
    const subRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/fastfasts-embed-worker/subdomain`,
      { method: "POST", headers: { "Authorization": `Bearer ${cfApiToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true }) }
    );
    const subResult = await subRes.json();
    console.log("Subdomain enable result:", JSON.stringify(subResult));
    return `https://fastfasts-embed-worker.lookhu.workers.dev`;
  }
  app.post("/api/deploy/embed-player", async (req, res) => {
    const { accountId, cfApiToken } = req.body;
    if (!accountId || !cfApiToken) return res.status(400).json({ error: "Missing Cloudflare credentials" });
    try {
      const url = await deployEmbedPlayer(accountId, cfApiToken);
      res.json({ success: true, url });
    } catch (err) {
      console.error("Embed deploy error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/publish/now", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const idToken = authHeader.split("Bearer ")[1];
    if (!idToken || idToken.length < 20) {
      return res.status(401).json({ error: "Invalid token" });
    }
    const { channelId, userId, channel, playlist, mediaItems, cfConfig } = req.body;
    if (!channelId || !userId || !channel || !playlist || !cfConfig) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    try {
      const decodedToken = await authAdmin.verifyIdToken(idToken);
      const requesterUid = decodedToken.uid;
      const userDoc = await dbAdmin.collection("users").doc(requesterUid).get();
      const userData = userDoc.exists ? userDoc.data() : null;
      const isMasterAdmin2 = userData?.role === "master_admin" || ["lookhumaster@gmail.com", "rpduece@gmail.com"].includes(decodedToken.email);
      if (!isMasterAdmin2 && (userData?.accountId !== channel.accountId && requesterUid !== channel.userId)) {
        return res.status(403).json({ error: "Forbidden: You do not have permission to publish this channel." });
      }
      const manifestSettingsSnap = await dbAdmin.collection("settings").doc("manifest").get();
      const manifestSettings = manifestSettingsSnap.exists ? manifestSettingsSnap.data() : null;
      if (!manifestSettings?.r2AccessKeyId) throw new Error("Manifest bucket not configured in Settings");
      const adSettingsSnap = await dbAdmin.collection("settings").doc("ads").get();
      const adSettingsData = adSettingsSnap.exists ? adSettingsSnap.data() : null;
      const adConfig = {
        id: "global",
        preRollUrl: adSettingsData?.preRollUrl || "",
        midRollUrl: adSettingsData?.midRollUrl || "",
        enabled: adSettingsData?.enabled || false,
        adPodSize: adSettingsData?.adPodSize || adSettingsData?.midRollFrequency || 2,
        breakDurationSeconds: adSettingsData?.breakDurationSeconds || 30,
        houseAds: adSettingsData?.houseAds || []
      };
      const manifest = buildManifest(channel, playlist, mediaItems || [], [cfConfig], adConfig);
      const validation = validateManifest(manifest);
      if (!validation.valid) {
        return res.status(400).json({ error: `Invalid manifest: ${validation.errors.join(", ")}` });
      }
      const manifestR2 = createR2Client(
        manifestSettings.accountId,
        manifestSettings.r2AccessKeyId,
        manifestSettings.r2SecretAccessKey
      );
      const channelSlug = slugify(channel.name);
      const manifestKey = `channels/${channelSlug}/manifest.json`;
      await manifestR2.send(new PutObjectCommand({
        Bucket: manifestSettings.bucketName,
        Key: manifestKey,
        Body: JSON.stringify(manifest, null, 2),
        ContentType: "application/json",
        CacheControl: "no-store"
      }));
      const epoch = Math.floor(Date.now() / 1e3);
      const { deployChannelWorker: deployChannelWorker2 } = await Promise.resolve().then(() => (init_workerDeployer(), workerDeployer_exports));
      const deployResult = await deployChannelWorker2({
        accountId: manifestSettings.accountId,
        cfApiToken: manifestSettings.cfApiToken,
        channelSlug,
        manifestBucketUrl: manifestSettings.publicBaseUrl,
        epoch,
        workerBaseDomain: manifestSettings.workerBaseDomain
      });
      if (!deployResult.success) throw new Error(deployResult.error);
      try {
        const pagesUrl = await deployEmbedPlayer(manifestSettings.accountId, manifestSettings.cfApiToken);
        await dbAdmin.collection("settings").doc("embedPlayer").set({ pagesUrl });
      } catch (err) {
        console.error("Embed deploy failed:", err);
      }
      if (dbAdmin) {
        await dbAdmin.collection("channels").doc(channelId).update({
          workerManifestUrl: deployResult.workerUrl + "/index.m3u8",
          lastPublishedAt: (/* @__PURE__ */ new Date()).toISOString(),
          epoch,
          workerDeployed: true,
          workerNeedsRedeploy: false
        });
      }
      res.json({
        success: true,
        workerUrl: deployResult.workerUrl,
        manifestUrl: `${manifestSettings.publicBaseUrl}/${manifestKey}`
      });
    } catch (err) {
      console.error("Publish Now Error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/deploy/channel", async (req, res) => {
    try {
      const { deployChannelWorker: deployChannelWorker2 } = await Promise.resolve().then(() => (init_workerDeployer(), workerDeployer_exports));
      const result = await deployChannelWorker2(req.body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  app.delete("/api/deploy/channel/:slug", async (req, res) => {
    try {
      const { slug } = req.params;
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const idToken = authHeader.split("Bearer ")[1];
      await authAdmin.verifyIdToken(idToken);
      const settingsDoc = await dbAdmin.collection("settings").doc("masterApi").get();
      if (!settingsDoc.exists) {
        return res.status(400).json({ error: "Master API settings not configured" });
      }
      const manifestSettings = settingsDoc.data();
      if (!manifestSettings?.accountId || !manifestSettings?.cfApiToken) {
        return res.status(400).json({ error: "Cloudflare credentials missing in Master API settings" });
      }
      const { deleteChannelWorker: deleteChannelWorker2 } = await Promise.resolve().then(() => (init_workerDeployer(), workerDeployer_exports));
      const result = await deleteChannelWorker2(
        manifestSettings.accountId,
        manifestSettings.cfApiToken,
        slug
      );
      res.json(result);
    } catch (err) {
      console.error("Delete Channel Worker Error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
  app.post("/api/deploy/scheduler", async (req, res) => {
    try {
      const { deploySchedulerWorker: deploySchedulerWorker2 } = await Promise.resolve().then(() => (init_workerDeployer(), workerDeployer_exports));
      const result = await deploySchedulerWorker2(req.body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  app.post("/api/submission", async (req, res) => {
    const submission = req.body;
    try {
      if (!dbAdmin) {
        throw new Error("Firestore Admin SDK not initialized");
      }
      const docRef = await dbAdmin.collection("submissions").add({
        ...submission,
        submittedAt: (/* @__PURE__ */ new Date()).toISOString(),
        status: "pending"
      });
      res.json({ success: true, id: docRef.id });
    } catch (error) {
      console.error("Submission Error:", error);
      res.status(500).json({ error: "Failed to save submission" });
    }
  });
  app.post("/api/upload", (req, res, next) => {
    console.log("Upload request received");
    upload.single("file")(req, res, (err) => {
      if (err) {
        console.error("Multer error:", err);
        return res.status(500).json({ error: "File upload failed", details: err.message });
      }
      next();
    });
  }, (req, res) => {
    if (!req.file) {
      console.error("No file in request");
      return res.status(400).json({ error: "No file uploaded" });
    }
    console.log("File uploaded successfully:", req.file.filename);
    const fileId = req.file.filename.split("-")[0];
    const inputPath = req.file.path;
    const outputDir = path.join(streamsDir, fileId);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
    const m3u8Path = path.join(outputDir, "index.m3u8");
    console.log("Starting transcoding for:", fileId);
    ffmpeg(inputPath).outputOptions([
      "-c:v libx264",
      "-profile:v high",
      "-level 4.1",
      "-pix_fmt yuv420p",
      "-b:v 4000k",
      "-maxrate 4500k",
      "-bufsize 9000k",
      "-vf scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30",
      "-c:a aac",
      "-ar 48000",
      "-ac 2",
      "-b:a 128k",
      "-af aresample=48000",
      "-g 180",
      "-keyint_min 180",
      "-sc_threshold 0",
      "-flags +cgop",
      "-video_track_timescale 90000",
      "-hls_time 6",
      "-hls_list_size 0",
      "-hls_flags independent_segments",
      "-hls_segment_type mpegts",
      `-hls_segment_filename ${path.join(outputDir, "segment_%04d.ts")}`,
      "-f hls"
    ]).output(m3u8Path).on("start", (commandLine) => {
      console.log("Spawned Ffmpeg with command: " + commandLine);
    }).on("progress", (progress) => {
      if (progress.percent) {
        console.log("Processing: " + progress.percent.toFixed(2) + "% done");
      }
    }).on("end", () => {
      console.log("Transcoding finished for:", fileId);
    }).on("error", (err) => {
      console.error("Error during transcoding for " + fileId + ": " + err.message);
    }).run();
    res.json({
      id: fileId,
      filename: req.file.originalname,
      m3u8: `${req.protocol}://${req.get("host")}/streams/${fileId}/index.m3u8`
    });
  });
  app.get("/api/status/:id", (req, res) => {
    const { id } = req.params;
    const m3u8Path = path.join(streamsDir, id, "index.m3u8");
    if (fs.existsSync(m3u8Path)) {
      res.json({
        status: "ready",
        m3u8: `${req.protocol}://${req.get("host")}/streams/${id}/index.m3u8`
      });
    } else {
      res.json({ status: "transcoding" });
    }
  });
  app.use("/streams", express.static(streamsDir));
  app.use((err, req, res, next) => {
    console.error("Global Server Error:", err);
    res.status(500).json({ error: err.message || "Internal Server Error" });
  });
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        headers: {
          "Cross-Origin-Opener-Policy": "same-origin-allow-popups"
        }
      },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
  initializeFirebaseAdmin();
}
startServer();
