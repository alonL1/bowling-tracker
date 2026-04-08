import * as ImagePicker from 'expo-image-picker';
import { Redirect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import ActionButton from '@/components/action-button';
import AvatarPickerPanel from '@/components/avatar-picker-panel';
import InfoBanner from '@/components/info-banner';
import ScreenShell from '@/components/screen-shell';
import { spacing } from '@/constants/palette';
import {
  queryKeys,
  removeOwnProfileAvatar,
  setOwnProfileAvatarPreset,
  updateOwnProfile,
  uploadOwnProfileAvatar,
} from '@/lib/backend';
import type { AvatarKind, AvatarPresetId } from '@/lib/types';
import { useAuth } from '@/providers/auth-provider';

type UploadSelection = {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  webFile?: File | null;
};

function getSafeNextPath(raw: string | string[] | undefined) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return '/(tabs)/sessions';
  }
  if (
    trimmed.startsWith('/login') ||
    trimmed.startsWith('/complete-profile') ||
    trimmed.startsWith('/choose-avatar')
  ) {
    return '/(tabs)/sessions';
  }
  return trimmed || '/(tabs)/sessions';
}

export default function ChooseAvatarScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ next?: string }>();
  const { user, loading, isGuest, profile, refreshProfile } = useAuth();
  const nextPath = useMemo(() => getSafeNextPath(params.next), [params.next]);
  const [selectedMode, setSelectedMode] = useState<AvatarKind>('initials');
  const [selectedPresetId, setSelectedPresetId] = useState<AvatarPresetId | null>(null);
  const [selectedUpload, setSelectedUpload] = useState<UploadSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!profile) {
      return;
    }

    setSelectedMode(profile.avatarKind ?? 'initials');
    setSelectedPresetId(profile.avatarPresetId ?? null);
    setSelectedUpload(null);
  }, [profile]);

  if (loading) {
    return <ScreenShell title="Choose Avatar" subtitle="Loading account..." />;
  }

  if (!user || isGuest) {
    return <Redirect href="/login" />;
  }

  if (!profile?.profileComplete) {
    return <Redirect href={`/complete-profile?next=${encodeURIComponent(nextPath)}`} />;
  }

  if (!profile.avatarStepNeeded) {
    return <Redirect href={nextPath as Href} />;
  }

  const previewAvatarKind =
    selectedMode === 'uploaded' && selectedUpload?.uri
      ? 'uploaded'
      : selectedMode === 'preset' && selectedPresetId
        ? 'preset'
        : 'initials';

  const previewAvatarUrl =
    selectedMode === 'uploaded' && selectedUpload?.uri ? selectedUpload.uri : profile.avatarUrl;

  const handleAvatarAsset = async (source: 'camera' | 'library') => {
    if (busy) {
      return;
    }

    setError('');

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
              mediaTypes: ['images'],
              quality: 0.8,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
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

  const handleContinue = async () => {
    if (busy) {
      return;
    }

    setBusy(true);
    setError('');

    try {
      if (selectedMode === 'preset' && selectedPresetId) {
        await setOwnProfileAvatarPreset(selectedPresetId);
      } else if (selectedMode === 'uploaded' && selectedUpload?.uri) {
        await uploadOwnProfileAvatar(selectedUpload);
      } else if (selectedMode === 'initials' && profile.avatarKind !== 'initials') {
        await removeOwnProfileAvatar();
      } else {
        await updateOwnProfile({
          firstName: profile.firstName ?? '',
          lastName: profile.lastName,
          username: profile.username ?? profile.usernameSuggestion ?? '',
          completeAvatarOnboarding: true,
        });
      }

      await refreshProfile();
      await queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard });
      router.replace(nextPath as Href);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to save avatar.');
    } finally {
      setBusy(false);
    }
  };

  const handleSkip = async () => {
    if (busy) {
      return;
    }

    setBusy(true);
    setError('');

    try {
      await updateOwnProfile({
        firstName: profile.firstName ?? '',
        lastName: profile.lastName,
        username: profile.username ?? profile.usernameSuggestion ?? '',
        completeAvatarOnboarding: true,
      });
      await refreshProfile();
      await queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard });
      router.replace(nextPath as Href);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to finish avatar setup.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenShell
      title="Choose Avatar"
      subtitle="Pick a photo, a pin, a bowling ball, or keep your initials. You can change it later.">
      <View style={styles.body}>
        <AvatarPickerPanel
          title="Your public avatar"
          subtitle="Shown next to your username on account, friends, and invite surfaces."
          firstName={profile.firstName}
          lastName={profile.lastName}
          username={profile.username ?? profile.usernameSuggestion}
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

        {error ? <InfoBanner text={error} tone="error" /> : null}

        <ActionButton
          label="Save and Continue"
          onPress={handleContinue}
          disabled={busy}
          loading={busy}
        />
        <ActionButton
          label="Skip for Now"
          onPress={handleSkip}
          disabled={busy}
          variant="secondary"
        />
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.lg,
  },
});
