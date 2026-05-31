import type { Application, Request, Response } from 'express';
import { statsRepo } from '../lib/db';
import { parseTimestamp } from './admin/utils';

export function registerStatsRoutes(app: Application) {
  app.get('/api/stats/matches-per-day', async (req: Request, res: Response) => {
    const from = parseTimestamp(req.query.from);
    const to = parseTimestamp(req.query.to);
    try {
      const series = await statsRepo.getMatchesPerDay({
        fromIso: from,
        toIso: to,
      });
      res.json({
        series,
        from: from ?? null,
        to: to ?? null,
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to load matches-per-day',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get(
    '/api/stats/token-allocations-per-day',
    async (req: Request, res: Response) => {
      const from = parseTimestamp(req.query.from);
      const to = parseTimestamp(req.query.to);
      try {
        const series = await statsRepo.getTokenAllocationsPerDay({
          fromIso: from,
          toIso: to,
        });
        res.json({
          series,
          from: from ?? null,
          to: to ?? null,
        });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to load token-allocations-per-day',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  );

  app.get('/api/stats/active-users', async (req: Request, res: Response) => {
    const from = parseTimestamp(req.query.from);
    const to = parseTimestamp(req.query.to);
    const windowParam = req.query.windowDays;
    const windowDays =
      typeof windowParam === 'string' ? Number(windowParam) : undefined;
    try {
      const series = await statsRepo.getActiveUsersPerDay({
        fromIso: from ?? undefined,
        toIso: to ?? undefined,
        windowDays: Number.isFinite(windowDays) ? windowDays : undefined,
      });
      res.json({
        series,
        from: from ?? null,
        to: to ?? null,
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to load active-users',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/api/stats/topups-per-day', async (req: Request, res: Response) => {
    const from = parseTimestamp(req.query.from);
    const to = parseTimestamp(req.query.to);
    try {
      const series = await statsRepo.getTopUpsPerDay({
        fromIso: from ?? undefined,
        toIso: to ?? undefined,
      });
      res.json({
        series,
        from: from ?? null,
        to: to ?? null,
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to load topups-per-day',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });
}










