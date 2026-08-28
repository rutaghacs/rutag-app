import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

/**
 * Stable, random identifier for this specific app installation (not tied to
 * the signed-in user). Generated once and persisted locally, so it survives
 * app restarts but resets on reinstall — used by the backend to cap how many
 * distinct mobile installations may sign in under the same account/email.
 */
const INSTALLATION_ID_STORAGE_KEY = "app_installation_id";

let cachedInstallationId: string | null = null;

export async function getOrCreateInstallationId(): Promise<string> {
  if (cachedInstallationId) {
    return cachedInstallationId;
  }

  try {
    const stored = await AsyncStorage.getItem(INSTALLATION_ID_STORAGE_KEY);
    if (stored) {
      cachedInstallationId = stored;
      return stored;
    }

    const generated = Crypto.randomUUID();
    await AsyncStorage.setItem(INSTALLATION_ID_STORAGE_KEY, generated);
    cachedInstallationId = generated;
    return generated;
  } catch (error) {
    console.warn("[InstallationId] Failed to load/generate installation id:", error);
    // Fall back to a session-only id rather than blocking sign-in entirely.
    const fallback = Crypto.randomUUID();
    cachedInstallationId = fallback;
    return fallback;
  }
}
