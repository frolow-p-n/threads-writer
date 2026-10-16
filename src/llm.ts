import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { ZodType } from "zod";

let client: OpenAI | undefined;
const openai = () => (client ??= new OpenAI());

export interface Usage { input: number; output: number }
export const usage: Usage = { input: 0, output: 0 };

type Content = string | OpenAI.Chat.ChatCompletionContentPart[];

/** Вызов модели со структурированным ответом (JSON по zod-схеме). */
export async function askJson<T>(opts: {
  model: string;
  system: string;
  user: Content;
  schema: ZodType<T>;
  schemaName: string;
  maxTokens?: number;
  temperature?: number; // выше = креативнее; не для моделей, которые его не поддерживают
}): Promise<T> {
  // Новые модели тратят часть лимита на скрытые рассуждения: даём большой запас (платим только за использованное).
  const base = Math.max(1500, (opts.maxTokens ?? 800) * 6);
  const call = (temperature: number | undefined, budget: number) =>
    openai().chat.completions.parse({
      model: opts.model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      response_format: zodResponseFormat(opts.schema, opts.schemaName),
      max_completion_tokens: budget,
      ...(temperature !== undefined ? { temperature } : {}),
    });
  const isLength = (e: unknown) => /length limit|max_tokens|output limit/i.test((e as Error).message);
  let temperature = opts.temperature;
  let budget = base;
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await call(temperature, budget);
      break;
    } catch (e) {
      const msg = (e as Error).message;
      if (temperature !== undefined && /temperature/i.test(msg)) temperature = undefined; // модель принимает только значение по умолчанию
      else if (isLength(e) && attempt < 3) budget *= 2; // не хватило: повторяем с удвоенным лимитом
      else throw new Error(`[${opts.schemaName} / ${opts.model}] ${msg}`);
    }
  }
  usage.input += res.usage?.prompt_tokens ?? 0;
  usage.output += res.usage?.completion_tokens ?? 0;
  const parsed = res.choices[0]?.message.parsed;
  if (!parsed) throw new Error(`Пустой/отклонённый ответ модели ${opts.model}: ${res.choices[0]?.message.refusal ?? "?"}`);
  return parsed;
}
