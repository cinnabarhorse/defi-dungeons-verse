import { Sixtyfour, Changa } from 'next/font/google';

// Central place to choose the HUD/UI font.
// Swap to Changa for previewing UI with Changa everywhere Sixtyfour is used.
export const hudFont = Changa({
  subsets: ['latin'],
  variable: '--font-hud',
  display: 'swap',
});
// Keep Sixtyfour imported and available for future use.
export const sixtyfourFont = Sixtyfour({
  subsets: ['latin'],
  variable: '--font-sixtyfour',
  display: 'swap',
});
// Phaser canvas text needs a concrete font-family string (CSS variables aren't supported by canvas).
// Keep this in sync with the font chosen above.
// Use monospace for page.tsx canvas text, per request
export const HUD_PHASER_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
