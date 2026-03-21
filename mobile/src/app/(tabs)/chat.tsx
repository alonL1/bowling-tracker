import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ActionButton from '@/components/action-button';
import BowlingBallSpinner from '@/components/bowling-ball-spinner';
import IconAction from '@/components/icon-action';
import SurfaceCard from '@/components/surface-card';
import { queryKeys, sendChat } from '@/lib/backend';
import { buildOfflineChatResult } from '@/lib/offline-chat';
import { palette, radii, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import type { GameListItem } from '@/lib/types';

type Message = {
  role: 'user' | 'assistant';
  content: string;
  variant?: 'error' | 'offline';
  note?: string;
  meta?: string;
};

const DEFAULT_ASSISTANT_MESSAGE =
  'Ask about your bowling stats, patterns, sessions, and trends.\n' +
  'Chats can be about anything, get creative or checkout our examples.';

const EXAMPLES = [
  'What is my average score across games 1 to 3?',
  'How often do I strike on frame 9?',
  'List games with my highest score between Jan 7th and March 3rd?',
  'What is my average on games played after 7pm?',
  'How often do I strike or spare?',
  'List all of the games where I scored above 130?',
  'What percent of the time do I bowl a 7 in a frame?',
  'Of the times that I bowl a 7 how often do I convert the spare?',
  'How much better have I gotten since day 1?',
  'On average, what are my top 3 best frames?',
  'On which frames do I strike most often?',
  'How often do I wombat?',
  'Whats my average since the new pope was elected?',
  'Am I better after 5pm or before?',
  'Give me coaching tips based on my last 5 games.',
  'What should I focus on to improve my spare conversion?',
];

const PIN_IMAGES = {
  happy: require('../../../assets/pins/happy_pin.png'),
  thinking: require('../../../assets/pins/thinking_pin.png'),
  idea: require('../../../assets/pins/idea_pin.png'),
} as const;

const MIN_INPUT_HEIGHT = 48;
const MAX_INPUT_HEIGHT = 132;
const HEADER_SPINNER_SIZE = 34;
const INPUT_VERTICAL_PADDING = 24;
const MIN_TEXTAREA_HEIGHT = MIN_INPUT_HEIGHT - INPUT_VERTICAL_PADDING;

function renderInlineMessageContent(content: string) {
  const parts = content.split(/(\*\*.*?\*\*)/g);

  return parts.map((part, index) => {
    const match = part.match(/^\*\*(.*)\*\*$/s);
    if (!match) {
      return part;
    }

    return (
      <Text key={`bold-${index}`} style={styles.messageTextBold}>
        {match[1]}
      </Text>
    );
  });
}

function renderMessageContent(content: string, isUser: boolean) {
  return content.split('\n').map((line, index) => {
    const bulletMatch = line.match(/^\s*\*\s+(.*)$/);
    const lineStyle = [styles.messageText, isUser && styles.messageTextUser];

    if (bulletMatch) {
      return (
        <Text key={`line-${index}`} style={lineStyle}>
          <Text style={styles.messageBullet}>{'\u2022 '}</Text>
          {renderInlineMessageContent(bulletMatch[1])}
        </Text>
      );
    }

    return (
      <Text key={`line-${index}`} style={lineStyle}>
        {renderInlineMessageContent(line)}
      </Text>
    );
  });
}

export default function ChatScreen() {
  const tabBarHeight = useBottomTabBarHeight();
  const queryClient = useQueryClient();
  const scrollRef = useRef<ScrollView | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  const questionRef = useRef('');
  const [question, setQuestion] = useState('');
  const [inputShellHeight, setInputShellHeight] = useState(MIN_INPUT_HEIGHT);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: DEFAULT_ASSISTANT_MESSAGE,
    },
  ]);
  const [chatStatus, setChatStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [showExamples, setShowExamples] = useState(false);
  const [hasCompletedResponse, setHasCompletedResponse] = useState(false);
  const inputCanScroll = inputShellHeight >= MAX_INPUT_HEIGHT;

  useEffect(() => {
    const timeout = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 40);
    return () => clearTimeout(timeout);
  }, [messages, showExamples]);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const showSubscription = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const resetComposer = () => {
    setInputShellHeight(MIN_INPUT_HEIGHT);
  };

  const handleQuestionChange = (value: string) => {
    if (Platform.OS === 'ios' && value.endsWith('\n')) {
      const trimmedNewlineValue = value.replace(/\n+$/, '');
      questionRef.current = trimmedNewlineValue;
      setQuestion(trimmedNewlineValue);

      if (trimmedNewlineValue.length === 0) {
        resetComposer();
        return;
      }

      requestAnimationFrame(() => {
        void handleAsk();
      });
      return;
    }

    questionRef.current = value;
    setQuestion(value);

    if (value.length === 0) {
      resetComposer();
    }
  };

  const handleAsk = async () => {
    const nextQuestion = questionRef.current.trim();
    if (!nextQuestion || chatStatus === 'loading') {
      return;
    }

    const userQuestion = nextQuestion;
    questionRef.current = '';
    setQuestion('');
    inputRef.current?.clear();
    resetComposer();
    setMessages((prev) => [...prev, { role: 'user', content: userQuestion }]);
    setChatStatus('loading');

    try {
      const payload = await sendChat(userQuestion);
      if (payload.onlineError && payload.offlineAnswer) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: payload.onlineError || 'Chat request failed.', variant: 'error' },
          {
            role: 'assistant',
            content: payload.offlineAnswer || 'Offline answer unavailable.',
            variant: 'offline',
            meta: payload.offlineMeta,
            note:
              payload.offlineNote ||
              "This response was done offline so it can't handle complex questions and may be wrong.",
          },
        ]);
      } else if (payload.answer) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: payload.answer || 'No response returned.', meta: payload.meta },
        ]);
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', content: 'No response returned.' }]);
      }
      setChatStatus('idle');
      setHasCompletedResponse(true);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Chat request failed.';
      const isNetworkError =
        /network request failed/i.test(errorMessage) || /failed to fetch/i.test(errorMessage);

      if (isNetworkError) {
        const gamesPayload = queryClient.getQueryData<{ games: GameListItem[]; count: number | null }>(
          queryKeys.games,
        );
        const offlineResult = await buildOfflineChatResult(userQuestion, gamesPayload?.games);
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: offlineResult.answer,
            variant: 'offline',
            meta: offlineResult.meta,
            note: offlineResult.note,
          },
        ]);
        setChatStatus('idle');
        setHasCompletedResponse(true);
        return;
      }

      setChatStatus('error');
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: errorMessage,
          variant: 'error',
        },
      ]);
      setHasCompletedResponse(true);
    }
  };

  const pinSource = useMemo(() => {
    if (chatStatus === 'loading') {
      return PIN_IMAGES.thinking;
    }
    if (hasCompletedResponse) {
      return PIN_IMAGES.idea;
    }
    return PIN_IMAGES.happy;
  }, [chatStatus, hasCompletedResponse]);

  const androidComposerLift =
    Platform.OS === 'android' ? Math.max(0, keyboardHeight - tabBarHeight) : 0;
  const keyboardOpen = Platform.OS === 'android' && keyboardHeight > 0;
  const handleInputKeyPress = (event: {
    nativeEvent: { key?: string };
    preventDefault?: () => void;
  }) => {
    if (Platform.OS !== 'web') {
      return;
    }

    if (event.nativeEvent.key !== 'Enter') {
      return;
    }

    if (Platform.OS === 'web') {
      event.preventDefault?.();
    }

    void handleAsk();
  };

  const handleSubmitEditing = () => {
    void handleAsk();
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flexFill}>
        <View style={styles.page}>
          <View style={styles.header}>
            <View style={styles.pinRow}>
              <View style={styles.pinSlot}>
                <Image source={pinSource} style={styles.pinImage} resizeMode="contain" />
              </View>
              <View style={styles.spinnerSlot}>
                {chatStatus === 'loading' ? (
                  <BowlingBallSpinner size={HEADER_SPINNER_SIZE} holeColor={palette.surface} />
                ) : null}
              </View>
            </View>
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.viewport}
            contentContainerStyle={styles.messagesContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {messages.map((message, index) => (
              <View
                key={`${message.role}-${index}`}
                style={[
                  styles.messageWrap,
                  message.role === 'user' ? styles.messageWrapUser : styles.messageWrapAssistant,
                ]}>
                <View
                  style={[
                    styles.messageBubble,
                    message.role === 'user' ? styles.messageBubbleUser : styles.messageBubbleAssistant,
                    message.variant === 'error' && styles.messageBubbleError,
                  ]}>
                  {message.meta ? <Text style={styles.messageMeta}>{message.meta}</Text> : null}
                  <View style={styles.messageTextGroup}>
                    {renderMessageContent(message.content, message.role === 'user')}
                  </View>
                  {message.note ? <Text style={styles.messageNote}>{message.note}</Text> : null}
                </View>
              </View>
            ))}
          </ScrollView>

          <View
            style={[
              styles.composerDock,
              keyboardOpen && styles.composerDockKeyboardOpen,
              androidComposerLift > 0 && { marginBottom: androidComposerLift },
            ]}>
            <View style={styles.composerRow}>
              <View style={styles.inputWrap}>
                {Platform.OS === 'ios' ? (
                  <View pointerEvents="none" style={styles.inputMeasureWrap}>
                    <View
                      style={styles.inputMeasureShell}
                      onLayout={(event) => {
                        if (question.length === 0) {
                          return;
                        }

                        const measuredShellHeight = Math.max(
                          MIN_INPUT_HEIGHT,
                          Math.min(Math.ceil(event.nativeEvent.layout.height), MAX_INPUT_HEIGHT),
                        );
                        setInputShellHeight((current) =>
                          current === measuredShellHeight ? current : measuredShellHeight,
                        );
                      }}>
                      <Text style={styles.inputMeasureText}>{question || ' '}</Text>
                    </View>
                  </View>
                ) : null}
                <View
                  style={[
                    styles.inputShell,
                    { height: inputShellHeight },
                    !inputCanScroll && styles.inputShellClamped,
                  ]}>
                  <TextInput
                    ref={inputRef}
                    multiline
                    scrollEnabled={inputCanScroll}
                    placeholder="Type here"
                    placeholderTextColor={palette.muted}
                    style={styles.input}
                    value={question}
                    onChangeText={handleQuestionChange}
                    returnKeyType="send"
                    submitBehavior={Platform.OS === 'ios' ? undefined : 'submit'}
                    onSubmitEditing={Platform.OS === 'ios' ? undefined : handleSubmitEditing}
                    onKeyPress={handleInputKeyPress}
                    onContentSizeChange={(event) => {
                      if (Platform.OS === 'ios') {
                        return;
                      }

                      if (questionRef.current.length === 0) {
                        resetComposer();
                        return;
                      }

                      const measuredContentHeight = Math.ceil(event.nativeEvent.contentSize.height);
                      const measuredShellHeight = Math.max(
                        MIN_INPUT_HEIGHT,
                        Math.min(measuredContentHeight + INPUT_VERTICAL_PADDING, MAX_INPUT_HEIGHT),
                      );

                      setInputShellHeight((current) =>
                        current === measuredShellHeight ? current : measuredShellHeight,
                      );
                    }}
                  />
                </View>
              </View>
              <Pressable
                onPress={handleAsk}
                disabled={chatStatus === 'loading' || !question.trim()}
                style={({ pressed }) => [
                  styles.sendButton,
                  (chatStatus === 'loading' || !question.trim()) && styles.sendButtonDisabled,
                  pressed && styles.pressed,
                ]}>
                <Ionicons name="arrow-up" size={22} color={palette.text} />
              </Pressable>
            </View>
            {!keyboardOpen ? (
              <ActionButton label="View Examples" onPress={() => setShowExamples(true)} variant="secondary" />
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>

      <Modal transparent animationType="slide" visible={showExamples}>
        <View style={styles.examplesBackdrop}>
          <SurfaceCard style={styles.examplesSheet} tone="raised">
            <View style={styles.examplesHeader}>
              <Text style={styles.examplesTitle}>Examples</Text>
              <IconAction
                accessibilityLabel="Close examples"
                onPress={() => setShowExamples(false)}
                icon={<Ionicons name="close" size={20} color={palette.muted} />}
              />
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.examplesList}>
              {EXAMPLES.map((example) => (
                <Pressable
                  key={example}
                  onPress={() => {
                    questionRef.current = example;
                    resetComposer();
                    setQuestion(example);
                    setShowExamples(false);
                  }}
                  style={({ pressed }) => [styles.exampleItem, pressed && styles.pressed]}>
                  <Text style={styles.exampleText}>{example}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <ActionButton label="Close" onPress={() => setShowExamples(false)} variant="secondary" />
          </SurfaceCard>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  flexFill: {
    flex: 1,
  },
  page: {
    flex: 1,
    backgroundColor: palette.background,
  },
  header: {
    backgroundColor: palette.surface,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  pinRow: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 92,
  },
  pinSlot: {
    width: 74,
    height: 92,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinnerSlot: {
    position: 'absolute',
    right: '50%',
    marginRight: -66,
    top: '50%',
    marginTop: -(HEADER_SPINNER_SIZE / 2),
    width: HEADER_SPINNER_SIZE,
    height: HEADER_SPINNER_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinImage: {
    width: 74,
    height: 92,
  },
  viewport: {
    flex: 1,
  },
  messagesContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  messageWrap: {
    flexDirection: 'row',
  },
  messageWrapAssistant: {
    justifyContent: 'flex-start',
  },
  messageWrapUser: {
    justifyContent: 'flex-end',
  },
  messageBubble: {
    maxWidth: '88%',
    borderRadius: 22,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    gap: 6,
  },
  messageBubbleAssistant: {
    backgroundColor: palette.accent,
    borderTopLeftRadius: 8,
  },
  messageBubbleUser: {
    backgroundColor: palette.userChat,
    borderTopRightRadius: 8,
  },
  messageBubbleError: {
    backgroundColor: '#5f2430',
  },
  messageMeta: {
    color: palette.muted,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamilySans,
  },
  messageText: {
    color: palette.text,
    fontSize: 16,
    lineHeight: 22,
    fontFamily: fontFamilySans,
  },
  messageTextGroup: {
    gap: 2,
  },
  messageTextBold: {
    fontWeight: '700',
  },
  messageTextUser: {
    color: palette.background,
  },
  messageBullet: {
    fontWeight: '700',
  },
  messageNote: {
    color: palette.muted,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamilySans,
  },
  composerDock: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
    backgroundColor: palette.nav,
  },
  composerDockKeyboardOpen: {
    paddingBottom: spacing.sm,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    minWidth: 0,
  },
  inputWrap: {
    flex: 1,
    minWidth: 0,
  },
  inputMeasureWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    opacity: 0,
  },
  inputMeasureShell: {
    minHeight: MIN_INPUT_HEIGHT,
    maxHeight: MAX_INPUT_HEIGHT,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  inputMeasureText: {
    minHeight: MIN_TEXTAREA_HEIGHT,
    color: 'transparent',
    fontSize: 16,
    fontFamily: fontFamilySans,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  inputShell: {
    minHeight: MIN_INPUT_HEIGHT,
    maxHeight: MAX_INPUT_HEIGHT,
    backgroundColor: palette.field,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  inputShellClamped: {
    overflow: 'hidden',
  },
  input: {
    flex: 1,
    width: '100%',
    minWidth: 0,
    minHeight: MIN_TEXTAREA_HEIGHT,
    color: palette.text,
    fontSize: 16,
    fontFamily: fontFamilySans,
    textAlignVertical: 'top',
    paddingHorizontal: 0,
    paddingVertical: 0,
    ...(Platform.OS === 'web'
      ? {
          outlineColor: 'transparent',
          outlineStyle: 'solid',
          outlineWidth: 0,
          boxShadow: 'none',
        }
      : null),
    ...(Platform.OS === 'ios'
      ? null
      : {
          lineHeight: 20,
        }),
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.45,
  },
  examplesBackdrop: {
    flex: 1,
    backgroundColor: palette.overlay,
    justifyContent: 'flex-end',
  },
  examplesSheet: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
    maxHeight: '70%',
  },
  examplesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  examplesTitle: {
    color: palette.text,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '600',
    fontFamily: fontFamilySans,
    flex: 1,
  },
  examplesList: {
    gap: spacing.sm,
  },
  exampleItem: {
    backgroundColor: palette.field,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  exampleText: {
    color: palette.text,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
  pressed: {
    opacity: 0.9,
  },
});
