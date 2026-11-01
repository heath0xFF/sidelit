import { describe, expect, it } from 'vitest';
import type { OpenRequest } from '../src/api';
import { extendWalk, isWalk, MAX_WALK_STOPS, stepWalk } from '../src/walk';

const request = (change: Partial<OpenRequest>): OpenRequest => ({ path: '/a.md', directory: false, source: false, stops: [], append: false, ...change });
describe('walkthroughs', () => {
  it('leaves a lone --find as a plain pointer', () => {
    expect(isWalk(request({ stops: [{ find: 'x' }] }))).toBe(false);
    expect(isWalk(request({}))).toBe(false);
    expect(isWalk(request({ stops: [{ find: 'x', note: 'why' }] }))).toBe(true);
    expect(isWalk(request({ stops: [{ find: 'x' }, { find: 'y' }] }))).toBe(true);
    expect(isWalk(request({ stops: [{ find: 'x' }], append: true }))).toBe(true);
  });
  it('starts over unless told to add', () => {
    const first = extendWalk(undefined, request({ stops: [{ find: 'x', note: 'why' }] }));
    expect(first.go).toBe(true);
    expect(first.walk).toEqual({ index: 0, stops: [{ path: '/a.md', find: 'x', note: 'why', source: false }] });
    const added = extendWalk({ ...first.walk, index: 0 }, request({ path: '/b.md', append: true, source: true, stops: [{ find: 'y' }] }));
    expect(added.go).toBe(false);
    expect(added.walk.stops.map(stop => [stop.path, stop.source])).toEqual([['/a.md', false], ['/b.md', true]]);
    const replaced = extendWalk(added.walk, request({ stops: [{ find: 'z' }, { find: 'w' }] }));
    expect(replaced.go).toBe(true);
    expect(replaced.walk.stops.map(stop => stop.find)).toEqual(['z', 'w']);
  });
  it('--then with nothing to add to starts a walk', () => {
    expect(extendWalk(undefined, request({ append: true, stops: [{ find: 'x' }] })).go).toBe(true);
  });
  it('is bounded and stops at its ends', () => {
    const stops = Array.from({ length: 30 }, (_, i) => ({ find: String(i) }));
    let { walk } = extendWalk(undefined, request({ stops }));
    ({ walk } = extendWalk(walk, request({ stops, append: true })));
    expect(walk.stops).toHaveLength(MAX_WALK_STOPS);
    expect(stepWalk(walk, -1).index).toBe(0);
    expect(stepWalk({ ...walk, index: MAX_WALK_STOPS - 1 }, 1).index).toBe(MAX_WALK_STOPS - 1);
  });
});
