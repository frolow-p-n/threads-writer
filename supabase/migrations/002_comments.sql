-- Стадия 7: поля для ответов на комментарии. Выполнить один раз в Supabase -> SQL Editor.
alter table tw_comments add column if not exists username text;
alter table tw_comments add column if not exists commented_at timestamptz;
alter table tw_comments add column if not exists reply_id text;
alter table tw_comments add column if not exists created_at timestamptz default now();
create index if not exists tw_comments_post_user on tw_comments (post_id, username);
create index if not exists tw_comments_replied on tw_comments (replied_at);
