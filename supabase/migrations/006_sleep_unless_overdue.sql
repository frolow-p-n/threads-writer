-- Часы сна (01:00-08:00 по Нью-Йорку) не должны мешать опубликовать просроченный пост.
-- Теперь пропуск ночного тика действует только если нет ни одного слота, время которого уже
-- наступило, а пост ещё не опубликован и не отмечен пропущенным — иначе тик идёт в любое время.
-- Выполнить один раз в Supabase -> SQL Editor.

select cron.unschedule('tw-dispatch');

select cron.schedule(
  'tw-dispatch',
  '*/30 * * * *',
  $$
  DO $do$
  BEGIN
    IF EXTRACT(HOUR FROM (now() AT TIME ZONE 'America/New_York')) NOT BETWEEN 1 AND 7
       OR EXISTS (
         SELECT 1 FROM tw_schedule
         WHERE post_id IS NULL AND done_at IS NULL AND skipped = false AND slot_at <= now()
       )
    THEN
      PERFORM net.http_post(
        url := 'https://api.github.com/repos/frolow-p-n/threads-writer/actions/workflows/tick.yml/dispatches',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_dispatch_token'),
          'Accept', 'application/vnd.github+json',
          'X-GitHub-Api-Version', '2022-11-28',
          'User-Agent', 'supabase-cron',
          'Content-Type', 'application/json'
        ),
        body := '{"ref":"main"}'::jsonb
      );
    END IF;
  END
  $do$;
  $$
);

-- Проверить: select * from cron.job where jobname = 'tw-dispatch';
