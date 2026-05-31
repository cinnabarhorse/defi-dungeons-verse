import type { Express, Request, Response } from 'express';
import { requireAdminSession } from './admin-auth';
import { logError } from '../lib/http-logging';
import {
  depositsRepo,
  playersRepo,
  type DepositStatus,
  type PlayerRecord,
} from '../lib/db';

function normalizeDepositStatus(value: unknown): DepositStatus | undefined {
  if (typeof value !== 'string') return undefined;
  const lowered = value.trim().toLowerCase();
  const allowed: DepositStatus[] = ['pending', 'confirmed', 'credited', 'failed'];
  return allowed.find((s) => s === lowered) as DepositStatus | undefined;
}

export function registerAdminTopUpRoutes(app: Express): void {
  // Simple health endpoint for smoke tests
  app.get('/api/admin/topups/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // Admin list of top-ups. Supports "type=deposits" (default) to show on-chain deposits with unlockAt.
  app.get('/api/admin/top-ups', async (req: Request, res: Response) => {
    const adminSession = await requireAdminSession(req, res);
    if (!adminSession) return;

    const typeParam = String(req.query.type ?? 'deposits').toLowerCase();
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 200));

    // Currently only deposits are supported for admin listing (includes unlockAt)
    if (typeParam !== 'deposits') {
      return res.status(400).json({ error: 'Unsupported type' });
    }

    try {
      const status = normalizeDepositStatus(req.query.status) ?? 'credited';
      const deposits = await depositsRepo.listDepositsByStatus(status, limit);

      // Enrich with player info when available
      const playerByIdCache = new Map<string, PlayerRecord | null>();
      const playerByWalletCache = new Map<string, PlayerRecord | null>();

      async function getPlayerById(id: string | null | undefined) {
        const key = id?.trim();
        if (!key) return null;
        if (playerByIdCache.has(key)) return playerByIdCache.get(key)!;
        const player = await playersRepo.getPlayerById(key).catch(() => null);
        playerByIdCache.set(key, player);
        return player;
      }

      async function getPlayerByWallet(address: string | null | undefined) {
        const key = (address ?? '').toLowerCase();
        if (!key) return null;
        if (playerByWalletCache.has(key)) return playerByWalletCache.get(key)!;
        const player = await playersRepo.getPlayerByWallet(key).catch(() => null);
        playerByWalletCache.set(key, player);
        return player;
      }

      const enriched = await Promise.all(
        deposits.map(async (d) => {
          const player =
            (await getPlayerById(d.userId)) ||
            (await getPlayerByWallet(d.depositorAddress));
          return {
            id: d.id,
            // Resolve player when possible; deposits can exist before a player is linked
            playerId: player?.id ?? d.userId ?? null,
            playerWalletAddress: player?.walletAddress ?? d.depositorAddress ?? null,
            playerUsername: player?.username ?? null,
            tokenSymbol: d.tokenSymbol,
            amount: d.amount,
            amountWei: d.amountWei,
            status: d.txStatus,
            txHash: d.txHash,
            chainId: d.chainId,
            unlockAt: d.unlockAt,
            autoRenew: d.autoRenew,
            pointsMinted: d.pointsMinted,
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
          };
        })
      );

      return res.json({ topUps: enriched, status, type: 'deposits' });
    } catch (error) {
      logError(error, req);
      return res.status(500).json({ error: 'Failed to load admin top-ups' });
    }
  });
}
