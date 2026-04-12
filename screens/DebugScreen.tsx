/**
 * Debug Screen - Test Firebase connectivity and WebRTC signaling
 */

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { ref, get, set } from 'firebase/database';
import { rtdb } from '../firebase/firebaseConfig';

export const DebugScreen: React.FC = () => {
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);

  const log = (message: string) => {
    console.log('[DEBUG]', message);
    setDebugLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const testFirebaseConnection = async () => {
    setTesting(true);
    setDebugLog([]);
    
    try {
      log('🔄 Testing Firebase RTDB connection...');
      
      // Test 1: Can we read the root?
      log('  → Reading /webrtc_sessions root...');
      const sessionsRef = ref(rtdb, 'webrtc_sessions');
      const snapshot = await get(sessionsRef);
      log(`  ✅ Connection successful! Data exists: ${snapshot.exists()}`);
      
      if (snapshot.exists()) {
        const sessions = snapshot.val();
        const sessionIds = Object.keys(sessions).slice(-5); // Last 5 sessions
        log(`  → Found ${Object.keys(sessions).length} total sessions`);
        log(`  → Recent sessions: ${sessionIds.join(', ')}`);
        
        // Test 2: Read the most recent session
        if (sessionIds.length > 0) {
          const lastSessionId = sessionIds[sessionIds.length - 1];
          log(`  → Checking latest session: ${lastSessionId}`);
          
          const sessionRef = ref(rtdb, `webrtc_sessions/${lastSessionId}`);
          const sessionSnapshot = await get(sessionRef);
          const sessionData = sessionSnapshot.val();
          
          if (sessionData) {
            log(`    • Has offer: ${!!sessionData.offer}`);
            log(`    • Has answer: ${!!sessionData.answer}`);
            log(`    • Created at: ${new Date(sessionData.createdAt).toLocaleTimeString()}`);
          }
        }
      }
      
      // Test 3: Write a test value
      log('  → Writing test value to /debug/test...');
      const testRef = ref(rtdb, 'debug/test');
      await set(testRef, {
        timestamp: Date.now(),
        message: 'Test write from mobile app',
        clientSide: true
      });
      log('  ✅ Test write successful');
      
      // Test 4: Read it back
      log('  → Reading test value back...');
      const testSnapshot = await get(testRef);
      if (testSnapshot.exists()) {
        log('  ✅ Test read successful');
        log(`    Value: ${JSON.stringify(testSnapshot.val())}`);
      } else {
        log('  ❌ ERROR: Write succeeded but read returned no data!');
      }
      
      log('✅ All tests passed!');
      
    } catch (err) {
      log(`❌ Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTesting(false);
    }
  };

  const testSpecificSession = async () => {
    const sessionId = prompt('Enter session ID to check:');
    if (!sessionId) return;
    
    setTesting(true);
    setDebugLog([]);
    
    try {
      log(`🔍 Checking session: ${sessionId}`);
      
      const sessionRef = ref(rtdb, `webrtc_sessions/${sessionId}`);
      const snapshot = await get(sessionRef);
      
      if (snapshot.exists()) {
        const data = snapshot.val();
        log('✅ Session found!');
        log(`Full session data: ${JSON.stringify(data, null, 2)}`);
      } else {
        log('❌ Session not found');
      }
    } catch (err) {
      log(`❌ Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🔧 Firebase Debug Panel</Text>
      
      <TouchableOpacity 
        style={[styles.button, testing && styles.buttonDisabled]}
        onPress={testFirebaseConnection}
        disabled={testing}
      >
        <Text style={styles.buttonText}>
          {testing ? 'Testing...' : 'Test Firebase Connection'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity 
        style={[styles.button, testing && styles.buttonDisabled]}
        onPress={testSpecificSession}
        disabled={testing}
      >
        <Text style={styles.buttonText}>Test Specific Session</Text>
      </TouchableOpacity>

      <ScrollView style={styles.logContainer}>
        {debugLog.map((log, idx) => (
          <Text key={idx} style={styles.logText}>{log}</Text>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#1e1e1e',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  logContainer: {
    flex: 1,
    backgroundColor: '#000',
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
  },
  logText: {
    color: '#00ff00',
    fontSize: 12,
    fontFamily: 'Courier New',
    marginBottom: 4,
  },
});
