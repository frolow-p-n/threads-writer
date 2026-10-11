import { z } from "zod";
import { askJson } from "../llm.js";
import type { Config } from "../config.js";

const Schema = z.object({
  text: z.string(),
  mood: z.string().describe("одно-два слова: настроение поста"),
  topic: z.string().describe("одно-два слова: тема/сюжет"),
});
export type Draft = z.infer<typeof Schema>;

export interface WriteInput {
  persona: string;
  recent: string[];
  genre?: string;          // для постов к фото
  photoDescription?: string;
  topic?: string;          // для текстовых постов
  feedback?: string[];     // замечания критика при переписывании
  previous?: string;
}

export async function writePost(cfg: Config, i: WriteInput): Promise<Draft> {
  const system = [
    "Ты автор постов в Threads. Пиши строго от лица персоны, описанной ниже, её голосом и характером.",
    `Длина: от ${cfg.min_post_chars} до ${cfg.max_post_chars} символов. Только готовый текст поста, без вступлений вроде «Вот пост:».`,
    "Пиши от первого лица, как будто это случилось с персоной. Обычная капитализация и пунктуация, короткие абзацы через пустую строку. Никаких тире (—), хэштегов и стены текста.",
    "Пиши на том языке, который указан в персоне (если английский — только на английском).",
    "Избегай штампов ИИ («в мире, где…», избыток тире, пафос, морали в конце).",
    "",
    "=== ПЕРСОНА ===",
    i.persona,
  ].join("\n");

  const parts: string[] = [];
  if (i.photoDescription) {
    parts.push(
      `К посту прикреплено фото. Что на нём: ${i.photoDescription}`,
      `Напиши выдуманную мини-историю по этому фото от первого лица (на фото сама персона или её окружение). Жанр: ${i.genre}. Это именно история с началом, развитием и неожиданным поворотом или punchline, а не описание картинки: пусть будет событие, интрига или шутка. Используй 2-3 реальные детали фото, остальное придумай, но не добавляй объекты, которых на нём нет. Не начинай с «Once upon a time», без пафоса. Эмодзи по жанру и настроению, 5-8 штук, разбросаны по тексту (в конце абзацев и после ключевых моментов), а не одной кучкой в конце.`,
    );
  } else {
    parts.push(`Напиши текстовый пост без фото. Тема: ${i.topic}.`);
  }
  if (i.recent.length) {
    parts.push("Недавние посты (не повторяй сюжеты, приёмы и начала):", ...i.recent.map((t) => `- ${t.replace(/\n/g, " ").slice(0, 160)}`));
  }
  if (i.feedback?.length) {
    parts.push(`Предыдущая версия:\n${i.previous}`, "Замечания, которые нужно учесть:", ...i.feedback.map((f) => `- ${f}`));
  }
  const draft = await askJson({ model: cfg.models.writer, system, user: parts.join("\n"), schema: Schema, schemaName: "draft", maxTokens: 600 });
  // Жёсткая гарантия вместо надежды на промпт: убираем тире.
  draft.text = draft.text.replace(/\s*[—–]\s*/g, ", ").replace(/,\s*,/g, ",").trim();
  return draft;
}
