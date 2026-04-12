/**
 * 🔐 Admin Portal Access Control Integration
 * Checks if users have permission to access devices
 */

// Get admin portal URL from environment
const ADMIN_PORTAL_URL = process.env.EXPO_PUBLIC_ADMIN_PORTAL_URL || 'http://13.205.201.82';
const API_KEY = process.env.EXPO_PUBLIC_API_KEY || 'test-api-key-123';

interface AccessCheckResult {
  hasAccess: boolean;
  reason?: string;
  accessLevel?: 'viewer' | 'controller' | 'default';
  grantedBy?: string;
  expiresAt?: string;
}

/**
 * Check if a user has access to a specific device
 */
export async function checkDeviceAccess(
  userId: string,
  deviceId: string
): Promise<AccessCheckResult> {
  try {
    const response = await fetch(
      `${ADMIN_PORTAL_URL}/api/check-access/${userId}/${deviceId}`,
      {
        headers: {
          'X-API-Key': API_KEY,
        },
      }
    );

    if (!response.ok) {
      console.error('[Access Check] API error:', response.status);
      // If admin portal is down, allow access by default (graceful degradation)
      return { hasAccess: true, accessLevel: 'default' };
    }

    const result: AccessCheckResult = await response.json();
    return result;
  } catch (error) {
    console.error('[Access Check] Error checking access:', error);
    // If admin portal is unreachable, allow access by default
    return { hasAccess: true, accessLevel: 'default' };
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
