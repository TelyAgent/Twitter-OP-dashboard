-- ════════════════════════════════════════════════════════════════════════
-- Pallax OP-dashboard · Supabase 一次性建表 + 数据 seed
-- ════════════════════════════════════════════════════════════════════════
-- 用法:
--   1. 打开 Supabase Dashboard → SQL Editor → New query
--   2. 把本文件全部内容粘进去
--   3. 点 Run (右下), 等 5~10 秒
--   4. 看末尾的校验查询应返回:
--        - hotspots_seeded: 7
--        - tables_created : 9
--
-- 幂等: 反复运行不会重复建表 / 重复插数据
-- 不含 user_profiles seed (需 4 个邮箱先 Magic Link 登录, 单独跑 seed_user_profiles.sql)
-- ════════════════════════════════════════════════════════════════════════


-- ═══════════ PART 1 · v1 表 (周报核心: teams + weekly_data) ═══════════

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

alter table teams              enable row level security;
alter table team_schemas       enable row level security;
alter table team_api_configs   enable row level security;
alter table weekly_data        enable row level security;

drop policy if exists "auth all teams"   on teams;
drop policy if exists "auth all schemas" on team_schemas;
drop policy if exists "auth all api"     on team_api_configs;
drop policy if exists "auth all weekly"  on weekly_data;

create policy "auth all teams"   on teams              for all to authenticated using (true) with check (true);
create policy "auth all schemas" on team_schemas       for all to authenticated using (true) with check (true);
create policy "auth all api"     on team_api_configs   for all to authenticated using (true) with check (true);
create policy "auth all weekly"  on weekly_data        for all to authenticated using (true) with check (true);


-- ═══════════ PART 2 · v2 表 (内容工厂: profiles/sources/hotspots/templates) ═══════════

create table if not exists user_profiles (
  id            uuid        primary key references auth.users(id) on delete cascade,
  initials      text        not null,
  display_name  text        not null,
  role          text        check (role in ('Owner','Researcher','Coordinator','Distributor')),
  avatar_color  text        default '',
  created_at    timestamptz default now()
);
create index if not exists idx_user_profiles_initials on user_profiles(initials);

create table if not exists sources (
  id              text        primary key,
  type            text        not null check (type in ('twitter','onchain','market','rss')),
  handle          text        not null unique,
  name            text,
  tags            jsonb       default '[]'::jsonb,
  reliability     numeric     default 0.5 check (reliability >= 0 and reliability <= 1),
  status          text        default 'observe' check (status in ('observe','live','retired')),
  uploader_id     uuid        references user_profiles(id) on delete set null,
  added_at        timestamptz default now(),
  last_active_at  timestamptz,
  metrics_4w      jsonb       default '{}'::jsonb
);
create index if not exists idx_sources_type     on sources(type);
create index if not exists idx_sources_status   on sources(status);
create index if not exists idx_sources_uploader on sources(uploader_id);

