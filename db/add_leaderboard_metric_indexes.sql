create index if not exists idx_games_user_id
  on games(user_id);

create index if not exists idx_games_user_session_order
  on games(user_id, session_id, played_at, created_at, id);

create index if not exists idx_frames_game_id
  on frames(game_id);

create index if not exists idx_shots_frame_id_shot_number
  on shots(frame_id, shot_number);
