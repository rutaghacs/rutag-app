import { View, Text, ActivityIndicator, TouchableOpacity, ScrollView, StyleSheet, Linking, TextInput, Modal, Image } from "react-native";
import { useRef, useState } from "react";
import { GoogleSignin, statusCodes } from "@react-native-google-signin/google-signin";
import { GoogleAuthProvider, signInWithCredential, signOut, signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase/firebaseConfig";
import { clearFCMToken } from "../firebase/fcmService";
import Constants from "expo-constants";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialIcons } from "@expo/vector-icons";
import StyledAlert, { StyledAlertProps } from "../components/StyledAlert";

const webClientId =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ??
  Constants.expoConfig?.extra?.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

const adminPortalUrl = process.env.EXPO_PUBLIC_ADMIN_PORTAL_URL || 'http://13.205.201.82';
const userGuideUrl = 'https://rutaghacs.kesug.com/?i=1';

GoogleSignin.configure({
  webClientId: webClientId,
  offlineAccess: true,
});

export default function LoginScreen() {
  const [signInPhase, setSignInPhase] = useState<"idle" | "authenticating">("idle");
  const [authMethodLabel, setAuthMethodLabel] = useState("Signing you in...");
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [styledAlertVisible, setStyledAlertVisible] = useState(false);
  const [styledAlertConfig, setStyledAlertConfig] = useState<StyledAlertProps>({
    visible: false,
    title: "",
    message: "",
    type: "info",
    onClose: () => setStyledAlertVisible(false),
  });
  const loginInFlightRef = useRef(false);

  const isSigningIn = signInPhase !== "idle";

  const showStyledAlert = (
    title: string,
    message: string,
    type: StyledAlertProps["type"] = "info"
  ) => {
    setStyledAlertConfig({
      visible: true,
      title,
      message,
      type,
      onClose: () => setStyledAlertVisible(false),
    });
    setStyledAlertVisible(true);
  };

  const showAuthPrompt = (
    title: string,
    message: string,
    type: StyledAlertProps["type"] = "error"
  ) => {
    setShowEmailForm(false);
    setPassword("");

    setTimeout(() => {
      showStyledAlert(title, message, type);
    }, 0);
  };

  const syncUserToAdminPortal = async (
    userId: string,
    userEmail: string | null,
    displayName?: string | null,
    authProvider: "google" | "password" = "google"
  ) => {
    if (!userEmail) return;

    try {
      const syncResponse = await fetch(`${adminPortalUrl}/api/users/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          email: userEmail,
          displayName: displayName || userEmail,
          authProvider,
        }),
      });

      if (!syncResponse.ok) {
        console.warn('[Login] Failed to sync user to admin portal:', await syncResponse.text());
      } else {
        console.log('[Login] User synced to admin portal');
      }
    } catch (syncError) {
      console.warn('[Login] User sync error:', syncError);
    }
  };

  console.log("[Login] Web Client ID:", webClientId);

  const handleGetStarted = () => {
    Linking.openURL(userGuideUrl).catch(err => {
      console.error('Error opening user guide:', err);
      showStyledAlert('Error', 'Unable to open user guide. Please try again.', 'error');
    });
  };

  const handleLogin = async () => {
    if (loginInFlightRef.current) {
      console.log("[Login] Sign-in already in progress");
      return;
    }

    loginInFlightRef.current = true;

    try {
      setSignInPhase("authenticating");
      setAuthMethodLabel("Signing in with Google...");
      console.log("[Login] Starting Google Sign-In");

      // Sign out first to clear cached account
      try {
        await GoogleSignin.signOut();
        console.log("[Login] Signed out previous session");
      } catch (e) {
        console.log("[Login] No previous session");
      }

      await GoogleSignin.hasPlayServices();
      console.log("[Login] Play Services available");

      // This should show account picker
      const userInfo = await GoogleSignin.signIn();
      console.log("[Login] userInfo:", JSON.stringify(userInfo, null, 2));
      
      // Extract from correct structure
      const user = userInfo?.data?.user;
      const idToken = userInfo?.data?.idToken;

      if (!user || !user.email) {
        console.error("[Login] ❌ No user info returned");
        return;
      }

      console.log("[Login] Selected account:", user.email);

      if (!idToken) {
        console.error("[Login] ❌ No ID token");
        return;
      }

      console.log("[Login] ID Token received");

      const credential = GoogleAuthProvider.credential(idToken);
      console.log("[Login] Credential created");
      console.log("[Login] Starting Firebase credential sign-in...");

      const firebaseUser = await signInWithCredential(auth, credential);
      console.log("[Login] Firebase credential sign-in completed");

      if (firebaseUser.user) {
        await syncUserToAdminPortal(
          firebaseUser.user.uid,
          firebaseUser.user.email,
          firebaseUser.user.displayName || user.name || firebaseUser.user.email,
          "google"
        );
      }

      console.log("[Login] ✅ Firebase sign-in success:", firebaseUser.user.email);
      setSignedInEmail(firebaseUser.user.email);
    } catch (error: any) {
      console.error("[Login] ❌ Error:", error.code, error.message);
      console.error("[Login] Full error:", JSON.stringify(error, null, 2));

      if (error?.code === "10") {
        console.error(
          "[Login] Android DEVELOPER_ERROR (10): OAuth mismatch. Check Firebase Android app package + SHA-1/SHA-256, then re-download google-services.json."
        );
      }

      if (error?.code === "auth/network-request-failed") {
        showStyledAlert(
          "Network Error",
          "Firebase sign-in could not reach the server. Check that the device has internet access and that the Android build was regenerated after Firebase/Google config changes.",
          "error"
        );
      }

      if (error.code === statusCodes.SIGN_IN_CANCELLED) {
        console.log("[Login] User cancelled");
      }
    } finally {
      loginInFlightRef.current = false;
      setSignInPhase("idle");
    }
  };

  const handleEmailPasswordLogin = async () => {
    if (isSigningIn || loginInFlightRef.current) {
      return;
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      showStyledAlert("Missing details", "Please enter both email and password.", "warning");
      return;
    }

    setSignInPhase("authenticating");
    setAuthMethodLabel("Signing in with Email/Password...");

    try {
      const firebaseUser = await signInWithEmailAndPassword(auth, trimmedEmail, password);
      await syncUserToAdminPortal(
        firebaseUser.user.uid,
        firebaseUser.user.email,
        firebaseUser.user.displayName || firebaseUser.user.email,
        "password"
      );

      setSignedInEmail(firebaseUser.user.email);
      console.log("[Login] Email/password sign-in success:", firebaseUser.user.email);
    } catch (error: any) {
      console.error("[Login] Email/password error:", error?.code, error?.message);

      if (error?.code === "auth/invalid-credential" || error?.code === "auth/wrong-password") {
        showAuthPrompt("Sign-in failed", "Invalid email or password.", "error");
      } else if (error?.code === "auth/user-not-found") {
        showAuthPrompt("Sign-in failed", "No account found for this email.", "error");
      } else if (error?.code === "auth/invalid-email") {
        showAuthPrompt("Sign-in failed", "Please enter a valid email address.", "error");
      } else if (error?.code === "auth/network-request-failed" || error?.message?.includes("Network request failed")) {
        showAuthPrompt(
          "Network error",
          "Could not reach Firebase Authentication. Please check your internet connection and try again.",
          "error"
        );
      } else {
        showAuthPrompt("Sign-in failed", "Unable to sign in with email and password.", "error");
      }
    } finally {
      setSignInPhase("idle");
    }
  };

  const handleLogout = async () => {
    try {
      console.log("[Login] Logging out...");
      await clearFCMToken();
      await GoogleSignin.signOut();
      await signOut(auth);
      setSignedInEmail(null);
      console.log("[Login] ✅ Logged out");
    } catch (error) {
      console.error("[Login] ❌ Logout error:", error);
    }
  };

  return (
    <LinearGradient colors={["#F4F6FA", "#ECEFF6"]} style={styles.page}>
      <ScrollView contentContainerStyle={styles.startupScroll} showsVerticalScrollIndicator={false}>
          <View style={styles.brandRow}>
            <MaterialIcons name="verified-user" size={22} color="#1249B2" />
            <Text style={styles.brandText}>RUTAG</Text>
          </View>

          <Text style={styles.tagline}>THE VIGILANT CURATOR</Text>

          <View style={styles.appIconContainer}>
            <Image
              source={require("../assets/images/app-icon.png")}
              style={styles.appIcon}
              resizeMode="contain"
            />
          </View>

          <View style={styles.authCardsContainer}>
            <TouchableOpacity
              onPress={handleLogin}
              style={[styles.authCard, styles.googleCard, isSigningIn && { opacity: 0.7 }]}
              disabled={isSigningIn}
              activeOpacity={0.8}
            >
              {isSigningIn ? (
                <ActivityIndicator size="small" color="#4285F4" />
              ) : (
                <MaterialIcons name="language" size={28} color="#4285F4" />
              )}
              <Text style={styles.authCardTitle}>Sign in with Google</Text>
              <Text style={styles.authCardSubtitle}>{isSigningIn ? "Signing in..." : "Use your Google account"}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setShowEmailForm(true)}
              style={[styles.authCard, styles.emailCard, isSigningIn && { opacity: 0.7 }]}
              disabled={isSigningIn}
              activeOpacity={0.8}
            >
              <MaterialIcons name="alternate-email" size={28} color="#0F766E" />
              <Text style={styles.authCardTitle}>Email/Password</Text>
              <Text style={styles.authCardSubtitle}>Sign in with credentials</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.getStartedButton} onPress={handleGetStarted}>
            <Text style={styles.getStartedButtonText}>Get Started</Text>
          </TouchableOpacity>

          <Modal
            visible={showEmailForm}
            transparent
            animationType="fade"
            onRequestClose={() => !isSigningIn && setShowEmailForm(false)}
          >
            <View style={styles.emailModalBackdrop}>
              <View style={styles.emailModalCard}>
                <Text style={styles.altAuthTitle}>Email/Password Sign-In</Text>

                <TextInput
                  style={styles.authInput}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Email"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="emailAddress"
                  editable={!isSigningIn}
                />

                <TextInput
                  style={styles.authInput}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Password"
                  placeholderTextColor="#9CA3AF"
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="password"
                  editable={!isSigningIn}
                />

                <TouchableOpacity
                  onPress={handleEmailPasswordLogin}
                  style={[styles.emailButton, isSigningIn && { opacity: 0.7 }]}
                  disabled={isSigningIn}
                >
                  {isSigningIn ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.emailButtonText}>Continue</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setShowEmailForm(false)}
                  style={styles.cancelEmailButton}
                  disabled={isSigningIn}
                >
                  <Text style={styles.cancelEmailButtonText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          {isSigningIn && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#ffffff" />
              <Text style={styles.loadingOverlayText}>{authMethodLabel}</Text>
            </View>
          )}

          {signedInEmail && (
            <>
              <Text style={styles.signedInText}>Signed in as: {signedInEmail}</Text>
              <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
                <Text style={styles.logoutButtonText}>Logout</Text>
              </TouchableOpacity>
            </>
          )}

          <StyledAlert
            {...styledAlertConfig}
            visible={styledAlertVisible}
            onClose={() => setStyledAlertVisible(false)}
          />
        </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  startupScroll: {
    paddingHorizontal: 24,
    paddingTop: 72,
    paddingBottom: 28,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 20,
  },
  brandText: {
    fontSize: 24,
    fontWeight: "700",
    color: "#1249B2",
    letterSpacing: 1,
  },
  tagline: {
    color: "#8A1A08",
    letterSpacing: 2,
    fontSize: 10,
    marginBottom: 28,
    fontWeight: "600",
    textAlign: "center",
  },
  appIconContainer: {
    alignItems: "center",
    marginBottom: 36,
  },
  appIcon: {
    width: 200,
    height: 200,
    borderRadius: 20,
  },
  authCardsContainer: {
    flexDirection: "column",
    gap: 16,
    marginBottom: 20,
  },
  authCard: {
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 140,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  googleCard: {
    backgroundColor: "#F0F4FF",
    borderWidth: 2,
    borderColor: "#4285F4",
  },
  emailCard: {
    backgroundColor: "#F0FDF9",
    borderWidth: 2,
    borderColor: "#0F766E",
  },
  authCardTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111827",
    marginTop: 12,
    marginBottom: 6,
  },
  authCardSubtitle: {
    fontSize: 14,
    color: "#6B7280",
    textAlign: "center",
  },
  headline: {
    fontSize: 32,
    lineHeight: 36,
    color: "#0E1726",
    fontWeight: "700",
    marginBottom: 24,
  },
  headlineAccent: {
    color: "#1249B2",
    fontStyle: "italic",
    fontWeight: "700",
  },
  heroCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 24,
    marginBottom: 18,
    shadowColor: "#111827",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 3,
  },
  heroIconBox: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: "#DCECF6",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 10,
  },
  heroBody: {
    fontSize: 16,
    lineHeight: 22,
    color: "#3F4A5A",
  },
  featureRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 18,
  },
  featureCardLight: {
    flex: 1,
    backgroundColor: "#EFEDEE",
    borderRadius: 16,
    padding: 18,
    minHeight: 150,
    justifyContent: "flex-end",
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#8A1A08",
    marginBottom: 10,
  },
  featureTitleDark: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "700",
    color: "#101522",
    marginBottom: 6,
  },
  featureCaption: {
    fontSize: 12,
    letterSpacing: 1,
    color: "#4B5563",
  },
  featureCardBlue: {
    width: 160,
    backgroundColor: "#1249B2",
    borderRadius: 16,
    padding: 18,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 150,
  },
  featureTitleLight: {
    marginTop: 10,
    color: "#FFFFFF",
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  secondaryButton: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  secondaryButtonText: {
    color: "#1249B2",
    fontSize: 18,
    fontWeight: "700",
  },
  authWrapper: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 30,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    marginBottom: 20,
    gap: 6,
  },
  backButtonText: {
    fontSize: 16,
    color: "#1D4ED8",
    fontWeight: "600",
  },
  authContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  authLogoWrap: {
    marginBottom: 40,
    alignItems: "center",
  },
  authLogoInner: {
    width: 130,
    height: 130,
    backgroundColor: "#FFFFFF",
    borderRadius: 65,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 10,
  },
  authTitle: {
    fontSize: 34,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 10,
    textAlign: "center",
  },
  authSubtitle: {
    fontSize: 16,
    color: "#374151",
    marginBottom: 40,
    textAlign: "center",
    lineHeight: 24,
  },
  getStartedButton: {
    backgroundColor: "#1249B2",
    borderRadius: 12,
    paddingVertical: 18,
    paddingHorizontal: 24,
    alignItems: "center",
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
  },
  getStartedButtonText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  googleButton: {
    width: "100%",
    backgroundColor: "#ffffff",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
  },
  googleButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1F2937",
  },
  emailEntryButton: {
    width: "100%",
    backgroundColor: "#ffffff",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
    marginTop: 10,
  },
  emailEntryButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1F2937",
  },
  altAuthSection: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  altAuthTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 10,
  },
  authInput: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#111827",
    backgroundColor: "#FFFFFF",
    marginBottom: 10,
  },
  emailButton: {
    backgroundColor: "#1249B2",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  emailButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  emailModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  emailModalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 10,
  },
  cancelEmailButton: {
    marginTop: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#6B7280",
  },
  cancelEmailButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
  signedInText: {
    marginTop: 30,
    color: "#111827",
    fontSize: 14,
  },
  logoutButton: {
    marginTop: 20,
    backgroundColor: "#1249B2",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  logoutButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0, 0, 0, 0.35)",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
    zIndex: 999,
  },
  loadingOverlayText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
});
