import { View, Text, StyleSheet, ActivityIndicator, ScrollView, FlatList, TouchableOpacity, Modal, Linking, Image, TextInput, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { signOut, onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase/firebaseConfig";
import { useState, useEffect, useRef } from "react";
import { listenToUserDevices, updateDeviceLabel, getAvailableDevicesForUser, claimDevice, unclaimDevice, listenToUserMLAlerts, updateMLAlertRating, getUserDevices, getUserAlertRetentionDays, saveUserAlertRetentionDays, type AlertRetentionDays } from "../db/firestore";
import { useRouter } from "expo-router";
import { initPushNotifications, setupNotificationListeners } from "../utils/notifications";
import { clearFCMToken } from "../firebase/fcmService";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialIcons } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import type { MLAlert } from "../types/mlAlertTypes";
import StyledAlert, { StyledAlertProps } from "../components/StyledAlert";
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function Dashboard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  
  // Refs
  const readingsUnsubscribesRef = useRef<any[]>([]);
  const shownNotificationsRef = useRef<Set<string>>(new Set());
  const mlAlertsRef = useRef<MLAlert[]>([]);
  const mlAlertsBootstrapDoneRef = useRef(false);
  const latestNotifiedAlertAtRef = useRef(0);
  const sessionSignInAtRef = useRef(0);
  
  // Core State
  const [loggingOut, setLoggingOut] = useState(false);
  const [isUserLoggedIn, setIsUserLoggedIn] = useState(!!auth.currentUser);
  const [mlAlerts, setMLAlerts] = useState<MLAlert[]>([]);
  const [visibleAlertCount, setVisibleAlertCount] = useState(50);
  // Bumped once a day to trigger re-evaluation of the local retention filter
  const [retentionPulse, setRetentionPulse] = useState(0);
  const [devices, setDevices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"alerts" | "devices">("devices");
  const [alertRetentionDays, setAlertRetentionDays] = useState<AlertRetentionDays>(7);

  // Device Management State
  const [showAddModal, setShowAddModal] = useState(false);
  const [loadingAvailable, setLoadingAvailable] = useState(false);
  const [availableDevices, setAvailableDevices] = useState<any[]>([]);
  const [claimingDeviceId, setClaimingDeviceId] = useState<string | null>(null);

  // Sensor Control State
  const [showSensorControlModal, setShowSensorControlModal] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<any | null>(null);
  const [deviceSensors, setDeviceSensors] = useState<any[]>([]);
  const [loadingSensors, setLoadingSensors] = useState(false);
  const [deletingSensorId, setDeletingSensorId] = useState<number | null>(null);

  // Alert Rating State
  const [selectedAlert, setSelectedAlert] = useState<MLAlert | null>(null);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [selectedAccuracy, setSelectedAccuracy] = useState<boolean | null>(null);
  const [showAlertImageModal, setShowAlertImageModal] = useState(false);
  const [selectedAlertImageUri, setSelectedAlertImageUri] = useState<string>('');

  // Profile State
  const [showProfileModal, setShowProfileModal] = useState(false);

  // Styled Alert State
  const [styledAlertVisible, setStyledAlertVisible] = useState(false);
  const [styledAlertConfig, setStyledAlertConfig] = useState<StyledAlertProps>({
    visible: false,
    title: '',
    message: '',
    type: 'info',
  });

  // Custom Modal States
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showTextInputModal, setShowTextInputModal] = useState(false);
  const [modalConfig, setModalConfig] = useState({
    title: '',
    message: '',
    confirmText: 'OK',
    cancelText: 'Cancel',
    onConfirm: () => {},
    isDestructive: false
  });
  const [textInputConfig, setTextInputConfig] = useState({
    title: '',
    message: '',
    placeholder: '',
    defaultValue: '',
    onConfirm: (text: string) => {},
  });
  const [inputText, setInputText] = useState('');

  const sensorControlHost = (process.env.EXPO_PUBLIC_SENSOR_CONTROL_URL || 'http://13.205.201.82').replace(/\/$/, '');
  const sensorControlApiUrl = sensorControlHost.endsWith('/sensor-api')
    ? sensorControlHost
    : `${sensorControlHost}/sensor-api`;

  // Cleanup function
  const cleanupDeviceReadingListeners = () => {
    readingsUnsubscribesRef.current.forEach((unsub) => {
      if (typeof unsub === "function") unsub();
    });
    readingsUnsubscribesRef.current = [];
  };

  // Show styled alert helper
  const showStyledAlert = (title: string, message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setStyledAlertConfig({
      visible: true,
      title,
      message,
      type,
      onClose: () => setStyledAlertVisible(false),
    });
    setStyledAlertVisible(true);
  };

  // Auth state monitoring
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setIsUserLoggedIn(true);
        sessionSignInAtRef.current = Date.now();
        shownNotificationsRef.current = new Set();
        setVisibleAlertCount(50);
        mlAlertsBootstrapDoneRef.current = false;
        latestNotifiedAlertAtRef.current = 0;
      } else {
        setIsUserLoggedIn(false);
        setDevices([]);
        setMLAlerts([]);
        setVisibleAlertCount(50);
        sessionSignInAtRef.current = 0;
        shownNotificationsRef.current = new Set();
        mlAlertsBootstrapDoneRef.current = false;
        latestNotifiedAlertAtRef.current = 0;
        cleanupDeviceReadingListeners();
      }
    });

    return () => unsubscribeAuth();
  }, []);

  // ML Alerts listener
  useEffect(() => {
    if (!isUserLoggedIn) {
      setMLAlerts([]);
      return;
    }

    const unsubscribe = listenToUserMLAlerts((alerts) => {
      mlAlertsRef.current = alerts;
      setMLAlerts(alerts);
      setLoading(false);

      // On first snapshot after login, treat existing alerts as baseline and
      // avoid replaying old notifications.
      if (!mlAlertsBootstrapDoneRef.current) {
        let latest = latestNotifiedAlertAtRef.current;

        alerts.forEach((alert) => {
          if (alert.id) {
            shownNotificationsRef.current.add(alert.id);
          }

          const alertAt = alert.alertGeneratedAt || alert.timestamp?.toMillis?.() || 0;
          if (alertAt > latest) {
            latest = alertAt;
          }
        });

        latestNotifiedAlertAtRef.current = latest;
        mlAlertsBootstrapDoneRef.current = true;
        return;
      }

      // Send notifications for new alerts
      alerts.forEach((alert) => {
        if (!alert.id || shownNotificationsRef.current.has(alert.id)) {
          return;
        }

        const generatedAt = alert.alertGeneratedAt || 0;
        const storedAt = alert.timestamp?.toMillis?.() || 0;
        const alertAt = generatedAt > 0 ? generatedAt : storedAt;
        if (alertAt < sessionSignInAtRef.current || alertAt <= latestNotifiedAlertAtRef.current) {
          shownNotificationsRef.current.add(alert.id);
          return;
        }

        try {
          Notifications.scheduleNotificationAsync({
            content: {
              title: `🤖 ${alert.riskLabel?.toUpperCase() || "ALERT"}`,
              body: `${alert.detectedObjects?.join(", ") || "Detection"} - ${alert.deviceIdentifier || "Unknown Device"}`,
              badge: 1,
              sound: true,
              data: { alertId: alert.id },
            },
            trigger: { type: "time" as const, seconds: 1 },
          }).catch(console.error);
        } catch (error) {
          console.error("[Dashboard] Exception scheduling notification:", error);
        }

        shownNotificationsRef.current.add(alert.id);
        if (alertAt > latestNotifiedAlertAtRef.current) {
          latestNotifiedAlertAtRef.current = alertAt;
        }
      });
    });

    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [isUserLoggedIn]);

  // Local-only retention filter: hide alerts older than the user's preference.
  // retentionPulse (bumped daily) ensures stale alerts disappear even when
  // no new Firestore data arrives. alertRetentionDays === 0 means keep forever.
  const retainedAlerts = (() => {
    void retentionPulse; // reactive dependency
    if (alertRetentionDays === 0) return mlAlerts;
    const cutoffMs = Date.now() - alertRetentionDays * 24 * 60 * 60 * 1000;
    return mlAlerts.filter((alert) => {
      const alertAt = alert.alertGeneratedAt || alert.timestamp?.toMillis?.() || 0;
      return alertAt >= cutoffMs;
    });
  })();

  const visibleAlerts = retainedAlerts.slice(0, visibleAlertCount);
  const hasMoreAlerts = retainedAlerts.length > visibleAlertCount;

  const handleLoadMoreAlerts = () => {
    setVisibleAlertCount((current) => current + 50);
  };

  // Devices listener
  useEffect(() => {
    if (!isUserLoggedIn) {
      setDevices([]);
      return;
    }

    const unsubscribe = listenToUserDevices((userDevices) => {
      setDevices(userDevices);
      setLoading(false);
    });

    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [isUserLoggedIn]);

  // Initialize notifications
  useEffect(() => {
    if (isUserLoggedIn) {
      let cleanup: (() => void) | undefined;
      const setupNotifications = async () => {
        try {
          await initPushNotifications();
          cleanup = setupNotificationListeners();
        } catch (error) {
          console.error("[Dashboard] Failed to setup notifications:", error);
        }
      };
      setupNotifications();

      return () => {
        if (cleanup) cleanup();
      };
    }
  }, [isUserLoggedIn]);

  // Daily local retention filter pulse – forces re-render so old alerts are
  // hidden from the list without touching Firestore.
  useEffect(() => {
    if (!isUserLoggedIn) return;
    const interval = setInterval(() => {
      setRetentionPulse((p) => p + 1);
    }, 24 * 60 * 60 * 1000); // 24 hours
    return () => clearInterval(interval);
  }, [isUserLoggedIn]);

  // Load alert retention setting
  useEffect(() => {
    const loadAlertRetentionSetting = async () => {
      try {
        const savedRemote = await getUserAlertRetentionDays();
        setAlertRetentionDays(savedRemote);
        await AsyncStorage.setItem('alertRetentionDays', savedRemote.toString());
      } catch (remoteError) {
        try {
          const saved = await AsyncStorage.getItem('alertRetentionDays');
          if (saved !== null) {
            setAlertRetentionDays(parseInt(saved, 10) as AlertRetentionDays);
          }
        } catch (localError) {
          console.error('Failed to load local alert retention setting:', localError);
        }

        console.error('Failed to load remote alert retention setting:', remoteError);
      }
    };

    if (isUserLoggedIn) {
      loadAlertRetentionSetting();
    }
  }, [isUserLoggedIn]);

  // Handle logout
  const handleLogout = () => {
    setModalConfig({
      title: 'Confirm Logout',
      message: 'Are you sure you want to log out?',
      confirmText: 'Logout',
      cancelText: 'Cancel',
      isDestructive: true,
      onConfirm: async () => {
        setLoggingOut(true);
        setShowProfileModal(false);
        setShowConfirmModal(false);
        try {
          await clearFCMToken();
          await signOut(auth);
          router.replace("/");
        } catch (error) {
          console.error("Logout failed:", error);
          showStyledAlert("Error", "Failed to log out", "error");
        } finally {
          setLoggingOut(false);
        }
      }
    });
    setShowConfirmModal(true);
  };

  // Handle add device
  const handleAddDevice = async () => {
    setLoadingAvailable(true);
    try {
      const available = await getAvailableDevicesForUser();
      setAvailableDevices(available);
      setShowAddModal(true);
    } catch (error) {
      showStyledAlert("Error", "Failed to fetch available devices", "error");
    } finally {
      setLoadingAvailable(false);
    }
  };

  // Handle claim device
  const handleClaimDevice = async (deviceId: string, label: string) => {
    setClaimingDeviceId(deviceId);
    try {
      await claimDevice(deviceId, label);
      showStyledAlert("Success", `Device "${label}" added to your account!`, "success");
      setShowAddModal(false);
      setAvailableDevices([]);
    } catch (error) {
      showStyledAlert("Error", "Failed to add device", "error");
    } finally {
      setClaimingDeviceId(null);
    }
  };

  // Handle device removal
  const handleRemoveDevice = (deviceId: string, deviceLabel: string) => {
    setModalConfig({
      title: 'Remove Device',
      message: `Are you sure you want to remove "${deviceLabel}" from your account?`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      isDestructive: true,
      onConfirm: async () => {
        try {
          await unclaimDevice(deviceId);
          showStyledAlert("Success", "Device removed successfully", "success");
        } catch (error) {
          showStyledAlert("Error", "Failed to remove device", "error");
        }
        setShowConfirmModal(false);
      }
    });
    setShowConfirmModal(true);
  };

  // Handle device rename
  const handleRenameDevice = (deviceId: string, currentLabel: string) => {
    setTextInputConfig({
      title: 'Rename Device',
      message: 'Enter a new name for your device:',
      placeholder: 'Device name',
      defaultValue: currentLabel,
      onConfirm: async (newName: string) => {
        if (newName.trim() && newName.trim() !== currentLabel) {
          try {
            await updateDeviceLabel(deviceId, newName.trim());
            showStyledAlert("Success", "Device renamed successfully", "success");
          } catch (error) {
            showStyledAlert("Error", "Failed to rename device", "error");
          }
        }
        setShowTextInputModal(false);
        setInputText('');
      }
    });
    setInputText(currentLabel);
    setShowTextInputModal(true);
  };

  // Fetch device sensors
  const fetchDeviceSensors = async (deviceId: string) => {
    setLoadingSensors(true);
    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('User not authenticated');
      }

      const response = await fetch(`${sensorControlApiUrl}/api/sensors?deviceId=${encodeURIComponent(deviceId)}`, {
        headers: {
          'x-api-key': 'admin_009db543d77b6639e42e947a6281fb5668cc92c4e6e89d241d318a0212549e38',
          'x-user-id': user.uid
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.reason || 'Failed to fetch sensors');
      }
      
      const data = await response.json();
      setDeviceSensors(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to fetch sensors:', error);
      showStyledAlert("Error", error instanceof Error ? error.message : "Failed to fetch device sensors", "error");
    } finally {
      setLoadingSensors(false);
    }
  };

  // Handle sensor control
  const handleSensorControl = (device: any) => {
    setSelectedDevice(device);
    setShowSensorControlModal(true);
    fetchDeviceSensors(device.id);
  };

  // Toggle sensor state
  const toggleSensorState = async (sensor: any) => {
    if (!selectedDevice || !sensor) return;
    
    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('User not authenticated');
      }

      const newState = !sensor.enabled;  // Use enabled field from backend
      const response = await fetch(`${sensorControlApiUrl}/api/sensors/${sensor.sensor_id}/state`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'x-api-key': 'admin_009db543d77b6639e42e947a6281fb5668cc92c4e6e89d241d318a0212549e38',
          'x-user-id': user.uid
        },
        body: JSON.stringify({ enabled: newState }),
      });

      if (response.ok) {
        fetchDeviceSensors(selectedDevice.id); // Refresh sensors
        showStyledAlert("Success", `Sensor ${newState ? 'enabled' : 'disabled'}`, "success");
      } else {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 403) {
          throw new Error(errorData.reason || 'Access denied - you may be blocked');
        }
        throw new Error(errorData.error || 'Failed to toggle sensor');
      }
    } catch (error) {
      showStyledAlert("Error", error instanceof Error ? error.message : "Failed to toggle sensor state", "error");
    }
  };

  // Delete sensor
  const deleteSensor = (sensorId: number, sensorLabel: string) => {
    Alert.alert(
      "Delete Sensor",
      `Are you sure you want to delete "${sensorLabel}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "OK",
          style: "destructive",
          onPress: async () => {
            if (!selectedDevice) return;
            
            setDeletingSensorId(sensorId);
            try {
              const user = auth.currentUser;
              if (!user) {
                throw new Error('User not authenticated');
              }

              const response = await fetch(`${sensorControlApiUrl}/api/sensors/${sensorId}`, {
                method: 'DELETE',
                headers: {
                  'x-api-key': 'admin_009db543d77b6639e42e947a6281fb5668cc92c4e6e89d241d318a0212549e38',
                  'x-user-id': user.uid
                }
              });

              if (response.ok) {
                fetchDeviceSensors(selectedDevice.id);
                showStyledAlert("Success", "Sensor deleted successfully", "success");
              } else {
                const errorData = await response.json().catch(() => ({}));
                if (response.status === 403) {
                  throw new Error(errorData.reason || 'Access denied - you may be blocked');
                }
                throw new Error(errorData.error || 'Failed to delete sensor');
              }
            } catch (error) {
              showStyledAlert("Error", error instanceof Error ? error.message : "Failed to delete sensor", "error");
            } finally {
              setDeletingSensorId(null);
            }
          },
        },
      ]
    );
  };

  // Open camera stream
  const openCameraStream = (device: any) => {
    // For WebRTC streams, open the viewer page with device ID
    const cameraUrl = `${sensorControlHost}/webrtc-viewer.html?device=${device.id}`;
    
    setModalConfig({
      title: 'Open Camera Stream',
      message: `Open camera stream for ${device.label || device.name}?`,
      confirmText: 'Open Stream',
      cancelText: 'Cancel',
      isDestructive: false,
      onConfirm: () => {
        Linking.openURL(cameraUrl).catch(() => {
          showStyledAlert("Error", "Failed to open camera stream", "error");
        });
        setShowConfirmModal(false);
      }
    });
    setShowConfirmModal(true);
  };

  // Handle alert rating
  const handleRateAlert = (alert: MLAlert) => {
    setSelectedAlert(alert);
    setSelectedRating(alert.rating || null);
    setSelectedAccuracy(alert.ratingAccuracy ?? null);
    setShowRatingModal(true);
  };

  // Submit rating
  const submitRating = async () => {
    if (!selectedAlert || selectedRating === null || selectedAccuracy === null) return;

    try {
      await updateMLAlertRating(selectedAlert.id, selectedRating, selectedAccuracy);
      showStyledAlert("Success", `Alert rated ${selectedRating}/10 and marked as ${selectedAccuracy ? 'accurate' : 'inaccurate'}`, "success");
      setShowRatingModal(false);
      setSelectedAlert(null);
      setSelectedRating(null);
      setSelectedAccuracy(null);
    } catch (error) {
      showStyledAlert("Error", "Failed to save rating", "error");
    }
  };

  // Save alert retention setting
  const saveAlertRetentionSetting = async (days: AlertRetentionDays) => {
    try {
      await Promise.all([
        AsyncStorage.setItem('alertRetentionDays', days.toString()),
        saveUserAlertRetentionDays(days),
      ]);
      setAlertRetentionDays(days);
      showStyledAlert("Success", `Alerts will be retained for ${days === 0 ? 'forever' : days + ' days'}`, "success");
    } catch (error) {
      showStyledAlert("Error", "Failed to save setting", "error");
    }
  };

  // View alert image
  const viewAlertImage = (imageUri: string) => {
    setSelectedAlertImageUri(imageUri);
    setShowAlertImageModal(true);
  };

  const user = auth.currentUser;

  const formatRelativeTime = (timestamp: any) => {
    try {
      if (!timestamp?.toDate) return "just now";
      const date = timestamp.toDate();
      const diffMs = Date.now() - date.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return "just now";
      if (diffMin < 60) return `${diffMin} min${diffMin > 1 ? "s" : ""} ago`;
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return `${diffHr} hr${diffHr > 1 ? "s" : ""} ago`;
      const diffDay = Math.floor(diffHr / 24);
      return `${diffDay} day${diffDay > 1 ? "s" : ""} ago`;
    } catch {
      return "just now";
    }
  };

  const getRiskStyle = (risk?: string) => {
    const normalized = (risk || "").toLowerCase();
    if (normalized.includes("critical")) return styles.riskCritical;
    if (normalized.includes("high") || normalized.includes("medium")) return styles.riskMedium;
    return styles.riskLow;
  };

  const getDeviceOnline = (device: any) => {
    if (typeof device.active === "boolean") return device.active;
    if (typeof device.online === "boolean") return device.online;
    return true;
  };

  const getAlertImageUri = (alert: MLAlert & { imageUrl?: string }) => {
    if (alert.imageUrl) return alert.imageUrl;
    if (Array.isArray(alert.screenshots) && alert.screenshots.length > 0) {
      return alert.screenshots[0];
    }
    return "";
  };

  const getRiskBadgeLabel = (risk?: string) => {
    const normalized = (risk || "").toLowerCase();
    if (normalized.includes("critical")) return "CRITICAL";
    if (normalized.includes("high") || normalized.includes("medium")) return "MEDIUM SEVERITY";
    return "LOW";
  };

  const getTemperaturePreview = (alert: MLAlert) => {
    const meta = alert.additionalData || {};
    const labelText = [
      ...(alert.detectedObjects || []),
      ...(alert.description || []),
    ]
      .join(" ")
      .toLowerCase();
    const looksLikeTemp =
      labelText.includes("temp") ||
      labelText.includes("temperature") ||
      typeof meta.temperature === "number" ||
      typeof meta.currentTemperature === "number";

    if (!looksLikeTemp) return null;

    const reading =
      Number(meta.temperature) ||
      Number(meta.currentTemperature) ||
      Number(meta.current_temp) ||
      Number(meta.value) ||
      null;
    const limit =
      Number(meta.threshold) ||
      Number(meta.limit) ||
      Number(meta.max) ||
      Number(meta.alertThreshold) ||
      null;

    return {
      reading,
      limit,
    };
  };

  const getDeviceLastPulse = (device: any) => {
    const raw = device?.lastSeen;
    if (raw?.toDate) {
      return formatRelativeTime(raw);
    }
    if (typeof raw === "number") {
      const diffMs = Date.now() - raw;
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return "Just now";
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHr = Math.floor(diffMin / 60);
      return `${diffHr}h ago`;
    }
    return getDeviceOnline(device) ? "2m ago" : "48h ago";
  };

  const getDeviceUptime = (device: any, index: number) => {
    const source = device?.uptime ?? device?.uptimePercent;
    if (typeof source === "number") {
      return `${source.toFixed(1)}%`;
    }
    if (!getDeviceOnline(device)) return "82.4%";
    if (index === 1) return "100%";
    return "99.9%";
  };

  return (
    <LinearGradient colors={["#E5E7EB", "#E3E5E8"]} style={{ flex: 1 }}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}> 
        <View style={styles.brandWrap}>
          <View style={styles.avatarCircle}>
            {user?.photoURL ? (
              <Image source={{ uri: user.photoURL }} style={styles.avatarImage} />
            ) : (
              <MaterialIcons name="person" size={18} color="#111827" />
            )}
          </View>
        </View>
        <TouchableOpacity onPress={() => setShowProfileModal(true)} style={styles.settingsBtn}>
          <MaterialIcons name="settings" size={22} color="#64748B" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + 112 }}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === "alerts" ? (
          <>
            <View style={styles.retentionOptionsWrap}>
              {[7, 15, 30, 0].map((days) => (
                <TouchableOpacity
                  key={days}
                  style={[styles.retentionOption, alertRetentionDays === days && styles.retentionOptionActive]}
                  onPress={() => saveAlertRetentionSetting(days as 7 | 15 | 30 | 0)}
                >
                  <Text style={[styles.retentionOptionText, alertRetentionDays === days && styles.retentionOptionTextActive]}>
                    {days === 0 ? "Never" : `${days} days`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.feedHeader}>
              <View>
                <Text style={styles.feedTitle}>Live Intelligence</Text>
                <Text style={[styles.feedTitle, { marginTop: -6 }]}>Feed</Text>
              </View>
              <View style={styles.feedPills}>
                <View style={styles.livePill}><Text style={styles.livePillText}>LIVE</Text></View>
                <View style={styles.newPill}><Text style={styles.newPillText}>{retainedAlerts.length} NEW</Text></View>
              </View>
            </View>

            {loading ? (
              <ActivityIndicator size="large" style={styles.loader} />
            ) : mlAlerts.length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialIcons name="notifications-none" size={60} color="#9CA3AF" />
                <Text style={styles.emptyText}>No alerts yet</Text>
                <Text style={styles.emptySubtext}>Live detections will appear here</Text>
              </View>
            ) : (
              <>
                <FlatList
                  data={visibleAlerts}
                  scrollEnabled={false}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => {
                    const ratingValue = item.userRating ?? item.rating;
                    const imageUri = getAlertImageUri(item as MLAlert & { imageUrl?: string });
                    const tempPreview = getTemperaturePreview(item);
                    return (
                      <TouchableOpacity style={styles.alertCard} onPress={() => handleRateAlert(item)} activeOpacity={0.86}>
                        <View style={styles.alertTopRow}>
                          <View style={styles.smallDeviceIcon}><MaterialIcons name="router" size={16} color="#1D4ED8" /></View>
                          <View style={styles.alertMetaBlock}>
                            <View style={styles.alertMetaTitleRow}>
                              <Text numberOfLines={1} style={styles.alertDeviceName}>{item.deviceIdentifier || "raspberrypi-node"}</Text>
                              <View style={[styles.riskBadge, getRiskStyle(item.riskLabel)]}>
                                <Text style={styles.riskBadgeText}>{getRiskBadgeLabel(item.riskLabel)}</Text>
                              </View>
                            </View>
                            <View style={styles.alertSubRow}>
                              <MaterialIcons name="visibility" size={13} color="#111827" />
                              <Text numberOfLines={1} style={styles.alertObjects}>{item.detectedObjects?.join(" ") || "person detected"}</Text>
                            </View>
                          </View>
                        </View>

                        <View style={styles.previewWrap}>
                          {imageUri ? (
                            <Image source={{ uri: imageUri }} style={styles.previewImage} />
                          ) : tempPreview ? (
                            <View style={styles.tempPreviewCard}>
                              <Text style={styles.tempReadingText}>
                                {typeof tempPreview.reading === "number" ? `${tempPreview.reading.toFixed(1)}°C` : "28.4°C"}
                                <Text style={styles.tempLimitText}>
                                  {typeof tempPreview.limit === "number" ? ` / ${tempPreview.limit.toFixed(1)}°C Limit` : " / 22.0°C Limit"}
                                </Text>
                              </Text>
                              <View style={styles.tempDividerLine} />
                            </View>
                          ) : (
                            <LinearGradient colors={["#D1D5DB", "#9CA3AF"]} style={styles.previewImage}>
                              <MaterialIcons name="videocam" size={34} color="rgba(17,24,39,0.45)" />
                            </LinearGradient>
                          )}
                          {item.confidenceScore ? (
                            <View style={styles.confidenceChip}>
                              <View style={styles.confidenceDot} />
                              <Text style={styles.confidenceChipText}>{(item.confidenceScore * 100).toFixed(1)}% CONFIDENCE</Text>
                            </View>
                          ) : null}
                        </View>

                        <View style={styles.alertFooterRow}>
                          <View style={styles.accuratePill}>
                            <MaterialIcons name="check-circle" size={13} color="#FFFFFF" />
                            <Text style={styles.accuratePillText}>
                              {item.ratingAccuracy === false ? "Inaccurate" : "Accurate"}
                            </Text>
                          </View>
                          <View style={styles.timeDotRow}>
                            <View style={styles.timeDot} />
                            <Text style={styles.alertTime}>{formatRelativeTime(item.timestamp)}</Text>
                          </View>
                          <TouchableOpacity
                            onPress={(e) => {
                              e.stopPropagation();
                              if (imageUri) viewAlertImage(imageUri);
                            }}
                          >
                            <Text style={styles.detailsLink}>VIEW DETAILS</Text>
                          </TouchableOpacity>
                        </View>

                        {typeof ratingValue === "number" && (
                          <View style={styles.ratingHintRow}>
                            <MaterialIcons name="star" size={14} color="#F59E0B" />
                            <Text style={styles.ratingHintText}>User Rating {ratingValue}/10</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  }}
                />
                {hasMoreAlerts ? (
                  <TouchableOpacity style={styles.loadMoreBtn} onPress={handleLoadMoreAlerts}>
                    <Text style={styles.loadMoreText}>Load more alerts</Text>
                  </TouchableOpacity>
                ) : null}
              </>
            )}
          </>
        ) : (
          <>
            <Text style={styles.devicesHeading}>Connected Devices</Text>
            <Text style={styles.devicesSubHeading}>Manage and monitor your hardware ecosystem in real-time.</Text>

            <TouchableOpacity style={styles.addDeviceCta} onPress={handleAddDevice}>
              <MaterialIcons name="add" size={22} color="#FFFFFF" />
              <Text style={styles.addDeviceCtaText}>Add Device</Text>
            </TouchableOpacity>

            {loading ? (
              <ActivityIndicator size="large" style={styles.loader} />
            ) : devices.length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialIcons name="devices-other" size={60} color="#9CA3AF" />
                <Text style={styles.emptyText}>No devices connected</Text>
                <Text style={styles.emptySubtext}>Tap Add Device to claim a gateway</Text>
              </View>
            ) : (
              <FlatList
                data={devices}
                scrollEnabled={false}
                keyExtractor={(item) => item.id}
                contentContainerStyle={{ paddingTop: 8 }}
                renderItem={({ item, index }) => {
                  const isOnline = getDeviceOnline(item);
                  return (
                    <View style={styles.deviceCard}>
                      <View style={styles.deviceTopRow}>
                        <View style={styles.deviceIconWrap}><MaterialIcons name="router" size={20} color="#1D4ED8" /></View>
                        <View style={styles.deviceTitleBlock}>
                          <Text style={styles.deviceLabel}>{item.label || item.name || "raspberrypi"}</Text>
                          <Text style={styles.deviceId}>ID: {String(item.id || "N/A").toUpperCase()}</Text>
                        </View>
                        <View style={[styles.statusPill, isOnline ? styles.statusOnline : styles.statusOffline]}>
                          <Text style={[styles.statusPillText, isOnline ? styles.statusOnlineText : styles.statusOfflineText]}>
                            {isOnline ? "ACTIVE" : "OFFLINE"}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.metricRow}>
                        <Text style={styles.metricLabel}>Last Pulse</Text>
                        <Text style={[styles.metricValue, !isOnline && styles.metricDanger]}>{getDeviceLastPulse(item)}</Text>
                      </View>
                      <View style={styles.metricRow}>
                        <Text style={styles.metricLabel}>Uptime</Text>
                        <Text style={[styles.metricValue, isOnline ? styles.metricGood : null]}>{getDeviceUptime(item, index)}</Text>
                      </View>

                      <View style={styles.devicePrimaryActions}>
                        <TouchableOpacity style={styles.primaryAction} onPress={() => handleSensorControl(item)}>
                          <MaterialIcons name="settings-input-component" size={15} color="#6B7280" />
                          <Text style={styles.primaryActionText}>SENSORS</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.primaryAction} onPress={() => openCameraStream(item)}>
                          <MaterialIcons name="videocam" size={15} color="#6B7280" />
                          <Text style={styles.primaryActionText}>CAMERA</Text>
                        </TouchableOpacity>
                      </View>

                      <View style={styles.deviceSecondaryActions}>
                        <TouchableOpacity style={styles.secondaryAction} onPress={() => handleRenameDevice(item.id, item.label || item.name || "")}> 
                          <MaterialIcons name="edit" size={15} color="#0B63E6" />
                          <Text style={styles.secondaryActionBlue}>RENAME</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.secondaryAction} onPress={() => handleRemoveDevice(item.id, item.label || item.name || "Unnamed Device")}>
                          <MaterialIcons name="delete-outline" size={15} color="#D90A0A" />
                          <Text style={styles.secondaryActionRed}>REMOVE</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                }}
              />
            )}

          </>
        )}
      </ScrollView>

      <View style={[styles.bottomTabsWrap, { paddingBottom: Math.max(10, insets.bottom) }]}>
        <View style={styles.bottomTabs}>
          <TouchableOpacity
            style={[styles.bottomTabBtn, activeTab === "devices" && styles.bottomTabBtnActive]}
            onPress={() => setActiveTab("devices")}
          >
            <MaterialIcons name="router" size={20} color={activeTab === "devices" ? "#1D4ED8" : "#64748B"} />
            <Text style={[styles.bottomTabText, activeTab === "devices" && styles.bottomTabTextActive]}>DEVICES</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.bottomTabBtn, activeTab === "alerts" && styles.bottomTabBtnActive]}
            onPress={() => setActiveTab("alerts")}
          >
            <MaterialIcons name="notifications" size={20} color={activeTab === "alerts" ? "#1D4ED8" : "#64748B"} />
            <Text style={[styles.bottomTabText, activeTab === "alerts" && styles.bottomTabTextActive]}>ALERTS</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Add Device Modal */}
      <Modal
        visible={showAddModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add Device</Text>
            <Text style={styles.modalSubtitle}>Select an available device</Text>

            {loadingAvailable ? (
              <ActivityIndicator size="large" style={styles.loader} />
            ) : availableDevices.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No devices available</Text>
                <Text style={styles.emptySubtext}>No more devices left to be added</Text>
              </View>
            ) : (
              <FlatList
                data={availableDevices}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[
                      styles.availableDeviceItem,
                      claimingDeviceId === item.id && styles.loadingItem
                    ]}
                    onPress={() => handleClaimDevice(item.id, item.label || item.name)}
                    disabled={claimingDeviceId !== null}
                  >
                    <View>
                      <Text style={styles.availableDeviceLabel}>
                        {item.label || item.name}
                      </Text>
                      <Text style={styles.availableDeviceId}>ID: {item.id}</Text>
                    </View>
                    {claimingDeviceId === item.id && (
                      <ActivityIndicator size="small" color="#4A90E2" />
                    )}
                  </TouchableOpacity>
                )}
              />
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setShowAddModal(false)}
              >
                <Text style={styles.closeButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Sensor Control Modal */}
      <Modal
        visible={showSensorControlModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSensorControlModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              Sensor Control - {selectedDevice?.label || selectedDevice?.name}
            </Text>

            {loadingSensors ? (
              <ActivityIndicator size="large" style={styles.loader} />
            ) : (
              <>
                <ScrollView style={styles.sensorsContainer}>
                  {deviceSensors.map((sensor) => (
                    <View key={sensor.sensor_id} style={styles.sensorItem}>
                      <View style={styles.sensorInfo}>
                        <Text style={styles.sensorLabel}>{sensor.sensor_name}</Text>
                        <Text style={styles.sensorPin}>Pin: {sensor.pin_number}</Text>
                      </View>
                      
                      <View style={styles.sensorControls}>
                        <TouchableOpacity
                          style={[
                            styles.toggleButton,
                            sensor.enabled ? styles.activeButton : styles.inactiveButton
                          ]}
                          onPress={() => toggleSensorState(sensor)}
                        >
                          <Text style={styles.toggleButtonText}>
                            {sensor.enabled ? 'Turn Off' : 'Turn On'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </ScrollView>
              </>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setShowSensorControlModal(false)}
              >
                <Text style={styles.closeButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Alert Rating Modal */}
      <Modal
        visible={showRatingModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRatingModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Rate Alert</Text>
            <Text style={styles.modalSubtitle}>
              Device: {selectedAlert?.deviceIdentifier}
            </Text>

            {/* Accuracy Selection */}
            <View style={styles.accuracySection}>
              <Text style={styles.sectionLabel}>Was this alert accurate?</Text>
              <View style={styles.accuracyButtons}>
                <TouchableOpacity
                  style={[
                    styles.accuracyButton,
                    selectedAccuracy === true && styles.selectedAccuracyButton
                  ]}
                  onPress={() => setSelectedAccuracy(true)}
                >
                  <MaterialIcons name="check-circle" size={18} color={selectedAccuracy === true ? "#FFFFFF" : "#10B981"} style={{ marginRight: 6 }} />
                  <Text style={styles.accuracyButtonText}>Accurate</Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={[
                    styles.accuracyButton,
                    selectedAccuracy === false && styles.selectedAccuracyButton
                  ]}
                  onPress={() => setSelectedAccuracy(false)}
                >
                  <MaterialIcons name="cancel" size={18} color={selectedAccuracy === false ? "#FFFFFF" : "#EF4444"} style={{ marginRight: 6 }} />
                  <Text style={styles.accuracyButtonText}>Inaccurate</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Rating Selection */}
            <View style={styles.ratingSection}>
              <Text style={styles.sectionLabel}>Rate from 1 to 10:</Text>
              <View style={styles.ratingButtons}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((rating) => (
                  <TouchableOpacity
                    key={rating}
                    style={[
                      styles.ratingButton,
                      selectedRating === rating && styles.selectedRatingButton
                    ]}
                    onPress={() => setSelectedRating(rating)}
                  >
                    <Text style={styles.ratingButtonText}>{rating}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setShowRatingModal(false);
                  setSelectedAlert(null);
                  setSelectedRating(null);
                  setSelectedAccuracy(null);
                }}
              >
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[
                  styles.okButton,
                  (selectedRating === null || selectedAccuracy === null) && styles.disabledButton
                ]}
                onPress={submitRating}
                disabled={selectedRating === null || selectedAccuracy === null}
              >
                <Text style={styles.buttonText}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Alert Image Modal */}
      <Modal
        visible={showAlertImageModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAlertImageModal(false)}
      >
        <View style={styles.imageModalOverlay}>
          <TouchableOpacity
            style={styles.imageModalClose}
            onPress={() => setShowAlertImageModal(false)}
          >
            <MaterialIcons name="close" size={32} color="#FFFFFF" />
          </TouchableOpacity>
          
          <Image
            source={{ uri: selectedAlertImageUri }}
            style={styles.alertImage}
            resizeMode="contain"
          />
        </View>
      </Modal>

      {/* Profile Modal */}
      <Modal
        visible={showProfileModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowProfileModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Profile</Text>
            
            <View style={styles.profileInfo}>
              <MaterialIcons name="person" size={48} color="#4A90E2" />
              <Text style={styles.profileName}>{user?.displayName || "User"}</Text>
              <Text style={styles.profileEmail}>{user?.email}</Text>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setShowProfileModal(false)}
              >
                <Text style={styles.buttonText}>Close</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.logoutButton}
                onPress={handleLogout}
                disabled={loggingOut}
              >
                {loggingOut ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.buttonText}>Logout</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Custom Confirmation Modal */}
      <Modal
        visible={showConfirmModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowConfirmModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{modalConfig.title}</Text>
            <Text style={styles.modalMessage}>{modalConfig.message}</Text>
            
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setShowConfirmModal(false)}
              >
                <Text style={styles.buttonText}>{modalConfig.cancelText}</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={modalConfig.isDestructive ? styles.removeButton : styles.confirmButton}
                onPress={modalConfig.onConfirm}
              >
                <Text style={styles.buttonText}>{modalConfig.confirmText}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Custom Text Input Modal */}
      <Modal
        visible={showTextInputModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowTextInputModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{textInputConfig.title}</Text>
            <Text style={styles.modalMessage}>{textInputConfig.message}</Text>
            
            <TextInput
              style={styles.textInput}
              value={inputText}
              onChangeText={setInputText}
              placeholder={textInputConfig.placeholder}
              placeholderTextColor="#9CA3AF"
              returnKeyType="done"
              onSubmitEditing={() => {
                if (inputText.trim()) {
                  textInputConfig.onConfirm(inputText.trim());
                }
              }}
            />
            
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setShowTextInputModal(false);
                  setInputText('');
                }}
              >
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.confirmButton}
                onPress={() => {
                  if (inputText.trim()) {
                    textInputConfig.onConfirm(inputText.trim());
                  }
                }}
              >
                <Text style={styles.buttonText}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Styled Alert */}
      <StyledAlert
        {...styledAlertConfig}
        visible={styledAlertVisible}
        onClose={() => setStyledAlertVisible(false)}
      />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: "#ECEDEF",
  },
  brandWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  avatarCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
  },
  brandTitle: {
    fontSize: 32 / 2,
    fontWeight: "700",
    color: "#111827",
    letterSpacing: 0.2,
  },
  settingsBtn: {
    padding: 4,
  },
  headingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginTop: 8,
    marginBottom: 14,
  },
  retentionOptionsWrap: {
    flexDirection: "row",
    backgroundColor: "#E0E2E7",
    borderRadius: 12,
    padding: 5,
    justifyContent: "space-between",
    marginBottom: 24,
    marginTop: 4,
  },
  retentionOptions: {
    flexDirection: "row",
    backgroundColor: "#D9DBDF",
    borderRadius: 10,
    padding: 4,
    justifyContent: "space-between",
  },
  retentionOption: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  retentionOptionActive: {
    backgroundColor: "#FFFFFF",
  },
  retentionOptionText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#4B5563",
  },
  retentionOptionTextActive: {
    color: "#111827",
  },
  feedHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  feedTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: "#0F172A",
    lineHeight: 32,
  },
  feedPills: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  livePill: {
    backgroundColor: "#CDE8D7",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  livePillText: {
    fontSize: 10,
    color: "#0B8A44",
    fontWeight: "800",
  },
  newPill: {
    backgroundColor: "#D5D8DF",
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  newPillText: {
    fontSize: 10,
    color: "#1F2937",
    fontWeight: "700",
  },
  loader: {
    marginVertical: 32,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 17,
    color: "#475569",
    fontWeight: "700",
  },
  emptySubtext: {
    marginTop: 4,
    fontSize: 13,
    color: "#64748B",
  },
  alertCard: {
    backgroundColor: "#F5F6F7",
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
  },
  alertTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  smallDeviceIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#DDE5F5",
    alignItems: "center",
    justifyContent: "center",
  },
  alertMetaBlock: {
    flex: 1,
  },
  alertMetaTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  alertDeviceName: {
    flex: 1,
    fontSize: 28 / 2,
    fontWeight: "700",
    color: "#111827",
  },
  riskBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  riskBadgeText: {
    fontSize: 9,
    fontWeight: "800",
  },
  riskCritical: {
    backgroundColor: "#CC1111",
  },
  riskMedium: {
    backgroundColor: "#F4C7C6",
  },
  riskLow: {
    backgroundColor: "#E6E7EB",
  },
  alertSubRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  alertObjects: {
    fontSize: 13,
    color: "#3F3F46",
    flex: 1,
  },
  previewWrap: {
    marginTop: 10,
    borderRadius: 8,
    overflow: "hidden",
    position: "relative",
  },
  previewImage: {
    width: "100%",
    height: 145,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#D1D5DB",
  },
  tempPreviewCard: {
    width: "100%",
    height: 145,
    borderRadius: 8,
    backgroundColor: "#E5E7EB",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  tempReadingText: {
    color: "#C91414",
    fontSize: 40 / 2,
    fontWeight: "800",
  },
  tempLimitText: {
    color: "#374151",
    fontSize: 24 / 2,
    fontWeight: "700",
  },
  tempDividerLine: {
    marginTop: 10,
    height: 5,
    width: "88%",
    borderRadius: 3,
    backgroundColor: "#D12020",
  },
  confidenceChip: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "#FFFFFFE6",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  confidenceDot: {
    width: 7,
    height: 7,
    borderRadius: 99,
    backgroundColor: "#CC1111",
  },
  confidenceChipText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#111827",
  },
  alertFooterRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  accuratePill: {
    backgroundColor: "#0B8A44",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  accuratePillText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "700",
  },
  timeDotRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  timeDot: {
    width: 7,
    height: 7,
    borderRadius: 99,
    backgroundColor: "#64748B",
  },
  alertTime: {
    fontSize: 11,
    color: "#475569",
  },
  detailsLink: {
    fontSize: 12,
    fontWeight: "800",
    color: "#1D4ED8",
  },
  ratingHintRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  ratingHintText: {
    fontSize: 12,
    color: "#334155",
    fontWeight: "600",
  },
  loadMoreBtn: {
    alignSelf: "center",
    marginTop: 4,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  loadMoreText: {
    color: "#1D4ED8",
    fontSize: 14,
    fontWeight: "700",
  },
  devicesHeading: {
    marginTop: 6,
    fontSize: 41 / 2,
    fontWeight: "800",
    color: "#111827",
  },
  devicesSubHeading: {
    marginTop: 6,
    fontSize: 16 / 1.3,
    color: "#1F2937",
    maxWidth: "92%",
    lineHeight: 22,
  },
  addDeviceCta: {
    marginTop: 16,
    marginBottom: 18,
    backgroundColor: "#0B63E6",
    borderRadius: 12,
    minHeight: 44,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    shadowColor: "#0B63E6",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  addDeviceCtaText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 22 / 2,
  },
  deviceCard: {
    backgroundColor: "#F1F2F4",
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  deviceTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  deviceIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "#D8E1F5",
    alignItems: "center",
    justifyContent: "center",
  },
  deviceTitleBlock: {
    flex: 1,
  },
  deviceLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
  },
  deviceId: {
    marginTop: 3,
    color: "#6B7280",
    fontSize: 12,
    letterSpacing: 0.7,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 6,
  },
  statusOnline: {
    backgroundColor: "#0B8A44",
  },
  statusOffline: {
    backgroundColor: "#F2D0D0",
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: "800",
  },
  statusOnlineText: {
    color: "#FFFFFF",
  },
  statusOfflineText: {
    color: "#991B1B",
  },
  metricRow: {
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  metricLabel: {
    fontSize: 15 / 1.2,
    color: "#374151",
  },
  metricValue: {
    fontSize: 14 / 1.1,
    color: "#111827",
    fontWeight: "600",
  },
  metricDanger: {
    color: "#C81E1E",
  },
  metricGood: {
    color: "#0B8A44",
  },
  devicePrimaryActions: {
    marginTop: 14,
    flexDirection: "row",
    gap: 10,
  },
  primaryAction: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: "#D2D6DC",
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  primaryActionText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#4B5563",
    letterSpacing: 0.8,
  },
  deviceSecondaryActions: {
    marginTop: 14,
    flexDirection: "row",
    justifyContent: "space-around",
  },
  secondaryAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  secondaryActionBlue: {
    color: "#0B63E6",
    fontWeight: "700",
    fontSize: 13,
    letterSpacing: 0.6,
  },
  secondaryActionRed: {
    color: "#D90A0A",
    fontWeight: "700",
    fontSize: 13,
    letterSpacing: 0.6,
  },
  bottomTabsWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    backgroundColor: "#E5E7EB",
  },
  bottomTabs: {
    flexDirection: "row",
    backgroundColor: "#ECEDEF",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
    justifyContent: "space-between",
  },
  bottomTabBtn: {
    width: "45%",
    borderRadius: 12,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  bottomTabBtnActive: {
    backgroundColor: "#C9D8EE",
  },
  bottomTabText: {
    fontSize: 11,
    color: "#64748B",
    fontWeight: "700",
    letterSpacing: 0.9,
  },
  bottomTabTextActive: {
    color: "#1D4ED8",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 20,
    width: "100%",
    maxHeight: "80%",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1F2937",
    marginBottom: 8,
    textAlign: "center",
  },
  modalSubtitle: {
    fontSize: 14,
    color: "#6B7280",
    marginBottom: 20,
    textAlign: "center",
  },
  availableDeviceItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderRadius: 8,
    backgroundColor: "#F9FAFB",
    marginBottom: 8,
  },
  loadingItem: {
    opacity: 0.6,
  },
  availableDeviceLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1F2937",
  },
  availableDeviceId: {
    fontSize: 14,
    color: "#6B7280",
  },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 20,
    gap: 12,
  },
  closeButton: {
    flex: 1,
    backgroundColor: "#6B7280",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  closeButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  sensorsContainer: {
    maxHeight: 300,
    marginBottom: 20,
  },
  sensorItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    backgroundColor: "#F9FAFB",
    borderRadius: 8,
    marginBottom: 8,
  },
  sensorInfo: {
    flex: 1,
  },
  sensorLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1F2937",
  },
  sensorPin: {
    fontSize: 14,
    color: "#6B7280",
  },
  sensorControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  toggleButton: {
    minWidth: 96,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: "center",
  },
  activeButton: {
    backgroundColor: "#10B981",
  },
  inactiveButton: {
    backgroundColor: "#6B7280",
  },
  toggleButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
  deleteSensorButton: {
    padding: 6,
  },
  accuracySection: {
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1F2937",
    marginBottom: 12,
  },
  accuracyButtons: {
    flexDirection: "row",
    gap: 12,
  },
  accuracyButton: {
    flex: 1,
    flexDirection: "row",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },
  selectedAccuracyButton: {
    backgroundColor: "#4A90E2",
  },
  accuracyButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1F2937",
  },
  ratingSection: {
    marginBottom: 20,
  },
  ratingButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
  },
  ratingButton: {
    width: "18%",
    height: 50,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 8,
    backgroundColor: "#F3F4F6",
  },
  selectedRatingButton: {
    backgroundColor: "#4A90E2",
  },
  ratingButtonText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1F2937",
    textAlign: "center",
  },
  cancelButton: {
    flex: 1,
    backgroundColor: "#6B7280",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  okButton: {
    flex: 1,
    backgroundColor: "#10B981",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  confirmButton: {
    flex: 1,
    backgroundColor: "#4A90E2",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  removeButton: {
    flex: 1,
    backgroundColor: "#EF4444",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  modalMessage: {
    fontSize: 16,
    color: "#374151",
    marginBottom: 20,
    textAlign: "center",
    lineHeight: 22,
  },
  textInput: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 20,
    backgroundColor: "#FFFFFF",
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  imageModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.9)",
    justifyContent: "center",
    alignItems: "center",
  },
  imageModalClose: {
    position: "absolute",
    top: 60,
    right: 20,
    zIndex: 1,
  },
  alertImage: {
    width: "90%",
    height: "70%",
  },
  profileInfo: {
    alignItems: "center",
    marginVertical: 20,
  },
  profileName: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1F2937",
    marginTop: 12,
  },
  profileEmail: {
    fontSize: 16,
    color: "#6B7280",
    marginTop: 4,
  },
  logoutButton: {
    flex: 1,
    backgroundColor: "#EF4444",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
});