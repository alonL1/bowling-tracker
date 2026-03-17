# Bowling Tracker Mobile + Web Frontend

`mobile/` is now the single source of truth for the Bowling Tracker product UI across:

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
