import type { Application, Request } from 'express';
import { resolveSessionFromRequest } from '../lib/auth/session';
import { logError } from '../lib/http-logging';
import {
  dailyHighStakesStateRepo,
  type DailyHighStakesStateRecord,
} from '../lib/db';
import {
  getDailyRunsConfig,
  getDailyDate,
  getDifficultyBand,
  getReferenceScore,
  isDifficultyValid,
  normalizeDifficultyId,
} from '../lib/daily-runs';

async function getSessionPlayerId(req: Request): Promise<string | null> {
  const resolved = await resolveSessionFromRequest(req);
  return resolved?.playerId ?? null;
}

function buildResponsePayload(input: {
  date: string;
  difficultyId: string;
  state: DailyHighStakesStateRecord;
  referenceScore: number;
  referenceDate: string;
  referenceSource: 'yesterday' | 'baseline';
  thresholdScore: number;
  thresholdFraction: number;
}) {
  const config = getDailyRunsConfig();
  const band = getDifficultyBand(input.difficultyId);
  const caps = config.maxPayoutPerDifficulty[band] ?? { USDC: 0, GHST: 0 };

  return {
    date: input.date,
    difficultyId: input.difficultyId,
    remainingAttunements: input.state.remainingAttunements,
    attunementsPerDay: config.attunementsPerDay,
    activeDifficultyId: input.state.activeDifficultyId,
    activeRunId: input.state.activeRunId,
    referenceScore: input.referenceScore,
    referenceDate: input.referenceDate,
    referenceSource: input.referenceSource,
    thresholdScore: input.thresholdScore,
    thresholdFraction: input.thresholdFraction,
    maxPayout: caps,
    enabled: config.enabled,
  };
}

export function registerDailyRunRoutes(app: Application) {
  app.get('/api/daily-runs/preview', async (req, res) => {
    try {
      const config = getDailyRunsConfig();
      if (!config.enabled) {
        return res.status(404).json({ error: 'Daily runs are disabled' });
      }

      const playerId = await getSessionPlayerId(req);
      if (!playerId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const difficultyId = normalizeDifficultyId(
        typeof req.query.difficultyId === 'string'
          ? req.query.difficultyId
          : null
      );
      if (!isDifficultyValid(difficultyId)) {
        return res.status(400).json({ error: 'Invalid difficulty id' });
      }

      const todayDate = getDailyDate({
        resetHour: config.resetTimeUtcHour,
      });

      const state = await dailyHighStakesStateRepo.ensureState({
        date: todayDate,
        accountId: playerId,
        attunementsPerDay: config.attunementsPerDay,
      });

      const reference = await getReferenceScore({
        difficultyId: difficultyId!,
      });

      return res.json(
        buildResponsePayload({
          date: todayDate,
          difficultyId: difficultyId!,
          state,
          referenceScore: reference.referenceScore,
          referenceDate: reference.referenceDate,
          referenceSource: reference.source,
          thresholdScore: reference.thresholdScore,
          thresholdFraction: reference.thresholdFraction,
        })
      );
    } catch (error) {
      logError(error, req);
      res.status(500).json({ error: 'Failed to load daily run preview' });
    }
  });

  app.post('/api/daily-runs/attune', async (req, res) => {
    try {
      const config = getDailyRunsConfig();
      if (!config.enabled) {
        return res.status(404).json({ error: 'Daily runs are disabled' });
      }

      const playerId = await getSessionPlayerId(req);
      if (!playerId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const difficultyId = normalizeDifficultyId(
        typeof req.body?.difficultyId === 'string'
          ? req.body.difficultyId
          : typeof req.query.difficultyId === 'string'
            ? (req.query.difficultyId as string)
            : null
      );

      if (!isDifficultyValid(difficultyId)) {
        return res.status(400).json({ error: 'Invalid difficulty id' });
      }

      const todayDate = getDailyDate({
        resetHour: config.resetTimeUtcHour,
      });

      const state = await dailyHighStakesStateRepo.ensureState({
        date: todayDate,
        accountId: playerId,
        attunementsPerDay: config.attunementsPerDay,
      });

      const reference = await getReferenceScore({
        difficultyId: difficultyId!,
      });

      if (state.remainingAttunements <= 0) {
        return res.status(400).json({
          error: 'No attunements remaining today',
          ...buildResponsePayload({
            date: todayDate,
            difficultyId: difficultyId!,
            state,
            referenceScore: reference.referenceScore,
            referenceDate: reference.referenceDate,
            referenceSource: reference.source,
            thresholdScore: reference.thresholdScore,
            thresholdFraction: reference.thresholdFraction,
          }),
        });
      }

      const attuned = await dailyHighStakesStateRepo.attuneDifficulty({
        date: todayDate,
        accountId: playerId,
        difficultyId: difficultyId!,
      });

      if (!attuned) {
        return res.status(400).json({
        error: 'Unable to attune daily run',
      });
    }

      return res.json(
        buildResponsePayload({
          date: todayDate,
          difficultyId: difficultyId!,
          state: attuned,
          referenceScore: reference.referenceScore,
          referenceDate: reference.referenceDate,
          referenceSource: reference.source,
          thresholdScore: reference.thresholdScore,
          thresholdFraction: reference.thresholdFraction,
        })
      );
    } catch (error) {
      logError(error, req);
      res.status(500).json({ error: 'Failed to attune daily run' });
    }
  });
}
