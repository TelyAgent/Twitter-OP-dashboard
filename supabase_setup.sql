-- Pallax Weekly Dashboard · Supabase setup
-- Run this once in Supabase SQL Editor (Project: snflonpxmzkeytzytqpg)

create table if not exists teams (
  id text primary key,
  label text not null,
  sort_order int default 0,
  updated_at timestamptz default now()
);

create table if not exists team_schemas (
  team_id text primary key references teams(id) on delete cascade,
  schema jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists team_api_configs (
  team_id text primary key references teams(id) on delete cascade,
  config jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists weekly_data (
  team_id text references teams(id) on delete cascade,
  week text not null,
  data jsonb not null,
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id),
  primary key (team_id, week)
);

alter table teams enable row level security;
alter table team_schemas enable row level security;
alter table team_api_configs enable row level security;
alter table weekly_data enable row level security;

drop policy if exists "auth all teams" on teams;
drop policy if exists "auth all schemas" on team_schemas;
drop policy if exists "auth all api" on team_api_configs;
drop policy if exists "auth all weekly" on weekly_data;

create policy "auth all teams" on teams
  for all to authenticated using (true) with check (true);
create policy "auth all schemas" on team_schemas
  for all to authenticated using (true) with check (true);
create policy "auth all api" on team_api_configs
  for all to authenticated using (true) with check (true);
create policy "auth all weekly" on weekly_data
  for all to authenticated using (true) with check (true);
