---
title: Mermaid diagrams
---

# Review the flow

Diagrams draw in the rich editor. Choose **Edit** to change the prose or a diagram.

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

The block shows an error and keeps its source. This example is intentionally invalid.

```mermaid
not a diagram
```
