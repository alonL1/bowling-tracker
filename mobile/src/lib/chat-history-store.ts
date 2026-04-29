import AsyncStorage from '@react-native-async-storage/async-storage';

export type PersistedChatMessage = {
  id: string;
  createdAt: string;
  role: 'user' | 'assistant';
  content: string;
  variant?: 'error' | 'offline';
  note?: string;
  meta?: string;
};

type ChatHistoryPayload = {
  version: 1;
  updatedAt: string;
  messages: PersistedChatMessage[];
};

const CHAT_HISTORY_STORAGE_PREFIX = 'pinpoint-chat-history-v1:user:';
const CHAT_HISTORY_VERSION = 1;
export const CHAT_HISTORY_MESSAGE_LIMIT = 100;

function getChatHistoryStorageKey(userId: string) {
  return `${CHAT_HISTORY_STORAGE_PREFIX}${userId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function createFallbackMessageId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeChatMessage(value: unknown): PersistedChatMessage | null {
  if (!isRecord(value)) {
    return null;
  }

  const role = value.role;
  const content = value.content;

  if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') {
    return null;
  }

  const variant = value.variant === 'error' || value.variant === 'offline' ? value.variant : undefined;
  const id = normalizeOptionalString(value.id) ?? createFallbackMessageId();
  const createdAt = normalizeOptionalString(value.createdAt) ?? new Date().toISOString();
  const note = normalizeOptionalString(value.note);
  const meta = normalizeOptionalString(value.meta);

  return {
    id,
    createdAt,
    role,
    content,
    ...(variant ? { variant } : {}),
    ...(note ? { note } : {}),
    ...(meta ? { meta } : {}),
  };
}

function normalizeMessages(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeChatMessage)
    .filter((message): message is PersistedChatMessage => Boolean(message))
    .slice(-CHAT_HISTORY_MESSAGE_LIMIT);
}

export async function loadChatHistory(userId: string | null | undefined) {
  if (!userId) {
    return [];
  }

  try {
    const raw = await AsyncStorage.getItem(getChatHistoryStorageKey(userId));
    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== CHAT_HISTORY_VERSION) {
      return [];
    }

    return normalizeMessages(parsed.messages);
  } catch (error) {
    console.error('Failed to load chat history.', error);
    return [];
  }
}

export async function saveChatHistory(
  userId: string | null | undefined,
  messages: readonly PersistedChatMessage[],
) {
  if (!userId) {
    return;
  }

  const payload: ChatHistoryPayload = {
    version: CHAT_HISTORY_VERSION,
    updatedAt: new Date().toISOString(),
    messages: normalizeMessages(messages),
  };

  try {
    await AsyncStorage.setItem(getChatHistoryStorageKey(userId), JSON.stringify(payload));
  } catch (error) {
    console.error('Failed to save chat history.', error);
  }
}

export async function clearChatHistory(userId: string | null | undefined) {
  if (!userId) {
    return;
  }

  try {
    await AsyncStorage.removeItem(getChatHistoryStorageKey(userId));
  } catch (error) {
    console.error('Failed to clear chat history.', error);
  }
}
