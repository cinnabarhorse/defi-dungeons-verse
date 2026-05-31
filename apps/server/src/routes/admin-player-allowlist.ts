import type { Application } from 'express';
import { requireAdminSession } from './admin-auth';
import { playerAllowlistRepo } from '../lib/db';
import { logError, logEvent } from '../lib/http-logging';

const WALLET_REGEX = /^0x[a-f0-9]{40}$/;

function parseWallet(input: unknown) {
  if (typeof input !== 'string') {
    return null;
  }
  const normalized = playerAllowlistRepo.normalizeWallet(input);
  if (!WALLET_REGEX.test(normalized)) {
    return null;
  }
  return normalized;
}

export function registerAdminPlayerAllowlistRoutes(app: Application) {
  app.get('/api/admin/player-allowlist', async (req, res) => {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return;
    }
    try {
      const limit = Number(req.query.limit);
      const offset = Number(req.query.offset);
      const query =
        typeof req.query.query === 'string' ? req.query.query : undefined;
      const result = await playerAllowlistRepo.list({
        limit: Number.isFinite(limit) ? limit : undefined,
        offset: Number.isFinite(offset) ? offset : undefined,
        query,
      });
      res.json(result);
    } catch (error) {
      logError(error, req);
      res.status(500).json({ error: 'Failed to list allowlist entries' });
    }
  });

  app.get('/api/admin/player-allowlist/:wallet', async (req, res) => {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return;
    }
    try {
      const wallet = parseWallet(req.params.wallet);
      if (!wallet) {
        return res.status(400).json({ error: 'Invalid wallet address' });
      }
      const entry = await playerAllowlistRepo.get(wallet);
      if (!entry) {
        return res.status(404).json({ error: 'Allowlist entry not found' });
      }
      res.json({ entry });
    } catch (error) {
      logError(error, req);
      res.status(500).json({ error: 'Failed to load allowlist entry' });
    }
  });

  app.post('/api/admin/player-allowlist', async (req, res) => {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return;
    }
    const addresses = Array.isArray(req.body?.addresses)
      ? req.body.addresses
      : null;
    if (!addresses || addresses.length === 0) {
      return res
        .status(400)
        .json({ error: 'addresses must be a non-empty array of strings' });
    }

    const normalized: string[] = [];
    const invalid: string[] = [];
    const seen = new Set<string>();
    for (const address of addresses) {
      const parsed = parseWallet(address);
      if (!parsed) {
        invalid.push(String(address));
        continue;
      }
      if (seen.has(parsed)) {
        continue;
      }
      seen.add(parsed);
      normalized.push(parsed);
    }

    if (invalid.length > 0) {
      return res.status(400).json({
        error: 'Invalid wallet addresses',
        invalidAddresses: invalid.slice(0, 50),
      });
    }

    if (normalized.length === 0) {
      return res
        .status(400)
        .json({ error: 'No valid wallet addresses provided' });
    }

    if (normalized.length > 100) {
      return res.status(400).json({
        error: 'Too many addresses; submit at most 100 per request',
      });
    }

    try {
      let addedCount = 0;
      for (const wallet of normalized) {
        const result = await playerAllowlistRepo.add({
          walletAddress: wallet,
          addedByAddress: session.address,
        });
        if (result.created) {
          addedCount += 1;
        }
      }
      const skippedCount = normalized.length - addedCount;
      logEvent(
        'allowlist_add',
        {
          actorAddress: session.address,
          addedCount,
          skippedCount,
          sample: normalized.slice(0, 5),
        },
        req
      );
      res.json({ addedCount, skippedCount });
    } catch (error) {
      logError(error, req);
      res.status(500).json({ error: 'Failed to add allowlist entries' });
    }
  });

  app.delete('/api/admin/player-allowlist/:wallet', async (req, res) => {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return;
    }
    try {
      const wallet = parseWallet(req.params.wallet);
      if (!wallet) {
        return res.status(400).json({ error: 'Invalid wallet address' });
      }
      const removed = await playerAllowlistRepo.remove(wallet);
      if (removed) {
        logEvent(
          'allowlist_remove',
          {
            actorAddress: session.address,
            walletAddress: wallet,
          },
          req
        );
      }
      res.json({ success: removed });
    } catch (error) {
      logError(error, req);
      res.status(500).json({ error: 'Failed to remove allowlist entry' });
    }
  });
}
