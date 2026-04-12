import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DHT11Sensor from '../components/DHT11Sensor';

export const TemperatureHumidityScreen = () => {
  // Replace these with your actual sensor IDs from your database
  const SENSOR_ID = 'dht11-sensor-01'; // From dhttemp.py script
  const DEVICE_ID = 'raspberry-pi-01'; // From dhttemp.py script

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Temperature & Humidity Monitor</Text>
        <Text style={styles.subtitle}>Real-time DHT11 Sensor Data</Text>
      </View>

      <DHT11Sensor
        sensorId={SENSOR_ID}
        sensorName="DHT11 Temperature & Humidity Sensor"
        deviceId={DEVICE_ID}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1f2937',
  },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
});

export default TemperatureHumidityScreen;
