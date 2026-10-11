import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";

const Config = z.object({
  posts_per_day: z.number(),
  windows: z.array(z.string()),
  timezone: z.string(),
  jitter_minutes: z.number(),
  photo_post_ratio: z.number().min(0).max(1),
  min_post_chars: z.number(),
  max_post_chars: z.number(),
  critic_min_score: z.number(),
  max_revisions: z.number(),
  memory_size: z.number(),
  models: z.object({ vision: z.string(), writer: z.string(), critic: z.string() }),
  genres: z.array(z.object({ id: z.string(), name: z.string(), weight: z.number() })),
  topics: z.array(z.string()),
});
export type Config = z.infer<typeof Config>;

export function loadConfig(path = "config/config.yaml"): Config {
  return Config.parse(parse(readFileSync(path, "utf8")));
}

export function loadPersona(path = "persona/persona.md"): string {
  return readFileSync(path, "utf8");
}
