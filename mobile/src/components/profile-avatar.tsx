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

import BowlingBallGlyph from '@/components/bowling-ball-glyph';
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
const COCONUT_HOLE_COLOR = '#3A2416';

function getInitialsBackground(seed: string) {
  const source = seed || 'P';
  let sum = 0;
  for (let index = 0; index < source.length; index += 1) {
    sum += source.charCodeAt(index);
  }
  return INITIALS_BACKGROUNDS[sum % INITIALS_BACKGROUNDS.length];
}

function CoconutBowlingBallAvatar({ size, color }: { size: number; color: string }) {
  return (
    <View style={styles.coconutWrap}>
      <BowlingBallGlyph size={size} color={color} holeColor={COCONUT_HOLE_COLOR} />
      <View
        pointerEvents="none"
        style={[
          styles.coconutTextureMark,
          {
            width: size * 0.16,
            height: size * 0.05,
            borderRadius: size * 0.03,
            top: size * 0.18,
            left: size * 0.2,
            transform: [{ rotate: '-18deg' }],
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.coconutTextureMark,
          {
            width: size * 0.12,
            height: size * 0.045,
            borderRadius: size * 0.03,
            top: size * 0.58,
            left: size * 0.16,
            transform: [{ rotate: '10deg' }],
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.coconutTextureMark,
          {
            width: size * 0.15,
            height: size * 0.05,
            borderRadius: size * 0.03,
            top: size * 0.64,
            right: size * 0.18,
            transform: [{ rotate: '-14deg' }],
          },
        ]}
      />
    </View>
  );
}

function SinkAvatar({ size }: { size: number }) {
  return (
    <View
      style={[
        styles.iconAvatarWrap,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: '#465261',
        },
      ]}>
      <View
        style={[
          styles.sinkFaucetStem,
          {
            width: size * 0.08,
            height: size * 0.18,
            top: size * 0.18,
            left: size * 0.46,
            borderRadius: size * 0.04,
          },
        ]}
      />
      <View
        style={[
          styles.sinkFaucetTop,
          {
            width: size * 0.22,
            height: size * 0.07,
            top: size * 0.16,
            left: size * 0.34,
            borderRadius: size * 0.03,
          },
        ]}
      />
      <View
        style={[
          styles.sinkBasin,
          {
            width: size * 0.56,
            height: size * 0.3,
            top: size * 0.44,
            left: size * 0.22,
            borderRadius: size * 0.12,
          },
        ]}>
        <View
          style={[
            styles.sinkDrain,
            {
              width: size * 0.08,
              height: size * 0.08,
              borderRadius: size * 0.04,
              top: size * 0.1,
              left: size * 0.24,
            },
          ]}
        />
      </View>
    </View>
  );
}

function LeafAvatar({ size }: { size: number }) {
  return (
    <View
      style={[
        styles.iconAvatarWrap,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: '#274A36',
        },
      ]}>
      <View
        style={[
          styles.leafBody,
          {
            width: size * 0.38,
            height: size * 0.56,
            left: size * 0.31,
            top: size * 0.18,
            borderTopLeftRadius: size * 0.24,
            borderTopRightRadius: size * 0.04,
            borderBottomLeftRadius: size * 0.04,
            borderBottomRightRadius: size * 0.24,
            transform: [{ rotate: '-32deg' }],
          },
        ]}
      />
      <View
        style={[
          styles.leafVein,
          {
            width: size * 0.04,
            height: size * 0.42,
            left: size * 0.47,
            top: size * 0.28,
            borderRadius: size * 0.02,
            transform: [{ rotate: '-32deg' }],
          },
        ]}
      />
    </View>
  );
}

