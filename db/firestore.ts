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
import AsyncStorage from "@react-native-async-storage/async-storage";
import { auth, db } from "../firebase/firebaseConfig";
import { getFunctions, httpsCallable } from "firebase/functions";
import type { MLAlert } from "../types/mlAlertTypes";
import { checkDeviceAccess } from "../utils/adminPortalAPI";
import { io, Socket } from "socket.io-client";

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

const BASE_API_URL = process.env.EXPO_PUBLIC_API_URL || "http://13.205.201.82";
const ALERT_API_ROOT = (process.env.EXPO_PUBLIC_ALERT_API_URL || `${BASE_API_URL}/alert-api`).replace(/\/$/, "");
const ALERT_API_BASE = `${ALERT_API_ROOT}/api`;
const ALERT_SOCKET_PATH = process.env.EXPO_PUBLIC_ALERT_SOCKET_PATH || "/alert-api/socket.io";
const ALERT_RETENTION_STORAGE_KEY_PREFIX = "alertRetentionDays:";
const LEGACY_ALERT_RETENTION_STORAGE_KEY = "alertRetentionDays";
const LOCAL_DELETED_ALERTS_STORAGE_KEY_PREFIX = "deletedMlAlerts:";
const DEVICE_POLL_INTERVAL_MS = 30000;
const ALERT_POLL_INTERVAL_MS = 30000;
const RATE_LIMIT_BACKOFF_MS = 180000;

const localDeviceLabelCache = new Map<string, Record<string, string>>();
const localDeletedAlertIdsCache = new Map<string, Set<string>>();

function normalizeAlertImageUrl(value: unknown, deviceId?: string): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const isLoopbackHost = (host: string) => {
    const normalized = host.toLowerCase();
    return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
  };

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (!isLoopbackHost(parsed.hostname)) {
        return parsed.toString();
      }

      const publicOrigin = new URL(BASE_API_URL).origin;
      return `${publicOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return trimmed;
    }
  }

  if (trimmed.startsWith('/alert-api/')) {
    return `${BASE_API_URL.replace(/\/$/, "")}${trimmed}`;
  }

  if (trimmed.startsWith('/uploads/')) {
    return `${ALERT_API_ROOT}${trimmed}`;
  }

  if (trimmed.startsWith('/')) {
    return `${BASE_API_URL.replace(/\/$/, "")}${trimmed}`;
  }

  if (trimmed.startsWith('uploads/')) {
    return `${ALERT_API_ROOT}/${trimmed.replace(/^\/+/, "")}`;
  }

  if (!trimmed.includes('/')) {
    const safeDeviceId = encodeURIComponent(String(deviceId || 'unknown-device'));
    const encodedName = encodeURIComponent(trimmed);
    return `${ALERT_API_ROOT}/uploads/alerts/${safeDeviceId}/${encodedName}`;
  }

  return trimmed;
}

function getLocalDeviceLabelsStorageKey(userId: string) {
  return `local_device_labels:${userId}`;
}

async function loadLocalDeviceLabels(userId: string): Promise<Record<string, string>> {
  if (localDeviceLabelCache.has(userId)) {
    return localDeviceLabelCache.get(userId)!;
  }

  try {
    const raw = await AsyncStorage.getItem(getLocalDeviceLabelsStorageKey(userId));
    const parsed = raw ? JSON.parse(raw) : {};
    const labels = (parsed && typeof parsed === "object") ? parsed as Record<string, string> : {};
    localDeviceLabelCache.set(userId, labels);
    return labels;
  } catch {
    const fallback: Record<string, string> = {};
    localDeviceLabelCache.set(userId, fallback);
    return fallback;
  }
}

async function saveLocalDeviceLabels(userId: string, labels: Record<string, string>): Promise<void> {
  localDeviceLabelCache.set(userId, labels);
  await AsyncStorage.setItem(getLocalDeviceLabelsStorageKey(userId), JSON.stringify(labels));
}

async function applyLocalLabelsToDevices(userId: string, devices: DeviceDoc[]): Promise<DeviceDoc[]> {
  const labels = await loadLocalDeviceLabels(userId);
  return devices.map((device) => {
    const localLabel = labels[device.id];
    if (!localLabel) return device;
    return {
      ...device,
      label: localLabel,
      userLabel: localLabel,
    };
  });
}

function getDeletedAlertsStorageKey(userId: string) {
  return `${LOCAL_DELETED_ALERTS_STORAGE_KEY_PREFIX}${userId}`;
}

async function loadDeletedAlertIds(userId: string): Promise<Set<string>> {
  if (localDeletedAlertIdsCache.has(userId)) {
    return localDeletedAlertIdsCache.get(userId)!;
  }

  try {
    const raw = await AsyncStorage.getItem(getDeletedAlertsStorageKey(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    const set = new Set<string>(Array.isArray(parsed) ? parsed.map((value) => String(value)) : []);
    localDeletedAlertIdsCache.set(userId, set);
    return set;
  } catch {
    const fallback = new Set<string>();
    localDeletedAlertIdsCache.set(userId, fallback);
    return fallback;
  }
}

async function saveDeletedAlertIds(userId: string, ids: Set<string>): Promise<void> {
  localDeletedAlertIdsCache.set(userId, ids);
  await AsyncStorage.setItem(getDeletedAlertsStorageKey(userId), JSON.stringify(Array.from(ids)));
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== undefined && item !== null).map((item) => String(item));
  }

  if (value === undefined || value === null || value === "") {
    return [];
  }

  return [String(value)];
}

function toMillis(value: unknown): number {
  if (!value) return 0;

  if (typeof value === "number") return value;

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  if (typeof value === "object" && value !== null && "toMillis" in value && typeof (value as any).toMillis === "function") {
    return (value as any).toMillis();
  }

  return 0;
}

function createPseudoTimestamp(value: unknown) {
  const millis = toMillis(value);
  return {
    toMillis: () => millis,
    toDate: () => new Date(millis),
  };
}

function isRateLimitError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error || "")).toLowerCase();
  return message.includes("too many requests") || message.includes("429");
}

async function getAuthHeader(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) return {};
  try {
    const token = await user.getIdToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

async function alertApiRequest<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const authHeader = await getAuthHeader();
  const response = await fetch(`${ALERT_API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeader,
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let payload: any = {};

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    const errorMessage = payload?.reason || payload?.error || payload?.message || `Alert API request failed: ${response.status}`;
    throw new Error(errorMessage);
  }

  return (payload ?? {}) as T;
}

