export interface Jump {
  nonce: number;
  path: string;
  text?: string;
  heading?: { index: number; line: number };
}
const claimed = new Map<string, number>();
// Editors remount on tab switches; returning to a tab must not repeat an old jump.
export function claimJump(jump: Jump | undefined, consumer: string): jump is Jump {
  if (!jump || claimed.get(consumer) === jump.nonce) return false;
  claimed.set(consumer, jump.nonce);
  return true;
}
let revealed = 0;
// Reveal is an App-wide counter; a remounted view must not replay one already handled.
export function claimReveal(reveal: number): boolean {
  if (reveal <= revealed) return false;
  revealed = reveal;
  return true;
}
