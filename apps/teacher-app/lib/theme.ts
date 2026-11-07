// Same look as the admin website: ink-blue, chalkboard green, marigold for
// "still to do", red only for absent/errors.
export const C = {
  ink: '#1d2b4f',
  inkSoft: '#4a5775',
  paper: '#f3f5f4',
  sheet: '#ffffff',
  rule: '#dbe2e6',
  ruleStrong: '#bfcad1',
  margin: '#e8a3a1',
  board: '#2e5b4f',
  boardDeep: '#234639',
  boardWash: '#e7efec',
  marigold: '#c98a12',
  marigoldWash: '#fbf1dc',
  red: '#a8322b',
  redWash: '#fbeceb',
  lateWash: '#eef1f8',
};

export const F = {
  regular: 'AtkinsonHyperlegible_400Regular',
  bold: 'AtkinsonHyperlegible_700Bold',
};

export const classLabel = (name: string) => (/^\d+$/.test(name) ? `Class ${name}` : name);

export const longDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
