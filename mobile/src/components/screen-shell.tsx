import React, { type ReactNode, type ReactElement } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type RefreshControlProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';

type ScreenShellProps = {
  title: string;
  subtitle?: string;
  children?: ReactNode;
  refreshControl?: ReactElement<RefreshControlProps>;
  headerRight?: ReactNode;
  bodyStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
};

export default function ScreenShell({
  title,
  subtitle,
  children,
  refreshControl,
  headerRight,
  bodyStyle,
  contentStyle,
}: ScreenShellProps) {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, contentStyle]}
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}>
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={styles.headerText}>
              <Text style={styles.title}>{title}</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            {headerRight ? <View style={styles.headerRight}>{headerRight}</View> : null}
          </View>
        </View>
        <View style={[styles.body, bodyStyle]}>{children}</View>
      </ScrollView>
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
    paddingBottom: 148,
    gap: 22,
  },
  header: {
    gap: spacing.md,
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
    fontSize: 44,
    lineHeight: 52,
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
});
