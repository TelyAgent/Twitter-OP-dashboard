-- Pallax v3 migration: strip analysis logic from Supabase.
-- Run in Supabase SQL Editor against the current project.
-- All analysis (scoring, classification, template stats) now runs via DeepSeek API.

-- 1. Drop analysis trigger and function
drop trigger if exists trg_template_uses_bump on template_uses;
drop function if exists bump_template_stats();

-- 2. Drop analysis views
drop view if exists v_weekly_hotspot_stats;
drop view if exists v_template_perf;
drop view if exists v_source_contribution;

-- 3. Switch RLS from authenticated to anon (no login required)
--    First drop existing policies, then recreate for anon
drop policy if exists "auth read profiles"  on user_profiles;
drop policy if exists "auth all sources"    on sources;
drop policy if exists "auth all hotspots"   on hotspots;
drop policy if exists "auth all templates"  on templates;
drop policy if exists "auth all tpl uses"   on template_uses;
drop policy if exists "self update profile" on user_profiles;
drop policy if exists "self insert profile" on user_profiles;

-- profiles: all users (including anon) can read; insert/update is unrestricted locally
create policy "anon all profiles"  on user_profiles for all to anon using (true) with check (true);

-- business tables: full anon access
create policy "anon all sources"   on sources       for all to anon using (true) with check (true);
create policy "anon all hotspots"  on hotspots      for all to anon using (true) with check (true);
create policy "anon all templates" on templates     for all to anon using (true) with check (true);
create policy "anon all tpl uses"  on template_uses for all to anon using (true) with check (true);

-- v1 dashboard tables: switch to anon (were authenticated-only)
drop policy if exists "auth all teams"    on teams;
drop policy if exists "auth all schemas"  on team_schemas;
drop policy if exists "auth all api"      on team_api_configs;
drop policy if exists "auth all weekly"   on weekly_data;

create policy "anon all teams"    on teams            for all to anon using (true) with check (true);
create policy "anon all schemas"  on team_schemas     for all to anon using (true) with check (true);
create policy "anon all api"      on team_api_configs for all to anon using (true) with check (true);
create policy "anon all weekly"   on weekly_data      for all to anon using (true) with check (true);
