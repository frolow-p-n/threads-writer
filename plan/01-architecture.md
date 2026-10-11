# 01. Архитектура

```
[Папка с фото] → [Загрузка в публичное хранилище] → Vision: описание фото (кэш)
                                                         ↓
 persona.md + память постов → Writer (жанр, лимит 500 симв.) → Critic → Publisher → Threads API
                                                         ↑         ↓ (правки, до 2 раз)
 Scheduler (конфиг: постов/день, окна времени) ──────────┘
 Replier: опрос комментариев → классификация → эмодзи / текст / игнор → Critic → ответ
 Collector + Analyst: метрики → рекомендации → веса жанров/времени (см. 03)
 DRY-RUN режим: то же, но вместо публикации — файл или Telegram на одобрение
```

## Компоненты
- **Persona** — `persona.md`: биография, манера речи, любимые темы, табу, 5–10 эталонных постов, правила (длина, эмодзи, язык).
- **Memory** — последние 30–50 постов и сюжеты, чтобы не повторяться.
- **Photo pipeline** — выбор неиспользованного фото, vision-описание (кэш), жанр.
- **Writer** — генерация поста, structured output JSON: `text`, `mood`, `topic`.
- **Critic** — мини-агент, JSON `{score 1-10, issues[], verdict}`; score >= 7 публикуем, иначе до 2 переписываний.
- **Publisher** — Threads API: контейнер (`/threads`, `media_type=IMAGE|TEXT`) -> `/threads_publish`. Картинка только по публичному URL.
- **Scheduler** — конфиг `posts_per_day`, `windows`, `timezone`, `jitter_minutes`, `photo_post_ratio`; тик раз в 15–30 мин.
- **Replier** — опрос ответов, классификатор (`emoji_only`/`short_text`/`ignore`/`escalate`), критик, лимит ответов/час.
- **Collector/Analyst** — см. 03.

## Данные (БД)
- `photos` (id, url, описание, used_at)
- `posts` (id, threads_id, text, genre, topic, type, length, published_at, critic_score, photo_id)
- `post_metrics` (post_id, снимок во времени: views, likes, replies, reposts, quotes, shares)
- `comments` (id, post_id, text, class, reply_text, replied_at)
- `insights` (дата, JSON выводов аналитика)
- `state` (токен, срок токена, стоп-флаг)

## Конфиг (пример)
```yaml
posts_per_day: 3
windows: ["07:30-09:30", "12:00-13:30", "19:00-23:00"]
timezone: America/New_York
jitter_minutes: 25
photo_post_ratio: 1.0
approval_mode: true
models: { writer: gpt-4.1-mini, critic: gpt-4.1-mini, vision: gpt-4o-mini, classifier: gpt-5-nano }
```

## Режимы
`--dry-run` (без публикации, отчёт в `out/review.md`), `approval_mode` (Telegram: одобрить/отклонить), боевой режим.
