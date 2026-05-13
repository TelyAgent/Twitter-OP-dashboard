-- 02-radar.html · 7 条热点 + FOMC 详情 seed
-- 一次性运行, 幂等 (on conflict do update)
--
-- 跑完后:
--   - 7 条 hotspots
--   - 最热的 hs_fomc_odds 含完整 intel (摘要 / 3 关键事实 / 机会切入 / 分歧 / 时间线) + 9 条推文
--   - 其余 6 条只有 title / category / status / score

insert into hotspots (id, title, category, status, score, hot_signal, metrics, intel, tweets) values

-- 1. 链上 smart money cluster (HOT)
('hs_wallets_yes', '3 个胜率 ≥70% 钱包 6h 内押 $691k YES', 'C', 'hot', 5, true,
  '{"talk_accounts":156,"engagements":8200,"detected_min":4}'::jsonb,
  '{}'::jsonb, '[]'::jsonb),

-- 2. FOMC 赔率跳动 (selected default, 完整数据)
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

-- 3. AI 监管合约 (HOT)
('hs_poly_ai_reg', 'Polymarket 新合约 "AI 监管法案 Q1 通过"', 'D', 'hot', 4, true,
  '{"talk_accounts":189,"engagements":9600,"detected_min":8}'::jsonb,
  '{}'::jsonb, '[]'::jsonb),

-- 4. Vision Pro 发布会
('hs_vision_pro', '苹果 Vision Pro 二代发布会赔率剧变', 'E', 'pool', 3, false,
  '{"talk_accounts":412,"engagements":15800,"detected_min":23}'::jsonb,
  '{}'::jsonb, '[]'::jsonb),

-- 5. Trump 媒体股 (HOT)
('hs_trump_media', 'Trump 媒体股大额钱包异动', 'C', 'hot', 4, true,
  '{"talk_accounts":91,"engagements":5400,"detected_min":26}'::jsonb,
  '{}'::jsonb, '[]'::jsonb),

-- 6. SBF 上诉
('hs_sbf_appeal', 'SBF 上诉判决相关合约成交激增', 'A', 'pool', 3, false,
  '{"talk_accounts":167,"engagements":4200,"detected_min":38}'::jsonb,
  '{}'::jsonb, '[]'::jsonb),

-- 7. Kalshi 新合约
('hs_kalshi_fed', 'Kalshi 上线美联储利率新合约', 'D', 'pool', 2, false,
  '{"talk_accounts":89,"engagements":1900,"detected_min":52}'::jsonb,
  '{}'::jsonb, '[]'::jsonb)

on conflict (id) do update set
  title = excluded.title,
  category = excluded.category,
  status = excluded.status,
  score = excluded.score,
  hot_signal = excluded.hot_signal,
  metrics = excluded.metrics,
  intel = excluded.intel,
  tweets = excluded.tweets,
  updated_at = now();

-- 校验
select id, title, category, status, score, hot_signal,
       (metrics->>'talk_accounts')::int as talk,
       (metrics->>'engagements')::int as eng,
       jsonb_array_length(coalesce(tweets,'[]'::jsonb)) as tweet_count,
       coalesce(intel->>'summary','') != '' as has_intel
  from hotspots
  order by score desc, hot_signal desc;
