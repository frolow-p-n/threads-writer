import type { Config } from "./config.js";
import { addSlots, getState, slotsForDay, updateSlot } from "./store.js";
import { generatePost } from "./pipeline.js";
import { publishApproved } from "./publisher.js";
import { notify } from "./notify.js";

const GRACE_MS = 3 * 3600_000; // слот старше 3 часов пропускаем, а не публикуем «с опозданием»

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

/** Один тик планировщика: создаёт слоты дня и публикует то, что подошло по времени. */
export async function tick(cfg: Config, persona: string, opts: { dry?: boolean } = {}) {
  if ((await getState("paused")) === "1") return console.log("Агент на паузе (tw_state.paused=1)");
  const day = dayIn(cfg.timezone);
  let slots = await slotsForDay(day);
  if (!slots.length) {
    await addSlots(day, planDay(cfg, day));
    slots = await slotsForDay(day);
    console.log(`Слоты на ${day}: ` + slots.map((s) => s.slot_at).join(", "));
  }
  const now = Date.now();
  let acted = 0;
  for (const s of slots) {
    if (s.done_at || s.skipped) continue;
    const at = new Date(s.slot_at).getTime();
    if (at > now) continue;
    if (now - at > GRACE_MS) { await updateSlot(s.id, { skipped: true }); console.log(`Слот ${s.slot_at} пропущен (опоздание > 3 ч)`); await notify(`⚠️ Слот ${s.slot_at} пропущен (опоздание больше 3 часов)`); continue; }
    if (opts.dry) { console.log(`[dry] подошёл слот ${s.slot_at}: сгенерировал бы и опубликовал пост`); acted++; continue; }

    let postId: number | undefined;
    let lastIssues: string[] = [];
    let lastScore = 0;
    for (let attempt = 1; attempt <= 3 && !postId; attempt++) {
      const r = await generatePost(cfg, persona, "photo");
      console.log(`Попытка ${attempt}: ${r.status}, score ${r.score}`);
      lastIssues = r.issues; lastScore = r.score;
      if (r.status === "approved") postId = r.postId;
    }
    if (!postId) { console.warn("Критик не пропустил ни одну из 3 попыток; слот остаётся на следующий тик");
      const why = lastIssues.slice(0, 3).map((x) => "- " + x).join("\n");
      await notify(`⚠️ Критик забраковал 3 попытки (последняя оценка ${lastScore}). Слот ${s.slot_at} повторится на следующем запуске.\n${why}`);
      continue; }
    const link = await publishApproved(postId);
    await updateSlot(s.id, { post_id: postId, done_at: new Date().toISOString() });
    console.log(`Опубликовано: ${link}`);
    await notify(`✅ Опубликован пост\n${link}`);
    acted++;
  }
  if (!acted) console.log("Сейчас публиковать нечего");
}
