import { useEffect, useState } from 'react';

/**
 * 🚀 Production-Ready API Configuration
 * Environment-based, no hardcoded IPs
 * Works across any network via DNS
 */

// Get API URL from environment (or fallback to default)
const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://api.yourdomain.com';
const API_KEY = process.env.EXPO_PUBLIC_API_KEY || '';

// ============================================
// API REQUEST HELPER
// ============================================

/**
 * Make authenticated API request
 * Includes JWT token and user ID for access control
 */
async function apiRequest(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: any,
  token?: string,
  userId?: string
) {
  const url = `${API_URL}${endpoint}`;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY,
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  // Add user ID for access control
  if (userId) {
    headers['x-user-id'] = userId;
  }
  
  const options: RequestInit = {
    method,
    headers,
  };
  
  if (body && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(body);
  }
  
  try {
    console.log(`[API] ${method} ${url}`);
    console.log(`[API] Headers:`, JSON.stringify(headers));
    
    const response = await fetch(url, options);
    
    if (!response.ok) {
      const contentType = response.headers.get('content-type');
      let error: any = {};
      
      // Only try to parse as JSON if content-type is application/json
      if (contentType?.includes('application/json')) {
        try {
          error = await response.json();
        } catch (e) {
          // Ignore JSON parse error, use status code message
          console.error(`[API] Failed to parse error response as JSON:`, e);
          error = { error: `HTTP ${response.status}` };
        }
      } else {
        // For non-JSON responses, try to get text
        try {
          const text = await response.text();
          error = { error: text || `HTTP ${response.status}` };
        } catch (e) {
          error = { error: `HTTP ${response.status}` };
        }
      }
      
      // Handle access denied specifically
      if (response.status === 403 && error.blocked) {
        throw new Error(`Access Denied: ${error.reason || 'You do not have permission to access this device'}`);
      }
      
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`[API] ${method} ${endpoint} failed:`, error);
    console.error(`[API] Full URL was:`, url);
    throw error;
  }
}

// ============================================
// TYPE DEFINITIONS
// ============================================

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
  is_online: boolean;
  last_online: string;
  created_at: string;
}

// ============================================
// HOOKS
// ============================================

/**
 * Hook to fetch sensor readings with auto-refresh
 * Requires JWT authentication and user ID for access control
 */
export function useSensorData(sensorId: number, hours: number = 24, token?: string, userId?: string, enabled: boolean = true) {
  const [readings, setReadings] = useState<SensorReading[]>([]);
  const [stats, setStats] = useState<SensorStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Skip if disabled
    if (!enabled) {
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Fetch readings
        const readingsData = await apiRequest(
          `/api/readings/${sensorId}?hours=${hours}&limit=500`,
          'GET',
          undefined,
          token,
          userId
        );
        setReadings(readingsData);

        // Fetch stats
        const statsData = await apiRequest(
          `/api/readings/stats/${sensorId}?hours=${hours}`,
          'GET',
          undefined,
          token,
          userId
        );
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
    
    // Auto-refresh every 60 seconds (reduced to avoid rate limiting)
    const interval = setInterval(fetchData, 60000);
    
    return () => clearInterval(interval);
  }, [sensorId, hours, token, userId, enabled]);

  return { readings, stats, loading, error };
}

/**
 * Hook to fetch all sensors for a device
 * Requires JWT authentication
 */
export function useSensors(deviceId?: string, token?: string) {
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSensors = async () => {
      try {
        setLoading(true);
        
        const endpoint = deviceId
          ? `/api/sensors?deviceId=${deviceId}`
          : `/api/sensors`;
        
        const data = await apiRequest(endpoint, 'GET', undefined, token);
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
    
    // Auto-refresh every 60 seconds (reduced to avoid rate limiting)
    const interval = setInterval(fetchSensors, 60000);
    
    return () => clearInterval(interval);
  }, [deviceId, token]);

  return { sensors, loading, error };
}

/**
 * Hook to fetch all devices (no IP addresses exposed)
 * Requires JWT authentication
 */
export function useDevices(token?: string) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDevices = async () => {
      try {
        setLoading(true);
        
        const data = await apiRequest('/api/devices', 'GET', undefined, token);
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
    
    // Auto-refresh every 60 seconds (reduced to avoid rate limiting)
    const interval = setInterval(fetchDevices, 60000);
    
    return () => clearInterval(interval);
  }, [token]);

  return { devices, loading, error };
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Register device with backend
 * Called when device comes online
 */
export async function registerDevice(
  deviceId: string,
  deviceName: string,
  deviceType: string = 'PC',
  location: string = 'Office'
) {
  return await apiRequest('/api/devices/register', 'POST', {
    device_id: deviceId,
    device_name: deviceName,
    device_type: deviceType,
    location: location,
  });
}

/**
 * Send sensor reading to backend
 */
export async function submitReading(
  sensorId: number,
  value: number,
  quality: number = 100,
  token?: string
) {
  return await apiRequest('/api/readings', 'POST', {
    sensor_id: sensorId,
    value: value,
    quality: quality,
  }, token);
}

/**
 * Send batch readings
 */
export async function submitReadingsBatch(
  readings: Array<{ sensor_id: number; value: number; quality?: number }>,
  token?: string
) {
  return await apiRequest('/api/readings/batch', 'POST', {
    readings: readings,
  }, token);
}

/**
 * Check backend health
 */
export async function checkBackendHealth() {
  try {
    const response = await fetch(`${API_URL}/health`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Backend health check failed:', error);
    throw error;
  }
}

// ============================================
// CONFIGURATION
// ============================================

export const API_CONFIG = {
  baseUrl: API_URL,
  apiKey: API_KEY,
  environment: process.env.NODE_ENV || 'production',
};

console.log('[API] Initialized with URL:', API_URL);
