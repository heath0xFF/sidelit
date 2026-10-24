---
name: Sidelit
description: A visual work surface beside Rex.
colors:
  accent: "#b4a7ff"
  action: "#6950e8"
  action-hover: "#5b42d5"
  on-action: "#ffffff"
  paper: "#333643"
  chrome: "#30323e"
  hover: "#3a3d4b"
  active: "#414452"
  rule: "#404350"
  text: "#d5d6df"
  muted: "#a5a7b8"
  line: "#55596b"
  selected: "#504a6c"
  warning: "#443c2d"
  error: "#e06c75"
  syntax-keyword: "#d797e6"
  syntax-string: "#98c379"
  syntax-number: "#d19a66"
  syntax-function: "#61afef"
  syntax-variable: "#f08c95"
  syntax-type: "#e5c07b"
  light-accent: "#6346c7"
  light-paper: "#fafafd"
  light-chrome: "#eeeef4"
  light-hover: "#e4e4ec"
  light-active: "#dcdce7"
  light-rule: "#dedee8"
  light-text: "#363744"
  light-muted: "#686a7c"
  light-line: "#c7c8d6"
  light-selected: "#e5def9"
  light-warning: "#fff2d5"
  light-error: "#b83a34"
  light-syntax-keyword: "#a626a4"
  light-syntax-string: "#397a38"
  light-syntax-number: "#805500"
  light-syntax-function: "#326ac6"
  light-syntax-variable: "#b83a34"
  light-syntax-type: "#805500"
typography:
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
  status:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "11px"
  body:
    fontFamily: '"IBM Plex Sans Variable", sans-serif'
    fontSize: "16px"
    lineHeight: 1.5
  code:
    fontFamily: '"Inconsolata Variable", monospace'
    fontSize: "16px"
    lineHeight: 1.5
  heading-1:
    fontFamily: '"IBM Plex Sans Variable", sans-serif'
    fontSize: "2em"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  heading-2:
    fontFamily: '"IBM Plex Sans Variable", sans-serif'
    fontSize: "1.4375em"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.015em"
  heading-3:
    fontFamily: '"IBM Plex Sans Variable", sans-serif'
    fontSize: "1.125em"
    fontWeight: 600
    lineHeight: 1.4
rounded:
  control: "6px"
  surface: "10px"
  tab: "16px"
  dialog: "12px"
  search: "5px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.on-action}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-primary-compact:
    backgroundColor: "{colors.action}"
    textColor: "{colors.on-action}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  button-ghost:
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
  button-bordered:
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
  tab-active:
    backgroundColor: "{colors.active}"
    textColor: "{colors.text}"
    rounded: "{rounded.tab}"
  mode-switch:
    backgroundColor: "{colors.hover}"
    rounded: "{rounded.surface}"
    padding: "2px"
  search-input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.text}"
    rounded: "{rounded.search}"
    padding: "10px 12px"
  feedback-input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "9px 10px"
  mdx-badge:
    padding: "2px 6px"
  mdx-card:
    padding: "12px 16px"
---

# Design System: Sidelit

## Overview

**Creative North Star: "A visual work surface beside Rex"**

Sidelit uses the observed native Superlogical Rex language: blue-charcoal layers, violet actions, quiet outline icons, soft tabs, and inset panes. These colors are Sidelit approximations, not official Rex tokens. The public documentation website has a different light design and is not the visual source. No Rex logos, proprietary fonts, or artwork are copied.

The interface stays compact around the document. Preserve the folder tree, tabs, Rendered/Source modes, explicit saves, and contextual feedback to Pi. Dark is the new-install default; explicit System and Light preferences remain valid. HTML and development-server pages retain their own visual identity.

**Key Characteristics:**

- Tonal layers and restrained borders keep the document prominent.
- Violet distinguishes intentional actions, focus, inspection, and unsaved state.
- Bundled prose and monospace fonts support offline reading and editing.

Source of truth: `src/style.css`, `src/App.tsx`, `src/Rich.tsx`, `src/SelectionActions.tsx`, `src/FeedbackComposer.tsx`, and the isolated stylesheet in `src/preview-html.ts`. Existing packaged captures are in `test-results/polish/rex/` (1180×790, 720×630, and minimum 720×480), with `test-results/companion-mdx.png` and `companion-mdx-light.png` for standalone MDX. These are reference artifacts, not a claim of new testing in this documentation pass.

## Colors

Dark uses blue-charcoal surfaces and a pale violet accent; Light keeps the same hierarchy on cool pale surfaces. Unprefixed frontmatter tokens describe Dark; `light-*` entries are Light overrides. Action, action-hover, and on-action are shared. The sidebar uses chrome.

### Primary

Accent colors serve links, Save, focus rings, inspection outlines, and unsaved dots. The stronger action fill serves primary buttons and the open-sidebar toggle, with white on-action text.

