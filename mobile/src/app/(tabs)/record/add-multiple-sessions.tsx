import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import UploadSessionForm from '@/components/upload-session-form';
import { palette } from '@/constants/palette';

export default function AddMultipleSessionsScreen() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={['top', 'left', 'right']}>
      <UploadSessionForm
        title="Add Multiple Sessions"
        playerLabel="Your name(s) on the scoreboard"
        imageLabel="Scoreboard image(s)"
        helperText="Select up to 100 images and the app will sort them into sessions."
        addToLogHelperText="Auto Session groups these images into sessions based on photo timestamps."
        sessionMode="auto"
      />
    </SafeAreaView>
  );
}