function mapEc2AlertToMLAlert(input: any, fallbackUserId: string): MLAlert {
  const generatedAt = toMillis(input?.alertGeneratedAt || input?.alert_generated_at || input?.timestamp || input?.created_at);
  const rawUserRating = input?.userRating ?? input?.user_rating ?? input?.ratingScore ?? input?.rating_score ?? input?.rating ?? null;
  const parsedUserRating =
    rawUserRating === null || rawUserRating === undefined || rawUserRating === ""
      ? null
      : Number(rawUserRating);
  const normalizedUserRating = Number.isFinite(parsedUserRating)
    ? Math.min(10, Math.max(1, parsedUserRating))
    : null;
  const normalizedAccuracy =
    input?.ratingAccuracy ??
    input?.rating_accuracy ??
    input?.isAccurate ??
    input?.is_accurate ??
    null;
  const normalizedScreenshots = asStringArray(input?.screenshots || input?.screenshot)
    .map((item) => normalizeAlertImageUrl(item, input?.deviceId || input?.device_id))
    .filter((item): item is string => Boolean(item));

  return {
    id: String(input?.id || input?.alertId || ""),
    deviceId: String(input?.deviceId || input?.device_id || ""),
    deviceIdentifier: String(input?.deviceIdentifier || input?.device_identifier || input?.deviceId || "Unknown Device"),
    userId: String(input?.userId || input?.user_id || fallbackUserId),
    notificationType: String(input?.notificationType || input?.notification_type || "Alert"),
    detectedObjects: asStringArray(input?.detectedObjects || input?.detected_objects || input?.detectedCondition || input?.detected_condition),
    riskLabel: String(input?.riskLabel || input?.risk_label || "Unknown"),
    predictedRisk: String(input?.predictedRisk || input?.predicted_risk || input?.riskLabel || input?.risk_label || "Unknown"),
    description: asStringArray(input?.description),
    screenshots: normalizedScreenshots,
    timestamp: createPseudoTimestamp(input?.timestamp || input?.created_at || generatedAt),
    alertGeneratedAt: generatedAt,
    modelVersion: input?.modelVersion || input?.model_version,
    confidenceScore: input?.confidenceScore ?? input?.confidence_score ?? null,
    acknowledged: input?.acknowledged === true,
    userRating: normalizedUserRating,
    ratingAccuracy: normalizedAccuracy,
    additionalData: input?.additionalData || input?.additional_data || {},
  };
}

