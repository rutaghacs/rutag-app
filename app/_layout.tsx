import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth, db } from "../firebase/firebaseConfig";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { View, ActivityIndicator, LogBox } from "react-native";
import { registerFCMToken } from "../firebase/fcmService";
import "../global.css";

LogBox.ignoreLogs([
  "Unable to activate keep awake",
]);

const globalAny = global as any;
if (!globalAny.__keepAwakeErrorGuardInstalled && globalAny.ErrorUtils?.setGlobalHandler) {
  const previousHandler = globalAny.ErrorUtils.getGlobalHandler?.();
  globalAny.ErrorUtils.setGlobalHandler((error: any, isFatal: boolean) => {
    const message = String(error?.message || error || "");
    if (message.includes("Unable to activate keep awake")) {
      console.warn("[RootLayout] Ignored non-fatal keep-awake activation error");
      return;
    }

    if (typeof previousHandler === "function") {
      previousHandler(error, isFatal);
    }
  });

  globalAny.__keepAwakeErrorGuardInstalled = true;
}

const adminPortalUrl = process.env.EXPO_PUBLIC_ADMIN_PORTAL_URL || "http://13.205.201.82";

async function isUserBlocked(firebaseUser: User): Promise<boolean> {
  if (!firebaseUser?.uid || !firebaseUser?.email) {
    return false;
  }

  try {
    const accessResponse = await fetch(`${adminPortalUrl}/api/users/access-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: firebaseUser.uid,
        email: firebaseUser.email,
      }),
    });

    if (!accessResponse.ok) {
      return false;
    }

    const accessData = await accessResponse.json();
    return accessData?.isBlocked === true || accessData?.blocked === true;
  } catch (error) {
    console.warn("[RootLayout] Access-status check failed:", error);
    return false;
  }
}

async function syncUserToAdminPortal(firebaseUser: User) {
  if (!firebaseUser?.uid || !firebaseUser?.email) {
    console.warn("[RootLayout] Skipping user sync: missing uid/email");
    return;
  }

  const payload = {
    userId: firebaseUser.uid,
    email: firebaseUser.email,
    displayName: firebaseUser.displayName || firebaseUser.email,
  };

  const response = await fetch(`${adminPortalUrl}/api/users/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`HTTP ${response.status}: ${responseText}`);
  }

  console.log("[RootLayout] User synced to admin portal");
}

async function syncUserProfileToFirestore(firebaseUser: User) {
  if (!firebaseUser?.uid || !firebaseUser?.email) {
    console.warn("[RootLayout] Skipping Firestore user profile sync: missing uid/email");
    return;
  }

  const userRef = doc(db, "users", firebaseUser.uid);
  const existing = await getDoc(userRef);

  await setDoc(
    userRef,
    {
      email: firebaseUser.email,
      displayName: firebaseUser.displayName || firebaseUser.email,
      photoURL: firebaseUser.photoURL || null,
      createdAt: existing.exists() ? existing.data()?.createdAt || serverTimestamp() : serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastLogin: serverTimestamp(),
    },
    { merge: true }
  );

  console.log("[RootLayout] Firestore user profile synced");
}

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessGateLoading, setAccessGateLoading] = useState(true);
  const [lastSyncedUserId, setLastSyncedUserId] = useState<string | null>(null);

  /**
   * 🔔 Listen to Firebase auth state
   */
  useEffect(() => {
    console.log("[RootLayout] Initializing auth listener");

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      console.log(
        "[RootLayout] Auth state changed:",
        firebaseUser?.email ?? "null"
      );
      console.log(
        "[RootLayout] 🆔 Firebase User ID:",
        firebaseUser?.uid ?? "null"
      );

      setAccessGateLoading(true);

      if (firebaseUser) {
        const blocked = await isUserBlocked(firebaseUser);
        if (blocked) {
          try {
            await auth.signOut();
          } catch (error) {
            console.warn("[RootLayout] Failed to sign out blocked user:", error);
          }

          router.replace({
            pathname: "/",
            params: {
              blocked: "1",
            },
          });

          setUser(null);
          setLoading(false);
          setAccessGateLoading(false);
          return;
        }
      }

      setUser(firebaseUser);
      setLoading(false);
      setAccessGateLoading(false);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) {
      setLastSyncedUserId(null);
      return;
    }

    if (lastSyncedUserId === user.uid) {
      return;
    }

    Promise.allSettled([
      syncUserToAdminPortal(user),
      syncUserProfileToFirestore(user),
      registerFCMToken(),
    ])
      .then((results) => {
        const hasFailure = results.some((item) => item.status === "rejected");
        if (hasFailure) {
          results.forEach((item) => {
            if (item.status === "rejected") {
              console.warn("[RootLayout] User sync task failed:", item.reason?.message || item.reason);
            }
          });
        }

        setLastSyncedUserId(user.uid);
      });
  }, [user, lastSyncedUserId]);

  /**
   * 🔀 Route protection & redirects
   */
  useEffect(() => {
    if (loading || accessGateLoading) return;

    const currentRoot = segments[0]; // first route segment
    const isOnLogin = !currentRoot; // "/"
    const isOnDashboard = currentRoot === "dashboard";
    const isOnSensorList = currentRoot === "sensor-list";
    const isOnAllowedRoute = isOnDashboard || isOnSensorList;

    if (!user && !isOnLogin) {
      console.log("[RootLayout] 🔐 No user → redirect to login");
      router.replace("/");
      return;
    }

    if (user && isOnLogin) {
      console.log("[RootLayout] ✅ User logged in → redirect to dashboard");
      router.replace("/dashboard");
      return;
    }

    if (!user && isOnAllowedRoute) {
      console.log("[RootLayout] 🔐 No user on protected route → redirect to login");
      router.replace("/");
    }
  }, [user, loading, accessGateLoading, segments]);

  /**
   * ⏳ Splash/loading state
   */
  if (loading || accessGateLoading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ActivityIndicator size="large" />
      </View>
    );
  }

  /**
   * 🧭 App navigation stack
   */
  return <Stack screenOptions={{ headerShown: false }} />;
}
