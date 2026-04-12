# AI Coding Agent Instructions for Sensor App

## Project Overview
This is an **Expo-based React Native app** (iOS, Android, Web) using Expo Router (file-based routing in `/app`), TypeScript (strict), and Google OAuth (via `expo-auth-session`).
# AI Coding Agent Instructions for Sensor App

## Architecture & Key Patterns
- **Routing:** File-based via Expo Router. Each `.tsx` in `/app` is a route. Root layout: [app/_layout.tsx](app/_layout.tsx). Main screens: [app/index.tsx](app/index.tsx) (login), [app/dashboard.tsx](app/dashboard.tsx) (post-auth).
- **Authentication:** Google OAuth. Login starts in `index.tsx` with `promptAsync()`. On success, fetches user info from Google API. Navigation to dashboard is manual (currently missing after login).
- **State:** Local state only (`useState`). No global state manager. Data passed via Expo Router search params (see `useLocalSearchParams`). No session persistence between app restarts.
- **Database:** See [db/](db/) for schema, queries, and migrations (not directly integrated with UI yet).
- **Firebase:** Config in [firebase/firebaseConfig.js](firebase/firebaseConfig.js) (not yet used in main flows).

## Developer Workflow
- **Install:** `npm install`
- **Start dev server:** `npm start` (choose platform in Expo UI)
- **Android emulator:** `npm run android`
- **iOS simulator:** `npm run ios`
- **Web:** `npm run web`
- **Lint:** `npm run lint` (uses Expo ESLint config)
- **Reset project:** `npm run reset-project` (see README)
## Conventions & Patterns
- **Screens:** Default export in each route file. Use inline `StyleSheet.create()` for styles (no CSS/Tailwind). Dark mode colors: `#0f172a`, `#020617`, white/slate text. Common layout: `flex: 1, justifyContent: 'center', alignItems: 'center'`.
- **TypeScript:** Strict mode. Explicit types for API responses (e.g., `useLocalSearchParams<{ token?: string }>`). Path alias `@/*` maps to root (rarely used). [expo-env.d.ts](expo-env.d.ts) for env types.
- **API:** Use `fetch()` directly. Google API endpoints are hardcoded (should be constants). Error handling is missing in `fetchUserInfo()` (add try-catch).

## Integration Points
- **expo-router/entry:** Entry point from `package.json` `main` field.
- **expo-auth-session:** Handles OAuth redirects. `WebBrowser.maybeCompleteAuthSession()` must be called in root component.
- **New Architecture:** Enabled in [app.json](app.json) (`newArchEnabled: true`).

## Anti-Patterns to Avoid
- Hardcoded Google client IDs (replace before deploy)
- Missing error handling in API calls
- No navigation after successful auth (add `router.push`)
- Untyped API responses (avoid `any`)
- No state persistence (session lost on restart)

## Examples
- See [app/index.tsx](app/index.tsx) for login flow and [app/dashboard.tsx](app/dashboard.tsx) for post-auth user display.
- Database and Firebase are scaffolded but not yet integrated with main flows.

## Development Conventions

### Component Structure
- All screens are default exports in their route files
- Styling: Inline `StyleSheet.create()` from React Native (no CSS/Tailwind)
- Color scheme: Dark mode (`#0f172a`, `#020617` backgrounds, white/slate text)
- Common style properties reused: `flex: 1, justifyContent: 'center', alignItems: 'center'`

### TypeScript Patterns
- Strict mode enforced; use explicit types for API responses (e.g., `useLocalSearchParams<{ token?: string }>`)
- Path alias configured: `@/*` maps to workspace root (not commonly used yet)
- Environmental types auto-generated: [expo-env.d.ts](expo-env.d.ts)

### API Integration
- Synchronous `fetch()` calls (no axios/tanstack-query)
- Google API endpoints hardcoded as strings (should extract to constants)
- Error handling absent in `fetchUserInfo()` — wrap with try-catch

## Common Tasks & Commands
| Task | Command |
|------|---------|
| Start dev server (choose platform) | `npm start` |
| Run Android emulator | `npm run android` |
| Run iOS simulator | `npm run ios` |
| Run web version | `npm run web` |
| Lint/format check | `npm run lint` (Expo ESLint config) |
| Fresh project state | `npm run reset-project` |

## Important Integration Points
- **expo-router/entry**: Auto-entry point from package.json `main` field
- **expo-auth-session**: Handles web browser redirect for OAuth; `WebBrowser.maybeCompleteAuthSession()` critical in root component
- **New Architecture enabled**: `app.json` has `newArchEnabled: true` — impacts native module compatibility

## Codebase Anti-Patterns to Avoid
- ❌ Hardcoded Google client IDs (already in code — must be replaced)
- ❌ Missing error boundaries and error handling in API calls
- ❌ No navigation on successful auth (missing navigation integration)
- ❌ Untyped API responses (e.g., `any` types in dashboard)
- ❌ No state persistence (session lost on app restart)

## Recommended Improvements (Not Implemented)
1. Extract Google API endpoints to `constants.ts`
2. Create `useGoogleAuth()` custom hook to centralize OAuth logic
3. Add error handling and loading states in API calls
4. Implement token persistence (AsyncStorage or SecureStore)
5. Complete the auth navigation: wire dashboard route with token param
