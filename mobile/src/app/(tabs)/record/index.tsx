import AntDesign from '@expo/vector-icons/AntDesign';
import Entypo from '@expo/vector-icons/Entypo';
import Feather from '@expo/vector-icons/Feather';
import Fontisto from '@expo/vector-icons/Fontisto';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import ScreenShell from '@/components/screen-shell';
import SurfaceCard from '@/components/surface-card';
import { fetchLiveSession, queryKeys } from '@/lib/backend';
import { palette, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';

export default function RecordScreen() {
  const router = useRouter();
  const liveSessionQuery = useQuery({
    queryKey: queryKeys.liveSession,
    queryFn: fetchLiveSession,
  });
  const hasLiveSession = Boolean(liveSessionQuery.data?.liveSession);

  const options = [
    {
      title: hasLiveSession ? 'Resume Live Session' : 'Start Live Session',
      description:
        'About to start your bowling session? Select this option to start recording it and see live stats.',
      route: '/record/live',
      icon: hasLiveSession ? (
        <AntDesign name="play-circle" size={30} color={palette.text} />
      ) : (
        <Fontisto name="radio-btn-active" size={26} color={palette.text} />
      ),
    },
    {
      title: 'Upload a Session',
      description: 'Finished bowling for the day? Upload your scoreboard images and record your session.',
      route: '/record/upload-session',
      icon: <Feather name="upload" size={28} color={palette.text} />,
    },
    {
      title: 'Add Multiple Sessions',
      description: 'Select up to 100 images and they will automatically be sorted into sessions and recorded.',
      route: '/record/add-multiple-sessions',
      icon: <MaterialCommunityIcons name="card-multiple" size={30} color={palette.text} />,
    },
    {
      title: 'Add to an Existing Session',
      description: 'Add game(s) to an already existing session.',
      route: '/record/add-existing-session',
      icon: <Entypo name="add-to-list" size={28} color={palette.text} />,
    },
  ] as const;

  return (
    <ScreenShell title="Record">
      <View style={styles.list}>
        {options.map((option) => (
          <Pressable
            key={option.route}
            onPress={() => router.push(option.route as never)}
            style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}>
            <SurfaceCard style={styles.card}>
              <View style={styles.iconWrap}>{option.icon}</View>
              <View style={styles.textBlock}>
                <Text style={styles.cardTitle}>{option.title}</Text>
                <Text style={styles.cardDescription}>{option.description}</Text>
              </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    gap: spacing.lg,
    minHeight: 116,
  },
  iconWrap: {
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBlock: {
    flex: 1,
    gap: 12,
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
