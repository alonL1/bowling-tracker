import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ActionButton from '@/components/action-button';
import InfoBanner from '@/components/info-banner';
import PageBackButton from '@/components/page-back-button';
import { palette, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import { deleteOwnData } from '@/lib/backend';
import { clearOfflineChatGames } from '@/lib/offline-chat';
import { queryClient } from '@/lib/query-client';
import { PUBLIC_WEBSITE_URL } from '@/lib/urls';
import { useAuth } from '@/providers/auth-provider';
import { useRouter } from 'expo-router';

const WEBSITE_URL = PUBLIC_WEBSITE_URL;
const DELETE_DATA_URL = `${WEBSITE_URL}/delete-data`;
const CONTACT_EMAIL = 'alonlevy04@gmail.com';

function Paragraph({ children }: { children: React.ReactNode }) {
  return <Text style={styles.paragraph}>{children}</Text>;
}

function Bullet({ children }: { children: React.ReactNode }) {
  return <Text style={styles.bullet}>• {children}</Text>;
}

type SectionProps = {
  title: string;
  children: React.ReactNode;
};

function Section({ title, children }: SectionProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export default function DeleteDataScreen() {
  const router = useRouter();
  const { isGuest } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleDeleteData = async () => {
    if (busy) {
      return;
    }

    if (isGuest) {
      router.push('/login?next=/delete-data');
      return;
    }

    if (!confirming) {
      setConfirming(true);
      setError('');
      setSuccess('');
      return;
    }

    setBusy(true);
    setError('');
    setSuccess('');

    try {
      await deleteOwnData();
      await clearOfflineChatGames();
      queryClient.clear();
      setConfirming(false);
      setSuccess('All account-linked PinPoint data has been deleted. Your account remains active.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to delete account data.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <PageBackButton fallbackHref="/(tabs)/account" />
          <Text style={styles.title}>Delete Data</Text>
          <Text style={styles.subtitle}>PinPoint</Text>
          <Text style={styles.meta}>Last updated: March 24, 2026</Text>
        </View>

        <Section title="Delete your account data in the app">
          <Paragraph>
            You can remove all account-linked PinPoint data without deleting your login by using the
            button below. This replaces the old email-only request flow.
          </Paragraph>
          {isGuest ? (
            <ActionButton
              label="Sign in to delete account data"
              onPress={() => router.push('/login?next=/delete-data')}
            />
          ) : (
            <View style={styles.actionGroup}>
              <ActionButton
                label={
                  busy
                    ? 'Deleting data...'
                    : confirming
                      ? 'Permanently delete all account data'
                      : 'Delete all account data'
                }
                onPress={handleDeleteData}
                disabled={busy}
                variant="danger"
              />
              {confirming ? (
                <ActionButton
                  label="Cancel"
                  onPress={() => {
                    if (!busy) {
                      setConfirming(false);
                    }
                  }}
                  disabled={busy}
                  variant="secondary"
                />
              ) : null}
            </View>
          )}
          {confirming && !isGuest ? (
            <InfoBanner
              tone="error"
              text="This deletes your sessions, games, friends data, drafts, and uploads but keeps your account login."
            />
          ) : null}
          {success ? <InfoBanner text={success} /> : null}
          {error ? <InfoBanner tone="error" text={error} /> : null}
        </Section>

        <Section title="What data will be deleted">
          <Paragraph>
            When you confirm data deletion in the app, PinPoint deletes account-linked app data we
            control, which may include:
          </Paragraph>
          <Bullet>Bowling sessions, games, frame data, shot data, and related stats</Bullet>
          <Bullet>Live sessions, recording drafts, and associated processing jobs</Bullet>
          <Bullet>Chat usage-limit and abuse-prevention records linked to your account</Bullet>
          <Bullet>Friend relationships and invite-link records associated with your account</Bullet>
          <Bullet>Temporary uploaded scoreboard files associated with your account workflows</Bullet>
        </Section>

        <Section title="What stays">
          <Paragraph>
            This action keeps your PinPoint login account active. You can continue using the app and
            log new data after the deletion completes.
          </Paragraph>
        </Section>

        <Section title="What may be retained">
          <Paragraph>
            Some limited information may still be retained after deletion where necessary for
            legitimate business or legal reasons, such as:
          </Paragraph>
          <Bullet>Security, fraud-prevention, and abuse-prevention records</Bullet>
          <Bullet>Legal compliance records</Bullet>
          <Bullet>Residual copies in backups for a limited retention period</Bullet>
        </Section>

        <Section title="In-app controls">
          <Paragraph>
            PinPoint already lets users manually remove some content inside the app, such as
            individual sessions and games. This page covers full account-data deletion without
            deleting the login itself.
          </Paragraph>
        </Section>

        <Section title="Contact">
          <Text style={styles.contactLine}>Email: {CONTACT_EMAIL}</Text>
          <Text style={styles.contactLine}>Website: {WEBSITE_URL}</Text>
          <Text style={styles.contactLine}>Delete data URL: {DELETE_DATA_URL}</Text>
        </Section>
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
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },
  header: {
    gap: spacing.xs,
  },
  title: {
    color: palette.text,
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '500',
    fontFamily: fontFamilySans,
  },
  subtitle: {
    color: palette.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    fontFamily: fontFamilySans,
  },
  meta: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamilySans,
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    color: palette.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    fontFamily: fontFamilySans,
  },
  paragraph: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 23,
    fontFamily: fontFamilySans,
  },
  bullet: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 23,
    fontFamily: fontFamilySans,
  },
  actionGroup: {
    gap: spacing.sm,
  },
  contactLine: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 23,
    fontFamily: fontFamilySans,
  },
});
