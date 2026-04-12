/**
 * Camera Video Stream Component
 * Embeds H.264 streaming from Raspberry Pi into the app using WebView
 */

import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

interface CameraVideoPlayerProps {
  streamUrl: string;
  title?: string;
}

export const CameraVideoPlayer: React.FC<CameraVideoPlayerProps> = ({
  streamUrl,
  title = "Live Stream"
}) => {
  const [loading, setLoading] = useState(true);

  // HTML content for the video player embedded in WebView
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          background: #000;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          font-family: Arial, sans-serif;
        }
        .container {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          background: #000;
        }
        .video-wrapper {
          flex: 1;
          display: flex;
          justify-content: center;
          align-items: center;
          background: #000;
        }
        video {
          width: 100%;
          height: 100%;
          object-fit: contain;
          background: #000;
        }
        .controls {
          padding: 10px;
          background: #1a1a1a;
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        button {
          flex: 1;
          padding: 12px;
          background: #00FF41;
          color: #000;
          border: none;
          border-radius: 6px;
          font-weight: bold;
          cursor: pointer;
          font-size: 14px;
          min-width: 80px;
        }
        button:active {
          opacity: 0.8;
          transform: scale(0.98);
        }
        button.stop {
          background: #FF6B6B;
          color: #fff;
        }
        .status {
          padding: 10px;
          background: #222;
          color: #00FF41;
          text-align: center;
          font-size: 12px;
          font-family: monospace;
        }
        .error {
          color: #FF6B6B;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="status" id="status">
          ⏳ Connecting to stream...
        </div>
        <div class="video-wrapper">
          <video id="videoStream" controls autoplay playsinline muted></video>
        </div>
        <div class="controls">
          <button onclick="startStream()">▶ Start Stream</button>
          <button onclick="stopStream()" class="stop">⏹ Stop</button>
          <button onclick="toggleMute()">🔊 Mute</button>
        </div>
      </div>

      <script>
        let isPlaying = false;
        const video = document.getElementById('videoStream');
        const statusDiv = document.getElementById('status');
        const streamUrl = '${streamUrl}';

        function updateStatus(message, isError = false) {
          statusDiv.textContent = message;
          if (isError) {
            statusDiv.classList.add('error');
          } else {
            statusDiv.classList.remove('error');
          }
        }

        async function startStream() {
          if (isPlaying) {
            updateStatus('Stream already playing');
            return;
          }

          try {
            updateStatus('🔄 Starting stream...');
            isPlaying = true;

            // Set video source to the H.264 stream
            video.src = streamUrl;
            
            // Try to play
            const playPromise = video.play();
            if (playPromise !== undefined) {
              playPromise.then(() => {
                updateStatus('✅ Stream playing');
              }).catch(error => {
                console.error('Play error:', error);
                updateStatus('⚠️ Auto-play blocked. Tap play button on video.', false);
                // Don't mark as error since this is expected on some devices
              });
            }
          } catch (error) {
            isPlaying = false;
            updateStatus('❌ Stream failed: ' + error.message, true);
          }
        }

        function stopStream() {
          try {
            video.pause();
            video.src = '';
            isPlaying = false;
            updateStatus('⏹ Stream stopped');
          } catch (error) {
            updateStatus('Error stopping stream', true);
          }
        }

        function toggleMute() {
          video.muted = !video.muted;
          updateStatus(video.muted ? '🔇 Muted' : '🔊 Unmuted');
        }

        // Auto-start stream when page loads
        window.addEventListener('load', () => {
          startStream();
        });

        // Handle page visibility
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) {
            stopStream();
          } else {
            startStream();
          }
        });
      </script>
    </body>
    </html>
  `;

  return (
    <View style={styles.container}>
      <WebView
        source={{ html: htmlContent }}
        style={styles.webview}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        startInLoadingState={true}
        renderLoading={() => (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#00FF41" />
          </View>
        )}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        allowsInlineMediaPlayback={true}
        mediaPlaybackRequiresUserAction={false}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  webview: {
    flex: 1,
    backgroundColor: '#000',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
});

export default CameraVideoPlayer;
