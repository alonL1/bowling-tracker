import React, { type ReactNode, type ReactElement } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type RefreshControlProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useRouter, type Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import KeyboardAwareScrollView from '@/components/keyboard-aware-scroll-view';
import { palette, spacing } from '@/constants/palette';
import { navigateBackOrFallback } from '@/lib/navigation';
import { fontFamilySans } from '@/constants/typography';

type ScreenShellProps = {
  title: string;
  subtitle?: string;
  children?: ReactNode;
  refreshControl?: ReactElement<RefreshControlProps>;
  headerRight?: ReactNode;
  showBackButton?: boolean;
  backHref?: Href;
  bodyStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  overlay?: ReactNode;
};

export default function ScreenShell({
  title,
  subtitle,
  children,
  refreshControl,
  headerRight,
  showBackButton = false,
  backHref = '/(tabs)/sessions',
  bodyStyle,
  contentStyle,
  overlay,
}: ScreenShellProps) {
  const router = useRouter();
  const navigation = useNavigation();

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, contentStyle]}
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}>
        <View style={styles.header}>
          {showBackButton ? (
            <Pressable
              onPress={() => navigateBackOrFallback(router, backHref, navigation)}
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
              <Ionicons name="chevron-back" size={16} color={palette.muted} />
              <Text style={styles.backText}>Back</Text>
            </Pressable>
          ) : null}
          <View style={styles.headerTop}>
            <View style={styles.headerText}>
              <Text style={styles.title}>{title}</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            {headerRight ? <View style={styles.headerRight}>{headerRight}</View> : null}
          </View>
        </View>
        <View style={[styles.body, bodyStyle]}>{children}</View>
      </KeyboardAwareScrollView>
      {overlay ? (
        <View pointerEvents="box-none" style={styles.overlay}>
          {overlay}
        </View>
      ) : null}
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
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: 28,
    paddingBottom: 74,
    gap: 22,
  },
  header: {
    gap: spacing.md,
  },
  backButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.xs,
  },
  backText: {
    color: palette.muted,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '500',
    fontFamily: fontFamilySans,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: spacing.sm,
    minWidth: 0,
  },
  headerRight: {
    flexShrink: 0,
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
    fontSize: 16,
    lineHeight: 22,
    maxWidth: 560,
    fontFamily: fontFamilySans,
  },
  body: {
    gap: spacing.lg,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  pressed: {
    opacity: 0.85,
  },
});
