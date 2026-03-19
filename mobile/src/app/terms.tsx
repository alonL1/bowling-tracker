import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';

const WEBSITE_URL = 'https://bowling-tracker-six.vercel.app';
const TERMS_URL = `${WEBSITE_URL}/terms`;
const CONTACT_EMAIL = 'alonlevy04@gmail.com';

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

function Paragraph({ children }: { children: React.ReactNode }) {
  return <Text style={styles.paragraph}>{children}</Text>;
}

function Bullet({ children }: { children: React.ReactNode }) {
  return <Text style={styles.bullet}>• {children}</Text>;
}

export default function TermsScreen() {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Terms of Service</Text>
          <Text style={styles.subtitle}>PinPoint</Text>
          <Text style={styles.meta}>Effective date: March 17, 2026</Text>
        </View>

        <Paragraph>
          These Terms of Service govern your use of PinPoint. By creating an account, using the app,
          or continuing to use PinPoint as a guest, you agree to these terms.
        </Paragraph>

        <Section title="1. Use of PinPoint">
          <Paragraph>
            PinPoint is a bowling tracking app that lets you upload scoreboard images, manage
            sessions and games, review stats, use live-session tools, chat for bowling-related
            insights, and connect with friends.
          </Paragraph>
          <Paragraph>
            You may use PinPoint only in compliance with these terms and applicable law.
          </Paragraph>
        </Section>

        <Section title="2. Accounts and Guest Use">
          <Bullet>You may use PinPoint as a guest where that feature is available.</Bullet>
          <Bullet>You are responsible for the activity that occurs under your account.</Bullet>
          <Bullet>You are responsible for keeping your sign-in information secure.</Bullet>
          <Bullet>You must provide accurate information when creating an account.</Bullet>
        </Section>

        <Section title="3. Your Content and Score Data">
          <Paragraph>
            You retain responsibility for the scoreboard images, player names, session details, chat
            prompts, and other data you submit through PinPoint.
          </Paragraph>
          <Paragraph>
            By using the app, you give us permission to store, process, and analyze that data as
            needed to operate the app and its features.
          </Paragraph>
        </Section>

        <Section title="4. Acceptable Use">
          <Paragraph>You agree not to misuse PinPoint. This includes, for example:</Paragraph>
          <Bullet>Trying to interfere with or disrupt the service</Bullet>
          <Bullet>Uploading content you do not have the right to use</Bullet>
          <Bullet>Using the app to harass, abuse, or impersonate other users</Bullet>
          <Bullet>Attempting to access data or accounts that do not belong to you</Bullet>
        </Section>

        <Section title="5. Friends, Social Features, and Chat">
          <Paragraph>
            PinPoint may display parts of your bowling activity through friends, invites, leaderboard,
            and chat-related features. You are responsible for how you use those features and for
            what information you choose to share.
          </Paragraph>
          <Paragraph>
            Automated chat or analysis features may be incomplete, incorrect, or unavailable at
            times. Use them as informational tools, not as guaranteed advice.
          </Paragraph>
        </Section>

        <Section title="6. Availability and Changes">
          <Paragraph>
            We may change, suspend, or discontinue parts of PinPoint at any time. We may also update
            features, limits, or requirements without prior notice.
          </Paragraph>
        </Section>

        <Section title="7. Termination">
          <Paragraph>
            We may suspend or terminate access to PinPoint if we believe you have violated these
            terms, misused the service, or created risk for the app or other users.
          </Paragraph>
          <Paragraph>
            You may stop using the app at any time and may request account deletion using the
            deletion options provided in the app or on our website.
          </Paragraph>
        </Section>

        <Section title="8. Disclaimers">
          <Paragraph>
            PinPoint is provided on an &quot;as is&quot; and &quot;as available&quot; basis. We do not
            guarantee that the app will always be available, error-free, or fully accurate.
          </Paragraph>
        </Section>

        <Section title="9. Limitation of Liability">
          <Paragraph>
            To the extent permitted by law, PinPoint and its operators will not be liable for
            indirect, incidental, special, consequential, or punitive damages arising out of or
            related to your use of the app.
          </Paragraph>
        </Section>

        <Section title="10. Changes to These Terms">
          <Paragraph>
            We may update these terms from time to time. If we make material changes, we will update
            the effective date above and may provide additional notice where appropriate.
          </Paragraph>
        </Section>

        <Section title="11. Contact">
          <Text style={styles.contactLine}>Email: {CONTACT_EMAIL}</Text>
          <Text style={styles.contactLine}>Website: {WEBSITE_URL}</Text>
          <Text style={styles.contactLine}>Terms URL: {TERMS_URL}</Text>
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
  contactLine: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 23,
    fontFamily: fontFamilySans,
  },
});
