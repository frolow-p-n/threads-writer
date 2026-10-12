import type { Config } from "./config.js";

export type HolidayDef = Config["holidays"]["list"][number];
export interface ActiveHoliday {
  def: HolidayDef;
  daysUntil: number; // 0 = сегодня
}

const DAY = 86400_000;

/** Сегодняшняя дата в часовом поясе tz как UTC-полночь (удобно для арифметики дат). */
function todayIn(tz: string, now = new Date()): Date {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Западная Пасха (алгоритм Meeus/Jones/Butcher). */
function easter(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** 4-й четверг ноября. */
function thanksgiving(year: number): Date {
  const first = new Date(Date.UTC(year, 10, 1));
  const offset = (4 - first.getUTCDay() + 7) % 7; // 4 = четверг
  return new Date(Date.UTC(year, 10, 1 + offset + 21));
}

/** Ближайшая пятница 13-го не раньше `from`. */
function friday13(from: Date): Date {
  for (let i = 0; i < 24; i++) {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 13));
    if (d.getUTCDay() === 5 && d >= from) return d;
  }
  return from;
}

/** Ближайшее наступление праздника не раньше `from`. */
export function nextOccurrence(h: HolidayDef, from: Date): Date {
  const y = from.getUTCFullYear();
  const pick = (f: (year: number) => Date) => {
    const d = f(y);
    return d >= from ? d : f(y + 1);
  };
  if (h.rule === "easter") return pick(easter);
  if (h.rule === "thanksgiving") return pick(thanksgiving);
  if (h.rule === "friday13") return friday13(from);
  return pick((year) => new Date(Date.UTC(year, (h.month ?? 1) - 1, h.day ?? 1)));
}

/** Праздники, у которых сейчас «неделя до» (или сам день). */
export function activeHolidays(cfg: Config, now = new Date()): ActiveHoliday[] {
  if (!cfg.holidays.enabled) return [];
  const today = todayIn(cfg.timezone, now);
  return cfg.holidays.list
    .map((def) => ({ def, daysUntil: Math.round((nextOccurrence(def, today).getTime() - today.getTime()) / DAY) }))
    .filter((x) => x.daysUntil >= 0 && x.daysUntil <= x.def.lead_days);
}

/** Решает, будет ли этот пост тематическим: чем ближе праздник, тем вероятнее. */
export function chooseHoliday(cfg: Config, forceId?: string, now = new Date()): ActiveHoliday | undefined {
  if (forceId) {
    const def = cfg.holidays.list.find((h) => h.id === forceId);
    if (!def) throw new Error(`Нет праздника ${forceId}. Доступны: ${cfg.holidays.list.map((h) => h.id).join(", ")}`);
    const d = Math.round((nextOccurrence(def, todayIn(cfg.timezone, now)).getTime() - todayIn(cfg.timezone, now).getTime()) / DAY);
    return { def, daysUntil: d };
  }
  const active = activeHolidays(cfg, now);
  if (!active.length) return undefined;
  // при пересечении праздников предпочитаем ближайший, но не всегда
  const weights = active.map((a) => 1 / (1 + a.daysUntil));
  let r = Math.random() * weights.reduce((s, w) => s + w, 0);
  let chosen = active[active.length - 1];
  for (let i = 0; i < active.length; i++) if ((r -= weights[i]) <= 0) { chosen = active[i]; break; }
  const chance = chosen.daysUntil === 0 ? cfg.holidays.theme_chance_on_day : cfg.holidays.theme_chance_in_window;
  return Math.random() < chance ? chosen : undefined;
}

/** Как сказать про дату в промпте. */
export function whenText(h: ActiveHoliday): string {
  if (h.daysUntil === 0) return "праздник СЕГОДНЯ";
  if (h.daysUntil === 1) return "праздник ЗАВТРА";
  return `до праздника ${h.daysUntil} дн.`;
}
