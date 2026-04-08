import { useRouter, type Href } from 'expo-router';
import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text } from 'react-native';

import { palette, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';

type PageBackButtonProps = {
  fallbackHref?: Href;
  label?: string;
};

export default function PageBackButton({
  fallbackHref = '/(tabs)/sessions',
  label = 'Back',
}: PageBackButtonProps) {
  const router = useRouter();

  const handlePress = () => {
    try {
      router.back();
    } catch {
      router.replace(fallbackHref);
    }
  };

  return (
    <Pressable onPress={handlePress} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <Ionicons name="chevron-back" size={16} color={palette.muted} />
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.xs,
  },
  label: {
    color: palette.muted,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '500',
    fontFamily: fontFamilySans,
  },
  pressed: {
    opacity: 0.85,
  },
});
