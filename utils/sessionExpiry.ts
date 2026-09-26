import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Enforces a hard 7-day session lifetime. On successful sign-in the app
 * records the login timestamp; on every launch / auth-state change the app
 * checks whether that timestamp is older than SESSION_MAX_AGE_MS. If it is,
 * the session is considered expired and the user must sign in again.
 *
 * The key is scoped per-user so switching accounts starts a fresh window.
 */
const SESSION_STARTED_AT_KEY_PREFIX = "session_started_at:";
export const SESSION_MAX_AGE_DAYS = 7;
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

function keyFor(userId: string): string {
  return `${SESSION_STARTED_AT_KEY_PREFIX}${userId}`;
}

/** Record the moment a session began (called right after a successful login). */
export async function markSessionStart(userId: string): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(keyFor(userId), String(Date.now()));
  } catch (error) {
    console.warn("[SessionExpiry] Failed to record session start:", error);
  }
}

/**
 * Returns true if the current session for this user has exceeded the 7-day
 * window. If no start timestamp exists yet, this call records "now" as the
 * start and returns false, so an in-progress session is never wrongly expired.
 */
export async function isSessionExpired(userId: string): Promise<boolean> {
  if (!userId) return false;
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (raw === null) {
      // First time we've seen this session — treat now as the start.
      await AsyncStorage.setItem(keyFor(userId), String(Date.now()));
      return false;
    }
    const startedAt = parseInt(raw, 10);
    if (!Number.isFinite(startedAt)) {
      await AsyncStorage.setItem(keyFor(userId), String(Date.now()));
      return false;
    }
    return Date.now() - startedAt >= SESSION_MAX_AGE_MS;
  } catch (error) {
    console.warn("[SessionExpiry] Failed to read session start:", error);
    return false;
  }
}

/** Clear the recorded session start (called on sign-out). */
export async function clearSessionStart(userId: string): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.removeItem(keyFor(userId));
  } catch (error) {
    console.warn("[SessionExpiry] Failed to clear session start:", error);
  }
}