import type { ConfigContext, ExpoConfig } from 'expo/config';

type AppVariant = 'development' | 'production';

function getAppVariant(): AppVariant {
  return process.env.APP_VARIANT === 'development' ? 'development' : 'production';
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const appVariant = getAppVariant();
  const isDevelopment = appVariant === 'development';

  return {
    ...config,
    name: isDevelopment ? 'PinPoint Dev' : 'PinPoint',
    slug: 'bowling-tracker-mobile',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: isDevelopment ? 'pinpoint-dev' : 'pinpoint',
    userInterfaceStyle: 'dark',
    ios: {
      icon: './assets/expo.icon',
      bundleIdentifier: isDevelopment
        ? 'com.alonl.pinpoint.dev'
        : 'com.alonl.pinpoint',
    },
    android: {
      package: isDevelopment ? 'com.alonl.pinpoint.dev' : 'com.alonl.pinpoint',
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    web: {
      output: 'single',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      'expo-dev-client',
      'expo-web-browser',
      [
        'expo-splash-screen',
        {
          backgroundColor: '#208AEF',
          android: {
            image: './assets/images/splash-icon.png',
            imageWidth: 76,
          },
        },
      ],
    ],
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
