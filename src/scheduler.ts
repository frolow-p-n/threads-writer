import type { Config } from "./config.js";
import { addSlots, getState, pendingSlots, promoteToApproved, setState, slotsForDay, updateSlot } from "./store.js";
import { getToken } from "./publisher.js";
import { getMe } from "./threads.js";
import { generatePost } from "./pipeline.js";
import { publishApproved } from "./publisher.js";
import { notify } from "./notify.js";

const GRACE_MS = 14 * 3600_000; // слот старше 14 часов пропускаем (с запасом переживает 7ч паузы на сон + время на попытки)
const MAX_ATTEMPTS = 12; // стоп-кран: столько полных генераций на слот максимум, дальше публикуем лучший черновик

/** Дата YYYY-MM-DD в заданном часовом поясе. */
export const dayIn = (tz: string, d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);

/** Локальное время tz (YYYY-MM-DD + minutes от полуночи) -> UTC Date. */
export function zonedToUtc(day: string, minutes: number, tz: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
  }).formatToParts(new Date(guess));
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asLocal = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"));
  return new Date(guess - (asLocal - guess));
}

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

/** Случайные времена публикаций на день: по одному слоту на окно (по кругу), равномерно внутри окна. */
export function planDay(cfg: Config, day: string): Date[] {
  return Array.from({ length: cfg.posts_per_day }, (_, i) => {
    const [a, b] = cfg.windows[i % cfg.windows.length].split("-").map(toMin);
    return zonedToUtc(day, a + Math.floor(Math.random() * (b - a)), cfg.timezone);
  }).sort((x, y) => x.getTime() - y.getTime());
}

/** Уведомление не чаще, чем раз в N часов на ключ (чтобы сбои не засыпали чат). */
async function alertThrottled(key: string, text: string, hours = 6) {
  const last = Number((await getState("alert_" + key)) ?? 0);
  if (Date.now() - last < hours * 3600_000) return;
  await setState("alert_" + key, String(Date.now()));
  await notify(text);
}

