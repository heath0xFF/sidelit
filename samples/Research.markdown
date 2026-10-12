---
title: A note with frontmatter
tags: [research, sample]
---

# Preserving what we do not render

This document opens in Source mode because its body includes math, Mermaid, and raw HTML. Frontmatter alone can use rendered editing; its metadata stays unchanged. Opening, changing modes, and a no-op Save must preserve all bytes.

```mermaid
graph LR
  Agent --> Markdown
  Markdown --> Sidelit
```

$$ E = mc^2 $$

<aside data-example="opaque">This HTML remains text, not an executable page.</aside>
