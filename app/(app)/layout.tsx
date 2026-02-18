import AppShell from "../components/AppShell";
import { AuthProvider } from "../components/providers/AuthProvider";
import { GamesProvider } from "../components/providers/GamesProvider";
import { JobsProvider } from "../components/providers/JobsProvider";

export default function AppLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <GamesProvider>
        <JobsProvider>
          <AppShell>{children}</AppShell>
        </JobsProvider>
      </GamesProvider>
    </AuthProvider>
  );
}
