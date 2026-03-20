import React from 'react';

import ScoreboardGameEditSheet from '@/components/scoreboard-game-edit-sheet';
import type { LivePlayer, LiveSessionGame } from '@/lib/types';

type LiveGameEditSheetProps = {
  visible: boolean;
  game: LiveSessionGame | null;
  selectedPlayerKeys?: string[];
  saving?: boolean;
  errorText?: string;
  onClose: () => void;
  onSave: (payload: { liveGameId: string; players: LivePlayer[] }) => void;
};

export default function LiveGameEditSheet({
  visible,
  game,
  selectedPlayerKeys = [],
  saving = false,
  errorText = '',
  onClose,
  onSave,
}: LiveGameEditSheetProps) {
  return (
    <ScoreboardGameEditSheet
      visible={visible}
      extraction={game?.extraction}
      selectedPlayerKeys={selectedPlayerKeys}
      saving={saving}
      errorText={errorText}
      title="Edit Live Game"
      subtitle="Adjust player names and frame marks for this scoreboard."
      saveLabel="Save live game"
      disabled={!game}
      onClose={onClose}
      onSave={(players) => {
        if (!game) {
          return;
        }
        onSave({
          liveGameId: game.id,
          players,
        });
      }}
    />
  );
}
