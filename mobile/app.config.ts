import type { ConfigContext, ExpoConfig } from 'expo/config';

type AppVariant = 'development' | 'production';

function getAppVariant(): AppVariant {
  return process.env.APP_VARIANT === 'development' ? 'development' : 'production';
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const appVariant = getAppVariant();
  const isDevelopment = appVariant === 'development';
  const plugins: ExpoConfig['plugins'] = [
    'expo-router',
    'expo-apple-authentication',
    'expo-web-browser',
    [
      'expo-image-picker',
      {
        cameraPermission:
          'PinPoint uses the camera to take photos of bowling scoreboards so the app can read the scores and create games or sessions for you.',
        photosPermission:
          'PinPoint uses your photo library so you can choose bowling scoreboard photos, for example a scoreboard image from your camera roll, and import it into a session or live capture.',
      },
    ],
    [
      'expo-splash-screen',
      {
        backgroundColor: '#000000',
        android: {
          image: './assets/images/splash-icon.png',
          imageWidth: 76,
        },
      },
    ],
  ];

  if (isDevelopment) {
    plugins.splice(1, 0, 'expo-dev-client');
  }

  return {
    ...config,
    name: isDevelopment ? 'PinPoint Dev' : 'PinPoint',
    slug: 'bowling-tracker-mobile',
    version: '1.0.6',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: isDevelopment ? 'pinpoint-dev' : 'pinpoint',
    userInterfaceStyle: 'dark',
    ios: {
      icon: './assets/images/icon.png',
      usesAppleSignIn: true,
      buildNumber: isDevelopment ? '20260414.1' : '20260414.1',
      bundleIdentifier: isDevelopment
        ? 'com.alonl.pinpoint.dev'
        : 'com.alonl.pinpoint',
      infoPlist: {
        CFBundleAllowMixedLocalizations: true,
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      icon: './assets/images/icon.png',
      package: isDevelopment ? 'com.alonl.pinpoint.dev' : 'com.alonl.pinpoint',
      versionCode: 20260414,
      softwareKeyboardLayoutMode: 'resize',
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/images/android-adaptive-icon.png',
      },
      predictiveBackGestureEnabled: false,
    },
    web: {
      output: 'single',
      favicon: './assets/images/favicon.png',
    },
    plugins,
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      eas: {
        projectId: '6a6fddb3-eaf8-4f3a-9fec-16f4225ca299',
      },
      appVariant,
    },
  };
};
