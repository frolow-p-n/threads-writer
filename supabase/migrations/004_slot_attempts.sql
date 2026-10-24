-- Стоп-кран от бесконечных повторов генерации (критик бракует, слот пробуется каждый тик до 6 часов).
-- Выполнить один раз в Supabase -> SQL Editor.
alter table tw_schedule add column if not exists attempts int not null default 0;
alter table tw_schedule add column if not exists best_post_id bigint references tw_posts(id);
alter table tw_schedule add column if not exists best_score int;
