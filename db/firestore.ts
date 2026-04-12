import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  getFirestore,
  getDoc,
  arrayUnion,
  arrayRemove,
} from "firebase/firestore";
import { auth, db } from "../firebase/firebaseConfig";
import { getFunctions, httpsCallable } from "firebase/functions";
import type { MLAlert } from "../types/mlAlertTypes";
import { checkDeviceAccess } from "../utils/adminPortalAPI";

type DeviceDoc = {
  id: string;
  label?: string;
  sharedLabel?: string;
  name?: string;
  userId?: string | null;
  userIds?: string[];
  active?: boolean;
  createdAt?: any;
  lastSeen?: any;
  claimedAt?: any;
  timestamp?: any;
  [key: string]: any;
};

type UserDeviceProfileDoc = {
  id: string;
  label?: string;
  claimedAt?: any;
  updatedAt?: any;
  [key: string]: any;
};

export type AlertRetentionDays = 7 | 15 | 30 | 0;

function normalizeAlertRetentionDays(value: any): AlertRetentionDays {
  if (value === 0 || value === 7 || value === 15 || value === 30) {
    return value;
  }

  return 30;
}

function normalizeDeviceDoc(deviceId: string, data: Record<string, any>): DeviceDoc {
  return {
    id: deviceId,
    label: data.label || "",
    sharedLabel: data.label || "",
    name: data.name || "",
    userId: data.userId || null,
    userIds: Array.isArray(data.userIds) ? data.userIds : [],
    active: data.active !== false,
    createdAt: data.createdAt,
    lastSeen: data.lastSeen,
    claimedAt: data.claimedAt,
    ...data,
  };
}

function normalizeUserDeviceProfile(deviceId: string, data: Record<string, any>): UserDeviceProfileDoc {
  return {
    id: deviceId,
    label: data.label || "",
    claimedAt: data.claimedAt,
    updatedAt: data.updatedAt,
    ...data,
  };
}

function getUserDeviceProfileRef(userId: string, deviceId: string) {
  return doc(db, "users", userId, "devices", deviceId);
}

function applyUserDeviceProfile(
  device: DeviceDoc,
  userProfile?: Partial<UserDeviceProfileDoc>
): DeviceDoc {
  if (!userProfile) {
    return device;
  }

  const nextLabel = typeof userProfile.label === "string" && userProfile.label.trim() !== ""
    ? userProfile.label
    : device.label;

  return {
    ...device,
    label: nextLabel,
    userLabel: userProfile.label || null,
  };
}

function mergeDevicesWithUserProfiles(
  deviceDocs: DeviceDoc[],
  userProfiles: Map<string, UserDeviceProfileDoc>
) {
  return deviceDocs.map((device) => applyUserDeviceProfile(device, userProfiles.get(device.id)));
}

function userHasDeviceMembership(device: Partial<DeviceDoc>, userId: string) {
  const memberUserIds = Array.isArray(device.userIds) ? device.userIds : [];
  return memberUserIds.includes(userId) || device.userId === userId;
}

// Use the db instance from firebaseConfig instead of creating a new one
// const db = getFirestore();

/**
 * 🔍 Firestore Collections Structure:
 * 
 * - devices/{deviceId}
 *   - label: string (e.g., "Device A", "Device 1")
 *   - userId: string (owner)
 *   - createdAt: timestamp
 *   - lastSeen: timestamp
 * 
 * - devices/{deviceId}/readings/{readingId}
 *   - value: number
 *   - timestamp: timestamp
 * 
 * - devices/{deviceId}/alerts/{alertId}
 *   - type: string
 *   - message: string
 *   - createdAt: timestamp
 *
 * - sensors/{sensorId}
 *   - name: string
 *   - type: string (temperature, humidity, etc)
 *   - location: string
 *   - userId: string (owner)
 *   - unit?: string
 *   - description?: string
 *   - alertThreshold?: { min: number, max: number }
 *   - createdAt: timestamp
 *   - updatedAt: timestamp
 * 
 * - sensors/{sensorId}/readings/{readingId}
 *   - value: number
 *   - timestamp: timestamp
 * 
 * - users/{userId}
 *   - email: string
 *   - expoPushToken: string (for server-side notifications)
 *   - tokenUpdatedAt: timestamp
 */

// ✅ NOTE: Sensor data now comes from backend API (http://backend-ip:3000)
// Old Firestore sensor functions removed - use useSensorData hook instead

