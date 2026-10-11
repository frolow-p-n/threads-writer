-- ThreadsWriter: таблицы агента. Выполнить один раз в Supabase -> SQL Editor.
-- Префикс tw_ чтобы не пересекаться с вашими существующими таблицами.

create table if not exists tw_photos (
  id bigint generated always as identity primary key,
  path text unique,                 -- локальный путь (только для загрузки)
  public_url text,
  description text,
  used_at timestamptz
);

create table if not exists tw_posts (
  id bigint generated always as identity primary key,
  threads_id text,
  status text not null,             -- draft | rejected | approved | published
  type text not null,               -- text | photo
  text text not null,
  genre text, topic text, mood text,
  length int, critic_score int, revisions int default 0,
  photo_id bigint references tw_photos(id),
  created_at timestamptz default now(),
  published_at timestamptz
);

create table if not exists tw_post_metrics (
  id bigint generated always as identity primary key,
  post_id bigint not null references tw_posts(id),
  captured_at timestamptz default now(),
  views int, likes int, replies int, reposts int, quotes int, shares int
);

create table if not exists tw_comments (
  id text primary key,
  post_id bigint references tw_posts(id),
  text text, class text, reply_text text, replied_at timestamptz
);

create table if not exists tw_insights (
  id bigint generated always as identity primary key,
  created_at timestamptz default now(),
  json jsonb not null
);

-- ключ-значение: токен Threads, срок, стоп-флаг и т.п.
create table if not exists tw_state (
  key text primary key,
  value text
);

-- слоты публикаций: на каждый день заранее выбранное время
create table if not exists tw_schedule (
  id bigint generated always as identity primary key,
  day date not null,                -- дата по Нью-Йорку
  slot_at timestamptz not null,
  post_id bigint references tw_posts(id),
  done_at timestamptz,
  skipped boolean default false,
  unique (day, slot_at)
);

-- Закрываем доступ публичным (anon) ключом: работает только service_role.
alter table tw_photos enable row level security;
alter table tw_posts enable row level security;
alter table tw_post_metrics enable row level security;
alter table tw_comments enable row level security;
alter table tw_insights enable row level security;
alter table tw_state enable row level security;
alter table tw_schedule enable row level security;
