import * as ImagePicker from 'expo-image-picker';
import { Redirect, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import ActionButton from '@/components/action-button';
import AvatarPickerPanel from '@/components/avatar-picker-panel';
import InfoBanner from '@/components/info-banner';
import ScreenShell from '@/components/screen-shell';
import { palette, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import {
  queryKeys,
  removeOwnProfileAvatar,
  setOwnProfileAvatarPreset,
  updateOwnProfile,
  uploadOwnProfileAvatar,
} from '@/lib/backend';
import { navigateBackOrFallback } from '@/lib/navigation';
import { normalizeUsernameInput } from '@/lib/profile';
import type { AvatarKind, AvatarPresetId } from '@/lib/types';
import { useAuth } from '@/providers/auth-provider';

type UploadSelection = {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  webFile?: File | null;
};

export default function EditProfileScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, loading, isGuest, profile, refreshProfile } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [selectedMode, setSelectedMode] = useState<AvatarKind>('initials');
  const [selectedPresetId, setSelectedPresetId] = useState<AvatarPresetId | null>(null);
  const [selectedUpload, setSelectedUpload] = useState<UploadSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    setFirstName(profile?.firstName ?? '');
    setLastName(profile?.lastName ?? '');
    setUsername(profile?.username ?? profile?.usernameSuggestion ?? '');
    setSelectedMode(profile?.avatarKind ?? 'initials');
    setSelectedPresetId(profile?.avatarPresetId ?? null);
    setSelectedUpload(null);
  }, [
    profile?.avatarKind,
    profile?.avatarPresetId,
    profile?.firstName,
    profile?.lastName,
    profile?.username,
    profile?.usernameSuggestion,
  ]);

  if (loading) {
    return <ScreenShell title="Edit Profile" subtitle="Loading account..." showBackButton />;
  }

  if (!user || isGuest) {
    return <Redirect href="/login" />;
  }

  if (!profile) {
    return <Redirect href="/complete-profile" />;
  }

  const previewAvatarKind =
    selectedMode === 'uploaded' && selectedUpload?.uri
      ? 'uploaded'
      : selectedMode === 'preset' && selectedPresetId
        ? 'preset'
        : selectedMode === 'uploaded' && profile.avatarKind === 'uploaded'
          ? 'uploaded'
          : 'initials';

  const previewAvatarUrl =
    selectedMode === 'uploaded' && selectedUpload?.uri ? selectedUpload.uri : profile.avatarUrl;

  const handleAvatarAsset = async (source: 'camera' | 'library') => {
    if (busy) {
      return;
    }

    setError('');
    setInfo('');

    try {
      const permission =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        throw new Error(
          source === 'camera'
            ? 'Camera access is required to take a profile picture.'
            : 'Photo library access is required to choose a profile picture.',
        );
      }

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({
              mediaTypes: 'images',
              quality: 0.8,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: 'images',
              quality: 0.8,
            });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      const asset = result.assets[0];
      setSelectedMode('uploaded');
      setSelectedPresetId(null);
      setSelectedUpload({
        uri: asset.uri,
        fileName: asset.fileName ?? 'avatar.jpg',
        mimeType: asset.mimeType ?? 'image/jpeg',
        webFile: 'file' in asset ? (asset.file as File | null | undefined) ?? null : null,
      });
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : 'Failed to choose a profile picture.',
      );
    }
  };

  const handleSave = async () => {
    if (busy) {
      return;
    }

    setBusy(true);
    setError('');
    setInfo('');

    try {
      await updateOwnProfile({
        firstName,
        lastName,
        username: normalizeUsernameInput(username),
        completeAvatarOnboarding: true,
      });

      if (selectedMode === 'preset' && selectedPresetId) {
        if (profile.avatarKind !== 'preset' || profile.avatarPresetId !== selectedPresetId) {
          await setOwnProfileAvatarPreset(selectedPresetId);
        }
      } else if (selectedMode === 'uploaded') {
        if (selectedUpload?.uri) {
          await uploadOwnProfileAvatar(selectedUpload);
        }
      } else if (profile.avatarKind !== 'initials') {
        await removeOwnProfileAvatar();
      }

      await refreshProfile();
      await queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard });
      setInfo('Profile updated.');
      navigateBackOrFallback(router, '/(tabs)/account');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to update profile.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenShell
      title="Edit Profile"
      subtitle="Update the public details shown on your PinPoint account."
      showBackButton
      backHref="/(tabs)/account">
      <View style={styles.body}>
        <View style={styles.nameRow}>
          <View style={[styles.formGroup, styles.nameField]}>
            <Text style={styles.label}>First Name</Text>
            <TextInput
              placeholder="First name"
              placeholderTextColor={palette.muted}
              style={styles.input}
              value={firstName}
              onChangeText={setFirstName}
            />
          </View>
          <View style={[styles.formGroup, styles.nameField]}>
            <Text style={styles.label}>Last Name</Text>
            <TextInput
              placeholder="Optional"
              placeholderTextColor={palette.muted}
              style={styles.input}
              value={lastName}
              onChangeText={setLastName}
            />
          </View>
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Username</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="username"
            placeholderTextColor={palette.muted}
            style={styles.input}
            value={username}
            onChangeText={setUsername}
          />
        </View>

        <AvatarPickerPanel
          title="Profile Picture"
          subtitle="Use a photo, a preset pin, a bowling ball, or your initials."
          firstName={firstName}
          lastName={lastName}
          username={normalizeUsernameInput(username) || profile.usernameSuggestion}
          avatarKind={previewAvatarKind}
          avatarPresetId={selectedMode === 'preset' ? selectedPresetId : profile.avatarPresetId}
          avatarUrl={previewAvatarUrl}
          initials={profile.initials}
          selectedMode={selectedMode}
          selectedPresetId={selectedPresetId}
          busy={busy}
          onTakePhoto={() => void handleAvatarAsset('camera')}
          onChoosePhoto={() => void handleAvatarAsset('library')}
          onUseInitials={() => {
            setSelectedMode('initials');
            setSelectedPresetId(null);
            setSelectedUpload(null);
          }}
          onSelectPreset={(presetId) => {
            setSelectedMode('preset');
            setSelectedPresetId(presetId);
            setSelectedUpload(null);
          }}
        />

        {info ? <InfoBanner text={info} /> : null}
        {error ? <InfoBanner text={error} tone="error" /> : null}

        <ActionButton
          label="Save Changes"
          onPress={handleSave}
          disabled={!firstName.trim() || !normalizeUsernameInput(username) || busy}
          loading={busy}
        />
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.lg,
  },
  nameRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  nameField: {
    flex: 1,
  },
  formGroup: {
    gap: spacing.sm,
  },
  label: {
    color: palette.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  input: {
    backgroundColor: palette.field,
    color: palette.text,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: 16,
    lineHeight: 22,
    fontFamily: fontFamilySans,
  },
});
