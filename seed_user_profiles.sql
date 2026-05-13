-- 4 角色档案 seed
-- 前置: 4 个邮箱已经通过 Magic Link 在 Supabase Auth 完成首次登录, auth.users 已有记录
--
-- 运行步骤:
--   1. 在 weekly_dashboard 登录页用以下 4 个邮箱各点一次 "发送登录链接", 完成登录
--      (任何邮箱都行, 这里给的是默认建议)
--   2. 进 Supabase SQL Editor 运行本文件
--   3. 检查: select * from user_profiles;

-- ─────────────────────────────────────────────────────────────────────────
-- 编辑下面 4 行的邮箱, 然后运行
-- ─────────────────────────────────────────────────────────────────────────

with role_map(email, initials, display_name, role, avatar_color) as (
  values
    ('0xlareina@gmail.com',     'LR', 'Lareina', 'Owner',      ''),     -- Owner
    ('kay@pallax.example',      'KA', 'Kay',     'Researcher', 'r1'),   -- 研究员 1
    ('jay@pallax.example',      'JY', 'Jay',     'Researcher', 'r2'),   -- 研究员 2
    ('valeria@pallax.example',  'VL', 'Valeria', 'Researcher', 'r3')    -- 研究员 3
)
insert into user_profiles (id, initials, display_name, role, avatar_color)
select u.id, r.initials, r.display_name, r.role, r.avatar_color
  from role_map r
  join auth.users u on lower(u.email) = lower(r.email)
on conflict (id) do update set
  initials     = excluded.initials,
  display_name = excluded.display_name,
  role         = excluded.role,
  avatar_color = excluded.avatar_color;

-- 校验: 应该返回 4 行
select up.initials, up.display_name, up.role, up.avatar_color, au.email
  from user_profiles up
  join auth.users au on au.id = up.id
  order by
    case up.role when 'Owner' then 0 when 'Researcher' then 1 else 2 end,
    up.initials;

-- ─────────────────────────────────────────────────────────────────────────
-- 如果某个邮箱还没登录过, auth.users 没那行 → 上面 insert 会跳过它
-- 后续该用户首次 Magic Link 登录后, 再 run 一次本文件即可补齐 profile
-- ─────────────────────────────────────────────────────────────────────────

-- (可选) 把 08-sources.html 当前 7 个 hardcoded 行也 seed 进 sources 表:
-- 注意 uploader_id 需要换成对应 auth.users.id, 这里用 user_profiles.initials 反查
insert into sources (id, type, handle, name, status, uploader_id, added_at, metrics_4w)
select
  'src_' || substr(md5(random()::text), 1, 8),
  v.type,
  v.handle,
  v.name,
  v.status,
  (select id from user_profiles where initials = v.uploader),
  now() - (v.weeks_ago || ' weeks')::interval,
  v.metrics
from (values
  ('twitter', '@JimGCryptos',     'A 赔率 · 链上分析师',      'live',     'LR', 12, '{"hits":14,"spark":[10,13,15,18],"fire":3}'::jsonb),
  ('twitter', '@OnchainBob',      'C 链上 · 钱包追踪',        'live',     'KA',  8, '{"hits":11,"spark":[9,11,14,14],"fire":2}'::jsonb),
  ('twitter', '@HayesEconomics',  'A 赔率 · 宏观',            'live',     'JY',  5, '{"hits":9,"spark":[11,10,11,12],"fire":1}'::jsonb),
  ('twitter', '@PolymarketPro',   'D 新合约 · 官方账号',       'live',     'LR',  6, '{"hits":7,"spark":[7,9,11,13],"fire":1}'::jsonb),
  ('twitter', '@SmartKalshi',     'A 赔率 · Kalshi 玩家',     'observe',  'VL',  3, '{"hits":3,"spark":[13,9,7,5],"fire":0}'::jsonb),
  ('twitter', '@CryptoTrendz2023','综合 · 通用账号',          'retired',  'LR', 28, '{"hits":0,"spark":[3,2,2,2],"fire":0,"note":"5 周无新推"}'::jsonb),
  ('twitter', '@PunditGuru99',    'E 现实 · 误报率高',        'retired',  'KA', 16, '{"hits":2,"spark":[5,3,2,2],"fire":0,"false_rate":0.78}'::jsonb)
) as v(type, handle, name, status, uploader, weeks_ago, metrics)
on conflict (handle) do nothing;

select count(*) as sources_seeded from sources;
