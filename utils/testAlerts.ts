import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebaseConfig";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { getFirestore } from "firebase/firestore";
import * as Notifications from "expo-notifications";

/**
 * 🧪 Trigger a test alert for a specific device
 * Creates an alert record in Firestore and sends a local notification
 */
export const triggerTestAlert = async (deviceId: string, deviceLabel: string = "Device") => {
  try {
    console.log("[TestAlert] Triggering test alert for device:", deviceId);
    
    const db = getFirestore();
    
    // Create alert record in device's alerts subcollection
    const alertRef = await addDoc(
      collection(db, "devices", deviceId, "alerts"),
      {
        type: "TEST_ALERT",
        message: "🧪 This is a test alert notification",
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
      }
    );

    console.log("[TestAlert] Alert created:", alertRef.id);

    // Send local notification immediately
    console.log("[TestAlert] Sending local notification...");
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `🧪 Test Alert - ${deviceLabel}`,
        body: "This is a test alert notification",
        badge: 1,
        sound: "default",
        data: {
          type: "testAlert",
          deviceId,
          deviceLabel,
        },
      },
      trigger: {
        type: "timeInterval",
        seconds: 1, // Show immediately
      },
    });

    console.log("[TestAlert] ✅ Local notification sent");
    return {
      success: true,
      message: "Alert created and notification sent",
    };
  } catch (error: any) {
    console.error("[TestAlert] Error:", error);
    throw error;
  }
};
