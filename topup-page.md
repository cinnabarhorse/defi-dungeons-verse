## Top Up page — questions and implementation plan

### Open questions to confirm

- **Chain and token contracts**: Which network(s) should we support for USDC/GHO (e.g., Polygon PoS, Base, Ethereum)? Please provide canonical contract addresses per chain.

Base. Contracts TBD, just use placeholders for now.

- **Credits conversion**: Is the conversion fixed at 1 Credit per 1 USD (USDC/GHO) locked? If not, what formula and rounding should we apply?

yes, 1:1.

- **Decimals and min/max**: What decimal precision and step do we allow in the amount input (USDC 6, GHO 18)? Any minimum/maximum per top-up and per wallet?

Correct. 1 min, 100 maximum for now.

- **Fees**: Are there protocol, gas, or platform fees to show separately? Should the UI present a net credit amount after fees?

Yes we can show their net credits.

- **Unlock timing**: Is unlock exactly createdAt + 30 days (30 × 24 × 60 × 60 seconds) using block timestamp, or wall-clock time? Any timezone/display preference (UTC vs user-local)?

Yes, block timestamp.

- **Auto-renew semantics**: On renewal, do we re-lock principal only, or principal + accrued credits? Is there a cut-off window to cancel auto-renew (e.g., 24h before unlock)?

Principal only. No window currently.

- **History source of truth**: In the final version, should history come from on-chain events, Supabase, or both (indexer → DB)? What statuses do we track (pending/locked/unlocked/failed/refunded)?

We will ave a subgraph.

- **Wallet flow**: Do we use the existing wallet stack (wagmi/ethers/siwe) and current network guardrails? Should we block interaction on the wrong network and offer one-click switch?

Yes current wallet stack.

- **CTA copy dynamics**: Should the CTA always say “Mint 100 Credits”, or should it reflect the current amount selection (e.g., “Mint 250 Credits”)?

Current amount selection.

- **Compliance/copy**: Any required disclosures about lockups/risks we must include near the form and FAQ?
  No.

### Data model (UI-level, mock phase)

```ts
export interface TopupRecord {
  id: string;
  token: 'USDC' | 'GHO';
  amount: number; // human-readable amount in token units
  credits: number; // derived from amount and conversion
  createdAt: string; // ISO8601
  unlockAt: string; // ISO8601 (createdAt + 30 days)
  autoRenew: boolean;
  status: 'pending' | 'locked' | 'unlocked' | 'failed' | 'refunded';
  txHash?: string;
  chain?: 'polygon' | 'base' | 'ethereum';
}
```

### UI/UX scope for this iteration

- **History**: Table listing token, amount, credits, created date, unlock date (+30d), auto-renew badge, and status. Use mock data.
- **Top-up form**: Token selector (USDC/GHO), numeric amount input, copy about 30-day lock/claim, “Auto-renew” checkbox (default checked), dynamic credit preview.
- **FAQ**: Collapsible Q&A using interactive headers that expand on click.
- **CTA**: Primary button with title “Mint 100 Credits” and subtitle “Lock up 100 USDC / GHO for 30 days”. Text should update to reflect selected token and amount if different than 100.

### Implementation plan (Next.js App Router, Shadcn, Tailwind)

1. **Types and mock data**
   - Add `TopupRecord` to `apps/client/src/types/topup.ts` (local, no shared packages).
   - Add mock list to `apps/client/data/topups.ts` returning `TopupRecord[]`.

2. **Route and page layout**
   - Create `apps/client/src/app/topup/page.tsx` as an RSC that:
     - Imports mock history data.
     - Renders sections: History, Top-up Form, FAQ, CTA.
     - Minimizes client components; pass only necessary props down.

3. **Components (by feature)**
   - `apps/client/src/components/topup/history.tsx` (RSC): Shadcn Table with token, amount, credits, createdAt, unlockAt, auto-renew badge, status chip.
   - `apps/client/src/components/topup/topup-form.tsx` (client): Shadcn Select (USDC/GHO), Input (amount), Checkbox (auto-renew), copy text, live credit preview.
   - `apps/client/src/components/topup/faq.tsx` (client): Shadcn/Radix Accordion with interactive headers.
   - `apps/client/src/components/topup/cta.tsx` (RSC wrapper + client button if needed): Primary Button showing dynamic title/subtitle.

