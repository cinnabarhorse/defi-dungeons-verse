## Credits system — questions before implementation

- **Basics**
  - Should 1 credit equal 1 unit of `levelCost` (i.e., cost = `getDifficultyTier(selected).levelCost` credits), or is there a conversion factor?

Yes, 1 credit = 1 unit of levelCost.

- Are credits integers only, or can they be fractional?

They can be fractional.

- **Initialization and persistence**
  - Initial value 1000: set only if no value exists in localStorage, or always reset to 1000 on first render?

Actually, don't worry about setting it to 1000. Since we have the top up button, you can let the user click that. And that will update the value that most of the stores.

- Preferred localStorage key name? Proposed: `gotchiverse:credits`.

That's fine.

- Scope: device-global, or tied to connected wallet address (e.g., `gotchiverse:credits:<address>`) when available?

Just something... device global is fine..

- **Deduction timing and failure handling**
  - When should credits be deducted: on click of Start, after successful room join, or once a match actually starts?

After a successful room join.

- If the join/start fails after deduction, should we auto-refund the credits?

Yes, absolutely.

- **Insufficient balance behavior**
  - Should the Start button be disabled if credits < required cost?

Yes, it should say "insufficient credits" and be disabled.

- If disabled, do you want a reason surfaced via `ctaDisabledReason`? Preferred copy?

Insufficient credits.

- **UI details for `Lobby.tsx`**
  - New island label: keep as “Credits: 1000” exactly, or format with thousands separators (e.g., “Credits: 1,000”)?

Thousand separator would be nice.

- Start button label: do we always override to `START GAME (x credits)`, or append cost to the existing `ctaLabel` (e.g., `${ctaLabel ?? 'Start Game'} (${x} credits)`)?

If they have enough credits, it can say start game. If they don't, it should say insufficient credit.

- “TOP UP” increments by 10 per click; any maximum cap?

10 is fine, no maximum cap.

- Should we show a small confirmation (toast/snackbar) after top up, or keep it silent?

A small confirmation toast would be fine.

- **Scope**
  - Implement the changes directly in `Lobby.tsx` so all layouts stay in sync?

Yes, apply them there for every layout.

- **Abstraction**
  - Do you want a small `useCredits` hook (get/set/topUp/consume) so we keep logic in one place and can later swap to backend without refactoring UI components?

Sure, that sounds great.

- **Testing / Dev UX**
  - Add a hidden/dev-only “Reset credits” control to speed up manual testing, or skip?

Not needed.

- Any e2e updates desired (e.g., assert button label includes `(${x} credits)`)?

No, that's not needed.

- **Future backend**
  - When moving to server-backed credits, should the client optimistically deduct and reconcile, or only reflect the server-authoritative balance?

Always the server authoritative balance.

## Implementation summary

- **Credits mirror `levelCost`** one-to-one and allow fractional balances.
- **Local persistence**: stored under `gotchiverse:credits` without auto-seeding; players add funds through the top-up control.
- **Lobby UI**: both mobile and desktop views expose a credits panel with formatted balance/cost and a `TOP UP +10` button that fires a confirmation toast.
- **CTA behavior**: disabled with `Insufficient credits` messaging when short on funds; shows `Start Game` (or `Join Room`) when affordable and `Insufficient credits` when not.
- **Transaction timing**: credits deduct after the `room_joined` event and remain pending briefly to auto-refund if startup fails.
- **Shared hook**: `useCredits` centralizes storage, top-up, consume, and refund helpers for future backend integration.
