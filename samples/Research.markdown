---
title: A note with frontmatter
tags: [research, sample]
---

# Preserving what we do not render

This document mixes math, Mermaid, and raw HTML. The rich editor keeps them unchanged, and comments stay hidden. Frontmatter stays unchanged too. Opening, changing modes, and a no-op Save must preserve all bytes.

```mermaid
graph LR
  Agent --> Markdown
  Markdown --> Sidelit
```

$$ E = mc^2 $$

<aside data-example="opaque">This HTML remains text, not an executable page.</aside>
