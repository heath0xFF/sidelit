# Sidelit interface

## Direction

Operate and Read: a familiar desktop writing tool, as requested. The folder tree, tabs, and toolbar stay where desktop users expect them. The document is the main work area. A small three-bar mark is the only brand ornament.

The theme selector offers System (default), One Light, and One Dark. System follows live OS changes; an explicit override is retained. One Light uses a #fafafa document surface and #383a42 text. One Dark uses #282c34 and #abb2bf. Chrome uses neutral gray; blue identifies active controls and selection. Amber identifies a disk conflict, never a routine action. Syntax colors follow the One palette, with darker light-theme text colors for contrast. CSS tokens are shared by the shell, Crepe code blocks, and Monaco.

The old boolean theme setting was written automatically on launch. It is not treated as an explicit preference during migration; upgraded installations start in System mode until the user makes a new choice. System, sun, and moon icons use simple SVG geometry with consistent strokes.

## Type and space

System sans remains in the shell. Rendered writing uses IBM Plex Sans; source, Compare, inline code, and fenced code use Inconsolata. Variable WOFF2 files are bundled through Fontsource, including IBM Plex Sans italic faces, with SIL OFL notices in `public/licenses/`.

UI labels stay at 12–13px. Document text defaults to 16px with 1.5 line height, and can be adjusted from 12–28px using A− / A+, the reset value, or Cmd/Ctrl+Plus, Minus, and 0. Headings, tables, code, and list markers scale with the setting. List marker boxes follow the first paragraph's line height plus its padding. The document column is at most 790px, including 56px side padding. Headings have more space above than below. Appearance changes must never remount either editor or change the document buffer.

The toolbar is 56px high, tabs 39px, and status bar 29px. The sidebar starts at 240px and supports pointer and keyboard resizing from 170–440px. The minimum window is 720×480.

## Behavior

Rendered and Source are alternate modes, not split panes. A forced Source fallback remains selected until the user changes mode. Frontmatter stays outside the rendered body, with a short note that metadata can be edited in Source.

A conflict uses a visible banner with Compare, Reload from Disk, and Save Copy. Comparison labels identify the read-only reviewed disk version and the editable draft. Change arrows accept individual disk changes; they have keyboard focus, labels, and Enter/Space support. Save Merged checks the reviewed version. Clean external changes offer a separate read-only review.

The Actions disclosure keeps New File, Save As, Quick Open, and Session & Recovery out of the main writing controls. Quick Open uses a labelled combobox with keyboard selection, loading/error states, and a bounded results list. Recovery is off by default and states its retention, privacy, and data-loss limits before activation. The HTML `<dialog>` element contains modal focus and returns it to the previous control. Close and Quit use a focused three-choice confirmation and block competing UI actions while they validate live drafts.

Use visible focus rings, restrained hover fills, and no decorative motion. Native menus supply desktop clipboard actions. No font or image CDN is required.

## Review

Inspected packaged macOS captures in dark mode: rendered document, source, and diff. Fixed low-contrast list markers and inline code. The first source capture was taken before paint; the final check waits for visible source text. Automated design checks reported no findings. Light theme was also captured. The native resize request did not change the captured viewport, so narrow-window visual checks remain manual. A user-reported list alignment issue was fixed by removing the first paragraph's top margin inside each list item and matching marker line height to the text. Packaged geometry checks cover tasks, two-digit numbers, wrapped items, and nested lists at 12, 16, 24, and 28px. The font/theme update was inspected in packaged WKWebView in both themes, including rendered code blocks and Monaco. Local font loading, live sizing, persistence, and editor identity were checked. The mechanical design check reported no findings. The recovery/merge update kept the existing palette, type, and spacing. Packaged captures cover frontmatter editing, Quick Open, editable Compare, clean-change review, recovery settings, and the startup restore offer. Follow-up changes removed a duplicate comparison action, corrected a singular result label, and made checkpoint limits more explicit. Native dialogs, screen-reader use, and narrow-window layout still require manual checks.
