import type { Application, Request, Response } from 'express';
import { resolveSessionFromRequest } from '../lib/auth/session';
import { DEFAULT_ADMIN_ADDRESS } from '../lib/constants';

export interface AdminSessionResult {
  address: string;
  playerId: string | null;
}

const DEFAULT_ADMIN_ALLOWLIST = [DEFAULT_ADMIN_ADDRESS];

function getAdminAllowlist(): Set<string> {
  const raw = process.env.ADMIN_WALLET_ALLOWLIST;
  const normalized = raw
    ? raw
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
    : DEFAULT_ADMIN_ALLOWLIST;
  return new Set(normalized);
}

const ADMIN_ALLOWLIST = getAdminAllowlist();

export function isAdminAddress(address: string | null | undefined): boolean {
  if (!address) {
    return false;
  }
  return ADMIN_ALLOWLIST.has(address.trim().toLowerCase());
}

export async function requireAdminSession(
  req: Request,
  res: Response
): Promise<AdminSessionResult | null> {
  const resolved = await resolveSessionFromRequest(req);
  if (!resolved) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  if (!isAdminAddress(resolved.address)) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }

  return {
    address: resolved.address,
    playerId: resolved.playerId,
  };
}
