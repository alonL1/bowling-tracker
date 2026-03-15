import { Stack } from 'expo-router';
import React from 'react';

import { palette } from '@/constants/palette';

export default function SessionsStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: {
          backgroundColor: palette.background,
        },
      }}
    />
  );
}
