-- ============================================================
-- SON KİŞİ — Supabase Database Schema
-- Run this SQL in your Supabase Project's SQL Editor.
-- ============================================================

-- 1. Profiles table (linked to Supabase Auth users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 2 and 20),
  avatar_id text not null default 'cat',
  total_points integer not null default 0,
  total_wins integer not null default 0,
  total_games integer not null default 0,
  current_streak integer not null default 0,
  best_streak integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Match results table (every finished game per authenticated player)
create table if not exists public.match_results (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  room_code text not null,
  placement integer not null check (placement >= 1),
  total_players integer not null check (total_players >= 1),
  rounds_survived integer not null default 0,
  points_earned integer not null default 0,
  won boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_match_results_created_at on public.match_results(created_at desc);
create index if not exists idx_match_results_user_id on public.match_results(user_id);
create index if not exists idx_profiles_total_points on public.profiles(total_points desc);
create index if not exists idx_profiles_total_wins on public.profiles(total_wins desc);
create index if not exists idx_profiles_best_streak on public.profiles(best_streak desc);

-- 3. Automatic profile update function when a match result is recorded
create or replace function public.record_match_result(
  p_room_code text,
  p_placement integer,
  p_total_players integer,
  p_rounds_survived integer,
  p_points_earned integer,
  p_won boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  insert into public.match_results (
    user_id, room_code, placement, total_players, rounds_survived, points_earned, won
  ) values (
    v_uid, p_room_code, p_placement, p_total_players, p_rounds_survived, p_points_earned, p_won
  );

  update public.profiles
  set
    total_points = total_points + greatest(0, p_points_earned),
    total_games = total_games + 1,
    total_wins = total_wins + case when p_won then 1 else 0 end,
    current_streak = case when p_won then current_streak + 1 else 0 end,
    best_streak = case when p_won then greatest(best_streak, current_streak + 1) else best_streak end,
    updated_at = now()
  where id = v_uid;
end;
$$;

-- 4. Leaderboard Views
create or replace view public.leaderboard_all_time as
select
  p.id,
  p.username,
  p.avatar_id,
  p.total_points as score,
  p.total_wins as wins,
  p.total_games as games,
  p.best_streak as streak
from public.profiles p
where p.total_games > 0
order by p.total_points desc, p.total_wins desc
limit 100;

create or replace view public.leaderboard_most_wins as
select
  p.id,
  p.username,
  p.avatar_id,
  p.total_points as score,
  p.total_wins as wins,
  p.total_games as games,
  p.best_streak as streak
from public.profiles p
where p.total_wins > 0
order by p.total_wins desc, p.total_points desc
limit 100;

create or replace view public.leaderboard_best_streak as
select
  p.id,
  p.username,
  p.avatar_id,
  p.total_points as score,
  p.total_wins as wins,
  p.total_games as games,
  p.best_streak as streak
from public.profiles p
where p.best_streak > 0
order by p.best_streak desc, p.total_wins desc
limit 100;

create or replace view public.leaderboard_daily as
select
  p.id,
  p.username,
  p.avatar_id,
  sum(m.points_earned)::integer as score,
  count(*) filter (where m.won)::integer as wins,
  count(*)::integer as games,
  p.best_streak as streak
from public.match_results m
join public.profiles p on p.id = m.user_id
where m.created_at >= now() - interval '24 hours'
group by p.id, p.username, p.avatar_id, p.best_streak
order by score desc, wins desc
limit 100;

create or replace view public.leaderboard_weekly as
select
  p.id,
  p.username,
  p.avatar_id,
  sum(m.points_earned)::integer as score,
  count(*) filter (where m.won)::integer as wins,
  count(*)::integer as games,
  p.best_streak as streak
from public.match_results m
join public.profiles p on p.id = m.user_id
where m.created_at >= now() - interval '7 days'
group by p.id, p.username, p.avatar_id, p.best_streak
order by score desc, wins desc
limit 100;

-- 5. Row Level Security (RLS)
alter table public.profiles enable row level security;
alter table public.match_results enable row level security;

-- Everyone can read public profiles & match results for leaderboards
create policy "Profiles are publicly readable"
  on public.profiles for select
  using (true);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Match results are publicly readable"
  on public.match_results for select
  using (true);

create policy "Users can insert their own match results"
  on public.match_results for insert
  with check (auth.uid() = user_id);
