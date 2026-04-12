import { useEffect, useState } from 'react';

export interface SensorReading {
  time: string;
  sensor_id: number;
  value: number;
  quality: number;
  created_at: string;
}

export interface SensorStats {
  min_value: number;
  max_value: number;
  avg_value: number;
  stddev_value: number;
  reading_count: number;
  oldest_reading: string;
  latest_reading: string;
}

export interface Sensor {
  sensor_id: number;
  device_id: string;
  sensor_name: string;
  sensor_type: string;
  location: string;
  unit: string;
  min_value: number;
  max_value: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Device {
  device_id: string;
  device_name: string;
  device_type: string;
  location: string;
  firmware_version: string | null;
  ip_address: string | null;
  last_online: string | null;
  is_online: boolean;
  created_at: string;
  updated_at: string;
  sensor_count?: number;
}

const API_URL = 'http://192.168.43.211:3000'; // Change to your backend IP

/**
 * Hook to fetch sensor readings with auto-refresh
 */
export function useSensorData(sensorId: number, hours: number = 24) {
  const [readings, setReadings] = useState<SensorReading[]>([]);
  const [stats, setStats] = useState<SensorStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Fetch readings
        const readingsResponse = await fetch(
          `${API_URL}/api/readings/${sensorId}?hours=${hours}&limit=500`
        );
        if (!readingsResponse.ok) throw new Error('Failed to fetch readings');
        const readingsData = await readingsResponse.json();
        setReadings(readingsData);

        // Fetch stats
        const statsResponse = await fetch(
          `${API_URL}/api/readings/stats/${sensorId}?hours=${hours}`
        );
        if (!statsResponse.ok) throw new Error('Failed to fetch stats');
        const statsData = await statsResponse.json();
        setStats(statsData);

        setError(null);
      } catch (err) {
        console.error('Error fetching sensor data:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    
    // Auto-refresh every 5 seconds
    const interval = setInterval(fetchData, 5000);
    
    return () => clearInterval(interval);
  }, [sensorId, hours]);

  return { readings, stats, loading, error };
}

/**
 * Hook to fetch all sensors for a device or all sensors
 */
export function useSensors(deviceId?: string) {
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSensors = async () => {
      try {
        setLoading(true);
        
        const url = deviceId
          ? `${API_URL}/api/sensors?deviceId=${deviceId}`
          : `${API_URL}/api/sensors`;
        
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch sensors');
        const data = await response.json();
        setSensors(data);
        
        setError(null);
      } catch (err) {
        console.error('Error fetching sensors:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchSensors();
    
    // Refresh every 10 seconds
    const interval = setInterval(fetchSensors, 10000);
    
    return () => clearInterval(interval);
  }, [deviceId]);

  return { sensors, loading, error };
}

/**
 * Hook to fetch all devices
 */
export function useDevices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDevices = async () => {
      try {
        setLoading(true);
        
        const response = await fetch(`${API_URL}/api/devices`);
        if (!response.ok) throw new Error('Failed to fetch devices');
        const data = await response.json();
        setDevices(data);
        
        setError(null);
      } catch (err) {
        console.error('Error fetching devices:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchDevices();
    
    // Refresh every 10 seconds
    const interval = setInterval(fetchDevices, 10000);
    
    return () => clearInterval(interval);
  }, []);

  return { devices, loading, error };
}
