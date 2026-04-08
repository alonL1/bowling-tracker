import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import PageBackButton from '@/components/page-back-button';
import { palette, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';

const WEBSITE_URL = 'https://bowling-tracker-six.vercel.app';
const PRIVACY_URL = `${WEBSITE_URL}/privacy`;
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

export default function PrivacyScreen() {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <PageBackButton fallbackHref="/(tabs)/account" />
          <Text style={styles.title}>Privacy Policy</Text>
          <Text style={styles.subtitle}>PinPoint</Text>
          <Text style={styles.meta}>Effective date: March 17, 2026</Text>
        </View>

        <Paragraph>
          PinPoint (&quot;PinPoint,&quot; &quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) provides tools
          for recording bowling games, uploading scoreboard images, tracking bowling statistics,
          managing sessions, using live session features, chatting with the app for score-related
          insights, and connecting with friends.
        </Paragraph>
        <Paragraph>
          This Privacy Policy explains what information we collect, how we use it, how we share it,
          and the choices available to you when you use PinPoint.
        </Paragraph>

        <Section title="1. Information We Collect">
          <Paragraph>We collect the following categories of information when you use PinPoint:</Paragraph>
          <Text style={styles.subheading}>Account Information</Text>
          <Bullet>Email address, if you create or sign in to an account</Bullet>
          <Bullet>Authentication-related identifiers needed to keep you signed in</Bullet>
          <Bullet>Guest or anonymous account identifiers if you use the app without creating a full account</Bullet>

          <Text style={styles.subheading}>Bowling Data</Text>
          <Bullet>Session names and descriptions</Bullet>
          <Bullet>Game names</Bullet>
          <Bullet>Player names entered or detected from scoreboard images</Bullet>
          <Bullet>Scores, frame-by-frame results, shot data, timestamps, and related bowling statistics</Bullet>
          <Bullet>Live session data, including unfinished or draft session information</Bullet>

          <Text style={styles.subheading}>Uploaded Images</Text>
          <Bullet>Scoreboard images that you upload or capture through the app for score extraction and processing</Bullet>

          <Text style={styles.subheading}>Chat and App Interaction Data</Text>
          <Bullet>Questions you submit through PinPoint&apos;s chat feature</Bullet>
          <Bullet>Generated chat responses</Bullet>
          <Bullet>Limited records needed to operate, improve, secure, and troubleshoot the chat and score-processing features</Bullet>

          <Text style={styles.subheading}>Friends and Social Features</Text>
          <Bullet>Friend relationships</Bullet>
          <Bullet>Friend invite links or tokens</Bullet>
          <Bullet>Leaderboard-related score information visible through the friends features</Bullet>

          <Text style={styles.subheading}>Device and Local Storage Data</Text>
          <Bullet>Authentication and session tokens stored locally on your device or browser to keep you signed in</Bullet>
          <Bullet>Basic technical information necessary to run the app and maintain security and reliability</Bullet>
        </Section>

        <Section title="2. How We Use Your Information">
          <Bullet>Create and manage your account</Bullet>
          <Bullet>Let you sign in, stay signed in, and use guest access where available</Bullet>
          <Bullet>Upload, process, and analyze scoreboard images</Bullet>
          <Bullet>Create bowling sessions, games, frame data, and statistics</Bullet>
          <Bullet>Support live session features and unfinished session recovery</Bullet>
          <Bullet>Provide chat responses and score-related insights</Bullet>
          <Bullet>Enable friends, invites, and leaderboard features</Bullet>
          <Bullet>Maintain, troubleshoot, secure, and improve the app</Bullet>
          <Bullet>Enforce usage limits, prevent abuse, and protect the service</Bullet>
          <Bullet>Comply with legal obligations</Bullet>
        </Section>

        <Section title="3. How Scoreboard Processing Works">
          <Paragraph>
            When you upload a scoreboard image, PinPoint temporarily stores the image so it can be
            processed. We then extract relevant bowling information, such as player names, frame
            results, and scores, in order to create or update your game and session data.
          </Paragraph>
          <Paragraph>
            Uploaded scoreboard images may be processed using third-party service providers that help
            us operate image analysis and related app functionality.
          </Paragraph>
          <Paragraph>
            In general, uploaded scoreboard images are stored temporarily for processing and are
            removed after processing is completed or no longer needed for that purpose. Extracted
            bowling data may remain in your account until you delete it or request deletion.
          </Paragraph>
        </Section>

        <Section title="4. Chat and AI-Related Features">
          <Paragraph>
            PinPoint includes chat and automated analysis features that may use third-party service
            providers to generate responses or process bowling-related information. When you use
            these features, the content you submit, including score-related questions and related app
            context, may be processed to provide the feature.
          </Paragraph>
          <Paragraph>
            You should not submit highly sensitive personal information through chat or image uploads
            unless it is necessary for your use of the app.
          </Paragraph>
        </Section>

        <Section title="5. How We Share Information">
          <Paragraph>We do not sell your personal information.</Paragraph>
          <Paragraph>
            We may share information with service providers that help us operate PinPoint, such as
            providers for authentication, database and cloud storage, file storage, hosting and
            infrastructure, image processing, chat or AI-assisted features, and app distribution and
            platform services.
          </Paragraph>
          <Paragraph>We may also share information:</Paragraph>
          <Bullet>If required by law, legal process, or government request</Bullet>
          <Bullet>To protect the rights, safety, security, or integrity of PinPoint, our users, or others</Bullet>
          <Bullet>In connection with a merger, acquisition, financing, or sale of assets</Bullet>
        </Section>

        <Section title="6. Friends and Leaderboards">
          <Paragraph>
            If you use PinPoint&apos;s friends or leaderboard features, some of your bowling information
            may be visible to other users you connect with through those features. This may include
            score-related data, rankings, and limited identifying information associated with your
            account.
          </Paragraph>
          <Paragraph>
            Please use social features only if you are comfortable sharing that information with
            connected users.
          </Paragraph>
        </Section>

        <Section title="7. Data Retention">
          <Paragraph>
            We keep information for as long as reasonably necessary to provide the app and operate
            our services, including to maintain your account, sessions, games, stats, and social
            features.
          </Paragraph>
          <Paragraph>In general:</Paragraph>
          <Bullet>Scoreboard images are stored temporarily for processing and then removed when no longer needed for that purpose</Bullet>
          <Bullet>Extracted bowling data may remain in your account until you delete it or request deletion</Bullet>
          <Bullet>Some records may be retained for security, fraud prevention, operational, legal, or compliance reasons</Bullet>
        </Section>

        <Section title="8. Your Choices">
          <Paragraph>Depending on how you use PinPoint, you may be able to:</Paragraph>
          <Bullet>Edit or delete sessions and games in the app</Bullet>
          <Bullet>Sign out of your account</Bullet>
          <Bullet>Use the app as a guest where supported</Bullet>
          <Bullet>Request deletion of your account or personal data by contacting us</Bullet>
          <Paragraph>
            To make a privacy or deletion request, contact us at: {CONTACT_EMAIL}
          </Paragraph>
        </Section>

        <Section title="9. Security">
          <Paragraph>
            We use reasonable technical and organizational measures to protect information processed
            through PinPoint. However, no method of transmission over the internet or method of
            electronic storage is completely secure, and we cannot guarantee absolute security.
          </Paragraph>
        </Section>

        <Section title="10. Children&apos;s Privacy">
          <Paragraph>
            PinPoint is not directed to children under 13, and we do not knowingly collect personal
            information from children under 13. If you believe a child has provided personal
            information to us, contact us at {CONTACT_EMAIL} and we will take appropriate steps.
          </Paragraph>
        </Section>

        <Section title="11. International Use">
          <Paragraph>
            If you use PinPoint from outside the country where our service providers operate, your
            information may be transferred to and processed in other countries where data protection
            laws may differ from those in your jurisdiction.
          </Paragraph>
        </Section>

        <Section title="12. Changes to This Privacy Policy">
          <Paragraph>
            We may update this Privacy Policy from time to time. If we make material changes, we
            will update the effective date above and may provide additional notice where required.
          </Paragraph>
        </Section>

        <Section title="13. Contact Us">
          <Text style={styles.contactLine}>Email: {CONTACT_EMAIL}</Text>
          <Text style={styles.contactLine}>Website: {WEBSITE_URL}</Text>
          <Text style={styles.contactLine}>Privacy Policy URL: {PRIVACY_URL}</Text>
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
  subheading: {
    color: palette.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    fontFamily: fontFamilySans,
    marginTop: spacing.xs,
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
