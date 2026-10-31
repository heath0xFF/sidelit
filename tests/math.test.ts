import { describe, expect, it } from 'vitest';
import { displayMath, findInlineMath } from '../src/math';

const sources = (text: string) => findInlineMath(text).map(m => m.source);
describe('math detection', () => {
  it('finds inline math', () => {
    expect(sources('Energy $E=mc^2$ here, and $$x+y$$ too.')).toEqual(['E=mc^2', 'x+y']);
    expect(findInlineMath('a $x$ b')).toEqual([{ from: 2, to: 5, source: 'x' }]);
  });
  it.each([
    'Budget is $500 and $HOME, from $5 to $10.', 'Price $5 only.', 'Costs $5, or $6.', '$HOME and $PATH', '$HOME/$PATH',
    'US$5 and US$6', 'a $ b $ c', 'pay $ 5$', 'escaped \\$x\\$', '$', '$$', '$$$$',
  ])('leaves %s as text', text => { expect(findInlineMath(text)).toEqual([]); });
  it('recognizes a paragraph that is only display math', () => {
    expect(displayMath('$$\nE=mc^2\n$$')).toBe('E=mc^2');
    expect(displayMath('$$x$$')).toBe('x');
    expect(displayMath('text $$x$$')).toBeUndefined();
    expect(displayMath('$$a$$ and $$b$$')).toBeUndefined();
  });
  it('does not stall on long text of dollars', () => {
    const start = Date.now();
    findInlineMath('$a '.repeat(50000));
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
