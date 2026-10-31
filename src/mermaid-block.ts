import { mermaidOptions } from './mermaid-options';

let diagrams = 0;

// Runs in the main window: links and images are off, Crepe sanitizes the SVG, and the app's CSP blocks scripts.
export function renderMermaidBlock(language: string, content: string, apply: (value: string | null) => void) {
  if (language.toLowerCase() !== 'mermaid') return null;
  // Separate IDs stop markers in one diagram resolving to another on the same page.
  const idPrefix = `sidelit-mermaid-${++diagrams}`;
  void import('pele').then(({ render }) => {
    try { apply(render(content, { ...mermaidOptions, idPrefix }).svg); }
    catch { apply('<p role="status">Diagram unavailable. Check its source.</p>'); }
  }).catch(() => apply('<p role="status">Diagram unavailable. Check its source.</p>'));
}
