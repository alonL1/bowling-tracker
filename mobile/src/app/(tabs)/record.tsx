import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import ScreenShell from '@/components/screen-shell';
import SurfaceCard from '@/components/surface-card';
import { palette, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';

const OPTIONS = [
  {
    title: 'Start a Session',
    description: 'About to start your bowling session? Select this option to start recording it live.',
    route: '/record/live',
  },
  {
    title: 'Upload a Session',
    description: 'Finished bowling for the day? Upload your scoreboard images and record your session.',
    route: '/record/upload-session',
  },
  {
    title: 'Add Multiple Sessions',
    description: 'Select up to 100 images and they will automatically be sorted into sessions and recorded.',
    route: '/record/add-multiple-sessions',
  },
  {
    title: 'Add to an Existing Session',
    description: 'Add game(s) to an already existing session.',
    route: '/record/add-existing-session',
  },
];

export default function RecordScreen() {
  const router = useRouter();

  return (
    <ScreenShell title="Record" subtitle="Record new games and add them to your personal log.">
      <View style={styles.list}>
        {OPTIONS.map((option) => (
          <Pressable
            key={option.route}
            onPress={() => router.push(option.route as never)}
            style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}>
            <SurfaceCard style={styles.card}>
              <Text style={styles.cardTitle}>{option.title}</Text>
              <Text style={styles.cardDescription}>{option.description}</Text>
            </SurfaceCard>
          </Pressable>
        ))}
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.md,
  },
  wrap: {
    minWidth: 0,
  },
  card: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    gap: 12,
    minHeight: 116,
  },
  cardTitle: {
    color: palette.text,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  cardDescription: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: fontFamilySans,
  },
  pressed: {
    opacity: 0.94,
  },
});
