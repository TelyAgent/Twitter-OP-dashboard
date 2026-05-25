-- Pallax Weekly Report + Content Factory · 共用数据库 setup v2
-- Project: snflonpxmzkeytzytqpg
-- 在 Supabase SQL Editor 一次性运行，幂等
--
-- v1 已有: teams / team_schemas / team_api_configs / weekly_data
-- v2 新增: user_profiles / sources / hotspots / templates / template_uses
-- 关系:
--   auth.users (Supabase 自带) ──┬─< user_profiles (4 角色档案)
--                                 ├─< sources.uploader_id
--                                 └─< templates.uploader_id
--   sources ──< (sources jsonb in hotspots/template_uses)
--   hotspots ──< template_uses.hotspot_id
--   templates ──< template_uses.template_id

-- ─────────────────────────────────────────────────────────────────────────
-- 1. user_profiles : 4 角色档案 (initials / 颜色 / role)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists user_profiles (
  id            uuid        primary key references auth.users(id) on delete cascade,
  initials      text        not null,
  display_name  text        not null,
  role          text        check (role in ('Owner','Researcher','Coordinator','Distributor')),
  avatar_color  text        default '',  -- '' / 'r1' / 'r2' / 'r3'
  created_at    timestamptz default now()
);
create index if not exists idx_user_profiles_initials on user_profiles(initials);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. sources : 监控源 (08-sources.html)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists sources (
  id              text        primary key,
  type            text        not null check (type in ('twitter','onchain','market','rss')),
  handle          text        not null unique,
  name            text,
  tags            jsonb       default '[]'::jsonb,
  reliability     numeric     default 0.5 check (reliability >= 0 and reliability <= 1),
  status          text        default 'observe' check (status in ('observe','live','retired')),
  uploader_id     uuid        references user_profiles(id) on delete set null,  -- 引 user_profiles 让 PostgREST 能 embed join
  added_at        timestamptz default now(),
  last_active_at  timestamptz,
  metrics_4w      jsonb       default '{}'::jsonb  -- {hits:14, spark:[10,13,15,18], fire:3, false_rate:0}
);
create index if not exists idx_sources_type   on sources(type);
create index if not exists idx_sources_status on sources(status);
create index if not exists idx_sources_uploader on sources(uploader_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. hotspots : 热点 (02-radar.html)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists hotspots (
  id          text        primary key,
  title       text        not null,
  category    text        check (category in ('A','C','D','E')),
  status      text        default 'pool' check (status in ('pool','hot','watching','published','ignored')),
  score       int         default 0,
  hot_signal  boolean     default false,
  sources     jsonb       default '[]'::jsonb,  -- ["src_xxx","src_yyy"]
  intel       jsonb       default '{}'::jsonb,  -- {facts:[], why_opportunity:'', dissent:'', timeline:[]}
  tweets      jsonb       default '[]'::jsonb,  -- [{handle, text, views, ts}, ...]
  metrics     jsonb       default '{}'::jsonb,  -- {talk_accounts, engagements, amplitude, peak_min, duration_min}
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists idx_hotspots_status     on hotspots(status);
create index if not exists idx_hotspots_score      on hotspots(score desc);
create index if not exists idx_hotspots_hot_signal on hotspots(hot_signal);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. templates : 金模板 (07-templates.html)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists templates (
  id              text        primary key,
  category        text        not null check (category in ('A','C','D','E')),
  angle           text        not null,  -- 反直觉 / 数据驱动 / 案例 / KOL 蹭点 / 深度 / 教程 / Thread
  skeleton        text        not null,  -- 含 {slot} 的 HTML/text 骨架
  required_slots  jsonb       default '[]'::jsonb,
  source_tweet_url text,
  uploader_id     uuid        references user_profiles(id) on delete set null,
  uses            int         default 0,
  avg_views       int         default 0,
  fire_count      int         default 0,  -- 爆款 (≥50k) 命中次数
  status          text        default 'observe' check (status in ('observe','solid','fire','retired')),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists idx_templates_category on templates(category);
create index if not exists idx_templates_angle    on templates(angle);
create index if not exists idx_templates_status   on templates(status);

-- ─────────────────────────────────────────────────────────────────────────
-- 5. template_uses : 模板使用记录 (爆款溯源)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists template_uses (
  id          bigserial   primary key,
  template_id text        not null references templates(id) on delete cascade,
  hotspot_id  text        references hotspots(id) on delete set null,
  tweet_url   text,
  views       int         default 0,
  snapshot    jsonb       default '{}'::jsonb,
  used_at     timestamptz default now()
);
create index if not exists idx_template_uses_tpl on template_uses(template_id);
create index if not exists idx_template_uses_hot on template_uses(hotspot_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 6. updated_at 自动维护 trigger
-- ─────────────────────────────────────────────────────────────────────────
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_hotspots_updated  on hotspots;
drop trigger if exists trg_templates_updated on templates;
create trigger trg_hotspots_updated  before update on hotspots  for each row execute function set_updated_at();
create trigger trg_templates_updated before update on templates for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 7. RLS (v3: 本地运行，无需认证 — 全部 anon 可读写)
-- ─────────────────────────────────────────────────────────────────────────
alter table user_profiles enable row level security;
alter table sources       enable row level security;
alter table hotspots      enable row level security;
alter table templates     enable row level security;
alter table template_uses enable row level security;

drop policy if exists "auth read profiles"  on user_profiles;
drop policy if exists "auth all sources"    on sources;
drop policy if exists "auth all hotspots"   on hotspots;
drop policy if exists "auth all templates"  on templates;
drop policy if exists "auth all tpl uses"   on template_uses;
drop policy if exists "self update profile" on user_profiles;
drop policy if exists "anon all profiles"   on user_profiles;

-- profiles: 所有用户 (含 anon) 全权限
create policy "anon all profiles"   on user_profiles for all to anon using (true) with check (true);

-- 业务表: anon 全权限
create policy "anon all sources"    on sources       for all to anon using (true) with check (true);
create policy "anon all hotspots"   on hotspots      for all to anon using (true) with check (true);
create policy "anon all templates"  on templates     for all to anon using (true) with check (true);
create policy "anon all tpl uses"   on template_uses for all to anon using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────────────
-- 8. 周报关联字段约定 (不改 weekly_data 表结构, 仅在 JSONB 里加字段)
-- ─────────────────────────────────────────────────────────────────────────
-- 现有 weekly_data.data jsonb 内, tasks 数组每个元素新增可选字段:
--   { id, desc, owner, status, metric,
--     hotspot_id?: 'hs_xxx',     -- 关联热点
--     template_id?: 'tpl_xxx'    -- 关联模板 (写稿台用)
--   }
-- 这是前端约定, 不需要 schema migration
