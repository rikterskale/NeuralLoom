create table if not exists neural_loom_model_settings (
  user_id text primary key,
  settings jsonb not null,
  updated_at timestamptz not null default now()
);
