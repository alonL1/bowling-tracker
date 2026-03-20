import AntDesign from '@expo/vector-icons/AntDesign';
import Entypo from '@expo/vector-icons/Entypo';
import Feather from '@expo/vector-icons/Feather';
import Fontisto from '@expo/vector-icons/Fontisto';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import BowlingBallSpinner from '@/components/bowling-ball-spinner';
import ScreenShell from '@/components/screen-shell';
import SurfaceCard from '@/components/surface-card';
import { fetchRecordEntryStatus, queryKeys } from '@/lib/backend';
import { palette, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';

type RecordOptionState = 'loading' | 'start' | 'resume';

type RecordOption = {
  key: 'live' | 'upload' | 'multiple' | 'existing';
  title: string;
  description: string;
  route: '/record/live' | '/record/upload-session' | '/record/add-multiple-sessions' | '/record/add-existing-session';
  icon: React.ReactNode;
  state: RecordOptionState;
};

export default function RecordScreen() {
  const router = useRouter();
  const recordStatusQuery = useQuery({
    queryKey: queryKeys.recordEntryStatus,
    queryFn: fetchRecordEntryStatus,
  });

  const status = recordStatusQuery.data?.status;
  const isLoading = recordStatusQuery.isPending && !recordStatusQuery.data;

  const liveSessionState: RecordOptionState = isLoading
    ? 'loading'
    : status?.liveSession
      ? 'resume'
      : 'start';
  const uploadSessionState: RecordOptionState = isLoading
    ? 'loading'
    : status?.uploadSessionDraft
      ? 'resume'
      : 'start';
  const addMultipleSessionsState: RecordOptionState = isLoading
    ? 'loading'
    : status?.addMultipleSessionsDraft
      ? 'resume'
      : 'start';
  const addExistingSessionState: RecordOptionState = isLoading
    ? 'loading'
    : status?.addExistingSessionDraft
      ? 'resume'
      : 'start';

  const renderLoadingIcon = () => (
    <BowlingBallSpinner size={26} holeColor={palette.surfaceRaised} />
  );

  const options: RecordOption[] = [
    {
      key: 'live',
      title:
        liveSessionState === 'loading'
          ? 'Live Session'
          : liveSessionState === 'resume'
            ? 'Resume Live Session'
            : 'Start Live Session',
      description:
        liveSessionState === 'loading'
          ? 'Checking for an active live session...'
          : liveSessionState === 'resume'
            ? 'Resume your live session. Or go in and end it to start a new one.'
            : 'About to start your bowling session? Select this option to start recording it and see live stats.',
      route: '/record/live',
      icon:
        liveSessionState === 'loading' ? (
          renderLoadingIcon()
        ) : liveSessionState === 'resume' ? (
          <AntDesign name="play-circle" size={30} color={palette.text} />
        ) : (
          <Fontisto name="radio-btn-active" size={26} color={palette.text} />
        ),
      state: liveSessionState,
    },
    {
      key: 'upload',
      title:
        uploadSessionState === 'loading'
          ? 'Upload a Session'
          : uploadSessionState === 'resume'
            ? 'Resume Upload Session'
            : 'Upload a Session',
      description:
        uploadSessionState === 'loading'
          ? 'Checking for an active upload draft...'
          : uploadSessionState === 'resume'
            ? 'Resume your upload draft. Or go in and discard it to start over.'
            : 'Finished bowling for the day? Upload your scoreboard images and record your session.',
      route: '/record/upload-session',
      icon: uploadSessionState === 'loading' ? renderLoadingIcon() : <Feather name="upload" size={28} color={palette.text} />,
      state: uploadSessionState,
    },
    {
      key: 'multiple',
      title:
        addMultipleSessionsState === 'loading'
          ? 'Add Multiple Sessions'
          : addMultipleSessionsState === 'resume'
            ? 'Resume Adding Multiple Sessions'
            : 'Add Multiple Sessions',
      description:
        addMultipleSessionsState === 'loading'
          ? 'Checking for an active multi-session draft...'
          : addMultipleSessionsState === 'resume'
            ? 'Resume your multi-session draft. Or go in and discard it to start over.'
            : 'Select up to 100 images and they will automatically be sorted into sessions and recorded.',
      route: '/record/add-multiple-sessions',
      icon:
        addMultipleSessionsState === 'loading' ? (
          renderLoadingIcon()
        ) : (
          <MaterialCommunityIcons name="card-multiple" size={30} color={palette.text} />
        ),
      state: addMultipleSessionsState,
    },
    {
      key: 'existing',
      title:
        addExistingSessionState === 'loading'
          ? 'Add to an Existing Session'
          : addExistingSessionState === 'resume'
            ? 'Resume Add to Existing Session'
            : 'Add to an Existing Session',
      description:
        addExistingSessionState === 'loading'
          ? 'Checking for an active existing-session draft...'
          : addExistingSessionState === 'resume'
            ? 'Resume your draft and keep adding it to a session. Or go in and discard it to start over.'
            : 'Add game(s) to an already existing session.',
      route: '/record/add-existing-session',
      icon:
        addExistingSessionState === 'loading' ? (
          renderLoadingIcon()
        ) : (
          <Entypo name="add-to-list" size={28} color={palette.text} />
        ),
      state: addExistingSessionState,
    },
  ] as const;

  return (
    <ScreenShell title="Record">
      <View style={styles.list}>
        {options.map((option) => (
          <Pressable
            key={option.route}
            disabled={option.state === 'loading'}
            onPress={() => router.push(option.route as never)}
            style={({ pressed }) => [
              styles.wrap,
              option.state === 'loading' && styles.disabled,
              pressed && styles.pressed,
            ]}>
            <SurfaceCard
              style={[
                styles.card,
                option.state === 'resume' && styles.resumeCard,
              ]}>
              <View style={styles.iconWrap}>{option.icon}</View>
              <View style={styles.textBlock}>
                <Text style={styles.cardTitle}>{option.title}</Text>
                <Text
                  style={[
                    styles.cardDescription,
                    option.state === 'resume' && styles.cardDescriptionResume,
                  ]}>
                  {option.description}
                </Text>
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
  resumeCard: {
    backgroundColor: palette.accent,
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
  cardDescriptionResume: {
    color: palette.text,
    opacity: 0.88,
  },
  pressed: {
    opacity: 0.94,
  },
  disabled: {
    opacity: 0.82,
  },
});
