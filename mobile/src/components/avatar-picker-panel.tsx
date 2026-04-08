import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import ActionButton from '@/components/action-button';
import ProfileAvatar from '@/components/profile-avatar';
import SurfaceCard from '@/components/surface-card';
import { palette, radii, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import { AVATAR_PRESET_OPTIONS, formatHandle } from '@/lib/profile';
import type { AvatarKind, AvatarPresetId } from '@/lib/types';

type AvatarPickerPanelProps = {
  title: string;
  subtitle?: string;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  avatarKind: AvatarKind;
  avatarPresetId?: AvatarPresetId | null;
  avatarUrl?: string | null;
  initials?: string | null;
  selectedMode: AvatarKind;
  selectedPresetId?: AvatarPresetId | null;
  busy?: boolean;
  onTakePhoto: () => void;
  onChoosePhoto: () => void;
  onUseInitials: () => void;
  onSelectPreset: (presetId: AvatarPresetId) => void;
};

export default function AvatarPickerPanel({
  title,
  subtitle,
  firstName = null,
  lastName = null,
  username = null,
  avatarKind,
  avatarPresetId = null,
  avatarUrl = null,
  initials = null,
  selectedMode,
  selectedPresetId = null,
  busy = false,
  onTakePhoto,
  onChoosePhoto,
  onUseInitials,
  onSelectPreset,
}: AvatarPickerPanelProps) {
  return (
    <SurfaceCard style={styles.card} tone="raised">
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>

      <View style={styles.preview}>
        <ProfileAvatar
          size={92}
          avatarKind={avatarKind}
          avatarPresetId={avatarPresetId}
          avatarUrl={avatarUrl}
          initials={initials}
          firstName={firstName}
          lastName={lastName}
          username={username}
        />
        <View style={styles.previewText}>
          <Text style={styles.previewName}>
            {[firstName, lastName].filter(Boolean).join(' ').trim() || 'PinPoint Profile'}
          </Text>
          <Text style={styles.previewHandle}>{formatHandle(username)}</Text>
        </View>
      </View>

      <View style={styles.actionGroup}>
        <ActionButton
          label="Take Photo"
          onPress={onTakePhoto}
          disabled={busy}
          variant="secondary"
        />
        <ActionButton
          label="Choose Photo"
          onPress={onChoosePhoto}
          disabled={busy}
          variant="secondary"
        />
        <ActionButton
          label="Use Initials"
          onPress={onUseInitials}
          disabled={busy}
          variant={selectedMode === 'initials' ? 'primary' : 'secondary'}
        />
      </View>

      <View style={styles.grid}>
        {AVATAR_PRESET_OPTIONS.map((option) => {
          const selected = selectedMode === 'preset' && selectedPresetId === option.id;
          return (
            <Pressable
              key={option.id}
              onPress={() => onSelectPreset(option.id)}
              style={({ pressed }) => [
                styles.presetCard,
                selected && styles.presetCardSelected,
                pressed && styles.pressed,
              ]}>
              <ProfileAvatar
                size={56}
                avatarKind="preset"
                avatarPresetId={option.id}
                firstName={firstName}
                lastName={lastName}
                username={username}
              />
              <Text style={styles.presetLabel}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SurfaceCard>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.lg,
  },
  header: {
    gap: spacing.xs,
  },
  title: {
    color: palette.text,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
    fontFamily: fontFamilySans,
  },
  subtitle: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  previewText: {
    flex: 1,
    gap: 4,
  },
  previewName: {
    color: palette.text,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  previewHandle: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: fontFamilySans,
  },
  actionGroup: {
    gap: spacing.sm,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  presetCard: {
    width: '48%',
    minHeight: 108,
    borderRadius: radii.md,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
  },
  presetCardSelected: {
    borderColor: palette.userChat,
    backgroundColor: palette.surfaceRaised,
  },
  presetLabel: {
    color: palette.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    textAlign: 'center',
    fontFamily: fontFamilySans,
  },
  pressed: {
    opacity: 0.92,
  },
});
