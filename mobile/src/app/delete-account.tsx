import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';

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
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Delete Account</Text>
          <Text style={styles.subtitle}>PinPoint</Text>
          <Text style={styles.meta}>Last updated: March 17, 2026</Text>
        </View>

        <Paragraph>
          If you want to request deletion of your PinPoint account and associated account data,
          email us at <Text style={styles.highlight}>{CONTACT_EMAIL}</Text> from the email address
          associated with your PinPoint account.
        </Paragraph>

        <Section title="How to request deletion">
          <Bullet>Send an email to {CONTACT_EMAIL}</Bullet>
          <Bullet>Use the subject line: PinPoint Account Deletion Request</Bullet>
          <Bullet>Send the request from the same email address used for your PinPoint account whenever possible</Bullet>
          <Bullet>If you cannot email us from that address, include enough information for us to verify ownership before deletion</Bullet>
        </Section>

        <Section title="What data will be deleted">
          <Paragraph>When we process a verified deletion request, we will delete the account data associated with your PinPoint account, which may include:</Paragraph>
          <Bullet>Account profile and authentication-related records we control</Bullet>
          <Bullet>Bowling sessions, games, frame data, shot data, and related stats</Bullet>
          <Bullet>Live session drafts and live-session game data</Bullet>
          <Bullet>Friend relationships and invite-link records associated with your account</Bullet>
          <Bullet>Processing-job records and account-linked usage records, where deletion is operationally feasible</Bullet>
        </Section>

        <Section title="What may be retained">
          <Paragraph>Some limited information may be retained after account deletion where necessary for legitimate business or legal reasons, such as:</Paragraph>
          <Bullet>Security, fraud-prevention, and abuse-prevention records</Bullet>
          <Bullet>Legal compliance records</Bullet>
          <Bullet>Residual copies in backups for a limited retention period</Bullet>
        </Section>

        <Section title="Temporary uploads">
          <Paragraph>
            Scoreboard images uploaded for processing are generally stored temporarily and removed
            after processing or when no longer needed for that purpose. They are not intended to be
            retained as long-term account content.
          </Paragraph>
        </Section>

        <Section title="Delete some data without deleting the account">
          <Paragraph>
            If you want to request deletion of some data without deleting your full account, use the
            partial-data deletion instructions at {DELETE_DATA_URL}.
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
  highlight: {
    color: palette.text,
    fontWeight: '700',
    fontFamily: fontFamilySans,
  },
  contactLine: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 23,
    fontFamily: fontFamilySans,
  },
});
