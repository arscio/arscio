// Arscio look (Nov 2026): Peacock for brand and actions, Lagoon for good
// news (present, paid), Saffron for things needing attention, Sky and Cloud
// for soft backgrounds and glass, Deep peacock for text. Red only for errors.
export const C = {
  ink: '#0B3B4C',        // Deep peacock: text
  inkSoft: '#3F6E7D',
  paper: '#EEF4F7',      // Cloud: page background
  sheet: '#ffffff',
  glass: 'rgba(255,255,255,0.62)',
  glassEdge: 'rgba(255,255,255,0.9)',
  rule: '#DCEBF0',
  ruleStrong: '#B9D3DC',
  board: '#0B7FA6',      // Peacock
  boardDeep: '#08607E',
  boardWash: '#DDF2FA',
  lagoon: '#22B3C4',
  lagoonDeep: '#0B5F69',
  lagoonWash: '#D6F1F4',
  sky: '#7FD3EE',
  gold: '#F2A33A',       // Saffron
  goldInk: '#4A2C02',
  marigold: '#7A4A06',
  marigoldWash: '#FDEBCF',
  red: '#B42318',
  redWash: '#FDECEA',
  // Older name kept so existing screens keep working.
  bright: '#22B3C4',
  margin: '#F5C98A',
};

export const F = {
  regular: 'Figtree_500Medium',
  bold: 'Figtree_600SemiBold',
  display: 'BricolageGrotesque_700Bold',
  displayHeavy: 'BricolageGrotesque_800ExtraBold',
};

/** Soft shadows. Raised = neumorphic card, lift = floating glass. */
export const SH = {
  raised: { boxShadow: '6px 6px 14px #D2E0E6, -6px -6px 14px #FFFFFF' },
  inset: { boxShadow: 'inset 2px 2px 5px #D2E0E6, inset -2px -2px 5px #FFFFFF' },
  lift: { boxShadow: '0px 14px 30px rgba(11,59,76,0.12)' },
  glow: (c: string) => ({ boxShadow: `0px 10px 22px ${c}55` }),
} as const;

export const classLabel = (name: string) => (/^\d+$/.test(name) ? `Class ${name}` : name);

export const longDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
