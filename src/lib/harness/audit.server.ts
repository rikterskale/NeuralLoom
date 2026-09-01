import { getSql } from "@/lib/db";
import type { HarnessRun } from "./types";
import { redactRunForAudit } from "./audit-redaction";

export async function saveRun(userId: string, run: HarnessRun): Promise<void> {
  const sql = await getSql();
  const safe = redactRunForAudit(run);
  await sql.query(
    `insert into neural_loom_runs (id, user_id, created_at, payload)
     values ($1, $2, $3, $4::jsonb)
     on conflict (id) do update set payload = excluded.payload`,
    [safe.id, userId, safe.createdAt, JSON.stringify(safe)],
  );
}

export async function readRuns(userId: string): Promise<HarnessRun[]> {
  const sql = await getSql();
  const rows = await sql.query<{ payload: HarnessRun | string }>(
    `select payload from neural_loom_runs
     where user_id = $1 order by created_at desc limit 80`,
    [userId],
  );
  return rows.map(({ payload }) =>
    typeof payload === "string" ? (JSON.parse(payload) as HarnessRun) : payload,
  );
}

export async function deleteRuns(userId: string): Promise<void> {
  const sql = await getSql();
  await sql.query("delete from neural_loom_runs where user_id = $1", [userId]);
}