create table if not exists hotspots (
  id          text        primary key,
  title       text        not null,
  category    text        check (category in ('A','C','D','E')),
  status      text        default 'pool' check (status in ('pool','hot','watching','published','ignored')),
  score       int         default 0,
  hot_signal  boolean     default false,
  sources     jsonb       default '[]'::jsonb,
  intel       jsonb       default '{}'::jsonb,
  tweets      jsonb       default '[]'::jsonb,
  metrics     jsonb       default '{}'::jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists idx_hotspots_status     on hotspots(status);
create index if not exists idx_hotspots_score      on hotspots(score desc);
create index if not exists idx_hotspots_hot_signal on hotspots(hot_signal);

create table if not exists templates (
  id              text        primary key,
  category        text        not null check (category in ('A','C','D','E')),
  angle           text        not null,
  skeleton        text        not null,
  required_slots  jsonb       default '[]'::jsonb,
  source_tweet_url text,
  uploader_id     uuid        references user_profiles(id) on delete set null,
  uses            int         default 0,
  avg_views       int         default 0,
  fire_count      int         default 0,
  status          text        default 'observe' check (status in ('observe','solid','fire','retired')),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists idx_templates_category on templates(category);
create index if not exists idx_templates_angle    on templates(angle);
create index if not exists idx_templates_status   on templates(status);

create table if not exists template_uses (
  id          bigserial   primary key,
  template_id text        not null references templates(id) on delete cascade,
  hotspot_id  text        references hotspots(id) on delete set null,
  tweet_url   text,
  views       int         default 0,
  used_at     timestamptz default now()
);
create index if not exists idx_template_uses_tpl on template_uses(template_id);
create index if not exists idx_template_uses_hot on template_uses(hotspot_id);

-- updated_at trigger
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_hotspots_updated  on hotspots;
drop trigger if exists trg_templates_updated on templates;
create trigger trg_hotspots_updated  before update on hotspots  for each row execute function set_updated_at();
create trigger trg_templates_updated before update on templates for each row execute function set_updated_at();

-- 模板统计 trigger
create or replace function bump_template_stats() returns trigger as $$
begin
  update templates set
    uses       = uses + 1,
    avg_views  = ((avg_views * uses) + coalesce(NEW.views, 0)) / (uses + 1),
    fire_count = fire_count + case when coalesce(NEW.views, 0) >= 50000 then 1 else 0 end,
    status     = case
                   when fire_count + (case when coalesce(NEW.views,0) >= 50000 then 1 else 0 end) >= 3 then 'fire'
                   when uses + 1 >= 3 then 'solid'
                   else status
                 end
  where id = NEW.template_id;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_template_uses_bump on template_uses;
create trigger trg_template_uses_bump after insert on template_uses
  for each row execute function bump_template_stats();

-- v2 RLS
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
drop policy if exists "self insert profile" on user_profiles;

create policy "auth read profiles"  on user_profiles for select to authenticated using (true);
create policy "self update profile" on user_profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create policy "self insert profile" on user_profiles for insert to authenticated with check (auth.uid() = id);

create policy "auth all sources"   on sources       for all to authenticated using (true) with check (true);
create policy "auth all hotspots"  on hotspots      for all to authenticated using (true) with check (true);
create policy "auth all templates" on templates     for all to authenticated using (true) with check (true);
create policy "auth all tpl uses"  on template_uses for all to authenticated using (true) with check (true);

-- v2 视图
create or replace view v_weekly_hotspot_stats as
  select
    date_trunc('week', created_at)::date  as week_start,
    count(*)                              as total,
    count(*) filter (where hot_signal)    as hot_count,
    count(*) filter (where status = 'published') as published
  from hotspots
  group by 1;

create or replace view v_template_perf as
  select
    t.id, t.category, t.angle, t.status,
    t.uses, t.avg_views, t.fire_count,
    p.initials  as uploaded_by_init,
    p.display_name as uploaded_by_name,
    t.created_at
  from templates t
  left join user_profiles p on p.id = t.uploader_id
  order by t.fire_count desc, t.avg_views desc;

create or replace view v_source_contribution as
  with src_in_hot as (
    select
      jsonb_array_elements_text(sources) as src_id,
      hot_signal,
      created_at
    from hotspots
    where created_at >= now() - interval '4 weeks'
  )
  select
    s.id, s.handle, s.type, s.status,
    count(*)                            as hits_4w,
    count(*) filter (where hot_signal)  as fires_4w,
    s.uploader_id,
    p.initials  as uploader_init,
    p.display_name as uploader_name
  from sources s
  left join src_in_hot sih on sih.src_id = s.id
  left join user_profiles p on p.id = s.uploader_id
  group by s.id, s.handle, s.type, s.status, s.uploader_id, p.initials, p.display_name;


-- ═══════════ PART 3 · seed 7 条 hotspots (FOMC 含完整 intel + 9 推文) ═══════════

insert into hotspots (id, title, category, status, score, hot_signal, metrics, intel, tweets) values

('hs_wallets_yes', '3 个胜率 ≥70% 钱包 6h 内押 $691k YES', 'C', 'hot', 5, true,
  '{"talk_accounts":156,"engagements":8200,"detected_min":4}'::jsonb,
  '{}'::jsonb, '[]'::jsonb),

('hs_fomc_odds', 'FOMC 前夜赔率剧烈跳动 0.42 → 0.38', 'A', 'watching', 4, false,
  '{"talk_accounts":248,"engagements":12400,"score_total":82,"detected_min":12,"amplitude":"9.5%","duration_min":38}'::jsonb,
  $$
  {
    "summary": "<b>2026 年 1 月 FOMC 会议前 12 小时</b>，Polymarket \"Jan FOMC 降息 50bps\" 合约从 <b>0.42 跌至 0.38</b>（38 min 内），同期 \"降息 25bps\" 从 0.51 升至 0.55。市场对鸽派转向的押注集中收敛到 25bps 路径——但与昨日 Powell \"Fed will remain patient\" 的表态方向背离。",
    "facts": [
      "当前 CME FedWatch 隐含降息概率 <b>92%</b>，但 25bps vs 50bps 路径分歧创 18 个月新高",
      "链上 3 个 90d ROI &gt;200% 钱包在 6h 内集中买入 <span class=\"hl-num\">$691k YES</span> 仓位（YES = 25bps）",
      "Powell 昨日演讲明确 \"patience on rate cuts\"，但隔夜利率市场 OIS 仍 price-in 鸽派"
    ],
    "opportunity": "主流叙事卡在 \"降几个 bps\"，所有人盯 headline。<b>真正的非对称信息</b>在 dot plot 2025 路径分歧——市场只 price 单一路径，但 Fed 内部分歧已到 2024 年中以来最高。Smart money 已经在前 3h 卡位，但还没扩散到 KOL 圈。",
    "dissent": {
      "handle": "@HayesEconomics",
      "interactions": "1.2k",
      "stance": "市场过度定价降息",
      "detail": "过去 12 个月里赔率与 Powell 表态背离 4 次，3 次最终是赔率错。可以做 NO。"
    },
    "timeline": [
      {"time":"昨 22:30","event":"Powell 公开演讲，强调 patience"},
      {"time":"06:14","event":"WSJ \"Dot plot dispersion at 18-month high\""},
      {"time":"08:36","event":"3 个 smart money 钱包开始建仓 YES"},
      {"time":"08:54","event":"@PolymarketWhale 发推，转发 487 次"},
      {"time":"09:02","event":"Reuters \"Powell signals patience\""},
      {"time":"09:14","event":"<b>赔率突破 0.40 关口 → HOT 触发</b>","hot":true}
    ]
  }
  $$::jsonb,
  $$
  [
    {"handle":"@PolymarketWhale","time":"41 min","text":"3 个 90d ROI >200% 的钱包刚在 6h 内集中买入 $691k YES 仓位。这种 smart money clustering 在前 3 次 FOMC 前都出现过，2 次方向对了。","tag":null,"stats":{"rt":487,"like":3100,"reply":226,"view":67000}},
    {"handle":"@JimGCryptos","time":"18 min","text":"FOMC 前赔率从 0.42 跌到 0.38 是经典 sell-the-news。每次都有人喊\"这次不一样\"，每次都不一样吗？","tag":null,"stats":{"rt":312,"like":2400,"reply":187,"view":48000}},
    {"handle":"@HayesEconomics","time":"32 min","text":"市场过度定价降息。Powell 昨天明确说 \"patience\"，但赔率却往鸽派方向跑——这种背离过去 12 个月出现过 4 次，3 次最终是赔率错。","tag":"反方","stats":{"rt":156,"like":1200,"reply":94,"view":22000}},
    {"handle":"@degenoeconomist","time":"56 min","text":"25bps 降息已经 priced in 到 92%。真正的非对称机会是 dot plot——市场只看 headline 数字，全员忽略 2025 路径分歧。","tag":null,"stats":{"rt":198,"like":1600,"reply":73,"view":31000}},
    {"handle":"@zhusu","time":"1h","text":"Dot plot dispersion at 18-month high. The market is trading FOMC like a single-path event but the Fed is internally a 2026 path debate. Volatility is mispriced.","tag":null,"stats":{"rt":624,"like":4800,"reply":312,"view":92000}},
    {"handle":"@ramahluwalia","time":"1h","text":"FedWatch shows 92% odds of a cut, but Polymarket is the cleaner read: 25 vs 50 split is where the real disagreement lives. Watch the 6pm settle.","tag":null,"stats":{"rt":241,"like":1900,"reply":118,"view":38000}},
    {"handle":"@nic__carter","time":"1h","text":"Polymarket FOMC volume already $4.2M, +68% vs 30d avg. Predictive markets are now front-running CME futures by 3-4 hours on rate decisions.","tag":null,"stats":{"rt":389,"like":2700,"reply":164,"view":54000}},
    {"handle":"@arampage","time":"1h 20min","text":"Smart money clustering 在 FOMC 前不是新事。回测过去 8 次类似 setup，胜率 50%——这次链上信号被过度赋权了。别 FOMO。","tag":"反方","stats":{"rt":178,"like":1400,"reply":142,"view":28000}},
    {"handle":"@cobie","time":"1h 35min","text":"25 bps is consensus now. The trade isn't the headline, it's the SEP dots. Every cycle since 2022 has had the dispersion mispriced going in.","tag":null,"stats":{"rt":412,"like":3600,"reply":209,"view":78000}}
  ]
  $$::jsonb),

('hs_poly_ai_reg', 'Polymarket 新合约 "AI 监管法案 Q1 通过"', 'D', 'hot', 4, true,
  '{"talk_accounts":189,"engagements":9600,"detected_min":8}'::jsonb,
  '{}'::jsonb, '[]'::jsonb),

('hs_vision_pro', '苹果 Vision Pro 二代发布会赔率剧变', 'E', 'pool', 3, false,
  '{"talk_accounts":412,"engagements":15800,"detected_min":23}'::jsonb,
  '{}'::jsonb, '[]'::jsonb),

('hs_trump_media', 'Trump 媒体股大额钱包异动', 'C', 'hot', 4, true,
  '{"talk_accounts":91,"engagements":5400,"detected_min":26}'::jsonb,
  '{}'::jsonb, '[]'::jsonb),

('hs_sbf_appeal', 'SBF 上诉判决相关合约成交激增', 'A', 'pool', 3, false,
  '{"talk_accounts":167,"engagements":4200,"detected_min":38}'::jsonb,
  '{}'::jsonb, '[]'::jsonb),

('hs_kalshi_fed', 'Kalshi 上线美联储利率新合约', 'D', 'pool', 2, false,
  '{"talk_accounts":89,"engagements":1900,"detected_min":52}'::jsonb,
  '{}'::jsonb, '[]'::jsonb)

on conflict (id) do update set
  title       = excluded.title,
  category    = excluded.category,
  status      = excluded.status,
  score       = excluded.score,
  hot_signal  = excluded.hot_signal,
  metrics     = excluded.metrics,
  intel       = excluded.intel,
  tweets      = excluded.tweets,
  updated_at  = now();


-- ═══════════ PART 4 · 校验 (跑完看这两条结果) ═══════════

select count(*) as hotspots_seeded from hotspots;

select count(*) as tables_created
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'teams','team_schemas','team_api_configs','weekly_data',
    'user_profiles','sources','hotspots','templates','template_uses'
  );

-- 期望: hotspots_seeded=7, tables_created=9
