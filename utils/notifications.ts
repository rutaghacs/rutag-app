import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";
import { registerFCMToken, setupFCMListeners } from "../firebase/fcmService";
import { generateMLAlertNotification } from "./mlAlertHandler";
import type { MLAlert } from "../types/mlAlertTypes";

/**
 * Initialize push notifications and FCM
 */
export const initPushNotifications = async () => {
  try {
    console.log("[Notifications] Initializing push notifications");

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Default",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#FF231F7C",
        sound: "default",
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    }

    // Set notification handler
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });

    // Get permission status
    const permission = await Notifications.getPermissionsAsync();
    console.log("[Notifications] Permission status:", permission.status);

    if (permission.status !== "granted") {
      console.log("[Notifications] Requesting notification permissions");
      const newPermission = await Notifications.requestPermissionsAsync();
      
      if (newPermission.status === "granted") {
        console.log("[Notifications] ✅ Permission granted");
      } else {
        console.warn("[Notifications] Permission denied");
        return;
      }
    }

    // Register Expo push token for server-side messaging.
    const token = await registerFCMToken();
    if (!token) {
      console.warn("[Notifications] Expo push token is null; background push will not work until token is saved");
    }

    // Setup FCM listeners
    setupFCMListeners();

    console.log("[Notifications] ✅ Initialization complete");
    return true;
  } catch (error) {
    console.error("[Notifications] Error initializing:", error);
  }
};

/**
 * Send a local test notification
 */
export const sendTestNotification = async (
  title: string = "Test Alert",
  message: string = "This is a test notification"
) => {
  try {
    console.log("[Notifications] Sending test notification");
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body: message,
        badge: 1,
        sound: true,
        data: {
          testData: true,
        },
      },
      trigger: null,
    });
    console.log("[Notifications] Test notification scheduled");
  } catch (error) {
    console.error("[Notifications] Error sending test notification:", error);
  }
};

/**
 * Send sensor alert notification with threshold info
 */
export const sendSensorAlert = async (
  sensorName: string,
  alertMessage: string,
  severity: "info" | "warning" | "error" = "warning",
  sensorId?: string,
  value?: number,
  threshold?: number
) => {
  try {
    const emoji = severity === "error" ? "🚨" : severity === "warning" ? "⚠️" : "ℹ️";
    
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${emoji} ${sensorName}`,
        body: alertMessage,
        badge: 1,
        sound: true,
        data: {
          sensorName,
          severity,
          type: "sensorAlert",
          sensorId: sensorId || "",
          value: value?.toString() || "",
          threshold: threshold?.toString() || "",
        },
      },
      trigger: null,
    });
    
    console.log("[Notifications] Sensor alert sent:", sensorName);
  } catch (error) {
    console.error("[Notifications] Error sending sensor alert:", error);
  }
};

/**
 * Send ML model alert notification
 * Called when a new ML alert is received from a remote device
 */
export const sendMLAlertNotification = async (alert: MLAlert) => {
  try {
    const { title, body } = generateMLAlertNotification(alert);

    console.log("[Notifications] Sending ML alert notification");
    
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        badge: 1,
        sound: true,
        data: {
          type: "mlAlert",
          deviceId: alert.deviceId,
          deviceIdentifier: alert.deviceIdentifier,
          alertId: alert.id,
          riskLabel: alert.riskLabel,
          detectedObjects: alert.detectedObjects.join(", "),
          timestamp: alert.timestamp?.toISOString?.() || new Date().toISOString(),
        },
      },
      trigger: null,
    });

    console.log("[Notifications] ✅ ML alert notification sent");
  } catch (error) {
    console.error("[Notifications] Error sending ML alert notification:", error);
  }
};

/**
 * Send FCM alert from server/Cloud Function
 * Used when server sends notifications via Firebase Cloud Messaging
 */
export const sendFCMAlert = async (
  sensorName: string,
  value: number,
  threshold: number,
  severity: "info" | "warning" | "error" = "warning",
  sensorId?: string
) => {
  const emoji = severity === "error" ? "🚨" : severity === "warning" ? "⚠️" : "ℹ️";
  const alertMessage = `Value: ${value} (Threshold: ${threshold})`;
  
  await sendSensorAlert(
    sensorName,
    alertMessage,
    severity,
    sensorId,
    value,
    threshold
  );
};

/**
 * Setup notification listeners including ML alerts
 */
export const setupNotificationListeners = () => {
  // Handle notification received while app is in foreground
  const foregroundSubscription = Notifications.addNotificationReceivedListener(
    (notification) => {
      console.log("[Notifications] Notification received (foreground):", notification);
      
      // Log ML alert notifications
      if (notification.request.content.data?.type === "mlAlert") {
        console.log("[Notifications] 🤖 ML Alert notification received in foreground");
      }
    }
  );

  // Handle notification when user taps on it
  const responseSubscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      console.log("[Notifications] Notification tapped:", response);
      
      // Handle ML alert navigation
      if (response.notification.request.content.data?.type === "mlAlert") {
        console.log("[Notifications] 🤖 ML Alert notification tapped");
        // Navigation can be handled by passing alertId through navigation params
      }
    }
  );

  // Refresh token when app returns to foreground.
  // This recovers from permission changes and stale/null tokens.
  const appStateSubscription = AppState.addEventListener("change", (state) => {
    if (state === "active") {
      registerFCMToken().catch((error) => {
        console.warn("[Notifications] Failed to refresh Expo push token on app active:", error);
      });
    }
  });

  return () => {
    foregroundSubscription.remove();
    responseSubscription.remove();
    appStateSubscription.remove();
  };
};
