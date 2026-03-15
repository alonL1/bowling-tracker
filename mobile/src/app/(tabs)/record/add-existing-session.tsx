import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import UploadSessionForm from '@/components/upload-session-form';
import { palette } from '@/constants/palette';

export default function AddExistingSessionScreen() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={['top', 'left', 'right']}>
      <UploadSessionForm
        title="Add to Existing Session"
        playerLabel="Your name(s) on the scoreboard"
        imageLabel="Scoreboard image(s)"
        helperText="These games will be added to the selected session."
        sessionMode="existing"
        requireExistingSession
      />
    </SafeAreaView>
  );
}
