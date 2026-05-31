### Stake Credits – Review Questions and Concerns

This document captures open questions, assumptions to validate, and risks for the staking-for-credits feature. Please respond inline; I will refine specs based on your answers.

### Assumptions to Confirm

- **goal**: Users lock supported stablecoins for a fixed term and receive non-transferable play credits usable in-game.
- **credits source of truth**: Server-authoritative credit balances (no on-chain credit token), aligned with your preference to keep important game logic on the server for anti-cheat.
- **stablecoins**: Likely USDC (6 decimals), USDT (6), DAI (18). ERC-20 non-standard return values handled safely.
- **conversion**: Credits granted based on stake amount and lock duration via a deterministic formula known to both contract and server.
- **locks**: Discrete lock options (e.g., 7/30/90/180 days). Early exit may be disallowed or allowed with penalty.
- **indexing**: Game server subscribes to contract events to award/revoke credits idempotently.
- **no rehypothecation (default)**: Principal sits in the contract; optional future yield strategy is out of scope unless specified.

### Blocking Product Questions

- **supported chains**: Which network(s)? Polygon PoS, Base, Arbitrum, OP, or L1? Any multi-chain plan?
- **supported assets**: Exact stablecoins at launch? Any plan to add/remove via governance?
- **KYC/compliance**: Any jurisdictional restrictions or blocked countries/assets? Age gating? Custody implications?
- **user identity**: Is wallet address the sole identity, or do we bind to a game account? One active stake per wallet or multiple concurrent stakes?
- **credits properties**: Are credits transferable, giftable, or strictly non-transferable? Do credits expire? Are they refundable upon early unlock?
- **economy cap**: Daily/total cap on credits issued? Per-wallet caps to mitigate abuse/whaling?
- **conversion policy**: What exact formula maps amount×duration → credits? Is it linear, tiered, or dynamic based on TVL or volatility? Do we use USD or token units?
- **price source**: If USD-based, do we rely on Chainlink oracles? How do we handle stale feeds or depegs?
- **early exit**: Allowed? If yes, penalty schedule and whether credits are clawed back/burned proportionally (potential negative balance?).
- **auto-renew/extend**: Can users extend a lock before/after maturity? Any bonus for extensions?
- **credit spend rate**: How are credits consumed in gameplay (per session, per minute, per dungeon run)? Do we allow overdraft or enforce pre-checks?

### Smart Contract Design Questions

- **upgradeability**: Proxy (UUPS/Transparent) or immutable? If proxy, who holds upgrade keys and what timelock/guardrails?
- **access control**: Role model (Ownable + Roles)? Multisig (e.g., Safe) for owner functions? On-chain timelocks for sensitive params?
- **pausing & emergencies**: Pausable circuit breaker? Emergency withdraw (admin or user-triggered) in case of depeg or incident?
- **time handling**: Use `block.timestamp` for maturity; acceptable for long durations. Any need for min/max durations and a global maturity horizon?
- **stake ids**: Deterministic incremental `stakeId` per contract; mapping from address → list of stakeIds. Any limit per address?
- **permit flow**: Support EIP-2612 `permit` for USDC/DAI variants to avoid separate approve tx where possible; graceful fallback for tokens without permit.
- **safe transfers**: Use a robust safe-ERC20 library to handle non-standard `transfer`/`transferFrom` return values.
- **precision**: Handle 6 vs 18 decimal assets correctly; consolidate to 18-decimal math internally; rounding direction specified.
- **events**: Emit `StakeCreated`, `StakeExtended`, `StakeUnlocked`, `StakeWithdrawn`, `PenaltyApplied`. Stable, indexed fields for off-chain indexing.
- **reentrancy**: Guard `withdraw`/`emergencyWithdraw`. Avoid external calls before state updates. Consider pull vs push patterns.
- **per-asset params**: Per-token configuration (decimals, oracle feed, pause flags, caps, min/max amounts, min/max duration).

### Conversion & Oracle Policy

