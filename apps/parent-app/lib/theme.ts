// AIEdu brand ("Sprout A"): Forest frame, Emerald actions, Signal Gold for
// "still to do", red only for absent/errors. Same as the admin website.
export const C = {
  ink: '#0B2A22',        // Forest
  inkSoft: '#4B6158',
  paper: '#F3F8F5',      // Mist
  sheet: '#ffffff',
  rule: '#DCE7E1',
  ruleStrong: '#BCCFC5',
  margin: '#F5C94D',     // gold margin line
  board: '#0E7C5F',      // Emerald
  boardDeep: '#0A6149',
  boardWash: '#E3EFE8',  // Mint
  bright: '#19B984',     // Bright Emerald
  gold: '#F5B700',       // Signal Gold
  marigold: '#B98700',
  marigoldWash: '#FFF4CC',
  red: '#B42318',
  redWash: '#FDECEA',
};

export const F = {
  regular: 'Manrope_500Medium',
  bold: 'Manrope_700Bold',
  display: 'Sora_700Bold',
  displayHeavy: 'Sora_800ExtraBold',
};

export const classLabel = (name: string) => (/^\d+$/.test(name) ? `Class ${name}` : name);

export const longDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
