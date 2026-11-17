// Dates and numbers in words, as certificates print them ("Fourteenth March Two Thousand Thirteen").
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const ORD: Record<string, string> = {
  One: 'First', Two: 'Second', Three: 'Third', Five: 'Fifth', Eight: 'Eighth', Nine: 'Ninth', Twelve: 'Twelfth',
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function numberWords(n: number): string {
  if (n === 0) return 'Zero';
  if (n < 20) return ONES[n]!;
  if (n < 100) return [TENS[Math.floor(n / 10)], ONES[n % 10]].filter(Boolean).join('-');
  if (n < 1000) return [ONES[Math.floor(n / 100)], 'Hundred', n % 100 ? numberWords(n % 100) : ''].filter(Boolean).join(' ');
  return [numberWords(Math.floor(n / 1000)), 'Thousand', n % 1000 ? numberWords(n % 1000) : ''].filter(Boolean).join(' ');
}

export function ordinalWords(n: number): string {
  const w = numberWords(n);
  const parts = w.split(/([ -])/);
  const last = parts.pop()!;
  const ord = ORD[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return [...parts, ord].join('');
}

/** "2013-03-14" -> "Fourteenth March Two Thousand Thirteen" */
export function dateWords(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number) as [number, number, number];
  return `${ordinalWords(d)} ${MONTHS[m - 1]} ${numberWords(y)}`;
}

/** "2013-03-14" -> "14 March 2013" */
export function dateShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Class names as words: "7" -> "Seven", "LKG" stays. */
export function classWords(name: string): string {
  return /^\d+$/.test(name) ? numberWords(Number(name)) : name;
}
export const classFig = (name: string) => (/^\d+$/.test(name) ? `Class ${name}` : name);
