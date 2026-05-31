import type { Application } from 'express';
import { requireAdminSession } from './admin-auth';
import { logError } from '../lib/http-logging';
import { dailyHighStakesStateRepo, getPgPool } from '../lib/db';
import { getDailyDate, getDailyRunsConfig } from '../lib/daily-runs';

export function registerAdminDailyRunRoutes(app: Application) {
  app.post('/api/admin/daily-runs/reset', async (req, res) => {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return;
    }

    try {
      const config = getDailyRunsConfig();
      if (!config.enabled) {
        return res
          .status(400)
          .json({ error: 'Daily runs feature is currently disabled' });
      }

      const pool = getPgPool();
      const client = await pool.connect();

      try {
        const todayDate = getDailyDate({
          resetHour: config.resetTimeUtcHour,
        });

        const targetAccountId =
          typeof req.body?.playerId === 'string' &&
          req.body.playerId.trim().length > 0
            ? req.body.playerId.trim()
            : session.playerId;

        if (!targetAccountId) {
          return res.status(400).json({ error: 'playerId is required' });
        }

        // Reset today’s state back to the configured attunements and clear active fields.
        await client.query(
          `
            insert into daily_high_stakes_state (
              date,
              account_id,
              remaining_attunements
            )
            values ($1, $2, $3)
            on conflict (date, account_id) do update
              set remaining_attunements = excluded.remaining_attunements,
                  active_difficulty_id = null,
                  active_run_id = null,
                  updated_at = now()
          `,
          [todayDate, targetAccountId, config.attunementsPerDay]
        );

        const state = await dailyHighStakesStateRepo.getState({
          date: todayDate,
          accountId: targetAccountId,
          client,
        });

        res.json({
          ok: true,
          date: todayDate,
          playerId: targetAccountId,
          state,
        });
      } finally {
        client.release();
      }
    } catch (error) {
      logError(error, req);
      res.status(500).json({ error: 'Failed to reset daily runs state' });
    }
  });
}
