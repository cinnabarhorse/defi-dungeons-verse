import { getPgPool } from '../apps/server/src/lib/db/client';
import {
  inventoryRepo,
  inventoryRecordToItem,
  sanitizeInventoryItems,
  getLickTongueCount,
  playersRepo,
} from '../apps/server/src/lib/db';
import { randomBytes } from 'crypto';

describe('db schema - players table', () => {
  const pool = getPgPool();

  afterAll(async () => {
    await pool.end();
  });

  test('players has unlocked_characters (text[]) and selected_character_id (text)', async () => {
    const result = await pool.query(
      `select
        column_name,
        data_type,
        udt_name,
        is_nullable
       from information_schema.columns
      where table_name = 'players'
        and column_name in ('unlocked_characters','selected_character_id')
      order by column_name asc`
    );

    // Intentionally strict: this will FAIL until migrations are up to date.
    const byName = new Map(result.rows.map((r: any) => [r.column_name, r]));
    const unlocked = byName.get('unlocked_characters');
    const selected = byName.get('selected_character_id');

    expect(unlocked).toBeDefined();
    expect(unlocked?.data_type).toBe('ARRAY');
    expect(unlocked?.udt_name).toBe('_text');

    expect(selected).toBeDefined();
    expect(selected?.data_type).toBe('text');
  });

  test('players has lick_tongue_count (int) and unlocked_tiers (text[])', async () => {
    const result = await pool.query(
      `select
        column_name,
        data_type,
        udt_name
       from information_schema.columns
      where table_name = 'players'
        and column_name in ('lick_tongue_count','unlocked_tiers')
      order by column_name asc`
    );

    const byName = new Map(result.rows.map((r: any) => [r.column_name, r]));
    const tongues = byName.get('lick_tongue_count');
    const tiers = byName.get('unlocked_tiers');

    expect(tongues).toBeDefined();
    expect(['integer', 'bigint']).toContain(tongues?.data_type);

    expect(tiers).toBeDefined();
    expect(tiers?.data_type).toBe('ARRAY');
    expect(tiers?.udt_name).toBe('_text');
  });

  test('players has is_authorized/access_granted_at and unique wallet constraint', async () => {
    const cols = await pool.query(
      `select column_name, data_type
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'players'
          and column_name in ('is_authorized','access_granted_at')
        order by column_name asc`
    );

    const byName = new Map(cols.rows.map((r: any) => [r.column_name, r]));
    const isAuth = byName.get('is_authorized');
    const accessAt = byName.get('access_granted_at');

    expect(isAuth).toBeDefined();
    expect(isAuth?.data_type).toBe('boolean');

    expect(accessAt).toBeDefined();
    expect(accessAt?.data_type).toMatch(/timestamp/);

    const constraints = await pool.query(
      `select c.conname, pg_get_constraintdef(c.oid) as def
         from pg_constraint c
         join pg_class t on c.conrelid = t.oid
         join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'public' and t.relname = 'players' and c.contype = 'u'`
    );
    const defs = constraints.rows.map((r: any) => String(r.def || ''));
    expect(defs.some((d: string) => d.includes('(wallet_address)'))).toBe(true);
  });

  test('upsert by wallet inserts then updates same row (tx rollback)', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');

      const wallet = `0x${randomBytes(20).toString('hex')}`;

      const first = await playersRepo.upsertPlayerByWallet({
        walletAddress: wallet,
        username: 'tester1',
        region: 'us',
        client,
      });

      expect(first.walletAddress).toBe(wallet.toLowerCase());
      expect(first.username).toBe('tester1');
      expect(first.region).toBe('us');
      expect(first.isAuthorized).toBe(true);

      const second = await playersRepo.upsertPlayerByWallet({
        walletAddress: wallet,
        username: null, // should keep existing username via coalesce
        region: 'eu',
        client,
      });

      expect(second.id).toBe(first.id);
      expect(second.username).toBe('tester1');
      expect(second.region).toBe('eu');

      await client.query('rollback');
    } finally {
      try {
        await client.query('rollback');
      } catch {}
      client.release();
    }
  });

  test('new player gets 5 Lick Tongues and can unlock a tier1 character (SQL, tx rollback)', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');

      const wallet = `0x${randomBytes(20).toString('hex')}`;
      const inserted = await client.query<{ id: string }>(
        `insert into players (wallet_address, is_authorized, access_granted_at, last_seen)
         values ($1, true, now(), now())
         returning id`,
        [wallet]
      );
      const playerId = inserted.rows[0].id;

      // Verify signup trigger granted Lick Tongues (read within same tx)
      const qty1Res = await client.query<{ qty: number }>(
        `select coalesce(sum(quantity),0) as qty
           from player_inventories
          where player_id = $1
            and item_type = 'material'
            and item_name = 'Lick Tongue'`,
        [playerId]
      );
      const tongues1 = Number(qty1Res.rows[0]?.qty || 0);
      expect(tongues1).toBe(5);

      const characterId = 'farmer';
      const cost = 5;

      // Spend tongues using the same repo decrement logic as prod
      const dec = await inventoryRepo.decrementInventoryItem(
        playerId,
        'material',
        'Lick Tongue',
        cost,
        client
      );
      expect(dec).not.toBeNull();

      // Persist unlock on players and decrement cached lick_tongue_count
      const qty2Res = await client.query<{ qty: number }>(
        `select coalesce(sum(quantity),0) as qty
           from player_inventories
          where player_id = $1
            and item_type = 'material'
            and item_name = 'Lick Tongue'`,
        [playerId]
      );
      const tongues2 = Number(qty2Res.rows[0]?.qty || 0);
      const update = await client.query<{
        unlocked_characters: string[];
        lick_tongue_count: number;
      }>(
        `update players
            set unlocked_characters = coalesce(unlocked_characters, '{}') || $2::text[],
                lick_tongue_count = $3,
                selected_character_id = coalesce(selected_character_id, $4),
                updated_at = now()
          where id = $1
          returning unlocked_characters, lick_tongue_count`,
        [playerId, [characterId], tongues2, characterId]
      );

      const unlocked = update.rows[0]?.unlocked_characters || [];
      const remaining = Number(update.rows[0]?.lick_tongue_count || 0);
      expect(unlocked).toEqual(expect.arrayContaining([characterId]));
      expect(remaining).toBeGreaterThanOrEqual(0);

      const qty3Res = await client.query<{ qty: number }>(
        `select coalesce(sum(quantity),0) as qty
           from player_inventories
          where player_id = $1
            and item_type = 'material'
            and item_name = 'Lick Tongue'`,
        [playerId]
      );
      const tongues3 = Number(qty3Res.rows[0]?.qty || 0);
      expect(tongues3).toBeGreaterThanOrEqual(0);

      // Cleanup: rollback the entire transaction to avoid persisting test data
      await client.query('rollback');
    } finally {
      // Ensure connection is not left in a transaction in case of early throws
      try {
        await client.query('rollback');
      } catch {}
      client.release();
    }
  });
});
