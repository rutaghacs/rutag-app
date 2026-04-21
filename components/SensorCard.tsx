import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useSensorData } from '../hooks/useSensorData-production';
import { auth } from '../firebase/firebaseConfig';

interface Props {
  sensorId: number | string;
  sensorName: string;
  sensorType: string;
  unit: string;
  deviceName?: string;
  deviceId?: string;
}

export default function SensorCard({
  sensorId,
  sensorName,
  sensorType,
  unit,
  deviceName,
  deviceId,
}: Props) {
  const router = useRouter();
  const userId = auth.currentUser?.uid || '';
  
  // Check if this is a DHT11 sensor BEFORE calling useSensorData
  const isDHT11 = sensorType === 'temperature_humidity' || sensorType === 'dht11';
  
  // Only fetch readings/stats for non-DHT11 sensors
  const { readings, stats, loading, error } = useSensorData(
    sensorId as number, 
    24, 
    undefined, 
    userId,
    !isDHT11  // Only enable for non-DHT11 sensors
  );
  
  // For DHT11/temperature_humidity sensors, fetch from sensor list endpoint
  const [dht11Data, setDht11Data] = useState<{temperature: number | null; humidity: number | null; timestamp: string} | null>(null);
  const [dht11Loading, setDht11Loading] = useState(true);
  
  useEffect(() => {
    if (!isDHT11) return;
    
    const sensorControlHost = (process.env.EXPO_PUBLIC_SENSOR_CONTROL_URL || process.env.EXPO_PUBLIC_API_URL || 'http://13.205.201.82').replace(/\/$/, '');
    const API_URL = sensorControlHost.endsWith('/sensor-api')
      ? sensorControlHost
      : `${sensorControlHost}/sensor-api`;
    
    const fetchDHT11Data = async () => {
      try {
        const apiKey = 'admin_009db543d77b6639e42e947a6281fb5668cc92c4e6e89d241d318a0212549e38';
        const response = await fetch(`${API_URL}/api/sensors`, {
          headers: {
            'x-api-key': apiKey,
          },
        });
        if (response.ok) {
          const sensors = await response.json();
          const sensor = Array.isArray(sensors) ? sensors.find(s => String(s.sensor_id) === String(sensorId)) : null;
          if (sensor) {
            setDht11Data({
              temperature: sensor.temperature || null,
              humidity: sensor.humidity || null,
              timestamp: sensor.updated_at || new Date().toISOString(),
            });
          }
        }
      } catch (err) {
        console.error('[SensorCard] Error fetching DHT11 data:', err);
      } finally {
        setDht11Loading(false);
      }
    };
    
    fetchDHT11Data();
    // Refresh every 60 seconds
    const interval = setInterval(fetchDHT11Data, 60000);
    return () => clearInterval(interval);
  }, [sensorId, isDHT11]);

  const handlePress = () => {
    router.push({
      pathname: '/sensor-detail',
      params: {
        sensorId: String(sensorId),
        sensorName,
        sensorType,
        unit,
        deviceId: deviceId || deviceName,
      },
    });
  };

  // Map old sensor names to new display names
  const getDisplayName = (name: string) => {
    const nameMap: { [key: string]: string } = {
      'Battery Level': 'Humidity',
      'GPU Temperature': 'Ambient Temperature',
      'Disk Usage': 'PM 2.5',
      'Memory Usage': 'PM10',
      'CPU Temperature': 'Device CPU Temperature',
    };
    return nameMap[name] || name;
  };

  const displayName = getDisplayName(sensorName);

  // For DHT11 sensors, show temperature as main value
  const currentValue = isDHT11 
    ? dht11Data?.temperature?.toFixed(1) 
    : readings?.[0]?.value?.toFixed(2);
    
  const avgValue = stats?.avg_value ? stats.avg_value.toFixed(2) : '--';
  const minValue = stats?.min_value ? stats.min_value.toFixed(2) : '--';
  const maxValue = stats?.max_value ? stats.max_value.toFixed(2) : '--';
  const readingCount = stats?.reading_count || 0;

  // Use appropriate loading state
  const isLoading = isDHT11 ? dht11Loading : loading;

  // Professional laboratory monitoring color gradients
  const getGradientColors = () => {
    switch (sensorType) {
      case 'temperature':
      case 'temperature_humidity':
      case 'dht11':
        return ['#E53E3E', '#C53030'] as const; // Clean red gradient
      case 'humidity':
        return ['#3182CE', '#2B77CB'] as const; // Professional blue
      case 'pressure':
        return ['#38A169', '#2F855A'] as const; // Clinical green
      case 'memory':
        return ['#D69E2E', '#B7791F'] as const; // Subtle amber
      case 'wind_speed':
        return ['#4A5568', '#2D3748'] as const; // Professional gray
      case 'rainfall':
        return ['#3182CE', '#2C5F7C'] as const; // Deep blue
      default:
        return ['#553C9A', '#44337A'] as const; // Laboratory purple
    }
  };

  const getSensorIcon = () => {
    switch (sensorType) {
      case 'temperature':
      case 'temperature_humidity':
      case 'dht11':
        return 'device-thermostat';
      case 'humidity':
        return 'water-drop';
      case 'pressure':
        return 'speed';
      case 'memory':
        return 'memory';
      case 'wind_speed':
        return 'air';
      case 'rainfall':
        return 'grain';
      default:
        return 'science';
    }
  };

  if (error) {
    return (
      <View style={styles.errorCard}>
        <Text style={styles.errorText}>Error: {error}</Text>
      </View>
    );
  }

  return (
    <TouchableOpacity onPress={handlePress} activeOpacity={0.8}>
      <LinearGradient
        colors={getGradientColors()}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
      <View style={styles.header}>
        <View style={styles.titleContainer}>
          <MaterialIcons
            name={getSensorIcon()}
            size={18}
            color="#fff"
            style={styles.icon}
          />
          <View>
            <Text style={styles.title}>{displayName}</Text>
            {deviceName && (
              <Text style={styles.device}>{deviceName}</Text>
            )}
          </View>
        </View>
        {isLoading && <ActivityIndicator size="small" color="#fff" />}
      </View>

      <View style={styles.mainValue}>
        {isLoading && !currentValue ? (
          <ActivityIndicator size="large" color="#fff" />
        ) : (
          <>
            <Text style={styles.currentValue}>{currentValue || '--'}</Text>
            <Text style={styles.unit}>{unit}</Text>
          </>
        )}
      </View>

      {stats && (
        <View style={styles.statsContainer}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Avg</Text>
            <Text style={styles.statValue}>{avgValue}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Min</Text>
            <Text style={styles.statValue}>{minValue}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Max</Text>
            <Text style={styles.statValue}>{maxValue}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Readings</Text>
            <Text style={styles.statValue}>{readingCount}</Text>
          </View>
        </View>
      )}
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  icon: {
    marginRight: 6,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: 0.3,
  },
  device: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.9)',
    marginTop: 2,
    fontWeight: '500',
  },
  mainValue: {
    alignItems: 'center',
    marginVertical: 8,
  },
  currentValue: {
    fontSize: 32,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.5,
  },
  unit: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.95)',
    marginTop: 3,
    fontWeight: '500',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginTop: 4,
  },
  stat: {
    alignItems: 'center',
    flex: 1,
  },
  statDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginHorizontal: 4,
  },
  statLabel: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '600',
  },
  statValue: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    marginTop: 1,
  },
  errorCard: {
    backgroundColor: '#FF6B6B',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  errorText: {
    color: '#fff',
    fontSize: 12,
  },
});

