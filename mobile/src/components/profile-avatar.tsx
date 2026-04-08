import React from 'react';
import { Image } from 'expo-image';
import {
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { palette } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import { AVATAR_PRESET_MAP, getProfileInitials } from '@/lib/profile';
import type { AvatarKind, AvatarPresetId } from '@/lib/types';

type ProfileAvatarProps = {
  size?: number;
  avatarKind?: AvatarKind | null;
  avatarPresetId?: AvatarPresetId | null;
  avatarUrl?: string | null;
  initials?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  style?: StyleProp<ViewStyle | ImageStyle>;
};

const INITIALS_BACKGROUNDS = ['#33506D', '#415E82', '#4C668D', '#2A4259'] as const;

function getInitialsBackground(seed: string) {
  const source = seed || 'P';
  let sum = 0;
  for (let index = 0; index < source.length; index += 1) {
    sum += source.charCodeAt(index);
  }
  return INITIALS_BACKGROUNDS[sum % INITIALS_BACKGROUNDS.length];
}

function BowlingBallAvatar({ size, color }: { size: number; color: string }) {
  const holeSize = Math.max(5, Math.round(size * 0.16));
  const holeOffset = Math.round(size * 0.22);
  const holeTop = Math.round(size * 0.26);
  const lowerHoleTop = Math.round(size * 0.48);

  return (
    <View
      style={[
        styles.ball,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
      ]}>
      <View
        style={[
          styles.ballHole,
          {
            width: holeSize,
            height: holeSize,
            borderRadius: holeSize / 2,
            top: holeTop,
            left: holeOffset,
          },
        ]}
      />
      <View
        style={[
          styles.ballHole,
          {
            width: holeSize,
            height: holeSize,
            borderRadius: holeSize / 2,
            top: holeTop - Math.round(size * 0.04),
            right: holeOffset,
          },
        ]}
      />
      <View
        style={[
          styles.ballHole,
          {
            width: holeSize,
            height: holeSize,
            borderRadius: holeSize / 2,
            top: lowerHoleTop,
            left: Math.round(size * 0.45),
          },
        ]}
      />
    </View>
  );
}

export default function ProfileAvatar({
  size = 56,
  avatarKind = 'initials',
  avatarPresetId = null,
  avatarUrl = null,
  initials = null,
  firstName = null,
  lastName = null,
  username = null,
  style,
}: ProfileAvatarProps) {
  const resolvedInitials = getProfileInitials({
    firstName,
    lastName,
    username,
    initials,
  });

  if (avatarKind === 'uploaded' && avatarUrl) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        contentFit="cover"
        style={[
          styles.image,
          { width: size, height: size, borderRadius: size / 2 },
          style as StyleProp<ImageStyle>,
        ]}
      />
    );
  }

  if (avatarKind === 'preset' && avatarPresetId) {
    const preset = AVATAR_PRESET_MAP[avatarPresetId];
    if (preset?.kind === 'pin' && preset.source) {
      return (
        <View
          style={[
            styles.presetWrap,
            { width: size, height: size, borderRadius: size / 2 },
            style,
          ]}>
          <Image
            source={preset.source}
            contentFit="contain"
            style={{ width: size * 0.9, height: size * 0.9 }}
          />
        </View>
      );
    }

    if (preset?.kind === 'ball' && preset.color) {
      return (
        <View style={style}>
          <BowlingBallAvatar size={size} color={preset.color} />
        </View>
      );
    }
  }

  return (
    <View
      style={[
        styles.initialsWrap,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: getInitialsBackground(resolvedInitials),
        },
        style,
      ]}>
      <Text style={[styles.initialsText, { fontSize: Math.max(16, Math.round(size * 0.34)) }]}>
        {resolvedInitials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: palette.surfaceRaised,
  },
  presetWrap: {
    backgroundColor: palette.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initialsWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialsText: {
    color: palette.text,
    fontWeight: '700',
    fontFamily: fontFamilySans,
    letterSpacing: 0.4,
  },
  ball: {
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  ballHole: {
    position: 'absolute',
    backgroundColor: '#111827',
  },
});