### Neutral

Paper is the work surface; chrome frames it and backs code blocks. Hover and active provide neutral interaction layers. Rule is the quiet separator; line bounds inputs and overlays. Text and muted distinguish document content from supporting labels. Selected is the violet-tinted text/inspection selection.

### Semantic colors

Warning is amber; error is red. Syntax retains keyword, string, number, function, variable, and type roles. The corrected light amber and dark keyword/variable values are normative in frontmatter. `tests/palette.test.ts` covers shell/editor text and syntax contrast, plus isolated MDX syntax, at a minimum 4.5:1 for its enumerated pairs. It is not a blanket accessibility certification.

**The State Color Rule.** Use neutral fills for selected tabs and tree rows, violet for actions and focus, and amber for conflicts and preview warnings. Preserve text labels alongside status color.

## Typography

System sans labels frame IBM Plex Sans prose and Inconsolata code. UI labels are generally 12–13px; status text is 11px. Document text defaults to 16px and adjusts from 12–28px. Markdown uses 1.5 line height; its relative heading ramp is recorded above, with lower headings at 1em/600. There is no general display-font role.

Standalone MDX uses the same bundled fonts through `SidelitProse` and `SidelitMono` aliases, with 1.6 body line height, 1.25 for h1–h3, and code at 0.95em. It has its own document stylesheet rather than identical Crepe geometry. Fontsource variable WOFF2 files, including prose italics, and SIL OFL notices in `public/licenses/` remain bundled offline.

**The Stable Editor Rule.** Theme and text-size changes update appearance without remounting editors, replacing models, or changing canonical text.

## Layout

The shell fills the window: toolbar (48px), horizontal tabs (40px minimum), flexible work area, and status bar (26px). The explorer starts at 240px and resizes by pointer or keyboard within 170–440px. The main pane has an 8px horizontal/bottom inset. Reuse the 4/8/12/16px spacing rhythm and 30px minimum control height.

Markdown has no maximum reading width: horizontal gutters are `max(32px, 10%)`, with 40px top and 96px bottom padding. Headings have more space above than below; the first document block has no top margin, even after a cursor widget. Lists align markers to the first paragraph at every text size. Tables use compact cells and a neutral header.

At 1000px and below, toolbar action labels collapse to accessible icons. At 900px and below, the toolbar and change notices wrap, Markdown vertical padding becomes 32px/80px, and status gaps narrow. The desktop minimum is 720×480; this is not a mobile navigation system.

Standalone MDX uses 32px vertical padding and `max(24px, 8%)` horizontal gutters. The preview toolbar wraps its controls; fluid frames have no outer padding, while a fixed-width preview has 18px around it.

Selection actions sit beside the captured text. The compact request composer is a single column, capped at 420px wide. At widths of 1000px or more it uses the captured selection anchor when there is room; otherwise it docks at the lower right above the status area. Narrow windows always use the dock. Its height is bounded, with the intent/Hide header and Pi target, delivery actions, and status outside the scrolling context/instruction body. Preserve this split when attached context expands.

## Elevation & Depth

Ordinary chrome, tabs, menus, and the feedback panel use tonal layering and thin borders without shadows. Modal dialogs alone use `0 16px 50px #0003` with a `#0005` backdrop. Menus and feedback sit above content without making every pane a floating card.

**The Inset Pane Rule.** Keep work inside the softly rounded inset pane; use tonal separation for ordinary chrome and reserve the modal shadow for dialogs.

No decorative transitions are defined. Scrolling is immediate; reduced-motion styling explicitly preserves automatic scroll behavior.

## Shapes

Controls use gentle corners, panes and menus use larger corners, and tabs plus the sidebar toggle use capsule-like corners. Close buttons and unsaved dots are circular. Dialog and Quick Open field radii are deliberate existing variants recorded above. Outline SVG icons are generally 16px with a 1.6 stroke on a 24-unit viewBox; tab close icons are 12px. Icons retain their width beside truncated filenames.

## Components

