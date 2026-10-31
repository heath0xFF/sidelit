export interface MathMatch {
  from: number;
  to: number;
  source: string;
}
export const MAX_MATH_SOURCE = 4000;
export const MAX_MATH_PER_DOCUMENT = 500;
// Pandoc's rule, plus no digit after the opening `$`, so money and shell variables stay text.
const inline = /(?<![\\$\w])\$\$(?=\S)([^$]{1,4000}?)\$\$(?!\$)|(?<![\\$\w])\$(?=[^\s\d$])([^$\n]{1,1000}?)(?<=[^\s\\])\$(?![\w$])/g;
const display = /^\s*\$\$([^$]{1,4000})\$\$\s*$/;

export function findInlineMath(text: string): MathMatch[] {
  if (!text.includes("$")) return [];
  return [...text.matchAll(inline)].map((match) => ({
    from: match.index,
    to: match.index + match[0].length,
    source: match[1] ?? match[2],
  }));
}
export function displayMath(text: string): string | undefined {
  return display.exec(text)?.[1].trim() || undefined;
}