// ============================================
// 📱 DEVICE MANAGEMENT FUNCTIONS
// ============================================

/**
 * Listen to real-time device updates for current user
 */
export const listenToUserDevices = (callback: (devices: any[]) => void) => {
  const user = auth.currentUser;
  if (!user) {
    console.error("[Firestore] No user authenticated");
    callback([]); // Call with empty array immediately
    return () => {};
  }

  console.log("[Firestore] Setting up real-time listener for devices for user:", user.uid);

  const devicesRef = collection(db, "devices");
  const userDevicesRef = collection(db, "users", user.uid, "devices");
  let latestDevices: DeviceDoc[] = [];
  let latestUserProfiles = new Map<string, UserDeviceProfileDoc>();
  let hasDevicesSnapshot = false;
  let hasProfilesSnapshot = false;

  const emitMergedDevices = () => {
    if (!hasDevicesSnapshot || !hasProfilesSnapshot) {
      return;
    }

    const mergedDevices = mergeDevicesWithUserProfiles(latestDevices, latestUserProfiles);

    console.log("[Firestore] User devices found:", mergedDevices.length);
    if (mergedDevices.length === 0) {
      console.log("[Firestore] ⚠️ No devices found for userId:", user.uid);
    } else {
      console.log("[Firestore] ✅ Found devices:", mergedDevices.map((d) => `${d.id}:${d.label || d.name || 'Unnamed'}`).join(", "));
    }

    callback(mergedDevices);
  };
  
  console.log("[Firestore] Query created, attaching listener...");

  try {
    const unsubscribeDevices = onSnapshot(
      devicesRef,
      {
        next: (snapshot) => {
          console.log("[Firestore] ✅ Devices snapshot received! Size:", snapshot.size);
          latestDevices = snapshot.docs
            .map((doc) => {
              const normalized = normalizeDeviceDoc(doc.id, doc.data());
              console.log("[Firestore] Device doc:", doc.id, "userId:", normalized.userId, "userIds:", normalized.userIds);
              return normalized;
            })
            .filter((device) => userHasDeviceMembership(device, user.uid));

          hasDevicesSnapshot = true;
          emitMergedDevices();
        },
        error: (error) => {
          console.error("[Firestore] ❌ Devices listener error:", error);
          console.error("[Firestore] Error code:", error.code);
          console.error("[Firestore] Error message:", error.message);
          callback([]); // Call with empty array on error
        }
      }
    );

    const unsubscribeProfiles = onSnapshot(
      userDevicesRef,
      {
        next: (snapshot) => {
          latestUserProfiles = new Map(
            snapshot.docs.map((profileDoc) => {
              const normalizedProfile = normalizeUserDeviceProfile(profileDoc.id, profileDoc.data());
              return [profileDoc.id, normalizedProfile];
            })
          );

          hasProfilesSnapshot = true;
          emitMergedDevices();
        },
        error: (error) => {
          console.error("[Firestore] ❌ User device profile listener error:", error);
          callback([]);
        }
      }
    );

    console.log("[Firestore] Listener attached successfully");
    return () => {
      unsubscribeDevices();
      unsubscribeProfiles();
    };
  } catch (err) {
    console.error("[Firestore] Exception attaching listener:", err);
    callback([]);
    return () => {};
  }
};

/**
 * Get all devices for current user (one-time fetch)
 */
export async function getUserDevices() {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error("User not authenticated");

  try {
    const [devicesSnapshot, userProfilesSnapshot] = await Promise.all([
      getDocs(collection(db, "devices")),
      getDocs(collection(db, "users", userId, "devices")),
    ]);

    const userProfiles = new Map(
      userProfilesSnapshot.docs.map((profileDoc) => [
        profileDoc.id,
        normalizeUserDeviceProfile(profileDoc.id, profileDoc.data()),
      ])
    );

    const devices = devicesSnapshot.docs
      .map((doc) => normalizeDeviceDoc(doc.id, doc.data()))
      .filter((device) => userHasDeviceMembership(device, userId));

    return mergeDevicesWithUserProfiles(devices, userProfiles);
  } catch (error) {
    console.error("[Firestore] Error getting devices:", error);
    throw error;
  }
}

/**
 * Add a new device for current user
 * Remote devices will call this or create it directly
 */
