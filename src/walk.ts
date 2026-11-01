import type { OpenRequest } from "./api";

export const MAX_WALK_STOPS = 50;
export interface WalkStop {
  path: string;
  find: string;
  note?: string;
  source: boolean;
}
export interface Walk {
  stops: WalkStop[];
  index: number;
}
// A single --find without a note stays a plain pointer; anything else is a walk.
export const isWalk = (request: OpenRequest) =>
  request.stops.length > 1 || request.append || !!request.stops[0]?.note;
// Returns the walk and whether to go to its current stop. Adding to a walk leaves the person where they are.
export function extendWalk(walk: Walk | undefined, request: OpenRequest): { walk: Walk; go: boolean } {
  const stops = request.stops.map(({ find, note }) => ({ path: request.path, find, note: note ?? undefined, source: request.source }));
  return walk && request.append
    ? { walk: { ...walk, stops: [...walk.stops, ...stops].slice(0, MAX_WALK_STOPS) }, go: false }
    : { walk: { stops: stops.slice(0, MAX_WALK_STOPS), index: 0 }, go: true };
}
export const stepWalk = (walk: Walk, delta: number): Walk =>
  ({ ...walk, index: Math.max(0, Math.min(walk.stops.length - 1, walk.index + delta)) });
