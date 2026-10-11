import { z } from "zod";
import { askJson } from "../llm.js";
import { setPhotoDescription, type PhotoRow } from "../store.js";
import type { Config } from "../config.js";

const Schema = z.object({
  description: z.string().describe("Фактическое описание: что на фото, детали, обстановка, настроение. 3-6 предложений."),
});

/** Описание фото с кэшем в БД (платим за vision один раз). Модель берёт картинку по публичному URL. */
export async function describePhoto(cfg: Config, photo: PhotoRow): Promise<string> {
  if (photo.description) return photo.description;
  if (!photo.public_url) throw new Error(`У фото ${photo.id} нет public_url: сначала upload-photos`);
  const { description } = await askJson({
    model: cfg.models.vision,
    system: "Ты описываешь фотографии для автора, который напишет по ним историю. Описывай только то, что реально видно. На русском.",
    user: [
      { type: "text", text: "Опиши эту фотографию." },
      { type: "image_url", image_url: { url: photo.public_url, detail: "low" } },
    ],
    schema: Schema,
    schemaName: "photo_description",
    maxTokens: 500,
  });
  await setPhotoDescription(photo.id, description);
  return description;
}
