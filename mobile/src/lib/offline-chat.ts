import AsyncStorage from '@react-native-async-storage/async-storage';

import { formatAverage, sortGamesByPlayedAtAsc } from '@/lib/bowling';
import type { GameListItem } from '@/lib/types';

const OFFLINE_CHAT_GAMES_STORAGE_KEY = 'pinpoint-offline-chat-games-v1';

export type OfflineChatResult = {
  answer: string;
  meta: string;
  note: string;
};

function isScoredGame(game: GameListItem): game is GameListItem & { total_score: number } {
  return typeof game.total_score === 'number';
}

function getSelectionFromQuestion(question: string, games: GameListItem[]) {
  const orderedGames = sortGamesByPlayedAtAsc(games);
  const lower = question.toLowerCase();

  const rangeMatch = lower.match(/\bgames?\s+(\d+)\s*(?:to|through|thru|-)\s*(\d+)\b/);
  if (rangeMatch) {
    const start = Number.parseInt(rangeMatch[1] || '', 10);
    const end = Number.parseInt(rangeMatch[2] || '', 10);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      const lowerBound = Math.max(1, Math.min(start, end));
      const upperBound = Math.max(start, end);
      return {
        games: orderedGames.filter((_, index) => {
          const gameNumber = index + 1;
          return gameNumber >= lowerBound && gameNumber <= upperBound;
        }),
        label: ` across games ${lowerBound} to ${upperBound}`,
      };
    }
  }

  const singleMatch = lower.match(/\bgame\s+(\d+)\b/);
  if (singleMatch) {
    const gameNumber = Number.parseInt(singleMatch[1] || '', 10);
    if (Number.isFinite(gameNumber) && gameNumber > 0) {
      return {
        games: orderedGames.filter((_, index) => index + 1 === gameNumber),
        label: ` in game ${gameNumber}`,
      };
    }
  }

  return {
    games: orderedGames,
    label: '',
  };
}

function buildHandledOfflineAnswer(question: string, games: GameListItem[]) {
  const lower = question.toLowerCase();
  const selection = getSelectionFromQuestion(question, games);
  const selectedGames = selection.games;
  const scoredGames = selectedGames.filter(isScoredGame);
  const includesAverage = lower.includes('average') || lower.includes('avg');
  const mentionsFrame = lower.includes('frame');
  const mentionsRate = lower.includes('rate') || lower.includes('percent');
  const mentionsStrikeOrSpare = lower.includes('strike') || lower.includes('spare');
  const mentionsPins = lower.includes('pins');

  if (/(how many|number of) games/.test(lower)) {
    return `You have **${selectedGames.length}** game${selectedGames.length === 1 ? '' : 's'} in this selection.`;
  }

  if (
    includesAverage &&
    !mentionsFrame &&
    !mentionsRate &&
    !mentionsStrikeOrSpare &&
    !mentionsPins
  ) {
    if (scoredGames.length === 0) {
      return selection.label
        ? `You have no scored games${selection.label}.`
        : 'You have no scored games yet.';
    }

    return `Your average score${selection.label} is **${formatAverage(scoredGames.map((game) => game.total_score))}**.`;
  }

  if (lower.includes('total score')) {
    const total = scoredGames.reduce((sum, game) => sum + game.total_score, 0);
    return `Your total score${selection.label} is **${total}**.`;
  }

  if (/(best|highest|max) score/.test(lower)) {
    if (scoredGames.length === 0) {
      return selection.label
        ? `You have no scored games${selection.label}.`
        : 'You have no scored games yet.';
    }

    const bestGame = scoredGames.reduce((best, current) =>
      current.total_score > best.total_score ? current : best,
    );
    return `Your highest score${selection.label} is **${bestGame.total_score}**.`;
  }

  if (/(worst|lowest|min) score/.test(lower)) {
    if (scoredGames.length === 0) {
      return selection.label
        ? `You have no scored games${selection.label}.`
        : 'You have no scored games yet.';
    }

    const worstGame = scoredGames.reduce((worst, current) =>
      current.total_score < worst.total_score ? current : worst,
    );
    return `Your lowest score${selection.label} is **${worstGame.total_score}**.`;
  }

  return null;
}

export async function cacheOfflineChatGames(games: GameListItem[]) {
  try {
    await AsyncStorage.setItem(OFFLINE_CHAT_GAMES_STORAGE_KEY, JSON.stringify(games));
  } catch {
    // Ignore cache write failures; chat should still work online.
  }
}

export async function loadOfflineChatGames() {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_CHAT_GAMES_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as GameListItem[]) : [];
  } catch {
    return [];
  }
}

export async function buildOfflineChatResult(
  question: string,
  inMemoryGames?: GameListItem[],
): Promise<OfflineChatResult> {
  const sourceGames =
    inMemoryGames && inMemoryGames.length > 0 ? inMemoryGames : await loadOfflineChatGames();

  if (sourceGames.length === 0) {
    return {
      answer:
        "You're offline and PinPoint doesn't have cached games on this device yet. Open your sessions while online once, then simple chat questions can work offline.",
      meta: 'Offline · No cached games',
      note:
        "This response was done on-device. Offline chat only works for simple questions using cached games that were already loaded on this device.",
    };
  }

  const handledAnswer = buildHandledOfflineAnswer(question, sourceGames);

  return {
    answer:
      handledAnswer ??
      "Offline mode on this device couldn't answer that question with cached games. Try a simpler stat question like average score, game count, total score, best score, or worst score.",
    meta: 'Offline · On-device cached games',
    note:
      "This response was done on-device from cached games, so it can't handle complex questions and may be out of date.",
  };
}
