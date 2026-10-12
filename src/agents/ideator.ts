import { z } from "zod";
import { askJson } from "../llm.js";
import type { Config } from "../config.js";

const Schema = z.object({
  hook: z.string().describe("ОДНА зацепка из фото: поза, предмет, цвет, одежда, место, свет. Коротко."),
  premise: z.string().describe("Сюжетный замысел в ОДНОМ-ДВУХ коротких предложениях (до 200 символов): где, что случилось, какой поворот."),
  opening: z.string().describe("Первая фраза поста, цепляющая и необычная, на английском."),
});
export type Idea = z.infer<typeof Schema>;

export interface IdeaInput {
  persona: string;
  photoDescription: string;
  setting: string;            // мир/ситуация (кубик)
  twist: string;              // поворот (кубик)
  device: string;             // форма подачи (кубик)
  mode: "fantasy" | "grounded";
  tone: string;               // жанр как тон (funny, creepy, flirty...)
  holiday?: { name: string; theme: string; when: string };
  recentTopics: string[];
}

/** Придумывает сюжетный замысел. Фото служит лишь зацепкой, сюжет может уйти куда угодно. */
export async function ideate(cfg: Config, i: IdeaInput): Promise<Idea> {
  const system = [
    "Ты креативный директор аккаунта в Threads. Придумай ОРИГИНАЛЬНЫЙ сюжетный замысел для короткого поста героини (персона ниже).",
    "Фото это только ЗАЦЕПКА: возьми из него ровно один мелкий элемент (поза, предмет, цвет, одежда, свет, место) как мостик. Сам сюжет НЕ должен описывать сцену на фото и необязательно происходит в том же месте. Героиню можно перенести куда угодно.",
    "Запрещены банальные ходы: «посмотрела в зеркало/на экран/ноутбук/телефон и увидела что-то странное», отражение, сообщение от самой себя, глюк, таинственная записка, «будто кто-то смотрит». Не пересказывай фото.",
    "Замысел должен быть конкретным и неожиданным: у сюжета есть цель, препятствие и поворот. Придумай то, что подписчик не угадает с первой строки.",
    "Следуй заданным «кубикам» (мир, поворот, форма), но творчески, не буквально, и подгони под героиню.",
    "Не повторяй недавние замыслы.",
    "",
    "=== ПЕРСОНА ===",
    i.persona,
  ].join("\n");

  const user = [
    `Что на фото: ${i.photoDescription}`,
    i.mode === "fantasy"
      ? `Режим: УХОД В ДРУГОЙ МИР. Мир: ${i.setting}.`
      : `Режим: ЕЁ ЖИЗНЬ с неожиданным поворотом. Ситуация: ${i.setting}.`,
    `Поворот: ${i.twist}.`,
    `Форма подачи: ${i.device}.`,
    `Тон: ${i.tone}.`,
    i.holiday ? `ТЕМА ПРАЗДНИКА: ${i.holiday.name} (${i.holiday.when}). ${i.holiday.theme}. Вплети праздник в сюжет естественно.` : "",
    i.recentTopics.length ? `Недавние замыслы (не повторять):\n${i.recentTopics.slice(0, 12).map((t) => `- ${t}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return askJson({
    model: cfg.models.writer,
    system,
    user,
    schema: Schema,
    schemaName: "idea",
    maxTokens: 450,
    temperature: 1.1,
  });
}
