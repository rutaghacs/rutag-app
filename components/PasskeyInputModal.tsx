import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";

type PasskeyInputModalProps = {
  visible: boolean;
  deviceId: string;
  onSubmit: (passkey: string) => Promise<void>;
  onCancel: () => void;
  loading: boolean;
};

export default function PasskeyInputModal({
  visible, deviceId, onSubmit, onCancel, loading,
}: PasskeyInputModalProps) {
  const [passkey, setPasskey] = useState("");

  useEffect(() => { if (visible) setPasskey(""); }, [visible]);

  const handleSubmit = async () => {
    const trimmed = passkey.trim().toUpperCase();
    if (!trimmed || loading) return;
    await onSubmit(trimmed);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Enter Passkey</Text>
          <Text style={styles.subtitle}>
            Enter the passkey shown on your Raspberry Pi screen or in{" "}
            <Text style={styles.code}>passkey.txt</Text>
          </Text>
          {deviceId ? <Text style={styles.deviceIdLabel} numberOfLines={1}>Device: {deviceId}</Text> : null}
          <TextInput
            style={styles.input}
            value={passkey}
            onChangeText={setPasskey}
            placeholder="e.g. AB3XY7ZQ"
            placeholderTextColor="#9CA3AF"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
            editable={!loading}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />
          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color="#1D4ED8" />
              <Text style={styles.loadingText}>Pairing device...</Text>
            </View>
          ) : null}
          <View style={styles.buttonRow}>
            <TouchableOpacity style={[styles.btn, styles.cancelBtn]} onPress={onCancel} disabled={loading}>
              <Text style={[styles.btnText, styles.cancelText]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.submitBtn, (!passkey.trim() || loading) && styles.btnDisabled]}
              onPress={handleSubmit}
              disabled={!passkey.trim() || loading}
            >
              <Text style={[styles.btnText, styles.submitText]}>Pair Device</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  card: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 28, paddingBottom: 40 },
  title: { fontSize: 20, fontWeight: "700", color: "#111827", marginBottom: 8 },
  subtitle: { fontSize: 14, color: "#4B5563", lineHeight: 20, marginBottom: 12 },
  code: { fontFamily: Platform.OS === "ios" ? "Courier" : "monospace", color: "#1D4ED8" },
  deviceIdLabel: { fontSize: 12, color: "#9CA3AF", marginBottom: 16 },
  input: { borderWidth: 2, borderColor: "#1D4ED8", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 22, fontWeight: "700", letterSpacing: 6, color: "#111827", textAlign: "center", marginBottom: 20 },
  loadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 16 },
  loadingText: { fontSize: 14, color: "#1D4ED8", fontWeight: "600" },
  buttonRow: { flexDirection: "row", gap: 12 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  cancelBtn: { backgroundColor: "#F3F4F6" },
  submitBtn: { backgroundColor: "#1D4ED8" },
  btnDisabled: { opacity: 0.4 },
  btnText: { fontSize: 15, fontWeight: "700" },
  cancelText: { color: "#374151" },
  submitText: { color: "#FFFFFF" },
});