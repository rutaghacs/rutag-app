import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

interface WebRTCWebViewPlayerProps {
  signalingUrl?: string;
  deviceId: string;
  onConnectionStateChange?: (state: string) => void;
}

const DEFAULT_SIGNALING_URL = "http://10.42.0.140:8080/signal";

export const WebRTCWebViewPlayer: React.FC<WebRTCWebViewPlayerProps> = ({
  signalingUrl = DEFAULT_SIGNALING_URL,
  deviceId,
  onConnectionStateChange,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;">
  <title>WebRTC Video Stream</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    body {
      background: #000;
      display: flex;
      justify-content: center;
      align-items: center;
      font-family: Arial, sans-serif;
    }
    #container {
      width: 100%;
      height: 100%;
      position: relative;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
    }
    video {
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: #1a1a1a;
      display: block;
    }
    video::-webkit-media-controls {
      display: none !important;
    }
    #status {
      position: absolute;
      top: 20px;
      left: 20px;
      background: rgba(124, 58, 237, 0.9);
      color: #fff;
      padding: 12px 18px;
      border-radius: 8px;
      font-size: 16px;
      font-weight: bold;
      z-index: 1000;
      box-shadow: 0 4px 6px rgba(0,0,0,0.3);
    }
    #error {
      position: absolute;
      top: 20px;
      right: 20px;
      background: rgba(255, 0, 0, 0.9);
      color: #fff;
      padding: 12px 18px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 1000;
      max-width: 300px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.3);
    }
    .test-marker {
      position: absolute;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 255, 0, 0.9);
      color: #000;
      padding: 10px 20px;
      border-radius: 5px;
      font-size: 14px;
      font-weight: bold;
      z-index: 1000;
    }
  </style>