async function fetchEc2UserAlerts(userId: string, sinceMillis?: number, limit = 200): Promise<MLAlert[]> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));

  if (sinceMillis && sinceMillis > 0) {
    params.set("since", new Date(sinceMillis).toISOString());
  }

  const result = await alertApiRequest<{ alerts?: any[] }>(`/alerts/user/${encodeURIComponent(userId)}?${params.toString()}`);
  const alerts = Array.isArray(result?.alerts) ? result.alerts : [];

  return alerts
    .map((item) => mapEc2AlertToMLAlert(item, userId))
    .sort((a, b) => {
      const aTime = a.alertGeneratedAt || a.timestamp?.toMillis?.() || 0;
      const bTime = b.alertGeneratedAt || b.timestamp?.toMillis?.() || 0;
      return bTime - aTime;
    });
}

function mapEc2DeviceToDeviceDoc(input: any, fallbackUserId: string | null = null): DeviceDoc {
  const id = String(input?.id || input?.deviceId || input?.device_id || "");
  const userId = input?.userId || input?.user_id || fallbackUserId || null;
  const userIds = Array.isArray(input?.userIds)
    ? input.userIds.map((value: any) => String(value))
    : (userId ? [String(userId)] : []);

  return {
    id,
    label: String(input?.label || input?.userLabel || input?.deviceName || input?.name || input?.location || id),
    sharedLabel: String(input?.label || input?.deviceName || input?.name || input?.location || id),
    name: String(input?.name || input?.deviceName || input?.location || id),
    userId: userId ? String(userId) : null,
    userIds,
    active: input?.active !== false,
    createdAt: input?.createdAt || input?.created_at || null,
    lastSeen: input?.lastSeen || input?.last_seen || null,
    claimedAt: input?.claimedAt || input?.claimed_at || input?.added_at || null,
    userLabel: input?.userLabel || input?.user_label || null,
    location: input?.location || null,
    ...input,
  };
}

async function fetchEc2UserDevices(userId: string): Promise<DeviceDoc[]> {
  const result = await alertApiRequest<{ devices?: any[] }>("/devices/user");
  const devices = Array.isArray(result?.devices) ? result.devices : [];

  const mapped = devices.map((item) => mapEc2DeviceToDeviceDoc(item, userId));
  return applyLocalLabelsToDevices(userId, mapped);
}

async function fetchEc2AvailableDevices(userId: string): Promise<DeviceDoc[]> {
  const result = await alertApiRequest<{ devices?: any[] }>("/devices/available");
  const devices = Array.isArray(result?.devices) ? result.devices : [];

  const mapped = devices.map((item) => mapEc2DeviceToDeviceDoc(item, null));
  return applyLocalLabelsToDevices(userId, mapped);
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
 *   - createdAt: timestamp
 *   - updatedAt: timestamp
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
    console.error("[Alerts] No user authenticated");
    callback([]);
    return () => {};
  }

  let isClosed = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let nextPollAllowedAt = 0;

  const pollDevices = async () => {
    if (isClosed) return;
    if (Date.now() < nextPollAllowedAt) return;

    try {
      const devices = await fetchEc2UserDevices(user.uid);
      callback(devices);
      nextPollAllowedAt = 0;
    } catch (error) {
      if (isRateLimitError(error)) {
        nextPollAllowedAt = Date.now() + RATE_LIMIT_BACKOFF_MS;
        console.warn("[Alerts] Device polling rate-limited; backing off for 60s.");
        return;
      }

      console.error("[Alerts] Error polling user devices:", error);
    }
  };

  pollDevices();
  pollTimer = setInterval(pollDevices, DEVICE_POLL_INTERVAL_MS);

  return () => {
    isClosed = true;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };
};

/**
 * Get all devices for current user (one-time fetch)
 */
