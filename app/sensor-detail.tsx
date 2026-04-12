import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { useState, useCallback, useRef } from "react";
import DHT11Sensor, { DHT11SensorHandle } from "../components/DHT11Sensor";

export default function SensorDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const sensorRef = useRef<DHT11SensorHandle>(null);
  
  const { 
    sensorId, 
    sensorName, 
    sensorType, 
    deviceId,
    unit 
  } = useLocalSearchParams<{ 
    sensorId: string; 
    sensorName: string;
    sensorType: string;
    deviceId: string;
    unit: string;
  }>();

  // Check if this is a temperature/humidity sensor (DHT11)
  const isDHT11 = sensorType === 'temperature_humidity' || sensorType === 'dht11' || sensorName?.toLowerCase().includes('dht11');

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (sensorRef.current && isDHT11) {
        await sensorRef.current.refresh();
      }
    } catch (err) {
      console.error('[SensorDetail] Error during refresh:', err);
    } finally {
      setRefreshing(false);
    }
  }, [isDHT11]);

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={styles.title}>{sensorName}</Text>
          <Text style={styles.subtitle}>{sensorType}</Text>
          {deviceId && <Text style={styles.deviceId}>{deviceId}</Text>}
        </View>
      </View>

      {/* Content */}
      <ScrollView 
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {isDHT11 ? (
          // Show DHT11 sensor component
          <DHT11Sensor
            ref={sensorRef}
            sensorId={sensorId || ''}
            sensorName={sensorName}
            deviceId={deviceId}
          />
        ) : (
          // Show generic sensor info for other types
          <View style={styles.genericSensorContainer}>
            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>Sensor Information</Text>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Sensor ID:</Text>
                <Text style={styles.infoValue}>{sensorId}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Sensor Type:</Text>
                <Text style={styles.infoValue}>{sensorType}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Unit:</Text>
                <Text style={styles.infoValue}>{unit || 'N/A'}</Text>
              </View>
              {deviceId && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Device ID:</Text>
                  <Text style={styles.infoValue}>{deviceId}</Text>
                </View>
              )}
            </View>

            <View style={styles.notSupportedCard}>
              <MaterialIcons name="info" size={48} color="#6b7280" />
              <Text style={styles.notSupportedText}>
                This sensor type is not yet configured for real-time monitoring.
              </Text>
              <Text style={styles.notSupportedSubtext}>
                Please configure it through the admin portal.
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f3f4f6",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  headerContent: {
    marginLeft: 12,
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1f2937",
  },
  subtitle: {
    fontSize: 13,
    color: "#6b7280",
    marginTop: 2,
  },
  deviceId: {
    fontSize: 11,
    color: "#9ca3af",
    marginTop: 2,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  genericSensorContainer: {
    gap: 16,
  },
  infoCard: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1f2937",
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  infoLabel: {
    fontSize: 13,
    color: "#6b7280",
    fontWeight: "500",
  },
  infoValue: {
    fontSize: 13,
    color: "#1f2937",
    fontWeight: "600",
  },
  notSupportedCard: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  notSupportedText: {
    fontSize: 14,
    color: "#4b5563",
    textAlign: "center",
    marginTop: 12,
    fontWeight: "500",
  },
  notSupportedSubtext: {
    fontSize: 12,
    color: "#9ca3af",
    textAlign: "center",
    marginTop: 8,
  },
});