/** Один тик планировщика: создаёт слоты дня и публикует то, что подошло по времени. */
export async function tick(cfg: Config, persona: string, opts: { dry?: boolean } = {}) {
  if ((await getState("paused")) === "1") return console.log("Агент на паузе (tw_state.paused=1)");
  const day = dayIn(cfg.timezone);
  let todaySlots = await slotsForDay(day);
  if (!todaySlots.length) {
    await addSlots(day, planDay(cfg, day));
    todaySlots = await slotsForDay(day);
    console.log(`Слоты на ${day}: ` + todaySlots.map((s) => s.slot_at).join(", "));
  }
  // Незавершённые слоты прошлых дней тоже разбираем: иначе просроченный слот, переживший смену
  // календарного дня, навсегда выпадает из вида (slotsForDay смотрит только на сегодня).
  const pending = await pendingSlots();
  const seen = new Set(todaySlots.map((s) => s.id));
  const slots = [...todaySlots, ...pending.filter((s) => !seen.has(s.id))].sort(
    (a, b) => new Date(a.slot_at).getTime() - new Date(b.slot_at).getTime(),
  );
  const now = Date.now();
  let acted = 0;
  for (const s of slots) {
    if (s.done_at || s.skipped) continue;
    const at = new Date(s.slot_at).getTime();
    if (at > now) continue;
    const expired = now - at > GRACE_MS;
    if (expired && !s.best_post_id) {
      // Ни одной попытки не было вообще (например, слот появился прямо перед долгой паузой) — публиковать нечего.
      await updateSlot(s.id, { skipped: true });
      console.log(`Слот ${s.slot_at} пропущен (опоздание > 14 ч, черновиков нет)`);
      await notify(`⚠️ Слот ${s.slot_at} пропущен (опоздание больше 14 часов, ни одного черновика не было).`);
      continue;
    }
    if (opts.dry) { console.log(`[dry] подошёл слот ${s.slot_at}: сгенерировал бы и опубликовал пост`); acted++; continue; }

    // Быстрая проверка API до генерации: если Threads недоступен, ничего не тратим.
    try {
      await getMe(await getToken());
    } catch (e) {
      console.warn("Threads API недоступен:", (e as Error).message);
      await alertThrottled("api", `❌ Threads API недоступен, публикация отложена: ${(e as Error).message}`);
      break;
    }

    // Если для слота пост уже сгенерирован (прошлая публикация упала), публикуем его, а не создаём новый.
    let postId: number | undefined = s.post_id ?? undefined;
    let lastIssues: string[] = [];
    let lastScore = 0;
    let bestPostId = s.best_post_id ?? undefined;
    let bestScore = s.best_score ?? -1;
    let attemptsThisTick = 0;
    const triedSettings: string[] = [];
    const triedShapes: string[] = [];
    // Если время слота уже истекло (14ч), новых попыток не делаем — только публикуем то, что уже есть.
    for (let attempt = 1; attempt <= 3 && !postId && !expired; attempt++) {
      const r = await generatePost(cfg, persona, { forceType: "photo", excludeSettings: triedSettings, excludeShapes: triedShapes });
      attemptsThisTick++;
      console.log(`Попытка ${attempt}: ${r.status}, score ${r.score}`);
      lastIssues = r.issues; lastScore = r.score;
      if (r.setting) triedSettings.push(r.setting);
      if (r.shape) triedShapes.push(r.shape);
      if (r.score > bestScore) { bestScore = r.score; bestPostId = r.postId; }
      if (r.status === "approved") {
        postId = r.postId;
        await updateSlot(s.id, { post_id: postId });
      }
    }
    const totalAttempts = s.attempts + attemptsThisTick;
    await updateSlot(s.id, { attempts: totalAttempts, best_post_id: bestPostId ?? null, best_score: bestScore });

    if (!postId && (totalAttempts >= MAX_ATTEMPTS || expired) && bestPostId) {
      const why = expired ? `время слота истекло (>14ч)` : `лимит попыток (${MAX_ATTEMPTS}) исчерпан`;
      console.warn(`${why}, публикуем лучший черновик (score ${bestScore})`);
      await promoteToApproved(bestPostId);
      postId = bestPostId;
      await updateSlot(s.id, { post_id: postId });
      await notify(`⚠️ Критик так и не одобрил пост (${why}). Публикую лучший черновик (оценка ${bestScore}) без одобрения критика.`);
    }
    if (!postId) {
      console.warn(`Критик не пропустил ни одну из попыток (всего ${totalAttempts}/${MAX_ATTEMPTS}); слот остаётся на следующий тик`);
      const why = lastIssues.slice(0, 3).map((x) => "- " + x).join("\n");
      await notify(`⚠️ Критик забраковал попытки (${totalAttempts}/${MAX_ATTEMPTS}, последняя оценка ${lastScore}). Слот ${s.slot_at} повторится на следующем запуске.\n${why}`);
      continue;
    }
    let link: string;
    try {
      link = await publishApproved(postId);
    } catch (e) {
      console.error("Публикация не удалась:", (e as Error).message);
      await alertThrottled("publish", `❌ Не удалось опубликовать пост ${postId}: ${(e as Error).message}
Повторю на следующем запуске.`, 2);
      continue;
    }
    await updateSlot(s.id, { post_id: postId, done_at: new Date().toISOString() });
    console.log(`Опубликовано: ${link}`);
    await notify(`✅ Опубликован пост\n${link}`);
    acted++;
  }
  if (!acted) console.log("Сейчас публиковать нечего");
  if (!opts.dry) {
    const { replyRound } = await import("./replier.js");
    try {
      await replyRound(cfg, persona);
    } catch (e) {
      console.warn("Ответы на комментарии: ошибка", (e as Error).message); // не роняем запуск из-за комментариев
    }
  }
}