4. **State and URL sync**
   - Use `nuqs` to reflect `token` and `amount` in search params (e.g., `?token=USDC&amount=100`).
   - Default `token=USDC`, `amount=100`, `autoRenew=true`.

5. **Copy and formatting**
   - Add concise explanation below the amount input: “Funds are locked for 30 days and claimable afterwards.”
   - Subtitle under CTA: “Lock up {amount} {token} for 30 days”.

6. **Validation and UX**
   - Numeric input with step aligned to token decimals; simple client-side validation (required, >0, within max if provided).
   - Disable CTA if invalid; show inline field description on error.

7. **Styling and accessibility**
   - Use Tailwind for layout; mobile-first; responsive table (stack on small screens).
   - Ensure proper roles/ARIA for accordion and form controls; keyboard navigation.

8. **Integration hooks (future)**
   - Prepare a server action placeholder `createTopupIntent` for real on-chain flow (no-op in mock phase).
   - Plan event syncing (on-chain → indexer → Supabase) to replace mock history.

### Mock data example

```ts
export const MOCK_TOPUPS: TopupRecord[] = [
  {
    id: 't1',
    token: 'USDC',
    amount: 100,
    credits: 100,
    createdAt: '2025-10-01T12:00:00.000Z',
    unlockAt: '2025-10-31T12:00:00.000Z',
    autoRenew: true,
    status: 'locked',
    chain: 'polygon',
  },
  {
    id: 't2',
    token: 'GHO',
    amount: 250,
    credits: 250,
    createdAt: '2025-10-15T08:15:00.000Z',
    unlockAt: '2025-11-14T08:15:00.000Z',
    autoRenew: false,
    status: 'pending',
    chain: 'base',
  },
];
```

### FAQ entries (initial)

- **What is a top-up?** Funds locked in a smart contract for 30 days to mint Credits.
- **When can I claim?** After the unlock date displayed; claiming requires a wallet transaction.
- **What does Auto-renew do?** Automatically re-locks your funds for another 30 days at unlock. You can disable it before the cut-off.
- **Are there fees?** Gas applies. Additional protocol fees (if any) will be shown in the UI once confirmed.
- **Which networks are supported?** We will show supported chain(s) and switch prompts.

### Acceptance criteria (mock phase)

- History table renders from mock data with correct computed unlock dates.
- Form defaults to USDC, amount 100, auto-renew checked.
- CTA shows “Mint 100 Credits” and subtitle reflects token and amount.
- FAQ expands/collapses on click.
- URL reflects selected token and amount via query params.

### Detailed implementation plan

1. Dependencies and setup

- Confirm `nuqs` is installed in `apps/client`. If missing, add it to `apps/client/package.json` and install.
- Use existing Shadcn primitives: `Button`, `Input`, `Select`, `Checkbox`, `Table`, `Badge`, `Accordion`, `Card`, `Separator`, `Label`, `Tooltip`.
- No workspace shared packages; keep types and utils inside `apps/client`.

2. Types and constants

- File `apps/client/src/types/topup.ts`:
  - `export interface TopupRecord` (as above).
  - `export interface CreateTopupParams { token: 'USDC' | 'GHO'; amount: number; autoRenew: boolean; }`.
  - `export type TokenSymbol = 'USDC' | 'GHO'`.
- File `apps/client/src/lib/topup/constants.ts`:
  - `export const TOKEN_DECIMALS: Record<TokenSymbol, number> = { USDC: 6, GHO: 18 }`.
  - `export const AMOUNT_MIN = 1` and `export const AMOUNT_MAX = 100`.
  - `export const CREDIT_CONVERSION = 1`.
  - `export const DEFAULT_CHAIN = 'base' as const`.
  - `export const FEE_BPS = 0` (mock; netCredits = amount − fee when > 0).
- File `apps/client/src/lib/topup/format.ts`:
  - `formatAmount(amount: number, token: TokenSymbol): string` via `Intl.NumberFormat`.
  - `formatCredits(credits: number): string`.
  - `formatDate(iso: string): string` (user locale).
