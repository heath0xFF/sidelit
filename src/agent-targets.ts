import type { AgentTarget } from './api';

export function chooseTarget(targets: AgentTarget[], remembered: string): string {
  const connected = targets.filter(target => target.connected);
  if (connected.some(target => target.id === remembered)) return remembered;
  return connected.length === 1 ? connected[0].id : '';
}
