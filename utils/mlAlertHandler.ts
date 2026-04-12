/**
 * 🤖 ML Alert Handler
 * Processes and handles ML model alerts from remote devices
 */

import { auth } from "../firebase/firebaseConfig";
import {
  addMLAlert,
  updateMLAlertRating,
  acknowledgeMLAlert,
  deleteMLAlert,
} from "../db/firestore";
import type { MLAlertPayload, MLAlert } from "../types/mlAlertTypes";

/**
 * Process incoming ML alert from Cloud Function
 * This is called when a new ML alert document is created in Firestore
 */
export async function processMLAlert(
  deviceId: string,
  deviceIdentifier: string,
  alertPayload: MLAlertPayload
): Promise<string> {
  try {
    const user = auth.currentUser;
    if (!user) throw new Error("User not authenticated");

    console.log("[MLAlertHandler] Processing ML alert from device:", deviceIdentifier);

    // Validate required fields
    if (!alertPayload.detected_objects || !alertPayload.risk_label) {
      throw new Error("Invalid alert payload: missing required fields");
    }

    // Store alert in Firestore
    const alertId = await addMLAlert(
      deviceId,
      deviceIdentifier,
      user.uid,
      {
        notificationType: alertPayload.notification_type || "Alert",
        detectedObjects: alertPayload.detected_objects,
        riskLabel: alertPayload.risk_label,
        predictedRisk: alertPayload.predicted_risk,
        description: alertPayload.description || [],
        screenshots: alertPayload.screenshot || [],
        timestamp: alertPayload.timestamp || Date.now(),
        modelVersion: alertPayload.model_version,
        confidenceScore: alertPayload.confidence_score,
        additionalData: alertPayload.additional_data,
      }
    );

    console.log("[MLAlertHandler] ✅ ML alert processed and stored:", alertId);
    return alertId;
  } catch (error) {
    console.error("[MLAlertHandler] Error processing ML alert:", error);
    throw error;
  }
}

/**
 * Generate notification title and body from ML alert
 */
export function generateMLAlertNotification(alert: MLAlert): {
  title: string;
  body: string;
  riskEmoji: string;
} {
  const riskMap: { [key: string]: string } = {
    critical: "🔴",
    high: "🟠",
    medium: "🟡",
    low: "🟢",
  };

  const riskLevel = alert.riskLabel.toLowerCase();
  const riskEmoji = riskMap[riskLevel] || "🔵";

  // Create title with risk level and device
  const title = `${riskEmoji} ${alert.riskLabel} Alert - ${alert.deviceIdentifier}`;

  // Create body with detected objects and first description
  const objectsStr = alert.detectedObjects.join(", ");
  const descriptionStr = alert.description?.[0] || "ML detection alert";

  const body = `${objectsStr}: ${descriptionStr}`;

  return {
    title,
    body,
    riskEmoji,
  };
}

/**
 * Format ML alert for display
 */
export function formatMLAlertForDisplay(alert: MLAlert): string {
  const alertTime = alert.timestamp?.toDate?.() || new Date(alert.alertGeneratedAt || 0);
  const timestamp = alertTime.toLocaleString?.();

  let formatted = `\n📱 Device: ${alert.deviceIdentifier}\n`;
  formatted += `⏰ Time: ${timestamp}\n`;
  formatted += `⚠️ Risk: ${alert.riskLabel}\n`;
  formatted += `🔍 Detected: ${alert.detectedObjects.join(", ")}\n`;

  if (alert.description && alert.description.length > 0) {
    formatted += `📝 Details:\n`;
    alert.description.forEach((desc, idx) => {
      formatted += `   ${idx + 1}. ${desc}\n`;
    });
  }

  if (alert.confidenceScore !== null && alert.confidenceScore !== undefined) {
    formatted += `📊 Confidence: ${(alert.confidenceScore * 100).toFixed(1)}%\n`;
  }

  if (alert.screenshots && alert.screenshots.length > 0) {
    formatted += `📸 Screenshots: ${alert.screenshots.length} available\n`;
  }

  if (alert.modelVersion) {
    formatted += `🤖 Model: ${alert.modelVersion}\n`;
  }

  if (alert.acknowledged) {
    formatted += `✅ Acknowledged\n`;
  }

  if (alert.rating) {
    formatted += `⭐ Rating: ${alert.rating}/10 (${alert.ratingAccuracy ? "Accurate" : "Inaccurate"})\n`;
  }

  return formatted;
}

/**
 * Rate/feedback on ML alert
 */
export async function rateMLAlert(
  deviceId: string,
  alertId: string,
  rating: number,
  isAccurate: boolean,
  notes?: string
): Promise<void> {
  try {
    if (rating < 1 || rating > 10) {
      throw new Error("Rating must be between 1 and 10");
    }

    await updateMLAlertRating(deviceId, alertId, rating, isAccurate, notes);
    console.log("[MLAlertHandler] ✅ ML alert rated:", alertId);
  } catch (error) {
    console.error("[MLAlertHandler] Error rating ML alert:", error);
    throw error;
  }
}

/**
 * Acknowledge ML alert as seen
 */
export async function acknowledgeAlert(
  deviceId: string,
  alertId: string
): Promise<void> {
  try {
    await acknowledgeMLAlert(deviceId, alertId);
    console.log("[MLAlertHandler] ✅ ML alert acknowledged:", alertId);
  } catch (error) {
    console.error("[MLAlertHandler] Error acknowledging ML alert:", error);
    throw error;
  }
}

/**
 * Delete ML alert
 */
export async function deleteAlert(
  deviceId: string,
  alertId: string
): Promise<void> {
  try {
    await deleteMLAlert(deviceId, alertId);
    console.log("[MLAlertHandler] ✅ ML alert deleted:", alertId);
  } catch (error) {
    console.error("[MLAlertHandler] Error deleting ML alert:", error);
    throw error;
  }
}
