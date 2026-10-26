-- Снижает частоту тика (минуты GitHub Actions почти исчерпаны: 1480 запусков за 16 дней)
-- и не дёргает GitHub вовсе в часы сна героини (01:00-08:00 по Нью-Йорку, с учётом перехода на
-- летнее/зимнее время через AT TIME ZONE, без ручного пересчёта в UTC).
-- Выполнить один раз в Supabase -> SQL Editor.

select cron.unschedule('tw-dispatch');

select cron.schedule(
  'tw-dispatch',
  '*/30 * * * *',
  $$
  DO $do$
  BEGIN
    IF EXTRACT(HOUR FROM (now() AT TIME ZONE 'America/New_York')) NOT BETWEEN 1 AND 7 THEN
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

-- Проверить расписание: select * from cron.job where jobname = 'tw-dispatch';
-- Проверить, что ночью запросы к GitHub не уходят: select status_code, created from net._http_response order by created desc limit 20;
