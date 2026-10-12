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
  models: z.object({ vision: z.string(), writer: z.string(), story: z.string(), critic: z.string(), classifier: z.string() }),
  replies: z.object({
    enabled: z.boolean(),
    max_per_day: z.number(),
    max_per_run: z.number(),
    delay_min: z.number(),
    delay_max: z.number(),
    reaction_reply_chance: z.number().min(0).max(1),
    max_replies_per_user_per_post: z.number(),
    lookback_days: z.number(),
    reply_max_chars: z.number(),
  }),
  fantasy_ratio: z.number().min(0).max(1),
  holidays: z.object({
    enabled: z.boolean(),
    theme_chance_in_window: z.number().min(0).max(1),
    theme_chance_on_day: z.number().min(0).max(1),
    list: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        month: z.number().optional(),
        day: z.number().optional(),
        rule: z.enum(["easter", "thanksgiving", "friday13"]).optional(),
        lead_days: z.number(),
        theme: z.string(),
      }),
    ),
  }),
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
