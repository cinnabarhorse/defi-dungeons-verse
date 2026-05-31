### Fog of War — Design Questionnaire

Answer inline below each question, or reply in chat. Where options are listed, pick one or specify custom values.

---

### 1) Goals and Scope

- **Primary goal**: What problems should fog-of-war solve in Gotchiverse (e.g., exploration, tension, anti-cheat, guiding progression)?

  1., exploration and anti-cheat mainly.

- **Which game modes/maps**: Which rooms/maps/difficulties should have fog-of-war initially? Any maps explicitly excluded?

all difficulty-tier maps except for Staging.

- **Single-player vs multiplayer**: Is this for solo only, co-op/party, or all modes?

solo and co-op both

### 2) Visibility Model

- **States**: Do we need three states per tile/cell?
  - Unseen (never discovered), Discovered (seen before but not currently visible), Visible (currently within vision)

let's start with two initially -- unseen and discovered (always visible)

- **Reveal shape**: Circle radius, line-of-sight with occlusion, or hybrid?

circle radius

- **Reveal radius**: What is the default vision radius (in tiles/meters)? Should it scale with stats, items, or buffs/debuffs?

yes it might scale with stats. choose a reasonable default first.

- **Occluders**: Which tiles/objects block line-of-sight? Solid walls only, or tall obstacles, closed doors, smoke, etc.?

solid walls for now.

- **Height/levels**: Any verticality that should affect visibility?

not yet.

### 3) Team/Shared Vision

- **Party sharing**: Should party members share visibility in real-time? Only within proximity, or full team share?

ful team share

- **Allies/pets**: Do friendly summons or pets contribute vision?

possibly, when we add them

### 4) Persistence (Exploration Memory)

- **Per entity**: Persist per player account, per character, or per run/instance?

per run / instance

- **Reset rules**: Reset on death, on new run, on daily reset/season, or never reset?

on new run only

- **Scope of key**: What identifies a map instance for persistence (world → map → room → seed)?

currently we don't have any way to identify maps except for their difficulty-tier.

- **Storage**: OK to persist as a bitset/compressed mask in DB per player×map? Any size/budget constraints?

i don't think we need to persist it on the db side. just server-side.

### 5) Server Authority and Networking

- **Authoritative visibility**: Should the server determine what is visible and only send visible entities/events to clients? (Recommended for anti-cheat.)

absolutely

- **Hidden entities**: Should enemies outside visibility be fully hidden (not streamed) or sent without sensitive data and culled client-side?

fully hidden, not streamed

- **Projectiles/abilities**: Can players target beyond visibility? If yes, what UI feedback is allowed?

no

- **Audio cues**: Are audio-only cues allowed from unseen areas?

no, not right now

### 6) Map/Tile/Chunk Details

- **Tile size**: What is the canonical tile size and unit system used by gameplay? (e.g., 1 tile = 32 px)

1 tile = 32px

- **Chunking**: What are the chunk dimensions (width×height in tiles)? Any constraints that affect mask storage (e.g., chunk-based masks)?
- **Max map size**: Typical and maximum dimensions we must handle?

current biggest map is 100x100

### 7) Rendering Layer and Technique

- **Rendering stack**: Which renderer is used for the main scene (Canvas 2D, WebGL, Pixi, Phaser, custom)?

canvas and webgl with phaser

- **Fog technique preference**: Full-screen shader, geometry mask, alpha overlay per tile, or hybrid (shader + tile flags)?

whatever is lighest on the client and looks good

- **Performance target**: Minimum FPS devices (mobile/desktop) and GPU/CPU budgets for fog updates?

60fps

- **Transitions**: Should reveal/hide be animated (fade/expand) or instant?

let's start with instant

### 8) Minimap and UI

- **Minimap obeys fog**: Should minimap hide Unseen, show Discovered as dim, and Visible as bright?

no minimap yet

- **Player indicators**: Show party members on minimap beyond visibility?

no minimap

- **Legend/UX**: Any specific colors/opacity for states (Unseen/Discovered/Visible)?

dark black for unseen

### 9) Gameplay Interactions

- **Spawns outside visibility**: Allowed? If so, do they remain dormant until revealed?

they spwn on server side but are not sent to the player

- **Loot/Chests**: Visible only when in line-of-sight? Remembered on Discovered state?

yes, remembered

- **Traps/Triggers**: Should traps be hidden until revealed? Any exceptions?

no traps yet

- **Stealth/smoke**: Any mechanics that temporarily override visibility rules?

no

### 10) Performance and Update Cadence

- **Update frequency**: How often should visibility recompute? Every tick, on movement only, at fixed intervals?

whatever is cheapest and lightest

- **Movement granularity**: Reveal continuously or snap to tile boundaries?
  whatever is cheapest and lightest

- **Mask representation**: Preference for bitset per chunk, RLE, or quadtree? Any serialization requirements?

whatever is cheapest and lightest

### 11) Editor and Content Pipeline

- **Map editor support**: Add placeable "reveal zones" or "light sources" that grant local vision?

yes we will add lamps

- **Occluder tagging**: Will level designers tag occluders explicitly, or infer from collision layer?

whatever is cheapest and lightest

- **Testing tools**: Need a debug toggle to reveal/hide fog and visualize LOS rays?

yes

### 12) Rollout and Configuration

- **Feature flag**: Gate via env/room/difficulty flags? Per-player opt-in on staging?

nope, all maps except for staging

- **Tuning hooks**: Configurable vision radius per difficulty or per character class?

yes

- **Telemetry**: Track exploration percent, time to clear, and correlation with outcomes?

### 13) Edge Cases

- **Teleport/portals**: Reveal destination area instantly or only after arrival?
- **Cameras/cutscenes**: Should camera pans reveal, or keep fog intact?
- **Dynamic geometry**: Doors opening, walls destroyed—should this recalc LOS immediately?

---

### Quick Defaults (confirm or adjust)

- [ ] Three-state model: Unseen, Discovered (dim), Visible (bright)
- [ ] Server-authoritative visibility; stream only visible entities/events to clients
- [ ] Circle reveal radius: 8 tiles default; scaled by buffs/debuffs
- [ ] Line-of-sight blocked by solid walls/doors; tall obstacles flagged as occluders
- [ ] Party shared vision in real-time; pets/summons contribute vision
- [ ] Persist exploration per character×map; no reset within a run; resets between runs
- [ ] Minimap obeys fog (Unseen hidden, Discovered dim, Visible bright)
- [ ] Update on movement and on geometry changes; animate reveal with short fade (100–150 ms)
- [ ] Bitset per chunk for storage; compressed when persisted
- [ ] Editor: support reveal zones and occluder tagging via collision layer

---

### Anything else?

List any constraints, lore-driven rules, or anti-cheat requirements that should shape the implementation.
