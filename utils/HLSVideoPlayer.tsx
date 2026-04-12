/**
 * HLS Video Player Component using expo-video
 * Provides smooth, flicker-free video streaming
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEvent } from 'expo';

interface HLSVideoPlayerProps {
  streamUrl: string;
  deviceLabel?: string;
  onClose?: () => void;
}

export default function HLSVideoPlayer({
  streamUrl,
  deviceLabel = 'Camera',
  onClose
}: HLSVideoPlayerProps) {
  console.log('[HLS] Component mounted with URL:', streamUrl);

  const safePlay = () => {
    Promise.resolve(player.play()).catch((error: any) => {
      // Avoid unhandled promise rejection overlays from transient keep-awake failures.
      console.warn('[HLS] play() warning:', error?.message || error);
    });
  };
  
  // Create video player with HLS stream
  const player = useVideoPlayer(streamUrl, player => {
    console.log('[HLS] Player initialized');
    player.loop = true;
    player.muted = false;
    Promise.resolve(player.play()).catch((error: any) => {
      console.warn('[HLS] initial play() warning:', error?.message || error);
    });
  });

  // Listen to player status
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  
  console.log('[HLS] Player status:', {
    isPlaying: status.isPlaying,
    isLoading: status.isLoading,
    isReadyToPlay: status.isReadyToPlay,
    error: status.error
  });

  // Force play on mount and when ready
  useEffect(() => {
    const timer = setTimeout(() => {
      console.log('[HLS] Force playing stream...');
      safePlay();
    }, 1000);

    return () => {
      clearTimeout(timer);
      player.release();
    };
  }, []);

  // Auto-play when ready
  useEffect(() => {
    if (status.isReadyToPlay && !status.isPlaying) {
      console.log('[HLS] Stream ready, starting playback...');
      safePlay();
    }
  }, [status.isReadyToPlay, status.isPlaying]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>📹 {deviceLabel} - Live Stream</Text>
        {onClose && (
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.videoContainer}>
        {status.isLoading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.loadingText}>Connecting to stream...</Text>
          </View>
        )}

        <VideoView
          player={player}
          style={styles.video}
          nativeControls={false}
          contentFit="contain"
        />

        {status.error && (
          <View style={styles.errorOverlay}>
            <Text style={styles.errorIcon}>❌</Text>
            <Text style={styles.errorText}>{status.error}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => {
                player.replace(streamUrl);
                safePlay();
              }}
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <View style={styles.statusContainer}>
          <View style={[styles.statusDot, status.isPlaying && styles.statusDotActive]} />
          <Text style={styles.statusText}>
            {status.isPlaying ? '🔴 LIVE' : status.isLoading ? '⏳ Loading...' : '⏸️ Paused'}
          </Text>
        </View>
        
        {!status.isPlaying && !status.isLoading && (
          <TouchableOpacity
            style={styles.playButton}
            onPress={() => {
              console.log('[HLS] Manual play triggered');
              safePlay();
            }}
          >
            <Text style={styles.playButtonText}>▶ Play</Text>
          </TouchableOpacity>
        )}
        
        <Text style={styles.streamInfo}>HLS Stream • 30 FPS</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.8)',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    fontSize: 20,
    color: '#fff',
    fontWeight: 'bold',
    lineHeight: 22,
  },
  videoContainer: {
    flex: 1,
    position: 'relative',
  },
  video: {
    flex: 1,
    backgroundColor: '#000',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  loadingText: {
    color: '#fff',
    marginTop: 16,
    fontSize: 16,
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 10,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.8)',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#666',
    marginRight: 8,
  },
  statusDotActive: {
    backgroundColor: '#ff0000',
  },
  statusText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  streamInfo: {
    color: '#999',
    fontSize: 12,
  },
  playButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
  },
  playButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
