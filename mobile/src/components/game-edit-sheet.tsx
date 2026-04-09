import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import ScoreboardGameEditSheet from '@/components/scoreboard-game-edit-sheet';
import { queryKeys, updateGame } from '@/lib/backend';
import { normalizePlayerKey } from '@/lib/live-session';
import type { GameListItem } from '@/lib/types';
import { useUploadsProcessing } from '@/providers/uploads-processing-provider';

type GameEditSheetProps = {
  visible: boolean;
  game: GameListItem | null;
  onClose: () => void;
};

export default function GameEditSheet({
  visible,
  game,
  onClose,
}: GameEditSheetProps) {
  const queryClient = useQueryClient();
  const { repairFailedLoggedGame } = useUploadsProcessing();
  const isFailedLocalSync = game?.local_sync?.syncState === 'failed';

  const saveMutation = useMutation({
    mutationFn: async (players: Parameters<typeof updateGame>[0]['players']) => {
      if (!game || !players) {
        throw new Error('Game was not found.');
      }
      if (isFailedLocalSync) {
        return repairFailedLoggedGame({
          game,
          players,
        });
      }
      return updateGame({
        gameId: game.id,
        players,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.games }),
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
        game ? queryClient.invalidateQueries({ queryKey: queryKeys.game(game.id) }) : Promise.resolve(),
      ]);
      onClose();
    },
  });

  return (
    <ScoreboardGameEditSheet
      visible={visible}
      extraction={game?.scoreboard_extraction}
      selectedPlayerKeys={
        game
          ? game.selected_self_player_key
            ? [game.selected_self_player_key]
            : game.local_sync?.syncState === 'failed'
              ? []
              : [normalizePlayerKey(game.player_name)]
          : []
      }
      saving={saveMutation.isPending}
      errorText={
        saveMutation.isError
          ? saveMutation.error instanceof Error
            ? saveMutation.error.message
            : 'Failed to save game.'
          : ''
      }
      title={isFailedLocalSync ? 'Fix Game' : 'Edit Game'}
      subtitle={
        isFailedLocalSync
          ? 'Correct player names or frame marks for this scoreboard, then the session will retry syncing automatically.'
          : 'Adjust player names and frame marks for this scoreboard.'
      }
      saveLabel={isFailedLocalSync ? 'Save and retry' : 'Save game'}
      savingLabel={isFailedLocalSync ? 'Saving and retrying...' : 'Saving...'}
      disabled={!game}
      onClose={onClose}
      onSave={(players) => saveMutation.mutate(players)}
    />
  );
}
