import React, { useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const sensorControlHost = (process.env.EXPO_PUBLIC_SENSOR_CONTROL_URL || process.env.EXPO_PUBLIC_API_URL || 'http://13.205.201.82').replace(/\/$/, '');
const API_URL = sensorControlHost.endsWith('/sensor-api')
  ? sensorControlHost
  : `${sensorControlHost}/sensor-api`;

interface SensorReading {
  sensor_id: string;
  temperature: number | null;
  humidity: number | null;
  timestamp: string;
}

interface DHT11SensorProps {
  sensorId: string;
  sensorName?: string;
  deviceId?: string;
}

export interface DHT11SensorHandle {
  refresh: () => Promise<void>;
}

export const DHT11Sensor = forwardRef<DHT11SensorHandle, DHT11SensorProps>(({
  sensorId,
  sensorName = 'DHT11 Sensor',
  deviceId,
}, ref) => {
  const [reading, setReading] = useState<SensorReading | null>(null);
  const [loading, setLoading] = useState(true);
  const [sensorEnabled, setSensorEnabled] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch latest sensor reading (memoized so it can be reused)
  const fetchSensorData = useCallback(async () => {
    if (!sensorId) {
      setError('Invalid sensor ID');
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      setError(null);
      const apiKey = 'admin_009db543d77b6639e42e947a6281fb5668cc92c4e6e89d241d318a0212549e38';
      
      // Fetch sensor list to get status (backend uses sensorId from list)
      const listUrl = `${API_URL}/api/sensors`;
      const listResponse = await fetch(listUrl, {
        headers: {
          'x-api-key': apiKey,
        },
      });
      
      if (!listResponse.ok) {
        const contentType = listResponse.headers.get('content-type');
        let errorMessage = `Failed to fetch sensor data: ${listResponse.status}`;
        
        if (contentType?.includes('application/json')) {
          try {
            const data = await listResponse.json();
            errorMessage = data.error || errorMessage;
          } catch (e) {
            console.error('[DHT11] Failed to parse error response:', e);
          }
        }
        
        throw new Error(errorMessage);
      }
      
      const sensors = await listResponse.json();
      const sensor = Array.isArray(sensors) ? sensors.find(s => String(s.sensor_id) === String(sensorId)) : null;
      
      if (sensor) {
        setReading({
          sensor_id: String(sensor.sensor_id),
          temperature: sensor.temperature || null,
          humidity: sensor.humidity || null,
          timestamp: sensor.updated_at || new Date().toISOString(),
        });
        setSensorEnabled(sensor.enabled !== false);
      }
    } catch (err) {
      console.error('[DHT11] Sensor fetch error:', err);
      const errorMsg = err instanceof Error ? `${err.message}\nURL: ${API_URL}/api/sensors` : `Failed to fetch sensor data\nURL: ${API_URL}/api/sensors`;
      setError(errorMsg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [sensorId]);

  // Expose refresh method to parent - defined AFTER fetchSensorData
  useImperativeHandle(ref, () => ({
    refresh: async () => {
      await fetchSensorData();
    }
  }), [fetchSensorData]);

  // Initial fetch and auto-refresh setup
  useEffect(() => {
    // Fetch immediately on mount or when sensorId changes
    fetchSensorData();
    
    // Refresh every 60 seconds (to avoid rate limiting)
    const interval = setInterval(() => {
      fetchSensorData();
    }, 60000);
    
    return () => clearInterval(interval);
  }, [sensorId, fetchSensorData]);

  // Control sensor on/off
  const controlSensor = async (action: 'on' | 'off') => {
    try {
      setError(null);
      const apiKey = 'admin_009db543d77b6639e42e947a6281fb5668cc92c4e6e89d241d318a0212549e38';
      const newState = action === 'on';
      
      const response = await fetch(`${API_URL}/api/sensors/${sensorId}/state`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-user-id': 'dht11-sensor-control',
        },
        body: JSON.stringify({ enabled: newState }),
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        let errorMessage = `Failed to control sensor: ${response.status}`;
        
        if (contentType?.includes('application/json')) {
          try {
            const data = await response.json();
            errorMessage = data.error || data.reason || errorMessage;
          } catch (e) {
            // Ignore JSON parse error
          }
        }
        
        throw new Error(errorMessage);
      }

      const data = await response.json();
      
      // Update status immediately from API response
      setSensorEnabled(data.sensor?.enabled !== false);
      
      // Refresh data after control action to get latest status
      setTimeout(() => {
        fetchSensorData();
      }, 500);
      
      Alert.alert(
        'Success',
        `Sensor turned ${action.toUpperCase()}`
      );
    } catch (err) {
      console.error('Control error:', err);
      const errorMsg = err instanceof Error
        ? `${err.message}\nURL: ${API_URL}/api/sensors/${sensorId}/state`
        : `Failed to control sensor\nURL: ${API_URL}/api/sensors/${sensorId}/state`;
      setError(errorMsg);
      Alert.alert('Error', errorMsg);
    }
  };

  if (!sensorId) {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Invalid sensor ID</Text>
        </View>
      </View>
    );
  }

  if (loading && !refreshing) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {error && (
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={20} color="#ef4444" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Sensor Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.sensorName}>{sensorName}</Text>
          <Text style={styles.sensorId}>ID: {sensorId}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: sensorEnabled ? '#10b981' : '#ef4444' }]}>
          <Text style={styles.statusText}>{sensorEnabled ? 'ACTIVE' : 'INACTIVE'}</Text>
        </View>
      </View>

      {/* Readings */}
      <View style={styles.readingsContainer}>
        {/* Temperature */}
        <View style={styles.readingCard}>
          <View style={styles.readingHeader}>
            <Ionicons name="thermometer" size={28} color="#ef4444" />
            <Text style={styles.readingLabel}>Temperature</Text>
          </View>
          <Text style={styles.readingValue}>
            {reading?.temperature !== null && reading?.temperature !== undefined
              ? `${reading.temperature.toFixed(1)}°C`
              : 'No data'}
          </Text>
          <Text style={styles.readingTime}>
            {reading?.timestamp
              ? new Date(reading.timestamp).toLocaleTimeString()
              : '--:--:--'}
          </Text>
        </View>

        {/* Humidity */}
        <View style={styles.readingCard}>
          <View style={styles.readingHeader}>
            <Ionicons name="water" size={28} color="#3b82f6" />
            <Text style={styles.readingLabel}>Humidity</Text>
          </View>
          <Text style={styles.readingValue}>
            {reading?.humidity !== null && reading?.humidity !== undefined
              ? `${reading.humidity.toFixed(1)}%`
              : 'No data'}
          </Text>
          <Text style={styles.readingTime}>
            {reading?.timestamp
              ? new Date(reading.timestamp).toLocaleTimeString()
              : '--:--:--'}
          </Text>
        </View>
      </View>

      {/* Control Buttons */}
      <View style={styles.controlContainer}>
        <TouchableOpacity
          style={[
            styles.controlButton,
            { backgroundColor: sensorEnabled ? '#ef4444' : '#10b981' },
          ]}
          onPress={() => controlSensor(sensorEnabled ? 'off' : 'on')}
        >
          <Ionicons
            name={sensorEnabled ? 'power' : 'power-outline'}
            size={24}
            color="white"
            style={{ marginRight: 8 }}
          />
          <Text style={styles.controlButtonText}>
            {sensorEnabled ? 'TURN OFF' : 'TURN ON'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Info Section */}
      <View style={styles.infoSection}>
        <Text style={styles.infoTitle}>Sensor Information</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Sensor Type:</Text>
          <Text style={styles.infoValue}>DHT11</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Sensor ID:</Text>
          <Text style={styles.infoValue}>{sensorId}</Text>
        </View>
        {deviceId && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Device ID:</Text>
            <Text style={styles.infoValue}>{deviceId}</Text>
          </View>
        )}
        {reading?.timestamp && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Last Update:</Text>
            <Text style={styles.infoValue}>
              {new Date(reading.timestamp).toLocaleString()}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
});

DHT11Sensor.displayName = 'DHT11Sensor';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sensorName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1f2937',
  },
  sensorId: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 4,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  errorContainer: {
    flexDirection: 'row',
    backgroundColor: '#fee2e2',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    alignItems: 'center',
  },
  errorText: {
    color: '#991b1b',
    marginLeft: 8,
    fontSize: 14,
    flex: 1,
  },
  readingsContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  readingCard: {
    flex: 1,
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  readingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  readingLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginLeft: 8,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  readingValue: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1f2937',
    marginBottom: 4,
  },
  readingTime: {
    fontSize: 10,
    color: '#9ca3af',
  },
  controlContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  controlButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: '#10b981',
  },
  controlButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  refreshButton: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: 'white',
    borderWidth: 2,
    borderColor: '#3b82f6',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  refreshButtonText: {
    color: '#3b82f6',
    fontSize: 12,
    fontWeight: '600',
  },
  infoSection: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  infoLabel: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 13,
    color: '#1f2937',
    fontWeight: '600',
  },
});

export default DHT11Sensor;
