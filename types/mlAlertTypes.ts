/**
 * 🤖 ML Model Alert Types
 * Structures for receiving and handling alerts from remote ML models
 */

/**
 * Alert data structure received from ML model on remote device
 */
export interface MLAlertPayload {
  notification_type: "Alert" | "Warning" | "Critical" | string;
  detected_objects: string[];
  risk_label: "Low" | "Medium" | "High" | "Critical" | string;
  predicted_risk: "Low" | "Medium" | "High" | "Critical" | string;
  description: string[];
  screenshot?: string[];
  device_identifier?: string; // e.g., "raspberry_pi_1", "device_a", "camera_01"
  timestamp?: number; // Unix timestamp in milliseconds
  model_version?: string;
  confidence_score?: number;
  additional_data?: Record<string, any>;
}

/**
 * Processed ML alert stored in Firestore
 */
export interface MLAlert {
  id?: string;
  deviceId: string; // Device that generated the alert
  deviceIdentifier: string; // Human-readable device name (e.g., "raspberry_pi_1")
  userId: string; // Device owner
  notificationType: string;
  detectedObjects: string[];
  riskLabel: string;
  predictedRisk: string;
  description: string[];
  screenshots: string[];
  timestamp: any; // Firestore timestamp
  alertGeneratedAt?: number; // Unix timestamp from device
  modelVersion?: string;
  confidenceScore?: number;
  acknowledged?: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: any;
  userRating?: number;
  ratingAccuracy?: boolean;
  ratingNotes?: string;
  additionalData?: Record<string, any>;
}

/**
 * Push notification payload for FCM
 */
export interface MLAlertNotification {
  title: string;
  body: string;
  data: {
    type: "mlAlert";
    deviceId: string;
    deviceIdentifier: string;
    alertId: string;
    riskLabel: string;
    detectedObjects: string;
    description: string;
    timestamp: string;
  };
}

/**
 * HTTP request payload from remote device
 */
export interface RemoteDeviceAlertRequest {
  apiKey?: string; // For authentication
  deviceId: string; // Firestore device ID
  deviceIdentifier: string; // Human-readable identifier
  mlAlert: MLAlertPayload;
}

/**
 * Response from Cloud Function
 */
export interface MLAlertResponse {
  success: boolean;
  alertId?: string;
  message: string;
  error?: string;
}

