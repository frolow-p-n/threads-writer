# 07. Эксплуатация

Репозиторий: https://github.com/frolow-p-n/threads-writer (приватный). Аккаунт Threads: `@danya_in.beta`.

## Как это работает
Каждые 30 минут GitHub Actions (`.github/workflows/tick.yml`) запускает `tick`:
1. если на сегодня (по Нью-Йорку) нет слотов, создаёт их: по одному случайному времени в каждом окне из `config.yaml`;
2. для слота, время которого пришло, генерирует пост (до 3 попыток критика), публикует и отмечает слот выполненным;
3. слот, опоздавший более чем на 3 часа, пропускается;
4. токен Threads продлевается автоматически, когда до конца остаётся менее 20 дней.

Состояние (посты, фото, слоты, токен, пауза) живёт в Supabase, таблицы `tw_*` (схема в `supabase/schema.sql`).

## Команды (из папки проекта)
| Команда | Что делает |
|---|---|
| `npm run dry-run -- --n 3` | Сгенерировать черновики (draft), ничего не публикуя; отчёт `out/review.md`. Фото не расходуются |
| `npm run cli -- publish --id N` | Опубликовать черновик или одобренный пост по id |
| `npm run cli -- tick` | Один тик планировщика (как в GitHub). С `--dry` только показывает, что бы сделал |
| `npm run cli -- plan-day` | Пример случайных слотов на сегодня |
| `npm run cli -- pause --on 1` | Поставить агента на паузу (действует сразу и в GitHub) |
| `npm run cli -- pause --on 0` | Снять паузу |
| `npm run cli -- upload-photos` | Сжать и загрузить новые фото из `photos/` в Supabase |
| `npm run cli -- threads-check` | Проверить токен и аккаунт Threads |
| `npm run typecheck` | Проверка типов |

## GitHub
```bash
gh workflow run tick.yml --repo frolow-p-n/threads-writer -f dry=true    # холостой прогон
gh workflow run tick.yml --repo frolow-p-n/threads-writer                # боевой прогон вручную
gh run list --repo frolow-p-n/threads-writer --limit 5                   # последние запуски
gh run view <run-id> --repo frolow-p-n/threads-writer --log              # лог запуска
gh workflow disable tick.yml --repo frolow-p-n/threads-writer            # выключить расписание полностью
gh workflow enable tick.yml --repo frolow-p-n/threads-writer             # включить обратно
```
Секреты: `OPENAI_API_KEY`, `THREADS_ACCESS_TOKEN`, `THREADS_USER_ID`, `THREADS_TOKEN_EXPIRES`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET`. Менять: `gh secret set ИМЯ --repo frolow-p-n/threads-writer`.
Если запуск упал, GitHub присылает письмо.

## Типовые задачи
- **Добавить фото:** положить файлы в `photos/` (png/jpg/webp), выполнить `npm run cli -- upload-photos`. Агент берёт случайное неиспользованное; когда все использованы, самое давно использованное.
- **Изменить частоту или время:** `config/config.yaml` (`posts_per_day`, `windows`, `timezone`), затем `git push`. Слоты текущего дня уже созданы и не пересчитываются.
- **Изменить характер, тон, эмодзи:** `persona/persona.md` и промпты в `src/agents/writer.ts`, `critic.ts`, затем `git push`. Проверить через `dry-run`.
- **Изменить жанры/веса:** `genres` в `config/config.yaml`.
- **Остановить на время:** `pause --on 1`. **Навсегда:** `gh workflow disable`.
- **Удалить плохой пост:** вручную в приложении Threads (API-удаление не реализовано).

## Токен Threads
Живёт 60 дней, продлевается сам (в `tw_state`: `threads_token`, `threads_token_expires`). Если агент простоял долго и токен умер: в консоли разработчика Meta, **Use cases, Access the Threads API, Settings, User Token Generator**, сгенерировать новый, обновить секрет `THREADS_ACCESS_TOKEN` и очистить ключи `threads_token` и `threads_token_expires` в таблице `tw_state`.

## Локальная настройка
`.env` (в git не попадает), образец `.env.example`: `OPENAI_API_KEY`, `THREADS_ACCESS_TOKEN`, `THREADS_USER_ID`, `THREADS_TOKEN_EXPIRES`, `SUPABASE_URL` (корень проекта, без `/rest/v1`), `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET` (регистр как у бакета). Установка: `npm install`.

## Расходы
OpenAI: около $0.01 за пост (3-4 вызова), около $0.5 в месяц при 2 постах в день. GitHub Actions: около 1000 из 2000 бесплатных минут. Supabase: фото около 200 КБ каждое, 1 ГБ бесплатно.

## Если что-то не работает
| Симптом | Причина / решение |
|---|---|
| `Supabase upload ... PGRST125` | В `SUPABASE_URL` лишний хвост `/rest/v1/` |
| Threads `code 452 Session key invalid` | Токен просрочен или отозван, см. раздел про токен |
| Пост не вышел в слот | Критик забраковал 3 попытки (слот ждёт следующий тик), либо опоздание больше 3 часов, либо включена пауза |
| `git push` отклонён из-за workflow | Нужен scope `workflow`: `gh auth refresh -h github.com -s workflow` |
| `У фото нет public_url` | Сначала `upload-photos` |
