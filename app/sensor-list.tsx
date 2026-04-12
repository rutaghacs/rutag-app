import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import SensorCard from "../components/SensorCard";
import { useSensors } from "../hooks/useSensorData-production";

export default function SensorListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { deviceId, deviceName } = useLocalSearchParams<{ deviceId: string; deviceName: string }>();

  // Fetch sensors for this specific device
  const { sensors, loading, error } = useSensors(deviceId);

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={styles.title}>📊 Sensors</Text>
          <Text style={styles.deviceName}>{deviceName}</Text>
          <Text style={styles.deviceId}>{deviceId}</Text>
        </View>
      </View>

      {/* Content */}
      <View style={styles.content}>
        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>Error: {error}</Text>
          </View>
        )}

        {loading ? (
          <ActivityIndicator size="large" color="#0066cc" style={styles.loader} />
        ) : sensors.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialIcons name="sensors" size={48} color="#ccc" />
            <Text style={styles.emptyText}>No sensors found</Text>
            <Text style={styles.emptySubtext}>Add sensors to this device</Text>
          </View>
        ) : (
          <FlatList
              data={sensors}
              scrollEnabled={true}
              keyExtractor={(item) => item.sensor_id.toString()}
              renderItem={({ item }) => (
                <SensorCard
                  sensorId={item.sensor_id}
                  sensorName={item.sensor_name}
                  sensorType={item.sensor_type}
                  unit={item.unit}
                  deviceName={item.device_id}
                  deviceId={deviceId}
                />
              )}
              contentContainerStyle={styles.listContent}
            />

        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    elevation: 2,
  },
  headerContent: {
    marginLeft: 12,
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
  deviceName: {
    fontSize: 14,
    fontWeight: "500",
    color: "#666",
    marginTop: 2,
  },
  deviceId: {
    fontSize: 12,
    color: "#999",
    marginTop: 2,
  },
  content: {
    flex: 1,
    padding: 12,
  },
  loader: {
    flex: 1,
    justifyContent: "center",
  },
  errorContainer: {
    backgroundColor: "#ffebee",
    padding: 16,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: "#f44336",
  },
  errorText: {
    color: "#c62828",
    fontSize: 14,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#999",
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 14,
    color: "#ccc",
    marginTop: 4,
  },
  listContent: {
    paddingBottom: 16,
  },
});
