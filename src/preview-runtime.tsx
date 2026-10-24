// This bundle executes only in the opaque-origin preview frame.
import React from 'react';
import { createRoot } from 'react-dom/client';
import * as runtime from 'react/jsx-runtime';
import { PreviewCodeBlock } from './preview-mermaid';

const config = JSON.parse(document.getElementById('sidelit-mdx')!.textContent!);
const components = { pre: PreviewCodeBlock, ...Object.fromEntries(['Callout', 'Card', 'Badge', 'Stack'].map(name => [name,
  ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => React.createElement(name === 'Badge' ? 'span' : 'div', { ...props, className: `sidelit-${name.toLowerCase()} ${props.className || ''}` }, children),
])) };
class RenderBoundary extends React.Component<React.PropsWithChildren, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: unknown) { return { error: String(error) }; }
  render() { return this.state.error ? React.createElement('pre', { role: 'alert' }, 'Preview rendering failed: ' + this.state.error) : this.props.children; }
}
try {
  const { default: Content } = new Function(config.code)({ ...runtime, baseUrl: 'https://sidelit.invalid/' });
  createRoot(document.getElementById('sidelit-root')!).render(React.createElement(RenderBoundary, null, React.createElement(Content, { components })));
} catch (error) {
  document.getElementById('sidelit-root')!.textContent = 'Preview rendering failed: ' + String(error);
  throw error;
}
