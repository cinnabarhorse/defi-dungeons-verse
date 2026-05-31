/**
 * Portal Sprite Configuration
 * Each portal type has its own spritesheet with split left/right halves
 *
 * Spritesheet structure:
 * - Top row (frames 0-9): Left half of portal animation
 * - Bottom row (frames 10-19): Right half of portal animation
 * - Frame size: 44×52 pixels each half
 * - Combined: 88×52 pixel full portal (when doubled: 176×104)
 */

/**
 * Portal type configurations
 * Each portal type has its own spritesheet with animation frames
 */
export interface PortalTypeConfig {
  key: string;
  imagePath: string;
  displayName: string;
  frameWidth: number;
  frameHeight: number;
  animations: Array<{
    key: string;
    startFrame: number;
    endFrame: number;
    frameRate: number;
    repeat: number;
  }>;
}

/**
 * Base portal animation configuration (shared across all portal types)
 */
const BASE_PORTAL_ANIMATION = {
  key: 'portal_spin',
  startFrame: 0,
  endFrame: 9, // 10 frames per row (left and right halves)
  frameRate: 15,
  repeat: -1,
};

/**
 * Base portal properties (shared across all portal types)
 */
const BASE_PORTAL_CONFIG = {
  frameWidth: 44, // Each half is 44x52 pixels
  frameHeight: 52,
  animations: [BASE_PORTAL_ANIMATION],
};

/**
 * Portal type definitions (only unique properties)
 */
const PORTAL_DEFINITIONS = {
  alpha: { displayName: 'Alpha Portal', file: 'alpha_portal.png' },
  fomo: { displayName: 'FOMO Portal', file: 'fomo_portal.png' },
  og: { displayName: 'OG Portal', file: 'og_portal.png' },
} as const;

/**
 * Generate full portal configurations
 */
export const PORTAL_TYPES: Record<string, PortalTypeConfig> =
  Object.fromEntries(
    Object.entries(PORTAL_DEFINITIONS).map(([type, def]) => [
      type,
      {
        key: `${type}_portal`,
        imagePath: `/sprites/portals/${def.file}`,
        displayName: def.displayName,
        ...BASE_PORTAL_CONFIG,
      },
    ])
  );

/**
 * Portal collision configuration
 */
export const PORTAL_CONFIG = {
  collisionRadius: 88, // Collision radius for portals (double size)
  interactionRadius: 100, // Interaction radius for future portal actions
  animationSpeed: 15, // Animation frame rate
  zDepth: 0, // Render depth (above ground, below players)
} as const;
