export type JobStatus = "queued" | "processing" | "logged" | "error";

export type StatusResponse = {
  jobId: string;
  status: JobStatus;
  lastError?: string | null;
  updatedAt?: string;
  gameId?: string;
};

export type PendingJob = {
  jobId: string;
  status: JobStatus;
  message: string;
  lastError?: string;
  isStale?: boolean;
};

export type SessionItem = {
  id: string;
  name?: string | null;
  description?: string | null;
  started_at?: string | null;
  created_at?: string | null;
};

export type GameDetail = {
  id: string;
  game_name?: string | null;
  player_name: string;
  total_score: number | null;
  played_at?: string | null;
  created_at?: string | null;
  status: string;
  frames?: Array<{
    id: string;
    frame_number: number;
    is_strike: boolean;
    is_spare: boolean;
    shots?: Array<{
      id: string;
      shot_number: number;
      pins: number | null;
    }>;
  }>;
};

export type GameListItem = {
  id: string;
  game_name?: string | null;
  player_name: string;
  total_score: number | null;
  status: string;
  played_at?: string | null;
  created_at: string;
  session_id?: string | null;
  session?: SessionItem | null;
};

export type SessionOption = {
  id: string;
  label: string;
};

export type QueuedJob = {
  jobId: string;
  message: string;
};

export type LeaderboardMetric =
  | "bestGame"
  | "bestAverage"
  | "bestSession"
  | "mostGames"
  | "mostSessions"
  | "SessionScore"
  | "TotalPoints"
  | "SessionLength"
  | "StrikeRate"
  | "SpareRate"
  | "TotalStrikes"
  | "TotalSpares"
  | "MostNines";

export type LeaderboardRow = {
  userId: string;
  displayName: string;
  metrics: {
    bestGame: number;
    bestAverage: number;
    bestSession: number;
    mostGames: number;
    mostSessions: number;
    SessionScore: number;
    TotalPoints: number;
    SessionLength: number;
    StrikeRate: number;
    SpareRate: number;
    TotalStrikes: number;
    TotalSpares: number;
    MostNines: number;
  };
};

export type InviteLinkResponse = {
  token: string;
  inviteUrl: string;
};

export type InviteLookupResponse = {
  valid: boolean;
  error?: string;
  inviter?: {
    userId: string;
    displayName: string;
  };
  authRequired?: boolean;
  selfInvite?: boolean;
  alreadyFriends?: boolean;
  canAccept?: boolean;
};
