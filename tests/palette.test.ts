// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mdxStyle } from '../src/preview-html';

const luminance = (hex: string) => [0.2126, 0.7152, 0.0722].reduce((sum, weight, i) => {
  const value = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return sum + weight * (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
}, 0);
function contrast(foreground: string, background: string) {
  const [low, high] = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (high + 0.05) / (low + 0.05);
}

describe('The Fold palette contrast', () => {
  const shell = readFileSync('src/style.css', 'utf8');
  const blocks = [...shell.matchAll(/:root(?:\[data-theme="dark"\])?\s*\{([^}]+)\}/g)]
    .map(match => Object.fromEntries([...match[1].matchAll(/--([\w-]+):\s*(#[\da-f]{6});/g)].map(match => [match[1], match[2]])));
  for (const [index, theme] of ['light', 'dark'].entries()) {
    it(`keeps ${theme} shell and editor text readable`, () => {
      const colors = { ...blocks[0], ...blocks[index] };
      const pairs = [['text', 'paper'], ['muted', 'paper'], ['muted', 'chrome'], ['accent', 'paper'], ['accent', 'chrome'], ['accent', 'selected'], ['on-action', 'action'], ['on-action', 'action-hover'], ['text', 'selected'], ['text', 'warning'], ['error', 'paper'], ['error', 'chrome'], ['error', 'warning']];
      for (const key of Object.keys(colors).filter(key => key.startsWith('syntax-'))) {
        pairs.push([key, 'paper'], [key, 'chrome']);
      }
      for (const [fg, bg] of pairs) expect(contrast(colors[fg], colors[bg]), `${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    });
    it(`keeps ${theme} actions and focus visible against their surfaces`, () => {
      const colors = { ...blocks[0], ...blocks[index] };
      for (const foreground of ['accent', 'action', 'action-hover']) {
        for (const background of ['paper', 'chrome', 'hover', 'active']) {
          expect(contrast(colors[foreground], colors[background]), `${theme}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(3);
        }
      }
    });
    it(`keeps ${theme} preview links, diagrams, and selections aligned with the shell`, () => {
      const colors = { ...blocks[0], ...blocks[index] };
      const prefix = theme === 'light' ? 'html[data-theme=light] ' : '';
      expect(mdxStyle).toContain(`${prefix}a{color:${colors.accent}}`);
      expect(mdxStyle).toContain(`--pele-accent:${colors.accent};`);
      expect(mdxStyle).toContain(`${prefix}::selection{background:${colors.selected};color:${colors.text}}`);
    });
    it(`keeps ${theme} MDX syntax readable in the isolated stylesheet`, () => {
      const colors: Record<string, string> = {};
      const rules = mdxStyle.split('}').map(rule => rule.split('{')).filter(([selector]) => selector.includes('.tok-'));
      for (const explicitLight of [false, true]) {
        if (explicitLight && theme !== 'light') continue;
        for (const rule of rules) {
          if (rule[0].includes('data-theme=light') !== explicitLight) continue;
          const color = rule[1].match(/(?:^|;)color:(#[\da-f]{6})/)?.[1];
          if (color) for (const token of rule[0].matchAll(/\.tok-([\w]+)/g)) colors[token[1]] = color;
        }
      }
      expect(Object.keys(colors).length).toBeGreaterThanOrEqual(7);
      const background = { ...blocks[0], ...blocks[index] }.chrome;
      for (const [token, color] of Object.entries(colors)) expect(contrast(color, background), `${theme}: MDX ${token}`).toBeGreaterThanOrEqual(4.5);
    });
  }
});
