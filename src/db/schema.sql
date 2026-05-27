-- OP Dashboard · 数据库 schema
-- 在 Supabase SQL Editor 一次性运行，幂等

-- ════════════════════════════════════════════════════════════════
-- 1. 周报核心表
-- ════════════════════════════════════════════════════════════════

create table if not exists teams (
  id         text primary key,
  label      text not null,
  sort_order int  default 0,
  updated_at timestamptz default now()
);

create table if not exists team_schemas (
  team_id    text primary key references teams(id) on delete cascade,
  schema     jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists team_api_configs (
  team_id    text primary key references teams(id) on delete cascade,
  config     jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists weekly_data (
  team_id    text references teams(id) on delete cascade,
  week       text not null,
  data       jsonb not null,
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id),
  primary key (team_id, week)
);

-- ════════════════════════════════════════════════════════════════
-- 2. 内容工厂表
-- ════════════════════════════════════════════════════════════════

create table if not exists user_profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  initials     text not null,
  display_name text not null,
  role         text check (role in ('Owner','Researcher','Coordinator','Distributor')),
  avatar_color text default '',
  created_at   timestamptz default now()
);

create table if not exists sources (
  id              text primary key,
  type            text not null check (type in ('twitter','onchain','market','rss')),
  handle          text not null unique,
  name            text,
  tags            jsonb default '[]'::jsonb,
  reliability     numeric default 0.5 check (reliability >= 0 and reliability <= 1),
  status          text default 'observe' check (status in ('observe','live','retired')),
  uploader_id     uuid references user_profiles(id) on delete set null,
  added_at        timestamptz default now(),
  last_active_at  timestamptz,
  metrics_4w      jsonb default '{}'::jsonb
);

create table if not exists hotspots (
  id         text primary key,
  title      text not null,
  category   text check (category in ('A','C','D','E')),
  status     text default 'pool' check (status in ('pool','hot','watching','published','ignored')),
  score      int default 0,
  hot_signal boolean default false,
  sources    jsonb default '[]'::jsonb,
  intel      jsonb default '{}'::jsonb,
  tweets     jsonb default '[]'::jsonb,
  metrics    jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists templates (
  id               text primary key,
  category         text not null check (category in ('A','C','D','E')),
  angle            text not null,
  skeleton         text not null,
  required_slots   jsonb default '[]'::jsonb,
  source_tweet_url text,
  uploader_id      uuid references user_profiles(id) on delete set null,
  uses             int default 0,
  avg_views        int default 0,
  fire_count       int default 0,
  status           text default 'observe' check (status in ('observe','solid','fire','retired')),
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create table if not exists template_uses (
  id          bigserial primary key,
  template_id text not null references templates(id) on delete cascade,
  hotspot_id  text references hotspots(id) on delete set null,
  tweet_url   text,
  views       int default 0,
  snapshot    jsonb default '{}'::jsonb,
  used_at     timestamptz default now()
);

-- ════════════════════════════════════════════════════════════════
-- 3. 索引
-- ════════════════════════════════════════════════════════════════

create index if not exists idx_user_profiles_initials on user_profiles(initials);
create index if not exists idx_sources_type   on sources(type);
create index if not exists idx_sources_status on sources(status);
create index if not exists idx_hotspots_status     on hotspots(status);
create index if not exists idx_hotspots_score      on hotspots(score desc);
create index if not exists idx_hotspots_hot_signal on hotspots(hot_signal);
create index if not exists idx_templates_category on templates(category);
create index if not exists idx_templates_angle    on templates(angle);
create index if not exists idx_templates_status   on templates(status);
create index if not exists idx_template_uses_tpl on template_uses(template_id);
create index if not exists idx_template_uses_hot on template_uses(hotspot_id);

-- ════════════════════════════════════════════════════════════════
-- 4. updated_at trigger (hotspots + templates)
-- ════════════════════════════════════════════════════════════════

create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_hotspots_updated  on hotspots;
drop trigger if exists trg_templates_updated on templates;
create trigger trg_hotspots_updated  before update on hotspots  for each row execute function set_updated_at();
create trigger trg_templates_updated before update on templates for each row execute function set_updated_at();

-- ════════════════════════════════════════════════════════════════
-- 5. RLS (anon 全权限, 本地运行无需认证)
-- ════════════════════════════════════════════════════════════════

alter table teams            enable row level security;
alter table team_schemas     enable row level security;
alter table team_api_configs enable row level security;
alter table weekly_data      enable row level security;
alter table user_profiles    enable row level security;
alter table sources          enable row level security;
alter table hotspots         enable row level security;
alter table templates        enable row level security;
alter table template_uses    enable row level security;

-- 删除所有已有的 policy（避免冲突）
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on %I', r.policyname, r.tablename);
  end loop;
end $$;

-- 全部 anon 可读写
create policy "anon_all" on teams            for all to anon using (true) with check (true);
create policy "anon_all" on team_schemas     for all to anon using (true) with check (true);
create policy "anon_all" on team_api_configs for all to anon using (true) with check (true);
create policy "anon_all" on weekly_data      for all to anon using (true) with check (true);
create policy "anon_all" on user_profiles    for all to anon using (true) with check (true);
create policy "anon_all" on sources          for all to anon using (true) with check (true);
create policy "anon_all" on hotspots         for all to anon using (true) with check (true);
create policy "anon_all" on templates        for all to anon using (true) with check (true);
create policy "anon_all" on template_uses    for all to anon using (true) with check (true);
