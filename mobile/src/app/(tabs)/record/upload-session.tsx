import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import UploadSessionForm from '@/components/upload-session-form';
import { palette } from '@/constants/palette';

export default function UploadSessionScreen() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={['top', 'left', 'right']}>
      <UploadSessionForm
        title="Upload a Session"
        playerLabel="Your name(s) on the scoreboard"
        imageLabel="Scoreboard image(s)"
        helperText="All of these games will go into one session."
        sessionMode="new"
      />
    </SafeAreaView>
  );
}