export async function addDevice(deviceData: {
  label: string;
  deviceId?: string;
}) {
  const user = auth.currentUser;
  if (!user) throw new Error("No user authenticated");

  try {
    // If no deviceId provided, use auto-generated document ID
    const finalDeviceId = deviceData.deviceId || undefined;
    
    const deviceDoc = {
      label: deviceData.label,
      userId: user.uid,
      userIds: [user.uid], // Initialize shared user array
      createdAt: serverTimestamp(),
      lastSeen: serverTimestamp(),
    };

    let docRef;
    if (finalDeviceId) {
      // Create or overwrite with specific device ID
      await setDoc(doc(db, "devices", finalDeviceId), deviceDoc, { merge: true });
      await setDoc(getUserDeviceProfileRef(user.uid, finalDeviceId), {
        label: deviceData.label,
        claimedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      docRef = { id: finalDeviceId };
    } else {
      // Auto-generate device ID
      docRef = await addDoc(collection(db, "devices"), deviceDoc);
      await setDoc(getUserDeviceProfileRef(user.uid, docRef.id), {
        label: deviceData.label,
        claimedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }

    console.log("[Firestore] Device added:", docRef.id);
    return docRef.id;
  } catch (error) {
    console.error("[Firestore] Error adding device:", error);
    throw error;
  }
}

/**
 * Update device label
 */
export async function updateDeviceLabel(
  deviceId: string,
  label: string
) {
  try {
    const userId = auth.currentUser?.uid;
    if (!userId) throw new Error("No user authenticated");

    await setDoc(getUserDeviceProfileRef(userId, deviceId), {
      label: label,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    console.log("[Firestore] Device label updated:", deviceId);
  } catch (error) {
    console.error("[Firestore] Error updating device label:", error);
    throw error;
  }
}

/**
 * Claim an existing device (add userId to it)
 */
export async function claimExistingDevice(deviceId: string) {
  const user = auth.currentUser;
  if (!user) throw new Error("No user authenticated");

  try {
    const deviceSnapshot = await getDoc(doc(db, "devices", deviceId));
    const deviceData = deviceSnapshot.data() || {};

    await updateDoc(doc(db, "devices", deviceId), {
      userId: user.uid,
      userIds: arrayUnion(user.uid),
      lastSeen: serverTimestamp(),
      claimedAt: serverTimestamp(),
    });

    await setDoc(getUserDeviceProfileRef(user.uid, deviceId), {
      label: deviceData.label || deviceData.name || deviceId,
      claimedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });

    console.log("[Firestore] Device claimed:", deviceId);
    return deviceId;
  } catch (error) {
    console.error("[Firestore] Error claiming device:", error);
    throw error;
  }
}

/**
 * Delete a device
 */
export async function deleteDevice(deviceId: string) {
  try {
    await deleteDoc(doc(db, "devices", deviceId));
    console.log("[Firestore] Device deleted:", deviceId);
  } catch (error) {
    console.error("[Firestore] Error deleting device:", error);
    throw error;
  }
}

/**
 * Add device reading/data point
 */
export async function addDeviceReading(
  deviceId: string,
  reading: {
    value: number;
    timestamp?: Date;
  }
) {
  try {
    const docRef = await addDoc(
      collection(db, "devices", deviceId, "readings"),
      {
        ...reading,
        timestamp: reading.timestamp || serverTimestamp(),
      }
    );
    console.log("[Firestore] Device reading added:", docRef.id);
    return docRef.id;
  } catch (error) {
    console.error("[Firestore] Error adding device reading:", error);
    throw error;
  }
}

/**
 * Listen to device readings in real-time
 */
export async function listenToDeviceReadings(
  deviceId: string,
  callback: (readings: any[]) => void,
  limit: number = 100
) {
  try {
    const userId = auth.currentUser?.uid;
    if (!userId) {
      console.error("[Firestore] No authenticated user");
      return () => {};
    }

    // 🔐 Skip access control check on every poll - already validated when device was claimed
    // const { hasAccess, reason } = await checkDeviceAccess(userId, deviceId);
    // if (!hasAccess) {
    //   console.warn(`[Access Control] User ${userId} denied access to device ${deviceId}: ${reason}`);
    //   callback([]);
    //   return () => {};
    // }

    const q = query(
      collection(db, "devices", deviceId, "readings")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const readings = (snapshot.docs
        .map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as Array<{ id: string; timestamp?: any; [key: string]: any }>)
        .sort((a, b) => {
          const timeA = a.timestamp?.toMillis?.() || 0;
          const timeB = b.timestamp?.toMillis?.() || 0;
          return timeB - timeA;
        })
        .slice(0, limit);

      callback(readings);
    }, (error: any) => {
      // Silently ignore permission errors (happens when user logs out)
      if (error?.code === "permission-denied") {
        console.log("[Firestore] Readings listener: Permission denied (user may be logged out)");
        return;
      }
      console.error("[Firestore] Readings listener error:", error);
    });

    return unsubscribe;
  } catch (error) {
    console.error("[Firestore] Error setting up readings listener:", error);
    return () => {};
  }
}

/**
 * Get ALL devices from Firestore (for device selection)
 * Updated for shared device access - looks for devices with userIds arrays
 */
export async function getAllAvailableDevices() {
  try {
    console.log("[Firestore] Querying all devices...");
    
    // Get all devices (don't filter by active in query as some devices might not have this field yet)
    const querySnapshot = await getDocs(collection(db, "devices"));
    
    const devices = querySnapshot.docs.map((doc) => {
      return normalizeDeviceDoc(doc.id, doc.data());
    }).filter(device => {
      // Filter active devices and devices with proper structure
      const isActive = device.active !== false;
      const hasLabel = Boolean(device.label || device.name);
      console.log(`[Firestore] Device ${device.id}: label="${device.label}", active=${isActive}, hasLabel=${hasLabel}`);
      return isActive && hasLabel;
    });
    
    console.log("[Firestore] Found available devices:", devices.length);
    devices.forEach(device => {
      console.log(`[Firestore] Available device ${device.id}: label="${device.label}", userIds=${JSON.stringify(device.userIds)}, userId="${device.userId || 'null'}"`);
    });
    
    return devices;
  } catch (error) {
    console.error("[Firestore] Error getting all devices:", error);
    throw error;
  }
}

/**
 * Get devices available for current user to claim (shared device access)
 * Returns devices where user is not already in the userIds array
 */
export async function getAvailableDevicesForUser() {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error("User not authenticated");

  try {
    console.log("[Firestore] Getting available devices for user:", userId);
    const allDevices = await getAllAvailableDevices();
    console.log("[Firestore] All active devices from Firestore:", allDevices.length);
    
    // Filter devices based on shared access logic
    const available = allDevices.filter((device) => {
      // Exclude test devices
      const label = (device.label || "").toLowerCase();
      const name = (device.name || "").toLowerCase();
      if (label.includes("test device") || name.includes("test")) {
        console.log("[Firestore] Excluding test device:", device.id, device.label);
        return false;
      }

      // Must have valid label/name and id
      if (!(device.label || device.name) || !device.id) {
        console.log("[Firestore] Excluding device with missing label/id:", device.id);
        return false;
      }

      // Check membership using both shared and legacy fields.
      const userIds = Array.isArray(device.userIds) ? device.userIds : [];
      const alreadyClaimed = userHasDeviceMembership(device, userId);
      
      console.log(`[Firestore] Device ${device.id} (${device.label}): userId=${device.userId || 'null'}, userIds=[${userIds.join(', ')}], alreadyClaimed=${alreadyClaimed}`);
      
      // Available if user hasn't claimed it yet
      return !alreadyClaimed;
    });

    console.log("[Firestore] Available devices for user to claim:", available.length);
    return available;
  } catch (error) {
    console.error("[Firestore] Error getting available devices:", error);
    throw error;
  }
}

/**
 * Claim a device for the current user
 * Multiple users can claim the same device (shared access)
 */
export async function claimDevice(deviceId: string) {
  const user = auth.currentUser;
  if (!user) throw new Error("No user authenticated");

  try {
    const deviceSnapshot = await getDoc(doc(db, "devices", deviceId));
    const deviceData = deviceSnapshot.data() || {};

    await updateDoc(doc(db, "devices", deviceId), {
      // Keep legacy userId for backward compatibility (first user or most recent)
      userId: user.uid,
      // Add user to shared access array (multiple users can claim same device)
      userIds: arrayUnion(user.uid),
      claimedAt: serverTimestamp(),
    });

    await setDoc(getUserDeviceProfileRef(user.uid, deviceId), {
      label: deviceData.label || deviceData.name || deviceId,
      claimedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });

    console.log("[Firestore] Device claimed:", deviceId, "by user:", user.uid);
    return deviceId;
  } catch (error) {
    console.error("[Firestore] Error claiming device:", error);
    throw error;
  }
}

/**
 * Unclaim a device (remove current user from shared access)
 * Device remains available for other users who have claimed it
 */
export async function unclaimDevice(deviceId: string) {
  const user = auth.currentUser;
  if (!user) throw new Error("No user authenticated");

  try {
    // Remove user from shared access array
    await updateDoc(doc(db, "devices", deviceId), {
      userIds: arrayRemove(user.uid),
    });

    await deleteDoc(getUserDeviceProfileRef(user.uid, deviceId));
    
    // Keep legacy userId aligned with one remaining member when possible.
    const deviceDoc = await getDoc(doc(db, "devices", deviceId));
    const deviceData = deviceDoc.data();
    if (deviceData?.userId === user.uid) {
      const remainingUserIds = Array.isArray(deviceData?.userIds)
        ? deviceData.userIds.filter((memberId: string) => memberId !== user.uid)
        : [];

      await updateDoc(doc(db, "devices", deviceId), {
        userId: remainingUserIds[0] || null,
      });
    }
    
    console.log("[Firestore] Device unclaimed:", deviceId, "by user:", user.uid);
    return deviceId;
  } catch (error) {
    console.error("[Firestore] Error unclaiming device:", error);
    throw error;
  }
}

/**
 * Create test unassigned devices via Cloud Function
 * This uses admin SDK on the backend to bypass security rules
 */
export async function createTestDevices() {
  try {
    const functions = getFunctions();
    const createTestDevicesFunction = httpsCallable(functions, "createTestDevices");
    
    const result = await createTestDevicesFunction({});
    console.log("[Firestore] Test devices created via Cloud Function:", result.data);
    return (result.data as { created?: string[] }).created || [];
  } catch (error) {
    console.error("[Firestore] Error calling createTestDevices Cloud Function:", error);
    throw error;
  }
}

/**
 * Listen to all alerts from owned devices
 */
export function listenToUserAlerts(callback: (alerts: any[]) => void) {
  try {
    const user = auth.currentUser;
    if (!user) throw new Error("No user authenticated");

    const unsubscribes: (() => void)[] = [];

    const devicesQuery = collection(db, "devices");

    const unsubscribeDevices = onSnapshot(devicesQuery, (devicesSnapshot) => {
      // Unsubscribe from previous alert listeners
      unsubscribes.forEach(unsub => unsub());
      unsubscribes.length = 0;

      const memberDevices = devicesSnapshot.docs
        .map((deviceDoc) => normalizeDeviceDoc(deviceDoc.id, deviceDoc.data()))
        .filter((device) => userHasDeviceMembership(device, user.uid));

      const allAlerts: any[] = [];
      let completedListeners = 0;
      const totalDevices = memberDevices.length;

      if (totalDevices === 0) {
        callback([]);
        return;
      }

      // For each device, listen to its alerts
      memberDevices.forEach((deviceDoc) => {
        const alertsRef = collection(db, "devices", deviceDoc.id, "alerts");
        
        const unsubscribeAlerts = onSnapshot(alertsRef, (alertsSnapshot) => {
          // Clear previous alerts for this device
          const deviceAlerts = allAlerts.filter(alert => alert.deviceId !== deviceDoc.id);

          // Add new alerts from this device
          alertsSnapshot.docs.forEach((alertDoc) => {
            deviceAlerts.push({
              id: alertDoc.id,
              deviceId: deviceDoc.id,
              deviceLabel: deviceDoc.name || deviceDoc.label,
              ...alertDoc.data(),
            });
          });

          // Update allAlerts with this device's alerts
          allAlerts.length = 0;
          memberDevices.forEach((device) => {
            const thisDeviceAlerts = deviceAlerts.filter(a => a.deviceId === device.id);
            allAlerts.push(...thisDeviceAlerts);
          });

          // Sort by timestamp descending (latest first)
          allAlerts.sort((a, b) => {
            const timeA = a.timestamp?.toMillis?.() || 0;
            const timeB = b.timestamp?.toMillis?.() || 0;
            return timeB - timeA;
          });

          callback(allAlerts);
        }, (error) => {
          // Silently handle permission denied errors
          if (error.code !== "permission-denied") {
            console.error("[Firestore] Error listening to alerts:", error);
          }
        });

        unsubscribes.push(unsubscribeAlerts);
      });
    });

    return () => {
      unsubscribeDevices();
      unsubscribes.forEach(unsub => unsub());
    };
  } catch (error) {
    console.error("[Firestore] Error in listenToUserAlerts:", error);
    return () => {};
  }
}

/**
 * Update the rating for a specific alert
 */
export async function updateAlertRating(deviceId: string, alertId: string, rating: number, accuracy: boolean) {
  try {
    const alertRef = doc(db, "devices", deviceId, "alerts", alertId);
    await updateDoc(alertRef, {
      accuracy: accuracy,
      rating: rating,
      ratedAt: serverTimestamp(),
    });
    console.log("[Firestore] Alert feedback updated - Accuracy:", accuracy, "Rating:", rating);
  } catch (error) {
    console.error("[Firestore] Error updating alert feedback:", error);
    throw error;
  }
}

/**
 * Delete test devices from Firestore
 */
export async function deleteTestDevices() {
  try {
    const user = auth.currentUser;
    if (!user) throw new Error("User not authenticated");

    // Combine owned devices and unassigned devices so the cleanup works
    // with restrictive security rules.
    const allDevicesSnapshot = await getDocs(collection(db, "devices"));

    const combinedDocs = new Map<string, any>();
    allDevicesSnapshot.docs
      .filter((d) => userHasDeviceMembership(normalizeDeviceDoc(d.id, d.data()), user.uid))
      .forEach((d) => combinedDocs.set(d.id, d));

    let deletedCount = 0;

    for (const docSnapshot of combinedDocs.values()) {
      const device = docSnapshot.data();
      const deviceLabel = device.label || "";
      const deviceName = device.name || "";
      
      // Delete devices with "Test Device" in label
      if (deviceLabel.toLowerCase().includes("test device")) {
        await deleteDoc(doc(db, "devices", docSnapshot.id));
        console.log("[Firestore] Deleted test device:", docSnapshot.id, deviceLabel);
        deletedCount++;
      }
    }

    console.log("[Firestore] Cleanup complete - Deleted", deletedCount, "test devices");
    return deletedCount;
  } catch (error) {
    console.error("[Firestore] Error deleting test devices:", error);
    throw error;
  }
}

// ============================================
// 🤖 ML ALERT MANAGEMENT FUNCTIONS
// ============================================

/**
 * Add ML alert from remote device to Firestore
 * Called by Cloud Function after receiving alert from remote device
 */
export async function addMLAlert(
  deviceId: string,
  deviceIdentifier: string,
  userId: string,
  alertData: {
    notificationType: string;
    detectedObjects: string[];
    riskLabel: string;
    predictedRisk: string;
    description: string[];
    screenshots: string[];
    timestamp?: number;
    modelVersion?: string;
    confidenceScore?: number;
    additionalData?: Record<string, any>;
  }
): Promise<string> {
  try {
    const alertRef = await addDoc(
      collection(db, "devices", deviceId, "alerts"),
      {
        deviceId,
        deviceIdentifier,
        userId,
        notificationType: alertData.notificationType,
        detectedObjects: alertData.detectedObjects,
        riskLabel: alertData.riskLabel,
        predictedRisk: alertData.predictedRisk,
        description: alertData.description,
        screenshots: alertData.screenshots,
        timestamp: serverTimestamp(),
        alertGeneratedAt: alertData.timestamp || Date.now(),
        modelVersion: alertData.modelVersion || null,
        confidenceScore: alertData.confidenceScore || null,
        acknowledged: false,
        rating: null,
        ratingAccuracy: null,
        additionalData: alertData.additionalData || {},
      }
    );

    console.log("[Firestore] ML alert stored:", alertRef.id);
    return alertRef.id;
  } catch (error) {
    console.error("[Firestore] Error adding ML alert:", error);
    throw error;
  }
}

/**
 * Get ML alerts for a device
 */
export async function getDeviceMLAlerts(
  deviceId: string,
  limit: number = 50
): Promise<MLAlert[]> {
  try {
    const q = query(
      collection(db, "devices", deviceId, "alerts")
    );

    const snapshot = await getDocs(q);
    const alerts = snapshot.docs
      .map((doc) => ({
        id: doc.id,
        ...doc.data(),
      } as MLAlert))
      .sort((a, b) => {
        const timeA = a.timestamp?.toMillis?.() || 0;
        const timeB = b.timestamp?.toMillis?.() || 0;
        return timeB - timeA;
      })
      .slice(0, limit);

    return alerts;
  } catch (error) {
    console.error("[Firestore] Error getting ML alerts:", error);
    throw error;
  }
}

/**
 * Listen to ML alerts in real-time for a device
 */
export function listenToDeviceMLAlerts(
  deviceId: string,
  callback: (alerts: MLAlert[]) => void,
  limit: number = 50
): () => void {
  try {
    const q = query(
      collection(db, "devices", deviceId, "alerts")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const alerts = snapshot.docs
        .map((doc) => ({
          id: doc.id,
          ...doc.data(),
        } as MLAlert))
        .sort((a, b) => {
          const timeA = a.timestamp?.toMillis?.() || 0;
          const timeB = b.timestamp?.toMillis?.() || 0;
          return timeB - timeA;
        })
        .slice(0, limit);

      callback(alerts);
    }, (error: any) => {
      if (error?.code === "permission-denied") {
        console.log("[Firestore] ML alerts listener: Permission denied (user may be logged out)");
        return;
      }
      console.error("[Firestore] ML alerts listener error:", error);
    });

    return unsubscribe;
  } catch (error) {
    console.error("[Firestore] Error setting up ML alerts listener:", error);
    return () => {};
  }
}

/**
 * Get all ML alerts from all user's devices
 */
export async function getUserMLAlerts(limit: number = 100): Promise<MLAlert[]> {
  try {
    const user = auth.currentUser;
    if (!user) throw new Error("User not authenticated");

    console.log("[Firestore] getUserMLAlerts: Fetching for user", user.uid);

    // Alerts are stored in users/{userId}/mlAlerts collection (by Cloud Function)
    // NOT in devices/{deviceId}/alerts
    const q = query(
      collection(db, "users", user.uid, "mlAlerts")
    );

    const snapshot = await getDocs(q);
    const allAlerts = snapshot.docs
      .map((doc) => ({
        id: doc.id,
        ...doc.data(),
      } as MLAlert))
      .sort((a, b) => {
        const timeA = a.timestamp?.toMillis?.() || 0;
        const timeB = b.timestamp?.toMillis?.() || 0;
        return timeB - timeA;
      })
      .slice(0, limit);

    console.log("[Firestore] getUserMLAlerts: Found", allAlerts.length, "alerts in users collection");
    return allAlerts;
  } catch (error) {
    // Don't log auth errors as ERROR - they're expected during logout
    if (error instanceof Error && error.message === "User not authenticated") {
      console.log("[Firestore] getUserMLAlerts: User not authenticated (expected during logout)");
    } else {
      console.error("[Firestore] Error getting user ML alerts:", error);
    }
    throw error;
  }
}

/**
 * Listen to ML alerts from all user devices in real-time
 */
export function listenToUserMLAlerts(callback: (alerts: MLAlert[]) => void): () => void {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.error("[Firestore] No user authenticated for ML alerts");
      callback([]); // Call with empty array immediately
      return () => {};
    }

    console.log("[Firestore] Setting up listener for user ML alerts from users/{userId}/mlAlerts");

    // Listen to user-level mlAlerts collection (from Cloud Functions)
    const q = query(
      collection(db, "users", user.uid, "mlAlerts")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const alerts = snapshot.docs
        .map((doc) => ({
          id: doc.id,
          ...doc.data(),
        } as MLAlert))
        .sort((a, b) => {
          const timeA = a.timestamp?.toMillis?.() || 0;
          const timeB = b.timestamp?.toMillis?.() || 0;
          return timeB - timeA;
        });

      console.log("[Firestore] User ML alerts snapshot received:", alerts.length, "alerts");
      callback(alerts);
    }, (error: any) => {
      if (error?.code === "permission-denied") {
        console.warn("[Firestore] ML alerts listener: Permission denied");
        callback([]); // Call with empty array
        return;
      }
      console.error("[Firestore] ML alerts listener error:", error);
      callback([]); // Call with empty array on error
    });

    return unsubscribe;
  } catch (error) {
    console.error("[Firestore] Error setting up user ML alerts listener:", error);
    callback([]); // Call with empty array
    return () => {};
  }
}

/**
 * Get the current user's alert retention setting
 */
export async function getUserAlertRetentionDays(): Promise<AlertRetentionDays> {
  const user = auth.currentUser;
  if (!user) throw new Error("User not authenticated");

  const userRef = doc(db, "users", user.uid);
  const userSnapshot = await getDoc(userRef);

  return normalizeAlertRetentionDays(userSnapshot.data()?.alertRetentionDays);
}

/**
 * Save the current user's alert retention setting
 */
export async function saveUserAlertRetentionDays(days: AlertRetentionDays): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error("User not authenticated");

  await setDoc(
    doc(db, "users", user.uid),
    {
      alertRetentionDays: normalizeAlertRetentionDays(days),
      alertRetentionUpdatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Update ML alert with user feedback/rating
 */
export async function updateMLAlertRating(
  alertId: string,
  rating: number,
  isAccurate?: boolean,
  notes?: string
): Promise<void> {
  try {
    const user = auth.currentUser;
    if (!user) throw new Error("User not authenticated");

    // Update in user-level mlAlerts collection
    const alertRef = doc(db, "users", user.uid, "mlAlerts", alertId);
    
    // Check if document exists first
    const docSnapshot = await getDoc(alertRef);
    if (!docSnapshot.exists()) {
      console.warn("[Firestore] Alert document not found:", alertId);
      return;
    }

    await updateDoc(alertRef, {
      userRating: Math.min(10, Math.max(1, rating)), // Clamp 1-10
      ratingAccuracy: isAccurate !== undefined ? isAccurate : null,
      ratingNotes: notes || null,
      ratedAt: serverTimestamp(),
      acknowledged: true,
      acknowledgedAt: serverTimestamp(),
    });

    console.log("[Firestore] ML alert rating updated:", alertId);
  } catch (error) {
    console.error("[Firestore] Error updating ML alert rating:", error);
    throw error;
  }
}

/**
 * Acknowledge an ML alert
 */
export async function acknowledgeMLAlert(
  deviceId: string,
  alertId: string
): Promise<void> {
  try {
    const user = auth.currentUser;
    if (!user) throw new Error("User not authenticated");

    await updateDoc(
      doc(db, "devices", deviceId, "alerts", alertId),
      {
        acknowledged: true,
        acknowledgedBy: user.uid,
        acknowledgedAt: serverTimestamp(),
      }
    );

    console.log("[Firestore] ML alert acknowledged:", alertId);
  } catch (error) {
    console.error("[Firestore] Error acknowledging ML alert:", error);
    throw error;
  }
}

/**
 * Delete an old ML alert
 */
export async function deleteMLAlert(
  _deviceId: string,
  _alertId: string
): Promise<void> {
  // Alerts are preserved permanently in Firestore.
  // "Deletion" is handled locally on each device: the app filters out alerts
  // older than the user's chosen retention period (7 / 15 / 30 days, or never)
  // and re-applies that filter once a day. No Firestore documents are removed.
  console.log("[Firestore] deleteMLAlert: no-op — backend data preserved, local retention filter applies.");
}

/**
 * 🔍 Debug function - Check raw Firestore collections
 */
export async function debugCheckAlertsCollections() {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.error("[Debug] No user authenticated");
      return;
    }

    console.log("[Debug] Checking all alerts collections for user:", user.uid);

    // Get all user devices
    const userDevices = await getUserDevices();
    console.log("[Debug] User devices:", userDevices.map(d => ({ id: d.id, label: d.label })));

    // Check each device's alerts collection
    for (const device of userDevices) {
      console.log(`\n[Debug] Checking alerts for device: ${device.id} (${device.label})`);
      
      const alertsRef = collection(db, "devices", device.id, "alerts");
      const snapshot = await getDocs(alertsRef);
      
      console.log(`[Debug] Raw collection size: ${snapshot.docs.length} documents`);
      
      snapshot.docs.forEach((doc, index) => {
        console.log(`[Debug]   Alert ${index + 1}:`, {
          id: doc.id,
          ...doc.data(),
        });
      });
    }

    // Also check users/{userId}/mlAlerts collection
    console.log(`\n[Debug] Checking users/${user.uid}/mlAlerts collection`);
    const userAlertsRef = collection(db, "users", user.uid, "mlAlerts");
    const userAlertsSnapshot = await getDocs(userAlertsRef);
    console.log(`[Debug] User mlAlerts collection size: ${userAlertsSnapshot.docs.length} documents`);
    userAlertsSnapshot.docs.forEach((doc, index) => {
      console.log(`[Debug]   User Alert ${index + 1}:`, {
        id: doc.id,
        ...doc.data(),
      });
    });

  } catch (error) {
    console.error("[Debug] Error checking collections:", error);
  }
}

