---
title: Mermaid preview
---

# Review the flow

This document uses a read-only Mermaid preview. Use **Source** to change the prose or diagram code. Previewing and changing the theme must not change the file.

## From draft to review

```mermaid
flowchart LR
    Draft[Agent writes a draft] --> Preview[Read in Sidelit]
    Preview --> Review{Changes needed?}
    Review -->|Yes| Feedback[Send feedback to Pi]
    Feedback --> Draft
    Review -->|No| Done[Keep the document]
```

## A review request

```mermaid
sequenceDiagram
    participant Human
    participant Sidelit
    participant Pi
    Human->>Sidelit: Select a passage
    Sidelit->>Pi: Send a review request
    Pi-->>Human: Answer in the terminal
```

## If a diagram cannot render

The source stays available with an error. This example is intentionally invalid.

```mermaid
not a diagram
```