- **Buttons:** quiet transparent defaults, neutral hover, and half-opacity disabled states. Primary buttons use the shared action fill and darker action hover; feedback uses the compact primary variant. Secondary dialog/conflict actions add a line border. Focus is a 2px accent outline inset by 2px; filled actions use a white outline inset by 4px.
- **Navigation:** soft active tabs, neutral selected tree rows, ellipsized filenames, horizontal tab overflow, and separate named close controls. The mode switch groups two pressed-state buttons; Rendered and Source are alternatives. A fidelity-forced Source fallback stays selected until the user changes mode.
- **Actions and fields:** the native details disclosure groups file operations, recovery, update checks, theme, and text size. Appearance adjustments keep it open; Escape closes it and returns focus, while outside input/focus closes it. Quick Open is a labelled combobox with keyboard selection, bounded results, and loading/error states. Inputs use quiet line borders, muted placeholders, and visible focus.
- **Document safety:** frontmatter stays outside rendered prose with a Source note. Amber conflicts expose Compare, Reload from Disk, and Save Copy. Comparison identifies the read-only reviewed disk version and editable draft; change arrows remain labelled and keyboard-operable. Save Merged checks the reviewed hash. Clean external changes have a separate read-only review.
- **Reading and selection:** rendered Markdown starts read-only. Toolbar Edit enables direct editing; Done editing returns to reading, as do tab and mode changes. Text selection exposes adjacent Explain, Review, and Edit request actions. Request Edit asks Pi for a change; it is separate from the toolbar's local editing control.
- **Request composer:** one in-memory request retains its intent, instruction, captured context, and delivery state across tabs and Hide/Escape. The toolbar's Request action reopens it. A new selection is offered through Use new selection before sending; it never silently replaces the attachment. The pressed intent uses the selected fill; the summary and document label lead a collapsible Attached context disclosure and one instruction field.
- **Context and highlight:** amber notices distinguish unsaved captures, changed file context, and live-page uncertainty. Stale file context requires Send the captured version before the first send. The attachment highlight uses a violet tint and outline independently of native text selection, including while the composer is hidden. Reveal selection returns to the attached document and locates the capture; missing or ambiguous text, mismatched elements, and changed page routes fail closed. A closed file must be reopened first.
- **Pi delivery:** Explain and Review request answers in Pi without file edits and allow an optional instruction; Edit requires an instruction. A remembered connected target or the only connected session may be selected; otherwise the user chooses. The first send attempt freezes target, intent, instruction, and context; Retry delivery reuses the same message ID and payload. Received, queued, and accepted describe delivery only. Answers appear in Pi; Show in Rex is available when the target has a Rex block. Discard request or New request explicitly clears the retained request. There is no batch queue or request persistence after app exit.
- **Dialogs, recovery, updates:** native modal focus containment and focus return; close/quit use live draft approvals and block competing actions while validating. Recovery is off by default, discloses privacy/retention limits, requires native approval to restore, excludes discarded drafts, and waits for writes before off-and-delete. Updates use the quiet changes banner, explicit Install & Restart, safe draft approvals, and a modal progress state; failure returns to the draft. Background checks stay quiet.
- **Preview continuity:** HTML/MDX refresh retains a visible anchor and viewport offset, with pixel fallback and up to eight scrolled containers. Memory holds at most 32 document positions, never disk persistence. Restoration yields to user input; the opt-in development-server bridge never restores a different route. MDX appearance updates without remount; HTML/server page styles stay their own.
- **Mermaid previews:** Markdown with diagrams uses the isolated preview layout, not the editable Crepe view. A read-only note points to Source. Diagrams use the existing prose fonts and theme colors; each has a keyboard-accessible Diagram source disclosure. Invalid or over-limit diagrams show the source and an error without hiding the rest of the document. MDX uses the same diagram renderer. Appearance changes do not reload the frame or change the source.
- **Standalone MDX primitives:** cards/callouts use a thin border with 12px/16px padding; badges use 2px/6px padding; stacks use a 12px gap. Their current fixed border/badge colors and distinct light string color remain local implementation drift, not shared palette tokens. The sidecar records their actual snippets without promoting those exceptions to new-screen rules.

## Do's and Don'ts

### Do:

- Do preserve the native folder tree, tabs, Rendered/Source switch, explicit Save, and contextual Pi composer.
- Do keep visible keyboard focus, accessible names on icon controls, native dialogs, and the active editor's Undo/Redo history; disk reloads clear editor history.
- Do preserve dirty drafts through external changes and failed operations. Reload needs explicit discard consent; Save Merged uses the explicitly reviewed disk hash.
- Do keep close, quit, and update approvals tied to live document revisions after awaits; retain opt-in, bounded, private recovery separate from originals.
- Do preserve HTML/MDX reading position through the bounded bridge and yield restoration immediately to user input.
- Do bundle the existing fonts and OFL notices; keep document list markers aligned throughout the supported text-size range.

### Don't:

- Don't let mount, focus, mode switches, appearance updates, or no-op Save alter canonical text or file bytes; only real editor transactions update drafts.
- Don't overwrite a disk conflict or replace newer edits with a save acknowledgment. Re-read and hash-check disk before an atomic save; update the baseline separately.
- Don't execute document HTML or MDX in the privileged webview. Keep local execution in the opaque-origin sandbox without native APIs, and require an explicitly opened development-server origin and opt-in inspection bridge.
- Don't bypass native path approval, filesystem grants, the Markdown fidelity gate, or frontmatter preservation.
- Don't install or restart silently, accept unsigned or version-mismatched updates, or treat Pi delivery acknowledgment as completed work.
- Don't add decorative motion, a permanent chat timeline, remote font dependencies, or Rex's terminal layout.
