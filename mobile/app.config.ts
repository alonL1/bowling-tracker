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
    'expo-web-browser',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#208AEF',
        android: {
          image: './assets/images/icon.png',
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
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: isDevelopment ? 'pinpoint-dev' : 'pinpoint',
    userInterfaceStyle: 'dark',
    ios: {
      icon: './assets/images/icon.png',
      bundleIdentifier: isDevelopment
        ? 'com.alonl.pinpoint.dev'
        : 'com.alonl.pinpoint',
    },
    android: {
      icon: './assets/images/icon.png',
      package: isDevelopment ? 'com.alonl.pinpoint.dev' : 'com.alonl.pinpoint',
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/images/icon.png',
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
