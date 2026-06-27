-- ============================================================
-- CanWin Team OS — Supabase 数据库 Schema
-- 在 Supabase SQL Editor 中执行此文件
-- ============================================================

-- 1. 团队数据表（键值存储，每行对应一个 Zustand store）
create table if not exists team_data (
  id uuid default gen_random_uuid() primary key,
  team_id text not null,
  table_name text not null,
  data jsonb default '{}'::jsonb,
  updated_at timestamptz default now(),
  unique(team_id, table_name)
);

-- 2. 团队表（记录已创建的团队）
create table if not exists teams (
  id text primary key,
  name text default '',
  created_at timestamptz default now()
);

-- 3. 行级安全：允许公开访问（纯前端 SPA，anon key 可操作）
alter table team_data enable row level security;
alter table teams enable row level security;

create policy "Allow all on team_data" on team_data for all using (true) with check (true);
create policy "Allow all on teams" on teams for all using (true) with check (true);

-- 4. 启用 Realtime（变更实时推送）
alter publication supabase_realtime add table team_data;

-- 5. 索引
create index idx_team_data_team on team_data(team_id);
create index idx_team_data_updated on team_data(updated_at desc);
