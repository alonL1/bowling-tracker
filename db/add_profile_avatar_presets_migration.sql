alter table profiles
  drop constraint if exists profiles_avatar_preset_id_check;

alter table profiles
  add constraint profiles_avatar_preset_id_check
  check (
    avatar_preset_id is null or
    avatar_preset_id in (
      'happy_pin',
      'thinking_pin',
      'idea_pin',
      'ball_blue',
      'ball_red',
      'ball_orange',
      'ball_purple',
      'ball_coconut',
      'sink',
      'leaf',
      'peanut_butter_jar',
      'beach_chair'
    )
  );
