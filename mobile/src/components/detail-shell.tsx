import { useRouter } from 'expo-router';
import React, { type ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import KeyboardAwareScrollView from '@/components/keyboard-aware-scroll-view';
import { palette, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';

type DetailShellProps = {
  title: string;
  subtitle?: string;
  children?: ReactNode;
  trailing?: ReactNode;
  scroll?: boolean;
  bodyStyle?: StyleProp<ViewStyle>;
};

export default function DetailShell({
  title,
  subtitle,
  children,
  trailing,
  scroll = true,
  bodyStyle,
}: DetailShellProps) {
  const router = useRouter();
  const content = (
    <View style={styles.content}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
            <Ionicons name="chevron-back" size={16} color={palette.muted} />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
        </View>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      <View style={[styles.body, bodyStyle]}>{children}</View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {scroll ? (
        <KeyboardAwareScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          {content}
        </KeyboardAwareScrollView>
      ) : (
        <View style={styles.flexFill}>{content}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  scroll: {
    flex: 1,
    backgroundColor: palette.background,
  },
  scrollContent: {
    paddingBottom: 148,
  },
  flexFill: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: 22,
    gap: 22,
  },
  header: {
    gap: spacing.sm,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backText: {
    color: palette.muted,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '500',
    fontFamily: fontFamilySans,
  },
  trailing: {
    flexShrink: 1,
    alignItems: 'flex-end',
  },
  title: {
    color: palette.text,
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '500',
    fontFamily: fontFamilySans,
  },
  subtitle: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
  body: {
    gap: spacing.lg,
  },
  pressed: {
    opacity: 0.85,
  },
});
