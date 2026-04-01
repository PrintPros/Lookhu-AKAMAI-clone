import { Firestore, collection, query, where, getDocs, updateDoc, doc, increment, addDoc, orderBy, limit } from "firebase/firestore";
import type { CloudflareConfig } from "../types.ts";

/**
 * Gets the active bucket for a user, handling spillover if necessary.
 */
export async function getActiveBucket(userId: string, db: Firestore): Promise<CloudflareConfig | null> {
  try {
    // 1. Find the current active bucket
    const activeQ = query(
      collection(db, "cloudflareConfigs"),
      where("userId", "==", userId),
      where("isActive", "==", true),
      limit(1)
    );
    const activeSnap = await getDocs(activeQ);
    let activeConfig = activeSnap.empty ? null : { ...activeSnap.docs[0].data(), id: activeSnap.docs[0].id } as CloudflareConfig;

    // 2. Check if it's full (90% threshold)
    if (activeConfig && activeConfig.usedBytes >= activeConfig.maxBytes * 0.9) {
      // Mark as full and inactive
      await updateDoc(doc(db, "cloudflareConfigs", activeConfig.id), {
        isFull: true,
        isActive: false
      });

      // 3. Find next available bucket (oldest createdAt where not full)
      const nextQ = query(
        collection(db, "cloudflareConfigs"),
        where("userId", "==", userId),
        where("isFull", "==", false),
        orderBy("createdAt", "asc"),
        limit(1)
      );
      const nextSnap = await getDocs(nextQ);
      if (!nextSnap.empty) {
        const nextId = nextSnap.docs[0].id;
        await updateDoc(doc(db, "cloudflareConfigs", nextId), {
          isActive: true
        });
        return { ...nextSnap.docs[0].data(), id: nextId } as CloudflareConfig;
      }
      return null;
    }

    return activeConfig;
  } catch (error) {
    console.error("Error in getActiveBucket:", error);
    return null;
  }
}

/**
 * Increments the usedBytes on a bucket configuration.
 */
export async function recordUploadBytes(configId: string, bytes: number, db: Firestore): Promise<void> {
  try {
    await updateDoc(doc(db, "cloudflareConfigs", configId), {
      usedBytes: increment(bytes)
    });
  } catch (error) {
    console.error("Error in recordUploadBytes:", error);
  }
}

/**
 * Returns a summary of all buckets for a user.
 */
export async function getBucketUsageSummary(userId: string, db: Firestore) {
  try {
    const q = query(
      collection(db, "cloudflareConfigs"),
      where("userId", "==", userId)
    );
    const snap = await getDocs(q);
    const buckets = snap.docs.map(d => {
      const data = d.data() as CloudflareConfig;
      return {
        ...data,
        id: d.id,
        percentFull: (data.usedBytes / data.maxBytes) * 100
      };
    });

    // Sort: active first, then by percentFull descending
    return buckets.sort((a, b) => {
      if (a.isActive) return -1;
      if (b.isActive) return 1;
      return b.percentFull - a.percentFull;
    });
  } catch (error) {
    console.error("Error in getBucketUsageSummary:", error);
    return [];
  }
}

/**
 * Adds a new bucket configuration.
 */
export async function addBucket(
  config: Omit<CloudflareConfig, "id" | "usedBytes" | "isActive" | "isFull">,
  db: Firestore
): Promise<string | null> {
  try {
    // Check if any other active bucket exists
    const activeQ = query(
      collection(db, "cloudflareConfigs"),
      where("userId", "==", config.userId),
      where("isActive", "==", true),
      limit(1)
    );
    const activeSnap = await getDocs(activeQ);
    const isActive = activeSnap.empty;

    const docRef = await addDoc(collection(db, "cloudflareConfigs"), {
      ...config,
      usedBytes: 0,
      isFull: false,
      isActive,
      createdAt: new Date().toISOString()
    });

    return docRef.id;
  } catch (error) {
    console.error("Error in addBucket:", error);
    return null;
  }
}
