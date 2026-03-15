import { Platform } from 'react-native';

export const fontFamilySans = Platform.select({
  ios: 'System',
  android: 'Roboto',
  web: 'Roboto, "Segoe UI", sans-serif',
  default: 'sans-serif',
});