- **unit of account**: Calculate credits from USD value or raw token units? If USD, which oracle(s) and heartbeat/staleness limits?
- **depeg handling**: Policy when oracle indicates depeg (freeze new stakes? scale credits down? pause withdrawals?)
- **volatility smoothing**: Do we snapshot price at `StakeCreated` and hold constant for conversion, or use TWAP over N blocks?
- **caps & limits**: Global TVL cap, per-asset cap, per-wallet cap, and per-epoch issuance cap to protect the economy.

### Early Exit, Penalties, and Clawbacks

- **penalty sink**: Burned, sent to a treasury, or redistributed (e.g., credit buybacks)?
- **credit clawback**: If a user exits early, how do we reconcile already-spent credits? Negative balances? Future stakes first repay debt?
- **grace period**: Post-maturity grace window without penalty? Auto-unlock after grace with no admin action?

### Off-Chain Integration (Game Server)

- **indexing**: Which provider (RPC/Alchemy/Infura) and confirmation policy (N blocks) before credit issuance?
- **idempotency**: Store processed logs keyed by `txHash + logIndex` to prevent duplicate credit awards.
- **auth linkage**: How does the server map wallet → player profile? Any signature-based linking flow? Multi-wallet per account?
- **spend model**: Server decrements credits on gameplay actions; define atomicity and rollback if a run aborts mid-session.
- **revocation**: If credits are clawed back (penalty/ban), do we hard stop active sessions or only block new sessions?
- **telemetry**: Emit metrics for credits awarded/spent, active locks, churn, depeg events, pauses.

### Security & Abuse Considerations

- **sybil/whale mitigation**: Per-wallet caps, per-KYC caps, or risk scoring? Any anti-bot measures?
- **flash loans**: Are there vectors where short-lived stakes can farm credits? Enforce min duration and time-weighted issuance.
- **reentrancy/approval griefing**: Thorough checks around ERC-20 behaviors; use `nonReentrant` and checks-effects-interactions.
- **oracle risks**: Stale feeds, outages, and aggregator manipulation; specify min answers, heartbeat, and fallback procedures.
- **key management**: Safe multisig for owner; rotate keys; timelock on parameter changes; emergency council?

### Operations & Governance

- **parameterization**: Which params are adjustable post-deploy (conversion rates, durations, caps, supported assets)? Who can change them and how fast?
- **pausing**: Who can pause/unpause? Does pause affect deposits, withdrawals, both, or just issuance?
- **migrations**: If v2 is needed, how do we migrate stakes and preserve credit balances? Any planned upgrade windows?
- **audits**: Target auditors, scope, and timeline. Will we run Slither/Foundry/echidna fuzzing and invariant tests pre-audit?

### Testing & Acceptance Criteria

- **unit tests**: Decimals handling, stake/extend/withdraw, permit paths, events, reentrancy protection, rounding, oracle staleness.
- **fuzz/invariants**: No credit over-issuance, conservation of principal, monotonic maturity, caps not exceeded.
- **integration**: End-to-end flow awarding credits on event and consuming credits during gameplay; idempotency under reorgs.
- **UX flows**: Approve/permit, stake, view lock, extend, withdraw; clear error messages for paused/limit breaches.

### Open Design Decisions (Pick One)

- **credits representation**:
  - Non-transferable off-chain balance (simple, server-controlled), or
  - Non-transferable on-chain soulbound token (adds complexity and gas; off-chain still needed for gameplay timing).
- **conversion curve**:
  - Linear amount×duration, or
  - Tiered bonuses for longer locks and larger amounts with diminishing returns.
- **yield strategy**:
  - None (principal idle for simplicity), or
  - Deposit into a whitelisted venue (Aave/Morpho) with strict risk controls and the ability to disable per-asset.

### Data Model Suggestions (Server)

- **tables**: `stakes` (on-chain mirror), `credit_balances`, `credit_ledger`, `processed_logs`, `wallet_links`, `params`.
- **idempotency**: Unique constraint on `(tx_hash, log_index)`; credits issuance recorded in `credit_ledger` with a reversible entry.
- **spend**: Deduct credits atomically; prevent negative balances unless explicitly allowed for clawbacks.

### Next Steps

- Please confirm assumptions and answer the blocking questions above. Based on your guidance, I will draft:
  - Detailed contract interface (methods, events, roles)
  - Conversion/issuance spec with formulas
  - Server integration plan and schemas
  - Test plan with acceptance criteria
