import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import StackBadge from '@/components/stack-badge';
import SurfaceCard from '@/components/surface-card';
import { palette, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import type { SessionGroup } from '@/lib/bowling';

export type SessionMetaSegment = {
  label: string;
  emphasized?: boolean;
};

type SessionCardProps = {
  session: SessionGroup;
  metaSegments: SessionMetaSegment[];
  onPress?: () => void;
};

export default function SessionCard({ session, metaSegments, onPress }: SessionCardProps) {
  const syncBadgeLabel = session.session?.local_sync
    ? session.session.local_sync.syncState === 'failed'
      ? 'Needs attention'
      : 'Syncing'
    : null;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}>
      <SurfaceCard style={styles.card}>
        <StackBadge lines={[session.dateMonth, session.dateDay]} />
        <View style={styles.textBlock}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{session.title}</Text>
            {syncBadgeLabel ? (
              <Text
                style={[
                  styles.syncBadge,
                  session.session?.local_sync?.syncState === 'failed' && styles.syncBadgeFailed,
                ]}>
                {syncBadgeLabel}
              </Text>
            ) : null}
          </View>
          <Text style={styles.meta}>
            {metaSegments.map((segment, index) => (
              <React.Fragment key={`${segment.label}-${index}`}>
                {index > 0 ? <Text style={styles.metaSeparator}> | </Text> : null}
                <Text style={segment.emphasized ? styles.metaEmphasized : null}>{segment.label}</Text>
              </React.Fragment>
            ))}
          </Text>
        </View>
      </SurfaceCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minWidth: 0,
  },
  card: {
    minHeight: 74,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  pressed: {
    opacity: 0.94,
  },
  textBlock: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    flex: 1,
    color: palette.text,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '400',
    fontFamily: fontFamilySans,
  },
  meta: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamilySans,
  },
  metaEmphasized: {
    color: palette.text,
    fontWeight: '700',
  },
  metaSeparator: {
    color: palette.muted,
    fontWeight: '400',
  },
  syncBadge: {
    color: palette.text,
    backgroundColor: palette.field,
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    fontFamily: fontFamilySans,
  },
  syncBadgeFailed: {
    backgroundColor: palette.danger,
    color: palette.error,
  },
});