- File `apps/client/src/lib/topup/time.ts`:
  - `addDaysIso(iso: string, days: number): string`.
  - `daysUntil(iso: string): number`.
- File `apps/client/src/lib/topup/validation.ts`:
  - `clampAmount(amount: number): number`.
  - `isValidAmount(amount: number): boolean` (>= min, <= max).
  - `getAmountError(amount: number): string | null`.

3. Mock data

- File `apps/client/data/topups.ts`:
  - Export `MOCK_TOPUPS: TopupRecord[]` (sample above; ensure `unlockAt = addDaysIso(createdAt, 30)`).

4. Route and page layout (RSC)

- File `apps/client/src/app/topup/page.tsx` (RSC):
  - Import `MOCK_TOPUPS`.
  - Render sections: header, `TopupHistory`, `TopupForm`, `TopupFaq`.
  - Keep copy concise; note Base network and 30-day lock.

5. History component (RSC)

- File `apps/client/src/components/topup/history.tsx` (named export `TopupHistory`):
  - Props: `{ records: TopupRecord[] }`.
  - Shadcn Table columns: Token, Amount, Credits, Created, Unlock (+"in X days"), Auto-renew (badge), Status (badge variant).
  - Mobile responsive: collapse into stacked rows.

6. Top-up form (client)

- File `apps/client/src/components/topup/topup-form.tsx` (named export `TopupForm`):
  - Manage state with `nuqs`: `token` (USDC/GHO), `amount` (number), `autoRenew` (boolean default true).
  - Amount input: step 0.01 for USDC, 0.0001 for GHO (UX-friendly); clamp to `[AMOUNT_MIN, AMOUNT_MAX]`.
  - Derived values: `grossCredits = amount * CREDIT_CONVERSION`, `fees = Math.floor(amount * FEE_BPS) / 10000`, `netCredits = grossCredits - fees`.
  - UI: `Select` for token, `Input` for amount, helper text about 30-day lock and claim, `Checkbox` auto-renew.
  - CTA Button (primary):
    - Title: `Mint {netCredits} Credits` (dynamic per current amount).
    - Subtitle: `Lock up {amount} {token} for 30 days`.
  - Validation: show inline error from `getAmountError`; disable CTA when invalid.
  - Submit handler (mock): call server action placeholder and show toast.

7. FAQ (client)

- File `apps/client/src/components/topup/faq.tsx` (named export `TopupFaq`):
  - Shadcn/Radix `Accordion` with the listed Q&A entries.
  - One item open at a time; keyboard accessible.

8. CTA extraction (optional)

- Optional `apps/client/src/components/topup/cta.tsx` to render the title/subtitle if we prefer a dedicated component; otherwise, inline within the form.

9. Server action placeholder

- File `apps/client/src/app/topup/actions.ts` (server):
  - `export async function createTopupIntent(params: CreateTopupParams) { return { ok: true } }`.
  - Future: integrate Base contracts (placeholders), approvals/lock, toasts, and error handling.

10. Styling and layout

- Page container: `div.mx-auto.max-w-5xl.px-4.md:px-6` with section `Separator`s.
- History: horizontal scroll on small screens; consistent number formatting.
- Form: labeled controls with `aria-describedby` for helper/error text.

11. Accessibility

- Labels associated via `htmlFor`/`id`.
- Accordion uses ARIA attributes; focus states visible.
- Button text remains descriptive for screen readers.

12. Testing

- Unit tests under `apps/client/src/__tests__/topup/`:
  - `format.spec.ts` for number/date formatting.
  - `validation.spec.ts` for min/max and edge cases.
- Playwright E2E `apps/client/e2e/topup.spec.ts`:
  - Loads defaults (USDC, amount 100, auto-renew checked).
  - Token switch updates CTA and subtitle.
  - Invalid amounts disable CTA and show error.
  - FAQ expands/collapses.
  - History renders mock rows with correct unlock.

13. Future integration notes

- Replace mock history with a Base subgraph query mapping events → `TopupRecord`.
- Use existing wallet stack; enforce Base network and show network switch when needed.
- Persist `autoRenew` on-chain; allow toggling per position; renew principal-only at unlock.
- Compute unlock using block timestamp; display user-local date with tooltip noting "block time" basis.
