import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { auth } from "./firebaseConfig";

const BASE_API_URL = process.env.EXPO_PUBLIC_API_URL || "http://13.205.201.82";
const ALERT_API_ROOT = (process.env.EXPO_PUBLIC_ALERT_API_URL || `${BASE_API_URL}/alert-api`).replace(/\/$/, "");
const ALERT_API_BASE = `${ALERT_API_ROOT}/api`;

/**
 * 🔕 Clear the stored Expo push token for the current user before sign-out.
 * This prevents push notifications from a previous user's devices arriving on
 * a shared device after a different account signs in.
 */
export const clearFCMToken = async () => {
  try {
    const user = auth.currentUser;
    if (!user) return;
    const tokenObj = await Notifications.getDevicePushTokenAsync();
    const fcmToken = tokenObj.data as string;
    const idToken = await user.getIdToken();

    await fetch(`${ALERT_API_BASE}/push-tokens/deactivate`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ token: fcmToken }),
    });

    console.log("[FCM] ✅ Push token cleared for user:", user.uid);
  } catch (error) {
    // Non-fatal - best-effort cleanup
    console.warn("[FCM] Could not clear push token:", error);
  }
};

/**
 * 📱 Get and store Expo push token
 * This token allows the server to send push notifications to this device
 * Note: This is optional - alerts are delivered via Firestore listeners
 */
export const registerFCMToken = async () => {
  try {
    console.log("[FCM] Registering FCM device token (direct)");
    console.log("[FCM] Current user:", auth.currentUser?.uid);

    const existingPermissions = await Notifications.getPermissionsAsync();
    let finalStatus = existingPermissions.status;
    if (finalStatus !== "granted") {
      const requestedPermissions = await Notifications.requestPermissionsAsync();
      finalStatus = requestedPermissions.status;
    }

    if (finalStatus !== "granted") {
      console.warn("[FCM] Notification permission not granted; cannot register push token");
      return null;
    }

    // Get raw FCM device token — works in local builds without EAS credentials
    const tokenObj = await Notifications.getDevicePushTokenAsync();
    const fcmToken = tokenObj.data as string;
    console.log("[FCM] FCM device token obtained:", fcmToken.substring(0, 20) + "...");

    const user = auth.currentUser;
    if (user) {
      console.log("[FCM] Registering push token in EC2 alert API for user:", user.uid);

      try {
        let pushAuthHeader: Record<string, string> = {};
        try {
          const idToken = await user.getIdToken();
          pushAuthHeader = { Authorization: `Bearer ${idToken}` };
        } catch { /* best-effort */ }
        await fetch(`${ALERT_API_BASE}/push-tokens/register`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...pushAuthHeader,
          },
          body: JSON.stringify({
            token: fcmToken,
            provider: "fcm",
            platform: Platform.OS,
          }),
        });
      } catch (apiError) {
        console.warn("[FCM] EC2 push token registration failed:", apiError);
      }

      console.log("[FCM] Token registration complete (EC2)");
    } else {
      console.warn("[FCM] No user logged in, cannot store token");
    }

    return fcmToken;
  } catch (error: any) {
    console.warn("[FCM] Push token registration failed:", error?.message || error);
    return null;
  }
};

/**
 * 🔔 Handle incoming FCM messages and local notifications
 */
export const setupFCMListeners = () => {
  try {
    console.log("[FCM] Setting up notification handlers");

    // Handle notification when app is in foreground
    const foregroundSubscription = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log("[FCM] 📬 Notification received in foreground:", notification);
        handleNotificationReceived(notification);
      }
    );

    // Handle notification tap/response
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        console.log("[FCM] 👆 Notification tapped:", response);
        handleNotificationResponse(response);
      }
    );

    console.log("[FCM] ✅ Listeners setup complete");

    return () => {
      foregroundSubscription.remove();
      responseSubscription.remove();
    };
  } catch (error) {
    // Silently handle errors - listeners are optional
    console.log("[FCM] ℹ️  Notification listeners setup skipped");
  }
};

/**
 * Process received notifications
 */
export const handleNotificationReceived = (notification: Notifications.Notification) => {
  const data = notification.request.content.data;

  if (data.type === "sensorAlert") {
    console.log("[FCM] 🚨 Sensor alert received:", {
      sensorName: data.sensorName,
      severity: data.severity,
      value: data.value,
      threshold: data.threshold,
    });
  }
};

/**
 * Handle notification tap
 */
export const handleNotificationResponse = (response: Notifications.NotificationResponse) => {
  const data = response.notification.request.content.data;

  if (data.type === "sensorAlert") {
    console.log("[FCM] Navigating to sensor:", data.sensorId);
    // TODO: Navigate to sensor detail screen with router
    // router.push(`/sensor/${data.sensorId}`);
  }
};
