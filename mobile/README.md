# Bowling Tracker Mobile

This Expo app now targets a **development build** workflow instead of Expo Go.

## Prerequisites

- Node.js + npm
- an Expo account
- EAS access via `eas-cli`
- Android device for the first build

## Environment strategy

The mobile app reads these public values:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_API_BASE_URL`

The source of truth should be EAS environments:

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

## One-time setup

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

4. Create EAS environments named `preview` and `production`, each with:

   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - `EXPO_PUBLIC_API_BASE_URL`

5. Build the Android dev client:

   ```bash
   npm run build:android:development
   ```

6. Install the generated APK on your phone.

The installed app is the separate development variant:

- app name: `Bowling Tracker Dev`
- Android package: `com.alonl.bowlingtracker.dev`
- iOS bundle identifier reserved for later: `com.alonl.bowlingtracker.dev`

## Daily workflow

1. Pull the backend environment you want:

   ```bash
   npm run env:pull:preview
   ```

   or:

   ```bash
   npm run env:pull:production
   ```

2. Start Metro for the dev client:

   ```bash
   npm run start:dev-client
   ```

3. Open `Bowling Tracker Dev` on your phone or scan the QR code from Metro.

## Notes

- The dev client can live on the phone beside a future production build.
- Rebuild the native app only when native config or native dependencies change.
- Normal UI and API work continues through Metro once the dev client is installed.
- iPhone support is prepared in the config, but this repo is currently set up to build Android first.
