import React from 'react';

import ScoreboardGameEditSheet from '@/components/scoreboard-game-edit-sheet';
import type { LivePlayer, RecordingDraftGame } from '@/lib/types';

type RecordingDraftGameEditSheetProps = {
  visible: boolean;
  game: RecordingDraftGame | null;
  selectedPlayerKeys?: string[];
  saving?: boolean;
  errorText?: string;
  onClose: () => void;
  onSave: (payload: { draftGameId: string; players: LivePlayer[] }) => void;
};

export default function RecordingDraftGameEditSheet({
  visible,
  game,
  selectedPlayerKeys = [],
  saving = false,
  errorText = '',
  onClose,
  onSave,
}: RecordingDraftGameEditSheetProps) {
  return (
    <ScoreboardGameEditSheet
      visible={visible}
      extraction={game?.extraction}
      selectedPlayerKeys={selectedPlayerKeys}
      saving={saving}
      errorText={errorText}
      title="Edit Scoreboard Draft"
      subtitle="Adjust player names and frame marks for this scoreboard."
      saveLabel="Save draft game"
      disabled={!game}
      onClose={onClose}
      onSave={(players) => {
        if (!game) {
          return;
        }
        onSave({
          draftGameId: game.id,
          players,
        });
      }}
    />
  );
}