export async function getUserDevices() {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error("User not authenticated");

  try {
    return await fetchEc2UserDevices(userId);
  } catch (error) {
    console.error("[Alerts] Error getting user devices:", error);
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

    const trimmed = label.trim();
    if (!trimmed) throw new Error("Label cannot be empty");

    const labels = await loadLocalDeviceLabels(userId);
    labels[deviceId] = trimmed;
    await saveLocalDeviceLabels(userId, labels);

    console.log("[Local] Device label updated for this app profile:", deviceId);
  } catch (error) {
    console.error("[Local] Error updating device label:", error);
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
 * Get ALL devices from Firestore (for device selection)
 * Updated for shared device access - looks for devices with userIds arrays
 */
export async function getAllAvailableDevices() {
  try {
    const userId = auth.currentUser?.uid;
    if (!userId) throw new Error("User not authenticated");

    const devices = await fetchEc2AvailableDevices(userId);
    console.log("[Alerts] Found available devices:", devices.length);

    return devices;
  } catch (error) {
    console.error("[Alerts] Error getting all devices:", error);
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
    console.log("[Alerts] Getting available devices for user:", userId);
    const allDevices = await getAllAvailableDevices();
    console.log("[Alerts] All active devices from EC2:", allDevices.length);
    
    // Filter devices based on shared access logic
    const available = allDevices.filter((device) => {
      // Exclude test devices
      const label = (device.label || "").toLowerCase();
      const name = (device.name || "").toLowerCase();
      if (label.includes("test device") || name.includes("test")) {
        console.log("[Alerts] Excluding test device:", device.id, device.label);
        return false;
      }

      // Must have valid label/name and id
      if (!(device.label || device.name) || !device.id) {
        console.log("[Alerts] Excluding device with missing label/id:", device.id);
        return false;
      }

      return true;
    });

    console.log("[Alerts] Available devices for user to claim:", available.length);
    return available;
  } catch (error) {
    console.error("[Alerts] Error getting available devices:", error);
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
    await alertApiRequest("/device-memberships/add", {
      method: "POST",
      body: JSON.stringify({
        deviceId,
      }),
    });

    console.log("[Alerts] Device membership added:", deviceId, "for user:", user.uid);
    return deviceId;
  } catch (error) {
    console.error("[Alerts] Error adding device membership:", error);
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
    await alertApiRequest("/device-memberships/remove", {
      method: "POST",
      body: JSON.stringify({
        deviceId,
      }),
    });

    console.log("[Alerts] Device membership removed:", deviceId, "for user:", user.uid);
    return deviceId;
  } catch (error) {
    console.error("[Alerts] Error removing device membership:", error);
    throw error;
  }
}

/**
 * Pair a device to the current user using the pairing token encoded in the
 * QR code displayed by the Raspberry Pi (Devices tab -> "Scan to Add").
 * This is the ONLY supported way to add a device — there is no browse/list
 * fallback, since only a physically-present, valid QR code can succeed.
 */
export async function pairDeviceWithQr(deviceId: string, token: string) {
  const user = auth.currentUser;
  if (!user) throw new Error("No user authenticated");

  try {
    const result = await alertApiRequest<{ device?: { device_name?: string; location?: string } }>(
      "/devices/pair",
      {
        method: "POST",
        body: JSON.stringify({ deviceId, token }),
      }
    );

    console.log("[Alerts] Device paired via QR:", deviceId, "for user:", user.uid);
    return result;
  } catch (error) {
    console.error("[Alerts] Error pairing device via QR:", error);
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
  const user = auth.currentUser;
  if (!user) throw new Error("User not authenticated");

  try {
    const alerts = await fetchEc2UserAlerts(user.uid, undefined, limit);
    console.log("[Alerts] getUserMLAlerts: fetched", alerts.length, "alerts from EC2 API");
    return alerts;
  } catch (apiError) {
    console.warn("[Alerts] EC2 getUserMLAlerts failed, falling back to Firestore:", apiError);

    const q = query(collection(db, "users", user.uid, "mlAlerts"));
    const snapshot = await getDocs(q);

    return snapshot.docs
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
  }
}

/**
 * Listen to ML alerts from all user devices in real-time
 */
export function listenToUserMLAlerts(callback: (alerts: MLAlert[]) => void): () => void {
  const user = auth.currentUser;
  if (!user) {
    callback([]);
    return () => {};
  }

  let isClosed = false;
  let socket: Socket | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let inFlightPoll = false;
  let lastSeenMillis = 0;
  let alertMap = new Map<string, MLAlert>();
  let deletedAlertIds = new Set<string>();
  let socketConnectErrorCount = 0;
  let socketDisabledForSession = false;
  let nextPollAllowedAt = 0;

  const emit = () => {
    const alerts = Array.from(alertMap.values())
      .filter((alert) => !alert.id || !deletedAlertIds.has(alert.id))
      .sort((a, b) => {
      const aTime = a.alertGeneratedAt || a.timestamp?.toMillis?.() || 0;
      const bTime = b.alertGeneratedAt || b.timestamp?.toMillis?.() || 0;
      return bTime - aTime;
    });

    callback(alerts);
  };

  const mergeAlerts = (incoming: MLAlert[]) => {
    incoming.forEach((alert) => {
      if (!alert.id) {
        return;
      }

      const existing = alertMap.get(alert.id);
      if (!existing) {
        alertMap.set(alert.id, alert);
      } else {
        alertMap.set(alert.id, { ...existing, ...alert });
      }

      const alertTime = alert.alertGeneratedAt || alert.timestamp?.toMillis?.() || 0;
      if (alertTime > lastSeenMillis) {
        lastSeenMillis = alertTime;
      }
    });
  };

  const poll = async (fullRefresh = false) => {
    if (isClosed || inFlightPoll) {
      return;
    }

    if (Date.now() < nextPollAllowedAt) {
      return;
    }

    inFlightPoll = true;
    try {
      const since = fullRefresh ? undefined : lastSeenMillis;
      const fetched = await fetchEc2UserAlerts(user.uid, since, 200);

      if (fullRefresh) {
        alertMap = new Map();
      }

      mergeAlerts(fetched);
      emit();
      nextPollAllowedAt = 0;
    } catch (error) {
      if (isRateLimitError(error)) {
        nextPollAllowedAt = Date.now() + RATE_LIMIT_BACKOFF_MS;
        console.warn("[Alerts] Alert polling rate-limited; backing off for 60s.");
        return;
      }

      console.warn("[Alerts] EC2 poll failed:", error);
      if (fullRefresh) callback([]);
    } finally {
      inFlightPoll = false;
    }
  };

  // Initialize local deletion set, then fetch initial state.
  loadDeletedAlertIds(user.uid)
    .then((ids) => {
      deletedAlertIds = ids;
    })
    .catch(() => {
      deletedAlertIds = new Set<string>();
    })
    .finally(() => {
      poll(true);
    });

  // Polling fallback is always on (network resilience).
  pollTimer = setInterval(() => {
    poll(false);
  }, ALERT_POLL_INTERVAL_MS);

  // WebSocket realtime channel — token fetched async before connecting.
  user.getIdToken().then((idToken) => {
    if (isClosed) return;
    socket = io(ALERT_API_ROOT, {
      auth: { token: idToken },
      path: ALERT_SOCKET_PATH,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 15000,
    });

    socket.io.on("reconnect_attempt", async () => {
      if (!socket) {
        return;
      }

      try {
        const refreshed = await user.getIdToken(true);
        if (socket) {
          socket.auth = { token: refreshed };
        }
      } catch (refreshError) {
        console.warn("[Alerts] Failed to refresh WebSocket auth token:", refreshError);
      }
    });

    socket.on("connect", () => {
      socketConnectErrorCount = 0;
      console.log("[Alerts] WebSocket connected for user", user.uid);
    });

    socket.on("alert:new", (payload: any) => {
      const alert = mapEc2AlertToMLAlert(payload, user.uid);
      mergeAlerts([alert]);
      emit();
    });

    socket.on("disconnect", (reason) => {
      console.log("[Alerts] WebSocket disconnected:", reason);
    });

    socket.on("connect_error", (error) => {
      socketConnectErrorCount += 1;

      if (socketConnectErrorCount <= 2) {
        console.warn("[Alerts] WebSocket connect error:", error?.message || error);
      }

      // Circuit-breaker: after repeated failures, stop realtime socket retries
      // and rely on the existing polling fallback to avoid log spam.
      if (socketConnectErrorCount >= 3 && !socketDisabledForSession) {
        socketDisabledForSession = true;
        console.warn("[Alerts] Disabling WebSocket for this session after repeated failures; using polling fallback.");

        if (socket) {
          socket.removeAllListeners();
          socket.disconnect();
          socket = null;
        }
      }
    });
  }).catch((tokenErr) => {
    console.warn("[Alerts] Could not get Firebase ID token for WebSocket:", tokenErr);
  });

  return () => {
    isClosed = true;

    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }

    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
  };
}

/**
 * Get the current user's alert retention setting
 */
export async function getUserAlertRetentionDays(): Promise<AlertRetentionDays> {
  const user = auth.currentUser;
  if (!user) throw new Error("User not authenticated");

  const scopedKey = `${ALERT_RETENTION_STORAGE_KEY_PREFIX}${user.uid}`;
  const [scopedValue, legacyValue] = await Promise.all([
    AsyncStorage.getItem(scopedKey),
    AsyncStorage.getItem(LEGACY_ALERT_RETENTION_STORAGE_KEY),
  ]);

  const candidate = scopedValue ?? legacyValue;
  if (candidate === null) {
    return 7;
  }

  return normalizeAlertRetentionDays(parseInt(candidate, 10));
}

/**
 * Save the current user's alert retention setting
 */
export async function saveUserAlertRetentionDays(days: AlertRetentionDays): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error("User not authenticated");

  const normalized = normalizeAlertRetentionDays(days);
  const scopedKey = `${ALERT_RETENTION_STORAGE_KEY_PREFIX}${user.uid}`;
  await AsyncStorage.multiSet([
    [scopedKey, normalized.toString()],
    [LEGACY_ALERT_RETENTION_STORAGE_KEY, normalized.toString()],
  ]);
}

/**
 * Update ML alert with user feedback/rating.
 * Writes to EC2 alert API first; falls back to Firestore for backwards compat.
 */
export async function updateMLAlertRating(
  alertId: string,
  rating: number,
  isAccurate?: boolean,
  notes?: string
): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error("User not authenticated");

  // ── EC2 primary path ─────────────────────────────────────────────────────
  const authHeader = await getAuthHeader();
  try {
    const res = await fetch(`${ALERT_API_BASE}/alerts/${encodeURIComponent(alertId)}/rating`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({
        rating,
        isAccurate,
        notes,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn('[EC2] Alert rating update failed:', res.status, body);
    } else {
      console.log('[EC2] ML alert rating updated:', alertId);
      return; // success — skip Firestore fallback
    }
  } catch (ec2Err) {
    console.warn('[EC2] Alert rating unreachable, falling back to Firestore:', ec2Err);
  }

  // ── Firestore fallback ────────────────────────────────────────────────────
  try {
    const alertRef = doc(db, "users", user.uid, "mlAlerts", alertId);
    const docSnapshot = await getDoc(alertRef);
    if (!docSnapshot.exists()) {
      console.warn("[Firestore] Alert document not found:", alertId);
      return;
    }
    await updateDoc(alertRef, {
      userRating: Math.min(10, Math.max(1, rating)),
      ratingAccuracy: isAccurate !== undefined ? isAccurate : null,
      ratingNotes: notes || null,
      ratedAt: serverTimestamp(),
      acknowledged: true,
      acknowledgedAt: serverTimestamp(),
    });
    console.log("[Firestore] ML alert rating updated (fallback):", alertId);
  } catch (error) {
    console.error("[Firestore] Error updating ML alert rating:", error);
    throw error;
  }
}

/**
 * Acknowledge an ML alert
 */
export async function acknowledgeMLAlert(
  _deviceId: string,
  alertId: string
): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error("User not authenticated");
  try {
    const authHeader = await getAuthHeader();
    const res = await fetch(`${ALERT_API_BASE}/alerts/${encodeURIComponent(alertId)}/rating`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn('[EC2] acknowledgeMLAlert failed:', res.status, body);
    } else {
      console.log('[EC2] ML alert acknowledged:', alertId);
    }
  } catch (error) {
    console.error('[EC2] Error acknowledging ML alert:', error);
    throw error;
  }
}

/**
 * Delete an old ML alert
 */
export async function deleteMLAlert(
  _deviceId: string,
  alertId: string
): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error("User not authenticated");

  const deletedIds = await loadDeletedAlertIds(user.uid);
  deletedIds.add(alertId);
  await saveDeletedAlertIds(user.uid, deletedIds);

  // Deletion is local-only: we hide the alert in this app profile and keep server data intact.
  console.log("[Local] ML alert marked as deleted in this app profile:", alertId);
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