function PeanutButterJarAvatar({ size }: { size: number }) {
  return (
    <View
      style={[
        styles.iconAvatarWrap,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: '#49372C',
        },
      ]}>
      <View
        style={[
          styles.jarLid,
          {
            width: size * 0.34,
            height: size * 0.11,
            left: size * 0.33,
            top: size * 0.18,
            borderTopLeftRadius: size * 0.05,
            borderTopRightRadius: size * 0.05,
          },
        ]}
      />
      <View
        style={[
          styles.jarBody,
          {
            width: size * 0.42,
            height: size * 0.42,
            left: size * 0.29,
            top: size * 0.28,
            borderRadius: size * 0.1,
          },
        ]}>
        <View
          style={[
            styles.jarLabel,
            {
              width: size * 0.24,
              height: size * 0.13,
              left: size * 0.09,
              top: size * 0.14,
              borderRadius: size * 0.04,
            },
          ]}
        />
      </View>
    </View>
  );
}

function BeachChairAvatar({ size }: { size: number }) {
  return (
    <View
      style={[
        styles.iconAvatarWrap,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: '#1D3446',
        },
      ]}>
      <View
        style={[
          styles.chairSeat,
          {
            width: size * 0.3,
            height: size * 0.34,
            left: size * 0.38,
            top: size * 0.24,
            borderRadius: size * 0.04,
            transform: [{ rotate: '-22deg' }],
          },
        ]}>
        <View style={[styles.chairStripe, { left: '18%' }]} />
        <View style={[styles.chairStripe, { left: '44%' }]} />
        <View style={[styles.chairStripe, { left: '70%' }]} />
      </View>
      <View
        style={[
          styles.chairLeg,
          {
            width: size * 0.045,
            height: size * 0.34,
            left: size * 0.34,
            top: size * 0.38,
            transform: [{ rotate: '20deg' }],
          },
        ]}
      />
      <View
        style={[
          styles.chairLeg,
          {
            width: size * 0.045,
            height: size * 0.34,
            left: size * 0.6,
            top: size * 0.34,
            transform: [{ rotate: '-14deg' }],
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
          <BowlingBallGlyph
            size={size}
            color={preset.color}
            holeColor={palette.background}
          />
        </View>
      );
    }

    if (preset?.kind === 'coconut' && preset.color) {
      return (
        <View style={style}>
          <CoconutBowlingBallAvatar size={size} color={preset.color} />
        </View>
      );
    }

    if (preset?.kind === 'sink') {
      return (
        <View style={style}>
          <SinkAvatar size={size} />
        </View>
      );
    }

    if (preset?.kind === 'leaf') {
      return (
        <View style={style}>
          <LeafAvatar size={size} />
        </View>
      );
    }

    if (preset?.kind === 'jar') {
      return (
        <View style={style}>
          <PeanutButterJarAvatar size={size} />
        </View>
      );
    }

    if (preset?.kind === 'chair') {
      return (
        <View style={style}>
          <BeachChairAvatar size={size} />
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
  coconutWrap: {
    position: 'relative',
  },
  iconAvatarWrap: {
    position: 'relative',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coconutTextureMark: {
    position: 'absolute',
    backgroundColor: 'rgba(165, 118, 84, 0.5)',
  },
  sinkFaucetStem: {
    position: 'absolute',
    backgroundColor: '#C8D1DB',
  },
  sinkFaucetTop: {
    position: 'absolute',
    backgroundColor: '#D8E0E8',
  },
  sinkBasin: {
    position: 'absolute',
    backgroundColor: '#E6EEF5',
    overflow: 'hidden',
  },
  sinkDrain: {
    position: 'absolute',
    backgroundColor: '#95A3B2',
  },
  leafBody: {
    position: 'absolute',
    backgroundColor: '#8FD07A',
  },
  leafVein: {
    position: 'absolute',
    backgroundColor: '#5A924B',
  },
  jarLid: {
    position: 'absolute',
    backgroundColor: '#D14836',
  },
  jarBody: {
    position: 'absolute',
    backgroundColor: '#C98843',
  },
  jarLabel: {
    position: 'absolute',
    backgroundColor: '#F2D79B',
  },
  chairSeat: {
    position: 'absolute',
    backgroundColor: '#4BA9C7',
    overflow: 'hidden',
  },
  chairStripe: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '14%',
    backgroundColor: '#F4E3AF',
  },
  chairLeg: {
    position: 'absolute',
    backgroundColor: '#D4DCE6',
    borderRadius: 999,
  },
});
