// Текущее время «глазами героини»: Нью-Йорк (tz из конфига). Нужно, чтобы тексты не противоречили времени суток.

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night" | "late night";

export interface NyNow {
  weekday: string;     // Monday
  month: string;       // October
  day: number;
  hour: number;        // 0-23
  minute: number;
  clock: string;       // 7:45 PM
  timeOfDay: TimeOfDay;
  season: "winter" | "spring" | "summer" | "autumn";
  text: string;        // готовая строка для промпта
}

export function nyNow(tz: string, now = new Date()): NyNow {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const monthIdx = new Date(`${get("month")} 1, 2000`).getMonth();
  const timeOfDay: TimeOfDay =
    hour < 5 ? "late night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
  const season = monthIdx >= 11 || monthIdx <= 1 ? "winter" : monthIdx <= 4 ? "spring" : monthIdx <= 7 ? "summer" : "autumn";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const clock = `${h12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
  const weekday = get("weekday");
  const month = get("month");
  const day = Number(get("day"));
  const text = `Сейчас в Нью-Йорке: ${weekday}, ${month} ${day}, ${clock} (${timeOfDay}, ${season}).`;
  return { weekday, month, day, hour, minute, clock, timeOfDay, season, text };
}

/** Общее правило для промптов: время суток, день, сезон не должны противоречить реальности. */
export const TIME_RULE =
  "Время суток, день недели, сезон и погода в тексте не должны противоречить времени выше (не пиши «good morning» вечером, «tonight» утром, «snow» летом). Упоминать время необязательно, но если упоминаешь, то верно. Если на фото явно другой свет (например, дневной свет, а сейчас вечер), расскажи это как воспоминание («earlier today», «this afternoon») или не упоминай время.";

/** Явные несовпадения во времени суток: приветствия и «сегодня вечером/утром». Возвращает список замечаний. */
export function timeMismatches(text: string, n: NyNow): string[] {
  const out: string[] = [];
  const t = text.toLowerCase();
  const h = n.hour;
  if (/\bgood morning\b/.test(t) && !(h >= 4 && h < 12)) out.push(`«good morning», а сейчас ${n.timeOfDay} (${n.clock})`);
  if (/\bgood afternoon\b/.test(t) && !(h >= 12 && h < 18)) out.push(`«good afternoon», а сейчас ${n.timeOfDay} (${n.clock})`);
  if (/\bgood evening\b/.test(t) && !(h >= 16 && h < 23)) out.push(`«good evening», а сейчас ${n.timeOfDay} (${n.clock})`);
  if (/\b(good night|tonight)\b/.test(t) && h >= 5 && h < 16) out.push(`«good night/tonight», а сейчас ${n.timeOfDay} (${n.clock})`);
  if (/\b(this morning)\b/.test(t) && h >= 5 && h < 9) out.push(`«this morning» слишком рано говорить в ${n.clock}: лучше «right now»`);
  const wrongSeason: Record<string, RegExp> = {
    summer: /\b(snow|snowing|snowy|blizzard|frost)\b/,
    winter: /\b(heatwave|sunburn|beach day)\b/,
  };
  const re = wrongSeason[n.season];
  if (re && re.test(t)) out.push(`упоминание погоды, не подходящей сезону (${n.season})`);
  return out;
}
