-- Надёжный запуск workflow: Supabase каждые 15 минут дёргает GitHub API (workflow_dispatch).
-- Причина: встроенный cron GitHub Actions срабатывает с задержкой в часы.
-- Выполнить в Supabase -> SQL Editor. Перед запуском замените ВСТАВЬТЕ_ТОКЕН на fine-grained токен GitHub
-- (только репозиторий threads-writer, право Actions: Read and write). Токен сохранится в Vault (зашифрованно).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('ВСТАВЬТЕ_ТОКЕН', 'github_dispatch_token');

select cron.schedule(
  'tw-dispatch',
  '*/15 * * * *',
  $$
  select net.http_post(
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
  $$
);

-- Остановить: select cron.unschedule('tw-dispatch');
-- Посмотреть ответы GitHub (204 = запуск принят): select status_code, created from net._http_response order by created desc limit 5;
-- Посмотреть запуски cron: select * from cron.job_run_details order by start_time desc limit 5;
