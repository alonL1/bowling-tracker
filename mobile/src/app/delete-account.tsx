import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ActionButton from '@/components/action-button';
import InfoBanner from '@/components/info-banner';
import { palette, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import { deleteOwnAccount } from '@/lib/backend';
import { useAuth } from '@/providers/auth-provider';
import { useRouter } from 'expo-router';

const WEBSITE_URL = 'https://bowling-tracker-six.vercel.app';
const DELETE_ACCOUNT_URL = `${WEBSITE_URL}/delete-account`;
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

export default function DeleteAccountScreen() {
  const router = useRouter();
  const { isGuest, signOutToGuestSession } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    if (busy) {
      return;
    }

    if (isGuest) {
      router.push('/login?next=/delete-account');
      return;
    }

    if (!confirming) {
      setConfirming(true);
      setError('');
      return;
    }

    setBusy(true);
    setError('');

    try {
      await deleteOwnAccount();
      await signOutToGuestSession();
      router.replace('/login');
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : 'Failed to delete the account.',
      );
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
          <Text style={styles.title}>Delete Account</Text>
          <Text style={styles.subtitle}>PinPoint</Text>
          <Text style={styles.meta}>Last updated: March 24, 2026</Text>
        </View>

        <Section title="Delete your account in the app">
          <Paragraph>
            You can permanently delete your PinPoint account and account-linked data by using the
            button below. This replaces the old email-only request flow.
          </Paragraph>
          {isGuest ? (
            <ActionButton
              label="Sign in to delete an account"
              onPress={() => router.push('/login?next=/delete-account')}
            />
          ) : (
            <View style={styles.actionGroup}>
              <ActionButton
                label={confirming ? 'Permanently delete account' : 'Delete account'}
                onPress={handleDelete}
                disabled={busy}
                loading={busy}
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
              text="This permanently deletes your account, sessions, games, friends data, drafts, and uploads."
            />
          ) : null}
          {error ? <InfoBanner tone="error" text={error} /> : null}
        </Section>

        <Section title="What data will be deleted">
          <Paragraph>
            When you confirm account deletion in the app, PinPoint deletes account-linked data we
            control, which may include:
          </Paragraph>
          <Bullet>Account profile and authentication records</Bullet>
          <Bullet>Bowling sessions, games, frame data, shot data, and related stats</Bullet>
          <Bullet>Live sessions, recording drafts, and associated processing jobs</Bullet>
          <Bullet>Friend relationships and invite-link records associated with your account</Bullet>
          <Bullet>Temporary uploaded scoreboard files associated with your account workflows</Bullet>
        </Section>

        <Section title="What may be retained">
          <Paragraph>
            Some limited information may still be retained where necessary for legitimate business or
            legal reasons, such as:
          </Paragraph>
          <Bullet>Security, fraud-prevention, and abuse-prevention records</Bullet>
          <Bullet>Legal compliance records</Bullet>
          <Bullet>Residual copies in backups for a limited retention period</Bullet>
        </Section>

        <Section title="Delete data without deleting the account">
          <Paragraph>
            If you want to remove all account-linked PinPoint data but keep your login, use the
            in-app data-deletion controls at {DELETE_DATA_URL}.
          </Paragraph>
        </Section>

        <Section title="Contact">
          <Text style={styles.contactLine}>Email: {CONTACT_EMAIL}</Text>
          <Text style={styles.contactLine}>Website: {WEBSITE_URL}</Text>
          <Text style={styles.contactLine}>Delete account URL: {DELETE_ACCOUNT_URL}</Text>
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
