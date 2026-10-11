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
}): Promise<T> {
  const res = await openai().chat.completions.parse({
    model: opts.model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    response_format: zodResponseFormat(opts.schema, opts.schemaName),
    max_completion_tokens: opts.maxTokens ?? 800,
  });
  usage.input += res.usage?.prompt_tokens ?? 0;
  usage.output += res.usage?.completion_tokens ?? 0;
  const parsed = res.choices[0]?.message.parsed;
  if (!parsed) throw new Error(`Пустой/отклонённый ответ модели ${opts.model}: ${res.choices[0]?.message.refusal ?? "?"}`);
  return parsed;
}
