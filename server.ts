import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import multer from "multer";
import ffmpegStatic from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import cors from "cors";

ffmpeg.setFfmpegPath(ffmpegStatic as string);
import { v4 as uuidv4 } from "uuid";
import { S3Client, PutObjectCommand, ListObjectsV2Command,
         GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

import { buildManifest, validateManifest, slugify } from "./src/lib/manifestBuilder.ts";
import { deployChannelWorker } from "./src/lib/workerDeployer.ts";

// Load config for project ID
const configPath = path.join(process.cwd(), "firebase-applet-config.json");
let firebaseConfig: any = {};
if (fs.existsSync(configPath)) {
  firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  console.log("Firebase config loaded:", firebaseConfig);
} else {
  console.error("Firebase config file not found at:", configPath);
}

let dbAdmin: any = null;
let authAdmin: any = null;

try {
  const apps = getApps();
  let adminApp: any;
  if (apps.length === 0) {
    if (!firebaseConfig.projectId) {
      console.error("Firebase Admin initialization failed: projectId is missing in firebase-applet-config.json");
    } else {
      adminApp = initializeApp({ projectId: firebaseConfig.projectId });
      console.log("Firebase Admin initialized with project:", firebaseConfig.projectId);
    }
  } else {
    adminApp = apps[0];
    console.log("Firebase Admin using existing app");
  }
  
  if (adminApp) {
    dbAdmin = getFirestore(adminApp, firebaseConfig.firestoreDatabaseId || "(default)");
    authAdmin = getAuth(adminApp);
    console.log("Firebase Admin ready. Using database:", firebaseConfig.firestoreDatabaseId || "(default)");
  } else {
    console.error("Firebase Admin initialization failed: adminApp is undefined");
  }
} catch (err) {
  console.error("Firebase Admin initialization error:", err);
}

function createR2Client(accountId: string, accessKeyId: string,
                        secretAccessKey: string): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

const PORT = Number(process.env.PORT) || 3000;

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

  // Ensure directories exist
  const uploadsDir = path.join(process.cwd(), "uploads");
  const streamsDir = path.join(process.cwd(), "streams");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
  if (!fs.existsSync(streamsDir)) fs.mkdirSync(streamsDir);

  // Multer config for MP4 uploads
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, "uploads/");
    },
    filename: (req, file, cb) => {
      const id = uuidv4();
      cb(null, `${id}-${file.originalname}`);
    },
  });
  const upload = multer({ storage });

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      firebase: {
        initialized: getApps().length > 0,
        projectId: firebaseConfig.projectId,
        dbAdmin: !!dbAdmin,
        authAdmin: !!authAdmin
      }
    });
  });

  // Helper to verify master admin
  const isMasterAdmin = async (uid: string) => {
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

  // Helper to verify account admin
  const isAccountAdmin = async (uid: string, accountId: string) => {
    if (!dbAdmin) return false;
    if (await isMasterAdmin(uid)) return true;
    const userDoc = await dbAdmin.collection("users").doc(uid).get();
    if (!userDoc.exists) return false;
    const userData = userDoc.data();
    return userData.role === "admin" && userData.accountId === accountId;
  };

  // Master Admin: List all accounts
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
      if (!(await isMasterAdmin(decodedToken.uid))) return res.status(403).json({ error: "Forbidden" });
      if (!dbAdmin) {
        console.error("dbAdmin is null");
        return res.status(500).json({ error: "dbAdmin is null" });
      }
      const snapshot = await dbAdmin.collection("accounts").get();
      const accounts = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
      res.json(accounts);
    } catch (err: any) {
      console.error("Error in /api/admin/accounts:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Master Admin: List all users
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
      if (!(await isMasterAdmin(decodedToken.uid))) return res.status(403).json({ error: "Forbidden" });
      if (!dbAdmin) {
        console.error("dbAdmin is null");
        return res.status(500).json({ error: "dbAdmin is null" });
      }
      const snapshot = await dbAdmin.collection("users").get();
      const users = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
      res.json(users);
    } catch (err: any) {
      console.error("Error in /api/admin/users:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Master Admin: Update User Role
  app.post("/api/admin/users/update-role", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    const idToken = authHeader.split("Bearer ")[1];
    const { userId, role } = req.body;
    try {
      const decodedToken = await authAdmin.verifyIdToken(idToken);
      if (!(await isMasterAdmin(decodedToken.uid))) return res.status(403).json({ error: "Forbidden" });
      await dbAdmin.collection("users").doc(userId).update({ role });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Master Admin: Create Account
  app.post("/api/admin/accounts", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    const idToken = authHeader.split("Bearer ")[1];
    const { name, ownerId } = req.body;
    try {
      const decodedToken = await authAdmin.verifyIdToken(idToken);
      if (!(await isMasterAdmin(decodedToken.uid))) return res.status(403).json({ error: "Forbidden" });
      const accountRef = await dbAdmin.collection("accounts").add({
        name,
        ownerId,
        members: [ownerId],
        createdAt: new Date().toISOString()
      });
      // Update owner's accountId
      await dbAdmin.collection("users").doc(ownerId).update({ accountId: accountRef.id, role: "admin" });
      res.json({ id: accountRef.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Send Invitation
  app.post("/api/invites/send", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    const idToken = authHeader.split("Bearer ")[1];
    const { email, accountId, role } = req.body;
    try {
      const decodedToken = await authAdmin.verifyIdToken(idToken);
      if (!(await isAccountAdmin(decodedToken.uid, accountId))) return res.status(403).json({ error: "Forbidden" });
      
      const inviteRef = await dbAdmin.collection("invitations").add({
        email,
        accountId,
        role: role || "user",
        status: "pending",
        invitedBy: decodedToken.uid,
        createdAt: new Date().toISOString()
      });
      res.json({ id: inviteRef.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Accept Invitation
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

      // Update user profile
      await dbAdmin.collection("users").doc(decodedToken.uid).update({
        accountId: inviteData.accountId,
        role: inviteData.role,
        ownerUserId: inviteData.invitedBy
      });

      // Add to account members
      await dbAdmin.collection("accounts").doc(inviteData.accountId).update({
        members: FieldValue.arrayUnion(decodedToken.uid)
      });

      // Mark invite as accepted
      await inviteDoc.ref.update({ status: "accepted" });

      res.json({ success: true });
    } catch (err: any) {
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
    } catch (err: any) {
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
      let continuationToken: string | undefined;
      let deleted = 0;
      do {
        const list = await r2.send(new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }));
        const keys = (list.Contents || []).map(o => o.Key!).filter(Boolean);
        for (const key of keys) {
          await r2.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
          deleted++;
        }
        continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
      } while (continuationToken);
      res.json({ success: true, deleted });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/r2/presign-secure", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Basic token presence check — Firebase client handles actual auth
    const idToken = authHeader.split("Bearer ")[1];
    if (!idToken || idToken.length < 20) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const { configId, keys, accountId, r2AccessKeyId, r2SecretAccessKey, bucketName } = req.body;

    if (!Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ error: "Missing keys" });
    }

    // Use credentials from request body if configId lookup would require admin
    if (!accountId || !r2AccessKeyId || !r2SecretAccessKey || !bucketName) {
      return res.status(400).json({ error: "Missing R2 credentials" });
    }

    try {
      const r2 = createR2Client(accountId, r2AccessKeyId, r2SecretAccessKey);
      const urls = await Promise.all(
        keys.map(async ({ key, contentType }: { key: string; contentType: string }) => {
          const cmd = new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            ContentType: contentType,
          });
          const uploadUrl = await getSignedUrl(r2, cmd, { expiresIn: 7200 });
          return { key, uploadUrl };
        })
      );
      res.json({ urls });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/r2/presign-batch", async (req, res) => {
    const { accountId, r2AccessKeyId, r2SecretAccessKey,
            bucketName, keys } = req.body;
    if (!accountId || !r2AccessKeyId || !r2SecretAccessKey ||
        !bucketName || !Array.isArray(keys)) {
      return res.status(400).json({ error: "Missing fields" });
    }
    try {
      const r2 = createR2Client(accountId, r2AccessKeyId, r2SecretAccessKey);
      const urls = await Promise.all(
        keys.map(async ({ key, contentType }: { key: string; contentType: string }) => {
          const cmd = new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            ContentType: contentType || "video/mp2t",
          });
          const uploadUrl = await getSignedUrl(r2, cmd, { expiresIn: 7200 });
          return { key, uploadUrl };
        })
      );
      res.json({ urls });
    } catch (err: any) {
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
      lines.forEach(line => {
        if (line.startsWith("#EXTINF:")) {
          const val = parseFloat(line.replace("#EXTINF:", "").split(",")[0]);
          if (!isNaN(val)) duration += val;
        }
      });

      res.json({ duration: Math.round(duration) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/r2/scan", async (req, res) => {
    const { accountId, r2AccessKeyId, r2SecretAccessKey,
            bucketName, publicBaseUrl } = req.body;
    if (!accountId || !r2AccessKeyId || !r2SecretAccessKey || !bucketName) {
      return res.status(400).json({ error: "Missing credentials" });
    }
    try {
      const r2 = createR2Client(accountId, r2AccessKeyId, r2SecretAccessKey);
      const found: any[] = [];
      let continuationToken: string | undefined;

      do {
        const cmd = new ListObjectsV2Command({
          Bucket: bucketName,
          ContinuationToken: continuationToken,
        });
        const result = await r2.send(cmd);
        const objects = result.Contents || [];
        const manifests = objects.filter(o => o.Key && o.Key.endsWith("index.m3u8"));

        for (const m of manifests) {
          const key = m.Key!;
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
                l => l.trim() && !l.startsWith("#")
              );
              
              // Calculate duration from #EXTINF lines
              let duration = 0;
              lines.forEach(line => {
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
                bucketName,
              });
            }
          } catch {}
        }

        continuationToken = result.IsTruncated
          ? result.NextContinuationToken
          : undefined;
      } while (continuationToken);

      res.json({ programs: found, total: found.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/r2/publish-manifest", async (req, res) => {
    const { accountId, r2AccessKeyId, r2SecretAccessKey,
            bucketName, publicBaseUrl, manifest, manifestKey } = req.body;
    if (!accountId || !r2AccessKeyId || !r2SecretAccessKey ||
        !bucketName || !manifest) {
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
        CacheControl: "no-store",
      });
      await r2.send(cmd);
      res.json({
        success: true,
        key,
        manifestUrl: `${publicBaseUrl}/${key}`,
      });
    } catch (err: any) {
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
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: bucketName }),
        }
      );
      const data = await response.json() as any;
      if (data.success) {
        res.json({ success: true, bucket: data.result });
      } else {
        res.status(400).json({
          success: false,
          error: data.errors?.[0]?.message || "Failed to create bucket",
        });
      }
    } catch (err: any) {
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
      let continuationToken: string | undefined;

      do {
        const cmd = new ListObjectsV2Command({
          Bucket: bucketName,
          ContinuationToken: continuationToken,
        });
        const result = await r2.send(cmd);
        for (const obj of result.Contents || []) {
          totalBytes += obj.Size || 0;
          objectCount++;
        }
        continuationToken = result.IsTruncated
          ? result.NextContinuationToken
          : undefined;
      } while (continuationToken);

      res.json({ success: true, usedBytes: totalBytes, objectCount });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/transcode", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Basic token presence check — Firebase client handles actual auth
    const idToken = authHeader.split("Bearer ")[1];
    if (!idToken || idToken.length < 20) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const { mp4Key, mediaId, accountId, r2AccessKeyId, r2SecretAccessKey,
            bucketName, publicBaseUrl, userId, metadata } = req.body;

    if (!accountId || !r2AccessKeyId || !bucketName || !mp4Key) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const rawVideoId = mp4Key.replace("uploads/", "").replace(".mp4", "");
    const artist = metadata?.artistName || "";
    const title = metadata?.songTitle || "";
    const slugBase = artist && title
      ? `${artist}-${title}`
      : (artist || title || rawVideoId);
    const videoId = slugBase
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .substring(0, 60) // cap length
      + "-" + rawVideoId.split("-")[0]; // append timestamp prefix for uniqueness
    const tmpDir = path.join(process.cwd(), "uploads", videoId);
    const rawPath = path.join(tmpDir, "original.mp4");
    const segDir = path.join(tmpDir, "segments");
    fs.mkdirSync(segDir, { recursive: true });

    const r2 = createR2Client(accountId, r2AccessKeyId, r2SecretAccessKey);

    try {
      // 1. Download MP4 from R2
      const { Body } = await r2.send(new GetObjectCommand({
        Bucket: bucketName,
        Key: mp4Key
      }));
      const writeStream = fs.createWriteStream(rawPath);
      await new Promise<void>((resolve, reject) => {
        (Body as any).pipe(writeStream);
        writeStream.on("finish", resolve);
        writeStream.on("error", reject);
      });

      // 2. Transcode to HLS segments
      const m3u8Path = path.join(segDir, "index.m3u8");
      await new Promise<void>((resolve, reject) => {
        ffmpeg(rawPath)
          .outputOptions([
            "-c:v libx264",
            "-profile:v baseline",
            "-level 3.0",
            "-c:a aac",
            "-ar 44100",
            "-ac 2",
            "-b:a 128k",
            "-af aresample=async=1:first_pts=0",
            "-vf scale=-2:720",
            "-crf 23",
            "-preset fast",
            "-hls_time 6",
            "-hls_list_size 0",
            `-hls_segment_filename ${path.join(segDir, "segment_%04d.ts")}`,
            "-f hls",
          ])
          .output(m3u8Path)
          .on("end", () => resolve())
          .on("error", (err: any) => reject(err))
          .run();
      });

      // 3. Get duration by parsing the generated m3u8
      const m3u8Content = fs.readFileSync(m3u8Path, "utf-8");
      const extinfMatches: string[] = m3u8Content.match(/#EXTINF:([\d.]+)/g) || [];
      const duration: number = extinfMatches.reduce((sum: number, line: string) => {
        return sum + parseFloat(line.replace("#EXTINF:", ""));
      }, 0);

      // 4. Upload segments to R2
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
            ContentType: file.endsWith(".m3u8") ? "application/x-mpegURL" : "video/mp2t",
          }));
        }));
      }

      // 5. Count segments
      const segmentCount = files.filter(f => f.endsWith(".ts")).length;

      // 6. Save to Firestore via Admin SDK
      if (mediaId && dbAdmin) {
        await dbAdmin.collection("media").doc(mediaId).set({
          status: "ready",
          m3u8Url: `${publicBaseUrl}/streams/${videoId}/index.m3u8`,
          segmentCount,
          duration,
          segmentDuration: 6,
          segmentPrefix: "segment_",
          segmentPad: 4,
          r2Path: `streams/${videoId}`,
          bucketName,
        }, { merge: true });
      } else {
        console.warn("Skipping Firestore update — dbAdmin unavailable or no mediaId");
      }

      // 7. Delete original MP4 now that segments are confirmed
      try {
        await r2.send(new DeleteObjectCommand({
          Bucket: bucketName,
          Key: mp4Key,
        }));
      } catch (e) {
        console.warn("Could not delete original MP4:", e);
      }

      // 8. Cleanup temp files
      fs.rmSync(tmpDir, { recursive: true, force: true });

      res.json({
        success: true,
        mediaId: mediaId || "new",
        segmentCount,
        duration,
        m3u8Url: `${publicBaseUrl}/streams/${videoId}/index.m3u8`,
        r2Path: `streams/${videoId}`,
      });

    } catch (err: any) {
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
      const now = new Date().toISOString();
      const snap = await dbAdmin.collection("scheduledPublishes")
        .where("status", "==", "pending")
        .where("scheduledAt", "<=", now)
        .get();

      if (snap.empty) {
        return res.json({ checked: 0, published: 0, errors: [] });
      }

      let publishedCount = 0;
      const errors: string[] = [];

      for (const d of snap.docs) {
        const publish = { ...d.data(), id: d.id } as any;
        try {
          // 1. Get Channel
          const channelSnap = await dbAdmin.collection("channels").doc(publish.channelId).get();
          if (!channelSnap.exists) throw new Error("Channel not found");
          const channel = { ...channelSnap.data(), id: channelSnap.id } as any;

          // 2. Get Playlist
          const playlistSnap = await dbAdmin.collection("playlists").doc(publish.playlistId).get();
          if (!playlistSnap.exists) throw new Error("Playlist not found");
          const playlist = { ...playlistSnap.data(), id: playlistSnap.id } as any;

          // 3. Get Media items
          const mediaSnap = await dbAdmin.collection("media")
            .where("userId", "==", channel.userId)
            .get();
          const mediaItems = mediaSnap.docs.map(m => ({ ...m.data(), id: m.id })) as any[];

          // 4. Get CloudflareConfigs
          const cfSnap = await dbAdmin.collection("cloudflareConfigs")
            .where("userId", "==", channel.userId)
            .get();
          const cfConfigs = cfSnap.docs.map(c => ({ ...c.data(), id: c.id })) as any[];

          const activeConfig = cfConfigs.find(c => c.isActive);
          if (!activeConfig) throw new Error("No active Cloudflare config");

          // 5. Build Manifest
          const manifest = buildManifest(channel, playlist, mediaItems, cfConfigs);
          const validation = validateManifest(manifest);
          if (!validation.valid) throw new Error(`Invalid manifest: ${validation.errors.join(", ")}`);

          // 6. Push Manifest to R2
          const r2 = createR2Client(activeConfig.accountId, activeConfig.r2AccessKeyId, activeConfig.r2SecretAccessKey);
          const channelSlug = channel.channelSlug || slugify(channel.name);
          const manifestKey = `channels/${channelSlug}/manifest.json`;
          
          await r2.send(new PutObjectCommand({
            Bucket: activeConfig.bucketName,
            Key: manifestKey,
            Body: JSON.stringify(manifest, null, 2),
            ContentType: "application/json",
            CacheControl: "no-store",
          }));

          // 7. Update Channel
          const epoch = Math.floor(Date.now() / 1000);
          const workerUrl = `https://rag-${channelSlug}.${activeConfig.accountId}.workers.dev`; // Placeholder, deploy worker below if needed

          const channelUpdate: any = {
            lastPublishedAt: new Date().toISOString(),
            workerManifestUrl: `${workerUrl}/index.m3u8`,
            epoch: epoch
          };

          // 8. Optionally re-deploy Worker
          if (channel.workerNeedsRedeploy) {
            const deployResult = await deployChannelWorker({
              accountId: activeConfig.accountId,
              cfApiToken: activeConfig.cfApiToken,
              channelSlug,
              manifestBucketUrl: activeConfig.publicBaseUrl,
              epoch
            });
            if (deployResult.success) {
              channelUpdate.workerDeployed = true;
              channelUpdate.workerNeedsRedeploy = false;
              channelUpdate.workerManifestUrl = `${deployResult.workerUrl}/index.m3u8`;
            } else {
              errors.push(`Worker deploy failed for ${channelSlug}: ${deployResult.error}`);
            }
          }

          await dbAdmin.collection("channels").doc(channel.id).update(channelUpdate);

          // 9. Update Scheduled Publish
          await dbAdmin.collection("scheduledPublishes").doc(publish.id).update({
            status: "published",
            publishedAt: new Date().toISOString(),
            workerUrl: channelUpdate.workerManifestUrl.replace("/index.m3u8", "")
          });

          publishedCount++;
        } catch (err: any) {
          console.error(`Failed to process schedule ${publish.id}:`, err);
          await dbAdmin.collection("scheduledPublishes").doc(publish.id).update({
            status: "failed",
            error: err.message
          });
          errors.push(`Schedule ${publish.id} failed: ${err.message}`);
        }
      }

      res.json({ checked: snap.size, published: publishedCount, errors });
    } catch (err: any) {
      console.error("Scheduler Check Error:", err);
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
      // Build manifest from data sent by browser
      const manifest = buildManifest(channel, playlist, mediaItems || [], [cfConfig]);
      const validation = validateManifest(manifest);
      if (!validation.valid) {
        return res.status(400).json({ error: `Invalid manifest: ${validation.errors.join(", ")}` });
      }

      // Push manifest to R2
      const r2 = createR2Client(
        cfConfig.accountId,
        cfConfig.r2AccessKeyId,
        cfConfig.r2SecretAccessKey
      );
      const channelSlug = slugify(channel.name);
      const manifestKey = `channels/${channelSlug}/manifest.json`;

      await r2.send(new PutObjectCommand({
        Bucket: cfConfig.bucketName,
        Key: manifestKey,
        Body: JSON.stringify(manifest, null, 2),
        ContentType: "application/json",
        CacheControl: "no-store",
      }));

      // Deploy Worker
      const epoch = Math.floor(Date.now() / 1000);
      const { deployChannelWorker } = await import("./src/lib/workerDeployer.ts");
      const deployResult = await deployChannelWorker({
        accountId: cfConfig.accountId,
        cfApiToken: cfConfig.cfApiToken || cfConfig.apiToken,
        channelSlug,
        manifestBucketUrl: cfConfig.publicBaseUrl,
        epoch,
      });

      if (!deployResult.success) throw new Error(deployResult.error);

      // Update channel with worker URL and epoch
      if (dbAdmin) {
        await dbAdmin.collection("channels").doc(channelId).update({
          workerManifestUrl: deployResult.workerUrl + "/index.m3u8",
          lastPublishedAt: new Date().toISOString(),
          epoch: epoch,
          workerDeployed: true,
          workerNeedsRedeploy: false
        });
      }

      res.json({
        success: true,
        workerUrl: deployResult.workerUrl,
        manifestUrl: `${cfConfig.publicBaseUrl}/${manifestKey}`,
      });

    } catch (err: any) {
      console.error("Publish Now Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/deploy/channel", async (req, res) => {
    try {
      const { deployChannelWorker } = await import("./src/lib/workerDeployer.ts");
      const result = await deployChannelWorker(req.body);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/deploy/scheduler", async (req, res) => {
    try {
      const { deploySchedulerWorker } = await import("./src/lib/workerDeployer.ts");
      const result = await deploySchedulerWorker(req.body);
      res.json(result);
    } catch (err: any) {
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
        submittedAt: new Date().toISOString(),
        status: "pending"
      });
      
      res.json({ success: true, id: docRef.id });
    } catch (error) {
      console.error("Submission Error:", error);
      res.status(500).json({ error: "Failed to save submission" });
    }
  });

  // LOCAL FALLBACK — used when R2 is not configured
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
    // Start transcoding
    ffmpeg(inputPath)
      .outputOptions([
        "-profile:v baseline",
        "-level 3.0",
        "-start_number 0",
        "-hls_time 10",
        "-hls_list_size 0",
        "-f hls"
      ])
      .output(m3u8Path)
      .on("start", (commandLine) => {
        console.log("Spawned Ffmpeg with command: " + commandLine);
      })
      .on("progress", (progress) => {
        if (progress.percent) {
          console.log("Processing: " + progress.percent.toFixed(2) + "% done");
        }
      })
      .on("end", () => {
        console.log("Transcoding finished for:", fileId);
      })
      .on("error", (err) => {
        console.error("Error during transcoding for " + fileId + ": " + err.message);
      })
      .run();

    res.json({ 
      id: fileId, 
      filename: req.file.originalname,
      m3u8: `${req.protocol}://${req.get("host")}/streams/${fileId}/index.m3u8`
    });
  });

  // LOCAL FALLBACK — used when R2 is not configured
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

  // Serve streams
  app.use("/streams", express.static(streamsDir));

  // Error handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error("Global Server Error:", err);
    res.status(500).json({ error: err.message || "Internal Server Error" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        headers: {
          "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
        },
      },
      appType: "spa",
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
}

startServer();