</head>
<body>
  <div id="container">
    <video id="video" autoplay playsinline muted></video>
    <div id="status">🔄 Initializing...</div>
    <div id="error" style="display:none;"></div>
    <div class="test-marker">WebView is rendering!</div>
  </div>

  <script>
    const SIGNALING_URL = "${signalingUrl}";
    const DEVICE_ID = "${deviceId}";
    const video = document.getElementById('video');
    const statusEl = document.getElementById('status');
    const errorEl = document.getElementById('error');

    let pc = null;
    let signalingInterval = null;

    async function initWebRTC() {
      try {
        console.log('[WebRTC] Initializing peer connection...');
        
        pc = new RTCPeerConnection({
          iceServers: [
            { urls: ['stun:stun.l.google.com:19302'] },
            { urls: ['stun:stun1.l.google.com:19302'] },
          ],
        });

        // Handle remote stream (modern approach)
        pc.ontrack = (event) => {
          console.log('[WebRTC] Remote track added', event);
          if (event.streams && event.streams[0]) {
            console.log('[WebRTC] Setting video srcObject from ontrack');
            video.srcObject = event.streams[0];
            video.play().then(() => {
              console.log('[WebRTC] Video playing');
              updateStatus('connected', '✅ Connected');
            }).catch(err => {
              console.error('[WebRTC] Video play error:', err);
              showError('Video play failed: ' + err.message);
            });
          } else {
            console.warn('[WebRTC] No streams in track event');
          }
        };

        // Fallback for older browsers
        pc.onaddstream = (event) => {
          console.log('[WebRTC] Remote stream added (legacy)', event);
          video.srcObject = event.stream;
          video.play().then(() => {
            console.log('[WebRTC] Video playing (legacy)');
            updateStatus('connected', '✅ Connected');
          }).catch(err => {
            console.error('[WebRTC] Video play error (legacy):', err);
            showError('Video play failed: ' + err.message);
          });
        };

        // Handle connection state
        pc.onconnectionstatechange = () => {
          console.log('[WebRTC] Connection state:', pc.connectionState);
          updateStatus(pc.connectionState, getStatusText(pc.connectionState));
        };

        // Handle ICE connection state
        pc.oniceconnectionstatechange = () => {
          console.log('[WebRTC] ICE connection state:', pc.iceConnectionState);
          updateStatus(pc.iceConnectionState, getStatusText(pc.iceConnectionState));
        };

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            console.log('[WebRTC] New ICE candidate');
            sendSignalingMessage({
              type: 'ice-candidate',
              candidate: event.candidate,
              deviceId: DEVICE_ID,
            });
          }
        };

        // Create and send offer
        await createAndSendOffer();
        
        // Start polling for answers and ICE candidates
        startSignalingPolling();
      } catch (error) {
        console.error('[WebRTC] Initialization error:', error);
        showError('Failed to initialize WebRTC: ' + error.message);
        updateStatus('failed', '❌ Failed');
      }
    }

    async function createAndSendOffer() {
      try {
        console.log('[WebRTC] Creating offer...');
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        
        await pc.setLocalDescription(offer);
        console.log('[WebRTC] Offer created, sending to server...');

        await sendSignalingMessage({
          type: 'offer',
          sdp: offer.sdp,
          deviceId: DEVICE_ID,
        });
      } catch (error) {
        console.error('[WebRTC] Offer creation error:', error);
        showError('Failed to create offer: ' + error.message);
      }
    }

    async function sendSignalingMessage(message) {
      try {
        console.log('[WebRTC] Sending message:', message.type);
        console.log('[WebRTC] Signaling URL:', SIGNALING_URL);
        
        // Use XMLHttpRequest instead of fetch for better WebView compatibility
        const xhr = new XMLHttpRequest();
        xhr.open('POST', SIGNALING_URL, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        
        xhr.onload = function() {
          console.log('[WebRTC] Response status:', xhr.status);
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const data = JSON.parse(xhr.responseText);
              console.log('[WebRTC] Received response:', data.type);
              
              if (data.sdp && data.type === 'answer' && pc) {
                console.log('[WebRTC] Setting remote description (answer)');
                pc.setRemoteDescription(new RTCSessionDescription({
                  sdp: data.sdp,
                  type: 'answer',
                })).catch(err => console.error('[WebRTC] Error setting remote description:', err));
              }
              
              if (data.candidate && pc) {
                console.log('[WebRTC] Adding ICE candidate');
                pc.addIceCandidate(new RTCIceCandidate(data.candidate))
                  .catch(e => console.warn('[WebRTC] Error adding ICE candidate:', e));
              }
            } catch (e) {
              console.error('[WebRTC] Error parsing response:', e);
            }
          } else {
            console.error('[WebRTC] Signaling server error:', xhr.status);
            showError('Signaling server error: ' + xhr.status);
          }
        };
        
        xhr.onerror = function() {
          console.error('[WebRTC] Network error');
          showError('Network error - cannot reach server');
        };
        
        xhr.send(JSON.stringify(message));
      } catch (error) {
        console.error('[WebRTC] Send message error:', error);
        console.error('[WebRTC] Error name:', error.name);
        console.error('[WebRTC] Error message:', error.message);
        showError('Failed to send message: ' + error.message);
      }
    }

    function startSignalingPolling() {
      signalingInterval = setInterval(() => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', SIGNALING_URL + '?deviceId=' + DEVICE_ID, true);
        
        xhr.onload = function() {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const data = JSON.parse(xhr.responseText);
              
              if (data.sdp && data.type === 'answer' && pc) {
                if (pc.remoteDescription === null) {
                  console.log('[WebRTC] Setting remote description from poll');
                  pc.setRemoteDescription(new RTCSessionDescription({
                    sdp: data.sdp,
                    type: 'answer',
                  })).catch(err => console.error('[WebRTC] Error setting remote description:', err));
                }
              }
              
              if (data.candidates && Array.isArray(data.candidates)) {
                for (const candidate of data.candidates) {
                  pc.addIceCandidate(new RTCIceCandidate(candidate))
                    .catch(e => console.warn('[WebRTC] Error adding ICE candidate from poll:', e));
                }
              }
            } catch (e) {
              console.warn('[WebRTC] Error parsing poll response:', e);
            }
          }
        };
        
        xhr.onerror = function() {
          console.warn('[WebRTC] Polling error');
        };
        
        xhr.send();
      }, 1000);
    }

    function updateStatus(state, text) {
      statusEl.textContent = text;
      console.log('[WebRTC] Status:', state, text);
      // Send message to React Native
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'status',
          state: state,
          text: text
        }));
      }
    }

    function getStatusText(state) {
      const statusMap = {
        'connecting': '🔄 Connecting...',
        'connected': '✅ Connected',
        'disconnected': '⚠️ Disconnected',
        'failed': '❌ Failed',
        'closed': '🔴 Closed',
        'new': '🔄 Initializing...',
        'checking': '🔄 Checking...',
        'completed': '✅ Connected',
      };
      return statusMap[state] || '❓ ' + state;
    }

    function showError(message) {
      errorEl.textContent = message;
      console.error('[WebRTC]', message);
      // Send error to React Native
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'error',
          message: message
        }));
      }
    }

    // Start WebRTC on page load
    window.addEventListener('load', initWebRTC);

    // Cleanup on unload
    window.addEventListener('beforeunload', () => {
      if (signalingInterval) clearInterval(signalingInterval);
      if (pc) pc.close();
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
        onLoadStart={() => {
          console.log('[WebRTCWebView] Loading started');
          setLoading(true);
        }}
        onLoadEnd={() => {
          console.log('[WebRTCWebView] Loading ended');
          setLoading(false);
        }}
        onError={(syntheticEvent) => {
          const { nativeEvent } = syntheticEvent;
          console.error('[WebRTCWebView] Error:', nativeEvent);
          setError(nativeEvent.description);
          setLoading(false);
        }}
        onMessage={(event) => {
          try {
            const data = JSON.parse(event.nativeEvent.data);
            console.log('[WebRTCWebView] Message from WebView:', data);
            
            if (data.type === 'status') {
              console.log(`[WebRTCWebView] Status: ${data.state} - ${data.text}`);
              onConnectionStateChange?.(data.state);
            } else if (data.type === 'error') {
              console.error('[WebRTCWebView] Error from WebView:', data.message);
              setError(data.message);
            }
          } catch (e) {
            console.log('[WebRTCWebView] Raw message:', event.nativeEvent.data);
          }
        }}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback={true}
        mixedContentMode="always"
        androidHardwareAccelerationDisabled={false}
        androidLayerType="hardware"
        originWhitelist={['*']}
        allowFileAccess={true}
        allowUniversalAccessFromFileURLs={true}
        sharedCookiesEnabled={true}
        thirdPartyCookiesEnabled={true}
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
    backgroundColor: 'transparent',
  },
});
