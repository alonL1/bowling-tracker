import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';

const WEBSITE_URL = 'https://bowling-tracker-six.vercel.app';
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
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Delete Data</Text>
          <Text style={styles.subtitle}>PinPoint</Text>
          <Text style={styles.meta}>Last updated: March 17, 2026</Text>
        </View>

        <Paragraph>
          If you want to request deletion of some or all of your PinPoint data without deleting your
          full account, email us at <Text style={styles.highlight}>{CONTACT_EMAIL}</Text>.
        </Paragraph>

        <Section title="How to request partial data deletion">
          <Bullet>Send an email to {CONTACT_EMAIL}</Bullet>
          <Bullet>Use the subject line: PinPoint Data Deletion Request</Bullet>
          <Bullet>Send the request from the email address associated with your PinPoint account whenever possible</Bullet>
          <Bullet>Clearly describe the data you want deleted</Bullet>
        </Section>

        <Section title="Examples of data you can request to delete">
          <Bullet>Specific bowling sessions or games</Bullet>
          <Bullet>Live session drafts</Bullet>
          <Bullet>Friend connections or invite-link records</Bullet>
          <Bullet>Chat-related data associated with your account, where deletion is operationally feasible</Bullet>
        </Section>

        <Section title="What to include in your request">
          <Bullet>Your account email address</Bullet>
          <Bullet>A clear description of the data you want removed</Bullet>
          <Bullet>Any useful identifiers, such as session names, dates, or other details that help us locate the data</Bullet>
        </Section>

        <Section title="What may be retained">
          <Paragraph>Some limited information may still be retained after a verified deletion request where necessary for legitimate business or legal reasons, such as:</Paragraph>
          <Bullet>Security, fraud-prevention, and abuse-prevention records</Bullet>
          <Bullet>Legal compliance records</Bullet>
          <Bullet>Residual copies in backups for a limited retention period</Bullet>
        </Section>

        <Section title="In-app controls">
          <Paragraph>
            PinPoint already lets users manually remove some content inside the app, such as sessions
            and games. This page exists for additional deletion requests that are not handled
            entirely by those in-app controls.
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
