/**
 * 🔐 Admin Portal Access Control Integration
 * Checks if users have permission to access devices.
 *
 * Authentication model: the app sends the signed-in user's Firebase ID token
 * (Authorization: Bearer <idToken>). The server verifies the token and derives
 * the user identity from it, so the client no longer needs — and must not ship —
 * a shared admin-portal API key. EXPO_PUBLIC_* values are embedded in the app
 * bundle and are extractable, so a shared secret in the client is effectively
 * public; identity-based auth avoids that entirely.
 */

import { auth } from '../firebase/firebaseConfig';

// Admin portal base URL from environment (no secret involved).
const ADMIN_PORTAL_URL = process.env.EXPO_PUBLIC_ADMIN_PORTAL_URL || 'http://13.205.201.82';

interface AccessCheckResult {
  hasAccess: boolean;
  reason?: string;
  accessLevel?: 'viewer' | 'controller' | 'default';
  grantedBy?: string;
  expiresAt?: string;
}

/**
 * Check if the currently signed-in user has access to a specific device.
 *
 * The `userId` parameter is accepted for backwards compatibility with existing
 * callers, but the authoritative identity is taken from the verified Firebase
 * ID token on the server — not from this argument.
 */
export async function checkDeviceAccess(
  _userId: string,
  deviceId: string
): Promise<AccessCheckResult> {
  try {
    const user = auth.currentUser;
    if (!user) {
      // No signed-in user: fail closed.
      return { hasAccess: false, reason: 'User is not signed in' };
    }

    let idToken: string;
    try {
      idToken = await user.getIdToken();
    } catch (tokenError) {
      console.error('[Access Check] Could not get ID token:', tokenError);
      return { hasAccess: false, reason: 'Could not authenticate. Please try again.' };
    }

    const response = await fetch(
      `${ADMIN_PORTAL_URL}/api/check-access/${encodeURIComponent(deviceId)}`,
      {
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      }
    );

    if (!response.ok) {
      console.error('[Access Check] API error:', response.status);
      // Fail closed: if the admin portal returns an error we cannot confirm
      // access, so deny it rather than granting access by default.
      return {
        hasAccess: false,
        reason: `Access check failed (status ${response.status})`,
      };
    }

    const result: AccessCheckResult = await response.json();
    return result;
  } catch (error) {
    console.error('[Access Check] Error checking access:', error);
    // Fail closed: if the admin portal is unreachable we cannot confirm access,
    // so deny it rather than granting access by default.
    return {
      hasAccess: false,
      reason: 'Access check unavailable. Please try again.',
    };
  }
}

/**
 * Check access and throw error if denied
 */
export async function requireDeviceAccess(
  userId: string,
  deviceId: string
): Promise<void> {
  const { hasAccess, reason } = await checkDeviceAccess(userId, deviceId);

  if (!hasAccess) {
    throw new Error(reason || 'Access denied to this device');
  }
}
