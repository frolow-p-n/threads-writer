import { z } from "zod";
import { askJson } from "../llm.js";
import type { Config } from "../config.js";

// Пост приходит абзацами: структура гарантируется схемой, а не надеждой на промпт.
const Schema = z.object({
  paragraphs: z.array(z.string()).min(2).max(4).describe("2-4 коротких абзаца поста; эмодзи внутри абзацев и в конце"),
  mood: z.string().describe("одно-два слова: настроение поста"),
  topic: z.string().describe("одно-два слова: тема/сюжет"),
});
export interface Draft {
  text: string;
  mood: string;
  topic: string;
}

export interface WriteInput {
  persona: string;
  recent: string[];
  genre?: string;          // для постов к фото
  photoDescription?: string;
  topic?: string;          // для текстовых постов
  feedback?: string[];     // замечания критика при переписывании
  previous?: string;
  avoid?: string[];        // образы, которые в последних постах уже встречались слишком часто
  idea?: { hook: string; premise: string; opening: string; device: string; holiday?: string };
}

export async function writePost(cfg: Config, i: WriteInput): Promise<Draft> {
  const system = [
    "Ты автор постов в Threads. Пиши строго от лица персоны, описанной ниже, её голосом и характером.",
    `Длина: от ${cfg.min_post_chars} до ${cfg.max_post_chars} символов ВСЕГО, по всем абзацам вместе (жёсткий лимит, превышение браковается). Ориентир: 3 абзаца, в каждом 1-2 КОРОТКИХ предложения (до 140 символов на абзац), всего около 400 символов, не больше; будь лаконичной, оставляй только завязку, поворот и концовку; 5-8 эмодзи тоже занимают место. Только готовый текст поста, без вступлений вроде «Вот пост:».`,
    "Пиши от первого лица, как будто это случилось с персоной. Обычная капитализация и пунктуация.",
    "Текст отдай в поле paragraphs: 2-4 коротких абзаца (завязка, развитие, поворот или концовка), НЕ одним куском. Никаких тире (—) и хэштегов.",
    "Пиши на том языке, который указан в персоне (если английский, то только на английском).",
    "Избегай штампов ИИ («в мире, где…», избыток тире, пафос, морали в конце).",
    "",
    "=== ПЕРСОНА ===",
    i.persona,
  ].join("\n");

  const parts: string[] = [];
  if (i.photoDescription && i.idea) {
    const lines = [
      `К посту прикреплено фото. Что на нём: ${i.photoDescription}`,
      `Напиши пост по готовому сюжетному замыслу. Фото лишь зацепка: используй только один элемент "${i.idea.hook}" как мостик в историю. Не описывай сцену на фото и не обязана оставаться в её месте: героиня может оказаться где угодно.`,
      `Замысел: ${i.idea.premise}`,
      `Идея первой фразы (можно улучшить): ${i.idea.opening}`,
      `Форма подачи: ${i.idea.device}. Тон: ${i.genre}.`,
      i.idea.holiday ? `Тема праздника: ${i.idea.holiday}. Вплети её естественно, назвав праздник или его атрибуты.` : "",
      "Это настоящая история с завязкой, развитием и поворотом, а не описание картинки. Не начинай с «Once upon a time». Запрещены ходы «посмотрела в зеркало/на экран и увидела странное», отражение, глюк, таинственная записка. Эмодзи по настроению, 5-8 штук, разбросаны по тексту (в конце абзацев и после ключевых моментов), а не кучкой в конце.",
    ];
    parts.push(...lines.filter(Boolean));
  } else if (i.photoDescription) {
    parts.push(
      `К посту прикреплено фото. Что на нём: ${i.photoDescription}`,
      `Напиши выдуманную мини-историю по этому фото от первого лица (на фото сама персона или её окружение). Жанр: ${i.genre}. Это именно история с началом, развитием и неожиданным поворотом или punchline, а не описание картинки: пусть будет событие, интрига или шутка. Используй 2-3 реальные детали фото, остальное придумай, но не добавляй объекты, которых на нём нет. Не начинай с «Once upon a time», без пафоса. Эмодзи по жанру и настроению, 5-8 штук, разбросаны по тексту (в конце абзацев и после ключевых моментов), а не одной кучкой в конце.`,
    );
  } else {
    parts.push(`Напиши текстовый пост без фото. Тема: ${i.topic}.`);
  }
  if (i.recent.length) {
    parts.push(
      "Недавние посты (не повторяй сюжеты, приёмы и начала; абзацы в памяти показаны знаком «/», а ты в ответе используй поле paragraphs):",
      ...i.recent.map((t) => `- ${t.replace(/\n+/g, " / ").slice(0, 160)}`),
    );
  }
  if (i.avoid?.length) {
    parts.push(`В этом посте НЕ используй (они уже надоели в последних постах): ${i.avoid.join("; ")}. Придумай свежую деталь из самого фото, а не из списка привычек персоны.`);
  }
  if (i.feedback?.length) {
    parts.push(`Предыдущая версия:\n${i.previous}`, "Замечания, которые нужно учесть:", ...i.feedback.map((f) => `- ${f}`));
  }
  const r = await askJson({ model: cfg.models.writer, system, user: parts.join("\n"), schema: Schema, schemaName: "draft", maxTokens: 700 });
  // Жёсткая гарантия вместо надежды на промпт: убираем тире в каждом абзаце, абзацы соединяем пустой строкой.
  const text = r.paragraphs
    .map((p) => p.replace(/\s*[—–]\s*/g, ", ").replace(/,\s*,/g, ",").trim())
    .filter(Boolean)
    .join("\n\n");
  return { text, mood: r.mood, topic: r.topic };
}

const TightSchema = z.object({ paragraphs: z.array(z.string()).min(2).max(4) });

/** Сжимает пост до лимита, сохраняя сюжет, поворот, голос и эмодзи. Надёжнее, чем просить писателя «сократи». */
export async function tightenPost(cfg: Config, persona: string, text: string, maxChars: number): Promise<string> {
  const target = maxChars - 40;
  const r = await askJson({
    model: cfg.models.writer,
    system: [
      `Ты редактор. Сократи пост до ${target} символов или меньше (сейчас ${text.length}; считаются и эмодзи). Сохрани сюжет, поворот, концовку, голос персоны и 3 абзаца.`,
      "Убирай второстепенные детали, лишние прилагательные и повторы. Не добавляй ничего нового. Оставь 5-8 эмодзи. Никаких тире (—).",
      "Верни абзацы в поле paragraphs.",
      "",
      "=== ПЕРСОНА ===",
      persona,
    ].join("\n"),
    user: text,
    schema: TightSchema,
    schemaName: "tight",
    maxTokens: 500,
  });
  return r.paragraphs
    .map((p) => p.replace(/\s*[—–]\s*/g, ", ").replace(/,\s*,/g, ",").trim())
    .filter(Boolean)
    .join("\n\n");
}
