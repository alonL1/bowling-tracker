export type JobStatus = 'queued' | 'processing' | 'logged' | 'error';

export type SessionMode = 'auto' | 'new' | 'existing';

export type SessionItem = {
  id: string;
  name?: string | null;
  description?: string | null;
  started_at?: string | null;
  created_at?: string | null;
};

export type ShotDetail = {
  id?: string | null;
  shot_number: number;
  pins: number | null;
};

export type FrameDetail = {
  id?: string | null;
  frame_number: number;
  is_strike: boolean;
  is_spare: boolean;
  frame_score?: number | null;
  shots?: ShotDetail[];
};

export type GameDetail = {
  id: string;
  game_name?: string | null;
  player_name: string;
  total_score: number | null;
  played_at?: string | null;
  created_at?: string | null;
  status: string;
  session_id?: string | null;
  frames?: FrameDetail[];
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

export type QueuedJob = {
  jobId: string;
  message: string;
};

export type StatusResponse = {
  jobId: string;
  status: JobStatus;
  lastError?: string | null;
  updatedAt?: string;
  gameId?: string;
};

export type LeaderboardMetric =
  | 'bestGame'
  | 'bestAverage'
  | 'bestSession'
  | 'mostGames'
  | 'mostSessions'
  | 'SessionScore'
  | 'TotalPoints'
  | 'SessionLength'
  | 'StrikeRate'
  | 'SpareRate'
  | 'TotalStrikes'
  | 'TotalSpares'
  | 'MostNines';

export type LeaderboardRow = {
  userId: string;
  displayName: string;
  metrics: Record<LeaderboardMetric, number>;
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

export type LiveSessionGameStatus = 'queued' | 'processing' | 'ready' | 'error';

export type LiveFrame = {
  frame: number;
  shots: [number | null, number | null, number | null];
};

export type LivePlayer = {
  playerName: string;
  totalScore: number | null;
  frames: LiveFrame[];
};

export type LiveExtraction = {
  players: LivePlayer[];
};

export type LiveSessionPlayerOption = {
  key: string;
  label: string;
};

export type LiveSessionGame = {
  id: string;
  capture_order: number;
  status: LiveSessionGameStatus;
  captured_at_hint?: string | null;
  captured_at?: string | null;
  last_error?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  extraction?: LiveExtraction | null;
};

export type LiveSession = {
  id: string;
  sessionId: string;
  sessionNumber: number;
  name?: string | null;
  description?: string | null;
  startedAt?: string | null;
  createdAt?: string | null;
  selectedPlayerKeys: string[];
  playerOptions: LiveSessionPlayerOption[];
  games: LiveSessionGame[];
};

export type LiveSessionResponse = {
  liveSession: LiveSession | null;
  nextSessionNumber: number;
};

export type LiveSessionCaptureResponse = {
  ok: boolean;
  jobId: string;
  liveSessionId: string;
  liveGameId: string;
  sessionId: string;
};

export type LiveSessionEndResponse = {
  ok: boolean;
  sessionId: string;
  loggedGameCount: number;
};

export type LiveSessionStats = {
  averageLabel: string;
  strikeRateLabel: string;
  spareRateLabel: string;
  spareConversionRateLabel: string;
  bestFrameLabel: string;
  worstFrameLabel: string;
};
