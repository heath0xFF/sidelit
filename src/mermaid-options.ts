import type { RenderOptions } from 'pele';

// shortcut: size bounds do not limit CPU time; use a worker if diagrams stall the app.
export const mermaidOptions: RenderOptions = {
  links: false, images: false, limit: 20_000, outputLimit: 1_000_000, maxEdges: 500,
};
