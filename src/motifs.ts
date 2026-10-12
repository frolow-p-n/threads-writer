// Повторяющиеся образы: если образ уже был в нескольких последних постах, писателю запрещаем его использовать.
const MOTIFS: { name: string; re: RegExp }[] = [
  { name: "snacks / food (snacks, pizza, bagels)", re: /\b(snacks?|pizza|bagels?|chips|cookies?)\b/i },
  { name: "coffee", re: /\b(coffee|latte|espresso|matcha)\b/i },
  { name: "Kevin the plant", re: /\bkevin\b/i },
  { name: "mirror / reflection", re: /\b(mirror|reflections?)\b/i },
  { name: "glitch / debug jokes", re: /\b(glitch\w*|debug\w*)\b/i },
  { name: "secrets / mystery notes", re: /\b(secrets?|mysterious)\b/i },
  { name: "plot twist", re: /\bplot twist\b/i },
  { name: "detective / clue wording", re: /\b(detective\w*|clues?)\b/i },
];

/** Какие образы встречаются минимум в `minCount` из последних `window` постов (recent: новые первыми). */
export function overusedMotifs(recent: string[], window = 8, minCount = 2): string[] {
  const last = recent.slice(0, window);
  return MOTIFS.filter((m) => last.filter((t) => m.re.test(t)).length >= minCount).map((m) => m.name);
}

/** Образы из списка, которые встретились в тексте. */
export function motifsIn(text: string, names: string[]): string[] {
  return MOTIFS.filter((m) => names.includes(m.name) && m.re.test(text)).map((m) => m.name);
}
