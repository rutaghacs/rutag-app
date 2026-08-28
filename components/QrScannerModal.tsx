import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity, ActivityIndicator } from "react-native";
import { CameraView, useCameraPermissions, BarcodeScanningResult } from "expo-camera";
import { MaterialIcons } from "@expo/vector-icons";

type QrScannerModalProps = {
  visible: boolean;
  onClose: () => void;
  /**
   * Called once per scan attempt with the raw QR payload string. The caller
   * is responsible for parsing/validating it and calling onScanHandled to
   * resume scanning (e.g. after a failed pairing attempt) or leave the
   * scanner closed (e.g. after a successful pairing).
   */
  onScanned: (data: string) => Promise<void> | void;
  processing?: boolean;
};

/**
 * Full-screen camera modal used exclusively for the device pairing flow.
 * Devices can ONLY be added by scanning a valid QR code displayed by the
 * Raspberry Pi — there is no manual entry or list-based fallback here.
 */
export default function QrScannerModal({ visible, onClose, onScanned, processing = false }: QrScannerModalProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanLocked, setScanLocked] = useState(false);
  const hasHandledRef = useRef(false);

  useEffect(() => {
    if (visible) {
      hasHandledRef.current = false;
      setScanLocked(false);
      if (!permission?.granted) {
        requestPermission();
      }
    }
  }, [visible, permission?.granted, requestPermission]);

  const handleBarcodeScanned = (result: BarcodeScanningResult) => {
    if (hasHandledRef.current || scanLocked) return;
    hasHandledRef.current = true;
    setScanLocked(true);

    Promise.resolve(onScanned(result.data)).finally(() => {
      // Allow re-scanning after the caller has processed this attempt
      // (e.g. showed an error and the modal is still open).
      hasHandledRef.current = false;
      setScanLocked(false);
    });
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {!permission ? (
          <View style={styles.centerContent}>
            <ActivityIndicator size="large" color="#FFFFFF" />
          </View>
        ) : !permission.granted ? (
          <View style={styles.centerContent}>
            <MaterialIcons name="camera-alt" size={48} color="#FFFFFF" />
            <Text style={styles.permissionText}>Camera access is needed to scan device QR codes.</Text>
            <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
              <Text style={styles.permissionButtonText}>Grant Camera Access</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <CameraView
              style={StyleSheet.absoluteFillObject}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={handleBarcodeScanned}
            />
            <View style={styles.overlay}>
              <View style={styles.scanFrame} />
              <Text style={styles.instructionText}>
                Point the camera at the QR code shown on the device
              </Text>
            </View>
            {processing && (
              <View style={styles.processingOverlay}>
                <ActivityIndicator size="large" color="#FFFFFF" />
                <Text style={styles.processingText}>Pairing device...</Text>
              </View>
            )}
          </>
        )}

        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
          <MaterialIcons name="close" size={28} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  centerContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
    gap: 16,
  },
  permissionText: {
    color: "#FFFFFF",
    fontSize: 16,
    textAlign: "center",
  },
  permissionButton: {
    backgroundColor: "#1249B2",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  permissionButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    gap: 24,
  },
  scanFrame: {
    width: 260,
    height: 260,
    borderWidth: 3,
    borderColor: "#4ADE80",
    borderRadius: 16,
    backgroundColor: "transparent",
  },
  instructionText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
    paddingHorizontal: 32,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingVertical: 8,
    borderRadius: 8,
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  processingText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
  closeButton: {
    position: "absolute",
    top: 50,
    right: 20,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 20,
    padding: 8,
  },
});
