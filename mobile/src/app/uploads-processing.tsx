import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import ActionButton from '@/components/action-button';
import BowlingBallSpinner from '@/components/bowling-ball-spinner';
import InfoBanner from '@/components/info-banner';
import ScreenShell from '@/components/screen-shell';
import SurfaceCard from '@/components/surface-card';
import { confirmAction } from '@/lib/confirm';
import { palette, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import { useUploadsProcessing } from '@/providers/uploads-processing-provider';

function formatSourceLabel(sourceFlow: string) {
  switch (sourceFlow) {
    case 'live_session':
      return 'Live session';
    case 'upload_session':
      return 'Upload session';
    case 'add_multiple_sessions':
      return 'Add multiple sessions';
    case 'add_existing_session':
      return 'Add to existing session';
    default:
      return 'Uploads & Processing';
  }
}

function formatCaptureStatus(status: string) {
  switch (status) {
    case 'captured_local':
      return 'Saved locally';
    case 'upload_pending':
      return 'Uploading';
    case 'uploaded':
      return 'Upload complete';
    case 'server_row_pending':
      return 'Creating draft row';
    case 'processing_pending':
      return 'Processing scoreboard';
    case 'ready_pending_finalize':
      return 'Ready to finalize';
    case 'finalize_pending':
      return 'Finalizing session';
    case 'failed':
      return 'Needs attention';
    default:
      return status.replace(/_/g, ' ');
  }
}

function formatFinalizeStatus(status: string) {
  switch (status) {
    case 'pending':
      return 'Queued';
    case 'waiting_on_captures':
      return 'Waiting on uploads';
    case 'ready_to_finalize':
      return 'Ready to finalize';
    case 'finalize_pending':
      return 'Finalizing';
    case 'failed':
      return 'Needs attention';
    default:
      return status.replace(/_/g, ' ');
  }
}

export default function UploadsProcessingScreen() {
  const { deleteEntry, ready, retryEntry, store, summary } = useUploadsProcessing();

  const entries = useMemo(() => {
    const captureEntries = store.captureItems
      .filter((item) => item.status !== 'synced' && item.status !== 'discarded')
      .map((item) => ({
        id: item.id,
        kind: 'capture' as const,
        title: `${formatSourceLabel(item.sourceFlow)} scoreboard`,
        subtitle: item.localFileName,
        status: formatCaptureStatus(item.status),
        lastError: item.lastError ?? null,
        updatedAt: item.updatedAt,
        failed: item.status === 'failed',
      }));

    const finalizeEntries = store.finalizeOperations
      .filter((item) => item.status !== 'synced' && item.status !== 'discarded')
      .map((item) => ({
        id: item.id,
        kind: 'finalize' as const,
        title: `${formatSourceLabel(item.sourceFlow)} finalization`,
        subtitle:
          item.draftName?.trim() ||
          item.targetSessionName?.trim() ||
          'Background session reconciliation',
        status: formatFinalizeStatus(item.status),
        lastError: item.lastError ?? null,
        updatedAt: item.updatedAt,
        failed: item.status === 'failed',
      }));

    return [...finalizeEntries, ...captureEntries].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }, [store.captureItems, store.finalizeOperations]);

  return (
    <ScreenShell
      title="Uploads & Processing"
      subtitle="Pending scoreboard uploads, retries, and local-first session finalization live here.">
      {!ready ? (
        <SurfaceCard style={styles.loadingCard}>
          <BowlingBallSpinner size={30} holeColor={palette.surfaceRaised} />
          <Text style={styles.loadingText}>Loading local sync queue…</Text>
        </SurfaceCard>
      ) : null}

      {ready ? (
        <SurfaceCard style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Overview</Text>
          <Text style={styles.summaryBody}>
            {summary.pendingCount} pending, {summary.failedCount} failed, {summary.captureCount} captures, {summary.finalizeCount} finalize operations.
          </Text>
        </SurfaceCard>
      ) : null}

      {ready && entries.length === 0 ? (
        <SurfaceCard style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Nothing is waiting</Text>
          <Text style={styles.emptyBody}>
            New offline captures and background finalization work will appear here automatically.
          </Text>
        </SurfaceCard>
      ) : null}

      {ready
        ? entries.map((entry) => (
            <SurfaceCard key={entry.id} style={styles.entryCard} tone="raised">
              <View style={styles.entryHeader}>
                <View style={styles.entryText}>
                  <Text style={styles.entryTitle}>{entry.title}</Text>
                  <Text style={styles.entrySubtitle}>{entry.subtitle}</Text>
                </View>
                <Text style={[styles.statusChip, entry.failed && styles.statusChipFailed]}>
                  {entry.status}
                </Text>
              </View>

              {entry.lastError ? <InfoBanner tone="error" text={entry.lastError} /> : null}

              <View style={styles.entryActions}>
                {entry.failed ? (
                  <ActionButton
                    label="Retry"
                    onPress={() => retryEntry(entry.id)}
                    variant="secondary"
                    style={styles.actionButton}
                  />
                ) : null}
                <ActionButton
                  label="Delete"
                  onPress={() =>
                    confirmAction({
                      title: 'Delete queued item',
                      message:
                        entry.kind === 'finalize'
                          ? 'Delete this background finalization and its linked local captures?'
                          : 'Delete this local capture and remove it from the sync queue?',
                      confirmLabel: 'Delete',
                      destructive: true,
                      onConfirm: () => {
                        void deleteEntry(entry.id);
                      },
                    })
                  }
                  variant="secondary"
                  style={styles.actionButton}
                />
              </View>
            </SurfaceCard>
          ))
        : null}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  loadingCard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  loadingText: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
  summaryCard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.xs,
  },
  summaryTitle: {
    color: palette.text,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  summaryBody: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
  emptyCard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    gap: spacing.xs,
  },
  emptyTitle: {
    color: palette.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  emptyBody: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
  entryCard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  entryHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  entryText: {
    flex: 1,
    gap: 4,
  },
  entryTitle: {
    color: palette.text,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  entrySubtitle: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 19,
    fontFamily: fontFamilySans,
  },
  statusChip: {
    color: palette.text,
    backgroundColor: palette.field,
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  statusChipFailed: {
    backgroundColor: palette.danger,
    color: palette.error,
  },
  entryActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
});
