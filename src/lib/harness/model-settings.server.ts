import { getSql } from "@/lib/db";
import { defaultModelSettings, parseModelSettings } from "./spec";
import type { ModelSettings } from "./types";

export async function readModelSettings(userId: string): Promise<ModelSettings> {
  const sql = await getSql();
  const rows = await sql.query<{ settings: ModelSettings | string }>(
    "select settings from neural_loom_model_settings where user_id = $1",
    [userId],
  );
  if (!rows.length) return defaultModelSettings();
  const value =
    typeof rows[0].settings === "string"
      ? (JSON.parse(rows[0].settings) as unknown)
      : rows[0].settings;
  return parseModelSettings(value);
}

export async function writeModelSettings(userId: string, value: unknown): Promise<ModelSettings> {
  const settings = parseModelSettings(value);
  const sql = await getSql();
  await sql.query(
    `insert into neural_loom_model_settings (user_id, settings, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (user_id) do update
     set settings = excluded.settings, updated_at = excluded.updated_at`,
    [userId, JSON.stringify(settings)],
  );
  return settings;
}
