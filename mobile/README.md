# PinPoint Mobile + Web Frontend

`mobile/` is now the single source of truth for the PinPoint product UI across:

- Android
- iPhone
- browser/web

The browser app is built from this Expo / React Native codebase and then hosted by the root Next/Vercel deployment.

## Frontend environment

The Expo frontend reads:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_API_BASE_URL`

For native dev-client work, the source of truth can still be EAS environments:

- `preview`
- `production`

Pull one into `mobile/.env.local` before starting Metro:

```bash
npm run env:pull:preview
```

or:

```bash
npm run env:pull:production
```

## Native workflow

1. Install dependencies:

   ```bash
   npm install
   ```

2. Log into Expo:

   ```bash
   npx eas login
   ```

3. Connect the project to EAS:

   ```bash
   npx eas init
   ```

4. Build the Android dev client:

   ```bash
   npm run build:android:development
   ```

5. Install the generated APK on your phone.

6. Start Metro:

   ```bash
   npm run start:dev-client
   ```

   This now uses LAN by default so it does not depend on ngrok tunnels.
   If you specifically need an Expo tunnel, use:

   ```bash
   npm run start:dev-client:tunnel
   ```

## Android Play Store workflow

Use the local native Android project for Play Store builds.

1. Pull the production frontend env:

   ```bash
   npm run env:pull:production
   ```

2. Build the production Android App Bundle locally with Gradle:

   ```bash
   cd android
   gradlew.bat bundleRelease
   ```

3. Find the generated `.aab` here:

   ```txt
   android/app/build/outputs/bundle/release/app-release.aab
   ```

4. Upload that `.aab` in Google Play Console.

If you ever need a local release APK instead of an App Bundle:

```bash
cd android
gradlew.bat assembleRelease
```

This uses the production app identity:

- app name: `PinPoint`
- Android package: `com.alonl.pinpoint`

## iPhone App Store workflow

Use Expo / EAS for production iPhone builds.

1. Build the production iOS app:

   ```bash
   npm run build:ios:production
   ```

2. Upload the latest finished iOS build to App Store Connect:

   ```bash
   npx eas submit --platform ios --latest
   ```

3. In App Store Connect:

   - wait for Apple to finish processing the build
   - add it to TestFlight or your App Store version
   - submit it for review when ready

## Web workflow

### Fast Expo web dev server

```bash
npm run web
```

This is the quickest way to iterate on browser UI directly from Expo.

### Production-like Next-hosted browser app

The repo root exports this Expo frontend and serves it through Next. From the repo root:

```bash
npm run dev
```

or for production build:

```bash
npm run build
```

## Notes

- The browser app now runs the same Expo route tree as mobile.
- Web-specific compatibility should be handled sparingly and only where browser behavior truly differs.
- Native dev-client flows remain intact; this migration does not change the Android/iPhone development model.
