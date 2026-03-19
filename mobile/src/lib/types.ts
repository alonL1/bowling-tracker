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
  scoreboard_extraction?: LiveExtraction | null;
  selected_self_player_key?: string | null;
  selected_self_player_name?: string | null;
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
  scoreboard_extraction?: LiveExtraction | null;
  selected_self_player_key?: string | null;
  selected_self_player_name?: string | null;
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
export type RecordingDraftMode =
  | 'upload_session'
  | 'add_multiple_sessions'
  | 'add_existing_session';

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
  gameCountLabel: string;
  averageLabel: string;
  bestScoreLabel: string;
  bestSeriesLabel: string;
  strikesLabel: string;
  ninesLabel: string;
  strikeRateLabel: string;
  spareConversionRateLabel: string;
  bestFrameLabel: string;
  worstFrameLabel: string;
};

export type RecordingDraftGameStatus = 'queued' | 'processing' | 'ready' | 'error';

export type RecordingDraftGame = {
  id: string;
  draft_id: string;
  group_id?: string | null;
  capture_order: number;
  storage_key: string;
  status: RecordingDraftGameStatus;
  captured_at_hint?: string | null;
  captured_at?: string | null;
  sort_at?: string | null;
  last_error?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  extraction?: LiveExtraction | null;
};

export type RecordingDraftGroup = {
  id: string;
  draft_id: string;
  display_order: number;
  name?: string | null;
  description?: string | null;
  anchor_captured_at?: string | null;
  games: RecordingDraftGame[];
};

export type RecordingDraftProgress = {
  total: number;
  queued: number;
  processing: number;
  ready: number;
  error: number;
  completed: number;
};

export type RecordingDraft = {
  id: string;
  mode: RecordingDraftMode;
  status: 'active' | 'finalized' | 'discarded';
  selectedPlayerKeys: string[];
  playerOptions: LiveSessionPlayerOption[];
  targetSessionId?: string | null;
  name?: string | null;
  description?: string | null;
  groups: RecordingDraftGroup[];
  progress: RecordingDraftProgress;
};

export type RecordingDraftResponse = {
  draft: RecordingDraft | null;
};

export type RecordEntryStatus = {
  liveSession: boolean;
  uploadSessionDraft: boolean;
  addMultipleSessionsDraft: boolean;
  addExistingSessionDraft: boolean;
};

export type RecordEntryStatusResponse = {
  status: RecordEntryStatus;
};
