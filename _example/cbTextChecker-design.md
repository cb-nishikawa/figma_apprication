---
version: alpha
name: cbTextChecker (もじ検索比較くん) Plugin Design
description: The design language of cbTextChecker, a Figma plugin that searches, compares and OCR-checks text. A compact 360px tool panel that blends into the Figma editor — white surfaces, hairline gray borders, 12px type and a single Figma-blue action color — paired with a canvas-side overlay vocabulary of four translucent highlight colors, a dashed target outline and tiny copyable OCR labels.

colors:
  primary: "#18a0fb"            # Figma Blue — focus, hover border, checked mode, links, spinner
  primary-hover: "#0b79c9"      # Deep Blue — link hover (history footer)
  primary-tint: "#eaf6ff"       # Blue Tint — hover/active row, checked mode, resize hover
  primary-tint-strong: "#d6eeff" # Blue Tint Strong — selected option in picker lists
  primary-wash: "#f5fbff"       # Blue Wash — target picker button hover
  primary-wash-alt: "#f3f9ff"   # Blue Wash Alt — selected color option
  spinner-track: "#d0e8ff"      # Pale Blue — spinner ring track
  surface: "#ffffff"            # White — app body, inputs, buttons, popovers
  surface-soft: "#fafafa"       # Off White — compare/image rows, add button
  surface-muted: "#f5f5f5"      # Light Gray — mode radios, hidden rows, icon-button hover
  surface-hover: "#f3f3f3"      # Hover Gray — keyword row, result header, menu item hover
  surface-handle: "#f7f7f7"     # Handle Gray — bottom resize handle
  chip: "#eef2f6"               # Cool Chip — A/B side badge in match rows
  ink: "#333333"                # primary text
  ink-strong: "#444444"         # ignore-category checkbox labels
  ink-soft: "#555555"           # radio text, counts, pin/copy icons
  ink-muted: "#666666"          # previews, OCR status, expand chevron
  muted: "#888888"              # empty states, swap icon, match counts
  placeholder: "#999999"        # empty picker label, list empty text
  disabled: "#bbbbbb"           # disabled menu item text
  disabled-glyph: "#cccccc"     # swap icon in hidden rows
  border: "#cfcfcf"             # text inputs, textarea, picker button
  border-control: "#d0d0d0"     # icon buttons, radios, pin, color trigger
  border-popover: "#d8d8d8"     # popover and menu panels
  border-row: "#e8e8e8"         # compare/image row frame
  border-dashed: "#c8c8c8"      # add-row button dashed border
  divider: "#e5e5e5"            # section divider, resize handle top border
  hairline: "#eeeeee"           # list frames, history separators
  grip: "#c0c0c0"               # resize handle grip lines
  success: "#1a7f37"            # pinned state
  success-tint: "#eaf6ee"       # pinned button fill
  error: "#b00020"              # error text
  error-surface: "#fff0f0"      # error banner fill
  error-border: "#f5c2c2"       # error banner border
  hl-red: "#ff3b30"             # canvas highlight / swatch — red
  hl-yellow: "#ffcc00"          # canvas highlight / swatch — yellow
  hl-green: "#00ff40"           # canvas highlight / swatch — green (default), target outline
  hl-purple: "#a154f2"          # canvas highlight / swatch — purple
  ocr-label-ink: "#000000"      # canvas OCR label text (90% opacity)

typography:
  body:
    fontFamily: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Sans", "Noto Sans JP", sans-serif
    fontSize: 12px
    fontWeight: 400
    lineHeight: normal
    letterSpacing: 0
  input:
    fontFamily: inherit
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0
  heading:
    fontFamily: inherit
    fontSize: 12px
    fontWeight: 600
    lineHeight: normal
    letterSpacing: 0
  label:
    fontFamily: inherit
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: 0
  caption:
    fontFamily: inherit
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: 0
  micro:
    fontFamily: inherit
    fontSize: 10px
    fontWeight: 400
    lineHeight: normal
    letterSpacing: 0
  micro-strong:
    fontFamily: inherit
    fontSize: 10px
    fontWeight: 600
    lineHeight: normal
    letterSpacing: 0
  badge:
    fontFamily: inherit
    fontSize: 9px
    fontWeight: 700
    lineHeight: 1
    letterSpacing: 0
  glyph:
    fontFamily: inherit
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1
    letterSpacing: 0
  menu-glyph:
    fontFamily: inherit
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1
    letterSpacing: 0
  canvas-ocr-label:
    fontFamily: Noto Sans JP, Inter, Roboto
    fontSize: 8px
    fontWeight: 400
    lineHeight: 10px
    letterSpacing: 0

rounded:
  none: 0px
  xxs: 1px
  xs: 2px
  sm: 3px
  md: 4px
  lg: 6px
  full: 50%

spacing:
  xxs: 2px
  xs: 4px
  sm: 6px
  md: 8px
  lg: 10px
  xl: 12px
  xxl: 14px
  section: 16px

components:
  app-shell:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "{spacing.xl} {spacing.xxl} {spacing.section}"
    gap: "{spacing.lg}"
    width: 360px
    height: 560px
    minHeight: 320px
    maxHeight: 900px
  resize-handle:
    backgroundColor: "{colors.surface-handle}"
    borderColor: "{colors.divider}"
    gripColor: "{colors.grip}"
    hoverBackground: "{colors.primary-tint}"
    hoverGripColor: "{colors.primary}"
    height: 12px
  section-heading:
    textColor: "{colors.ink}"
    typography: "{typography.heading}"
  divider:
    backgroundColor: "{colors.divider}"
    height: 1px
  mode-radio:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.ink-soft}"
    borderColor: "{colors.border-control}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "5px {spacing.md}"
  mode-radio-checked:
    backgroundColor: "{colors.primary-tint}"
    textColor: "{colors.primary}"
    borderColor: "{colors.primary}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "5px {spacing.md}"
  target-picker-button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "{spacing.xs} {spacing.md}"
    height: 28px
  target-picker-button-empty:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.placeholder}"
    borderColor: "{colors.border}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "{spacing.xs} {spacing.md}"
    height: 28px
  target-picker-button-hover:
    backgroundColor: "{colors.primary-wash}"
    textColor: "{colors.ink}"
    borderColor: "{colors.primary}"
    rounded: "{rounded.md}"
    canvasEffect: "{components.canvas-target-outline}"
  target-picker-button-disabled:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border}"
    rounded: "{rounded.md}"
    opacity: 0.55
  target-picker-popover:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.border-popover}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
    gap: "{spacing.sm}"
    minWidth: 180px
    listMaxHeight: 168px
    optionPadding: "{spacing.sm} {spacing.md}"
    optionHover: "{colors.primary-tint}"
    optionSelected: "{colors.primary-tint-strong}"
  target-history-popover:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.border-popover}"
    titleTypography: "{typography.label}"
    footerColor: "{colors.primary}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
    width: 220px
    listMaxHeight: 240px
  text-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border}"
    focusBorderColor: "{colors.primary}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 {spacing.md}"
    height: 28px
  keyword-row:
    backgroundColor: transparent
    hoverBackground: "{colors.surface-hover}"
    rounded: "{rounded.md}"
    padding: "{spacing.xs}"
    gap: "{spacing.xs}"
  keyword-textarea:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border}"
    focusOutline: "2px solid {colors.primary}"
    typography: "{typography.input}"
    rounded: "{rounded.md}"
    padding: "5px {spacing.md}"
    minHeight: 28px
  compare-pair-row:
    backgroundColor: "{colors.surface-soft}"
    borderColor: "{colors.border-row}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm}"
    gap: "{spacing.sm}"
  pair-swap-icon:
    textColor: "{colors.muted}"
    typography: "{typography.glyph}"
    width: 18px
  row-hidden:
    description: "Applied to a keyword, compare or image row that is hidden from the row menu."
    inputBackground: "{colors.surface-muted}"
    inputOpacity: 0.45
    swapIconColor: "{colors.disabled-glyph}"
  row-menu:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.border-popover}"
    triggerTypography: "{typography.menu-glyph}"
    itemTypography: "{typography.body}"
    itemHover: "{colors.surface-hover}"
    itemDisabled: "{colors.disabled}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xs}"
    minWidth: 96px
  btn-add-full:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink-soft}"
    borderColor: "{colors.border-dashed}"
    typography: "{typography.glyph}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm} {spacing.md}"
  btn-add-full-hover:
    backgroundColor: "{colors.primary-tint}"
    textColor: "{colors.primary}"
    borderColor: "{colors.primary}"
    rounded: "{rounded.md}"
  btn-icon:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border-control}"
    hoverBackground: "{colors.surface-muted}"
    rounded: "{rounded.md}"
    size: 28px
    iconSize: 14px
  btn-icon-compact:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border-control}"
    rounded: "{rounded.md}"
    size: 22px
    iconSize: 11px
  ignore-popover:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.border-popover}"
    checkTypography: "{typography.micro}"
    checkColor: "{colors.ink-strong}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
    width: 240px
  ocr-status:
    textColor: "{colors.ink-muted}"
    typography: "{typography.caption}"
    spinnerColor: "{colors.primary}"
    spinnerTrack: "{colors.spinner-track}"
    spinnerSize: 12px
  error-banner:
    backgroundColor: "{colors.error-surface}"
    textColor: "{colors.error}"
    borderColor: "{colors.error-border}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
  empty-state:
    textColor: "{colors.muted}"
    typography: "{typography.body}"
    padding: "{spacing.xs} 0"
  result-header:
    backgroundColor: transparent
    hoverBackground: "{colors.surface-hover}"
    textColor: "{colors.ink}"
    countColor: "{colors.ink-soft}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm} {spacing.md}"
    gap: "{spacing.sm}"
  result-pin:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-soft}"
    borderColor: "{colors.border-control}"
    rounded: "{rounded.md}"
    size: 22px
    iconSize: 10px
  result-pin-on:
    backgroundColor: "{colors.success-tint}"
    textColor: "{colors.success}"
    borderColor: "{colors.success}"
    rounded: "{rounded.md}"
    size: 22px
  result-color-select:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.border-control}"
    rounded: "{rounded.md}"
    size: 22px
    swatchSize: 12px
    swatchRounded: "{rounded.xs}"
    options: "{colors.hl-red} {colors.hl-yellow} {colors.hl-green} {colors.hl-purple}"
    optionSelectedBorder: "{colors.primary}"
    optionSelectedBackground: "{colors.primary-wash-alt}"
  match-item:
    backgroundColor: transparent
    hoverBackground: "{colors.primary-tint}"
    nameTypography: "{typography.micro-strong}"
    previewColor: "{colors.ink-muted}"
    countTypography: "{typography.micro}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm} {spacing.md}"
  match-side-badge:
    backgroundColor: "{colors.chip}"
    textColor: "{colors.ink-soft}"
    typography: "{typography.badge}"
    rounded: "{rounded.sm}"
    size: 14px
  ocr-copy-button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-soft}"
    borderColor: "{colors.border-control}"
    hoverBackground: "{colors.primary-tint}"
    hoverColor: "{colors.primary}"
    rounded: "{rounded.md}"
    size: 22px
    iconSize: 12px

  # ─── Canvas overlays (drawn on the Figma page, not in the plugin window) ───
  canvas-highlight:
    description: "Translucent rectangle over a matched text range or OCR region. Locked, grouped into a per-session pool."
    fillColor: "{colors.hl-green}"
    fillOpacity: 0.4
    strokeColor: "{colors.hl-green}"
    strokeWeight: 1px
    dashPattern: "10 10"
    variants: "{colors.hl-red} {colors.hl-yellow} {colors.hl-green} {colors.hl-purple}"
  canvas-ocr-label:
    description: "Unlocked text node at the page root, fitted inside an OCR highlight so the recognized text can be selected and copied."
    textColor: "{colors.ocr-label-ink}"
    textOpacity: 0.9
    typography: "{typography.canvas-ocr-label}"
  canvas-target-outline:
    description: "Dashed outline around the selected target layer while its picker button is hovered."
    fillColor: transparent
    strokeColor: "{colors.hl-green}"
    strokeWeight: 10px
    strokeAlign: outside
    dashPattern: "10 10"

  # ─── Examples (illustrative) — kit-mirror demonstration surfaces ───
  ex-pricing-tier:
    description: "Default Pricing tier card. Re-uses compare-pair-row chrome on the off-white surface."
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border-row}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
  ex-pricing-tier-featured:
    description: "Featured tier — uses the checked mode-radio treatment (blue tint fill, blue border and text)."
    backgroundColor: "{colors.primary-tint}"
    textColor: "{colors.primary}"
    borderColor: "{colors.primary}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
  ex-product-selector:
    description: "What's Included summary card — re-purposed for tool / B2B verticals (NOT a literal product gallery)."
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.border-popover}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
  ex-cart-drawer:
    description: "Subscription summary — line items separated by hairlines, like the history popover list."
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
    item-divider: "{colors.hairline}"
  ex-app-shell-row:
    description: "Sidebar nav row. Active state reuses the selected picker option (blue tint strong, 600 weight)."
    backgroundColor: "{colors.surface}"
    hoverBackground: "{colors.primary-tint}"
    activeBackground: "{colors.primary-tint-strong}"
    activeIndicator: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm} {spacing.md}"
  ex-data-table-cell:
    description: "Data-table th + td chrome. Header uses the 11px label style; body uses 12px body with tabular numerals for counts."
    headerBackground: "{colors.surface-muted}"
    headerTypography: "{typography.label}"
    bodyTypography: "{typography.body}"
    cellPadding: "{spacing.sm} {spacing.md}"
    rowBorder: "{colors.hairline}"
  ex-auth-form-card:
    description: "Sign-in card. Popover chrome with 28px text-input primitives inside."
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.border-popover}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
  ex-modal-card:
    description: "Modal dialog surface — popover chrome with the 16px soft shadow."
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.border-popover}"
    shadow: "0 4px 16px rgba(0, 0, 0, 0.12)"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
  ex-empty-state-card:
    description: "Empty-state frame. Muted gray copy on the off-white surface."
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.muted}"
    rounded: "{rounded.lg}"
    padding: "{spacing.section}"
    captionTypography: "{typography.caption}"
  ex-toast:
    description: "Toast notification — popover chrome with the 12px menu shadow."
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.border-popover}"
    shadow: "0 4px 12px rgba(0, 0, 0, 0.12)"
    rounded: "{rounded.lg}"
    padding: "{spacing.md} {spacing.xl}"
    typography: "{typography.body}"

---


## Overview

cbTextChecker (もじ検索比較くん) is a **Figma-native utility panel**. It never tries to look like a separate app: the window is a fixed 360px column of white surface, `{colors.ink}` 12px text and 1px gray borders, so it reads as part of the Figma editor's own property panels. The window is resized only vertically, from a 12px grip bar at the bottom (320–900px, 560px by default).

The panel is built from three stacked sections separated by `{colors.divider}` hairlines. The first is a **scope section**: three mode radios (検索 / 比較 / 画像) and the target pickers for the active mode. The second is the **keyword section**, shown only in search mode: auto-growing textarea rows and a dashed "＋" add button. The third is the **results section**: a heading with icon actions (ignore settings, re-run, clear all) and a nested accordion list of result groups.

Color is rationed to **one interactive voice**. `{colors.primary}` Figma Blue marks everything you can act on or have chosen: a hovered border, a checked mode, a focused field, a link, the spinner. Its tints (`{colors.primary-tint}`, `{colors.primary-tint-strong}`) mark hovered and selected rows. The only other saturated colors in the window are the pinned-green state (`{colors.success}`) and the error red (`{colors.error}`).

The second half of the system lives **on the Figma canvas**. Results are drawn back onto the design as translucent highlight rectangles in four user-selectable colors (`{colors.hl-red}`, `{colors.hl-yellow}`, `{colors.hl-green}`, `{colors.hl-purple}`). Two more overlays complete the set: a heavy dashed green outline that shows which layer a picker targets, and tiny 8px OCR labels that make recognized text copyable straight from the canvas. These are the loudest colors in the product, and they appear only where the user asked to see something.

**Key Characteristics:**
- A **fixed 360px, vertically resizable** panel that matches Figma's own UI density: 12px body, 11px labels, 28px controls, 4px corners.
- **One action color**: `{colors.primary}` and its tints carry all hover, focus, selection and link states. Gray carries structure.
- **Popovers, not pages**: target lists, history, ignore settings, row menus and color pickers all open as small 6px-rounded cards with a soft shadow, anchored to their trigger.
- **Rows as the unit of input**: keyword rows, compare pairs (A ↔ B) and the image row share one row grammar: content on the left, a "⋯" menu on the right (クリア / 非表示 / 削除).
- **Results as nested accordions**: each group header has an expand chevron, a label, a tabular count, a pin toggle and a color swatch. Expanded children list individual matches.
- **Canvas overlays are user-owned and session-scoped**: every highlight, label and outline is a page-root layer named with a per-launch session ID, so concurrent users never erase each other's overlays.

## Colors

The palette is **white and gray structure with a single blue for interaction**, plus a separate set of canvas colors for results. Read it in three layers: neutral chrome, blue interaction, and the canvas highlights.

### Interaction
- **Figma Blue** (`{colors.primary}` — #18a0fb): The single action color. It is used for:
  - Hovered and focused borders, and the textarea focus outline (2px, offset 1px)
  - The checked mode radio
  - The "候補一覧から選ぶ…" link, and the add-button and copy-button hover states
  - The spinner arc and the resize-grip hover
- **Deep Blue** (`{colors.primary-hover}` — #0b79c9): Link hover only.
- **Blue Tint** (`{colors.primary-tint}` — #eaf6ff): Hovered list options, hovered match rows, the checked radio fill, and the resize-handle hover.
- **Blue Tint Strong** (`{colors.primary-tint-strong}` — #d6eeff): The currently selected option in picker and history lists, always paired with 600 weight.
- **Blue Washes** (`{colors.primary-wash}` — #f5fbff, `{colors.primary-wash-alt}` — #f3f9ff): Very light hover fills for the picker button and the selected color option.
- **Spinner Track** (`{colors.spinner-track}` — #d0e8ff): The pale ring behind the spinning blue arc.

### Surface
- **White** (`{colors.surface}` — #ffffff): App body, inputs, buttons and every popover.
- **Off White** (`{colors.surface-soft}` — #fafafa): Compare and image row frames, and the dashed add button.
- **Light Gray** (`{colors.surface-muted}` — #f5f5f5): Unchecked mode radios, icon-button hover, and the input fill of hidden rows.
- **Hover Gray** (`{colors.surface-hover}` — #f3f3f3): Neutral hover for keyword rows, result headers and menu items.
- **Handle Gray** (`{colors.surface-handle}` — #f7f7f7): The bottom resize bar.
- **Cool Chip** (`{colors.chip}` — #eef2f6): The A/B side badge on compare matches.

### Text
- **Ink** (`{colors.ink}` — #333333): Primary text.
- **Ink Soft** (`{colors.ink-soft}` — #555555): Radio labels, counts, and pin and copy icons.
- **Ink Muted** (`{colors.ink-muted}` — #666666): Match previews, OCR status, and the expand chevron.
- **Muted** (`{colors.muted}` — #888888): Empty states, the ↔ swap glyph, and match counts.
- **Placeholder** (`{colors.placeholder}` — #999999): An unselected picker label ("ターゲット未選択") and "該当なし".
- **Disabled** (`{colors.disabled}` — #bbbbbb, `{colors.disabled-glyph}` — #cccccc): Disabled menu items, and the swap glyph in hidden rows.

### Borders
- **Input Border** (`{colors.border}` — #cfcfcf): Text inputs, the textarea and picker buttons.
- **Control Border** (`{colors.border-control}` — #d0d0d0): Icon buttons, radios, pin and color triggers.
- **Popover Border** (`{colors.border-popover}` — #d8d8d8): Popover and menu cards.
- **Row Border** (`{colors.border-row}` — #e8e8e8): Compare and image row frames.
- **Divider** (`{colors.divider}` — #e5e5e5) and **Hairline** (`{colors.hairline}` — #eeeeee): Section rules, list frames and history separators.
- **Dashed** (`{colors.border-dashed}` — #c8c8c8): The add-row button outline.

### Semantic
- **Pinned Green** (`{colors.success}` — #1a7f37 on `{colors.success-tint}` — #eaf6ee): A pinned result. Its highlight stays visible on the canvas.
- **Error** (`{colors.error}` — #b00020 on `{colors.error-surface}` — #fff0f0, bordered `{colors.error-border}` — #f5c2c2): The error banner above the results.

### Canvas Highlights
- **Red** (`{colors.hl-red}` — #ff3b30), **Yellow** (`{colors.hl-yellow}` — #ffcc00), **Green** (`{colors.hl-green}` — #00ff40, the default), **Purple** (`{colors.hl-purple}` — #a154f2). On the canvas they are painted at 40% fill opacity with a 1px dashed stroke of the same hue.
- The color-picker swatches in the plugin window use exactly the same four values, so what you pick is what is drawn. Both read one shared definition (`highlightPalette.ts`).
- **OCR Label Ink** (`{colors.ocr-label-ink}` — black at 90%): Text of the copyable OCR labels on the canvas.

## Typography

### Font Family
The UI uses the system stack **Inter → -apple-system → BlinkMacSystemFont → Segoe UI → Roboto → Hiragino Sans → Noto Sans JP**. Inter matches Figma's own UI. The two Japanese faces cover the labels and the user's text, which is mostly Japanese. Every control inherits the body font (`font: inherit`), so nothing introduces a second family.

On the canvas, OCR labels use the first available of **Noto Sans JP → Inter → Roboto** (Regular), so Japanese text renders correctly in any file.

### Hierarchy

| Token | Size | Weight | Line Height | Use |
|---|---|---|---|---|
| `{typography.menu-glyph}` | 16px | 400 | 1 | The "⋯" row-menu trigger |
| `{typography.glyph}` | 14px | 600 | 1 | "＋" add buttons, the ↔ swap glyph, icon-button glyphs |
| `{typography.heading}` | 12px | 600 | normal | Section headings ("チェック結果") |
| `{typography.body}` | 12px | 400 | normal | Default text, picker labels, result headers, menu items |
| `{typography.input}` | 12px | 400 | 1.4 | Keyword textarea |
| `{typography.label}` | 11px | 600 | 1.2 | Mode radios, popover titles |
| `{typography.caption}` | 11px | 400 | 1.3 | OCR status, list empty text, the history footer link |
| `{typography.micro-strong}` | 10px | 600 | normal | Match layer names |
| `{typography.micro}` | 10px | 400 | normal | Ignore-category checkboxes, match counts |
| `{typography.badge}` | 9px | 700 | 1 | A/B side badge |
| `{typography.canvas-ocr-label}` | 8px | 400 | 10px | Copyable OCR labels on the canvas |

### Principles
- **Small and even.** The steps between sizes are only 1–2px, as in Figma's own panels. Hierarchy comes from weight (600 for headings, labels and selected options) and from color (ink → soft → muted), not from size jumps.
- **Counts use tabular numerals** (`font-variant-numeric: tabular-nums`) so result counts line up down the list.
- **Truncate, don't wrap**: picker labels, result keywords and match names use a single-line ellipsis. Full text is in the `title` tooltip.
- **No letter spacing and no uppercase treatment.** Labels are Japanese and stay in plain case.

## Layout

### Spacing System
- **Base rhythm**: 4–8px (`{spacing.xs}`–`{spacing.md}`). Controls sit 6px apart (`{spacing.sm}`), list items 2–4px apart.
- **Tokens**:
  - `{spacing.xxs}` 2px, `{spacing.xs}` 4px, `{spacing.sm}` 6px, `{spacing.md}` 8px
  - `{spacing.lg}` 10px, `{spacing.xl}` 12px, `{spacing.xxl}` 14px, `{spacing.section}` 16px
- The app container is padded 12px top, 14px on the sides and 16px at the bottom, with a 10px gap between sections. Popovers pad 8–10px, and menu panels pad 4px.

### Grid & Container
- A **single column** at a fixed 360px window width. There is no multi-column layout.
- **Scope section**: a wrapping row of mode radios, then the mode's inline area:
  - Search mode shows one target picker.
  - Compare mode shows a stack of compare-pair rows and an add button.
  - Image mode shows one image row (image picker ↔ comparison target) and the OCR status line.
- **Compare and image rows**: the pickers fill a flexible left area (A ↔ B with an 18px swap glyph between them), and a fixed action column on the right holds the "⋯" menu.
- **Keyword rows**: a flexible textarea and a top-aligned action column (22px compact icon buttons and the "⋯" menu).
- **Results**:
  - A heading row with right-aligned 28px icon buttons.
  - Then the accordion list. Nested children are indented by 14px, and match lists by 8px.
- **Resize handle**: a full-width 12px bar pinned below the scrolling content area.

### Whitespace Philosophy
The panel is **dense and quiet**. Hairline borders and 4px gaps keep many rows on screen at a 560px height. The only extra air is the 10px gap between sections and the 16px at the bottom above the resize bar.

### Responsive Strategy
The width is fixed by the plugin host (`figma.ui.resize(360, h)`), so there are no width breakpoints. Only the height changes: the user drags the bottom handle, the value is clamped to 320–900px, and it is saved in `clientStorage`. Content scrolls inside `.app`. Long names truncate with an ellipsis rather than wrap.

#### Touch Targets
The panel is mouse-first, like Figma. Primary controls are 28px (picker buttons, icon buttons, inputs). Inline result controls (pin, color, copy, compact row buttons) are 22px, and the expand chevron hit area is 18px.

## Elevation & Depth

Depth is **flat with one floating layer**. Panels and rows are flush and separated only by borders and fills. Only transient UI floats.

| Level | Treatment | Use |
|---|---|---|
| 0 — Flat | No shadow; 1px border or a fill change | Rows, inputs, buttons, result headers |
| 1 — Menu | `0 4px 12px rgba(0, 0, 0, 0.12)`, 1px `{colors.border-popover}` | Row menu, color menu |
| 2 — Popover | `0 4px 16px rgba(0, 0, 0, 0.12)`, 1px `{colors.border-popover}` | Target picker, history, ignore popovers |

Menus sit at `z-index: 20`, popovers at `30`. Both anchor 2–4px below their trigger.

### Canvas Depth
Canvas overlays are page-root layers, always appended on top of the page so they render above the design:
- The highlight pool group is locked.
- OCR labels are kept above the pool and stay unlocked, so they can be selected.
- The target outline is re-appended to the top each time it is shown.

## Shapes

### Border Radius Scale

| Token | Value | Use |
|---|---|---|
| `{rounded.none}` | 0px | Dividers, the resize bar |
| `{rounded.xxs}` | 1px | Resize grip lines |
| `{rounded.xs}` | 2px | Color swatches |
| `{rounded.sm}` | 3px | A/B side badge |
| `{rounded.md}` | 4px | The default: inputs, buttons, radios, rows, result headers, list items |
| `{rounded.lg}` | 6px | Popovers and menus |
| `{rounded.full}` | 50% | Spinner |

The UI has a **4px default and a 6px float**. Everything you click is 4px. Only floating cards are slightly rounder at 6px, which helps them read as a separate layer.

### Canvas Geometry
Canvas highlights follow the measured text geometry:
- A partial range is split into one rectangle per line or per height break.
- An OCR region uses the bounding box of the recognized polygon, mapped through the image node's transform.
- The target outline uses the target's absolute bounding box, with the 10px stroke drawn outside it so the layer's content stays visible.

## Components

> Hover, disabled and hidden states are documented where they exist. Variants live as separate `components:` entries.

### Shell

**`app-shell`** — Plugin window
- 360px fixed width, 560px default height (320–900px). `{colors.surface}` body, `{typography.body}`, padded 12px / 14px / 16px with a 10px gap between sections.

**`resize-handle`** — Bottom height grip
- A 12px `{colors.surface-handle}` bar with a `{colors.divider}` top border and two 28×2px `{colors.grip}` lines. On hover or drag it turns `{colors.primary-tint}` with `{colors.primary}` grip lines, and the cursor stays `ns-resize` during the drag.

**`section-heading`** and **`divider`**
- 12px / 600 headings, and 1px `{colors.divider}` rules with 2px of vertical margin.

### Mode & Settings

**`mode-radio`** — 検索 / 比較 / 画像
- Segmented chip radios: `{colors.surface-muted}` fill, `{colors.border-control}` border, `{typography.label}` in `{colors.ink-soft}`, 5px / 8px padding, 4px corners. Hovering turns the border blue.
- The checked state, **`mode-radio-checked`**, uses a `{colors.primary-tint}` fill with `{colors.primary}` border and text.

**`ignore-popover`** — Ignore settings
- A 240px popover holding a 28px `{components.text-input}` for extra ignore strings, plus a wrapping row of 10px checkboxes (絵文字 / 禁則 / 記号 / 句読点 / 改行 / 空白) in `{colors.ink-strong}`.

**`btn-icon`** — Header icon button
- 28px square, white, `{colors.border-control}` border, 14px icon. It hovers to `{colors.surface-muted}` and is 40% opaque when disabled. **`btn-icon-compact`** is the 22px / 11px version used in keyword rows.

### Target Selection

**`target-picker-button`** — Target picker
- A 28px-min button with a single-line label: `{colors.border}` border, 4px corners, 4px / 8px padding.
- **`target-picker-button-empty`**: when nothing is selected, the label shows the placeholder (e.g. "ターゲット未選択", "ターゲット A") in `{colors.placeholder}`.
- **`target-picker-button-hover`**: the border turns `{colors.primary}` on a `{colors.primary-wash}` fill. If a target is selected, hovering also shows **`canvas-target-outline`** around that layer.
- **`target-picker-button-disabled`**: 55% opacity. Used during OCR and for hidden rows.

**`target-picker-popover`** — Candidate list
- Opens below the button at full width (180px min). It has a 28px filter input and a list framed by `{colors.hairline}` (168px max height).
- Options are padded 6px / 8px. Hover and keyboard focus use `{colors.primary-tint}`. The selected option uses `{colors.primary-tint-strong}` and weight 600.

**`target-history-popover`** — Recent targets
- A 220px card, right-aligned under the button. It shows when you click a picker with nothing selected on the canvas.
- Contents: a "最近選択したフレーム" `{typography.label}` title, up to 20 recent items (240px max height), and a `{colors.primary}` "候補一覧から選ぶ…" footer link that switches to the candidate list.

### Input Rows

**`keyword-row`** — Search keyword row
- A 4px-padded row that hovers to `{colors.surface-hover}`. It holds **`keyword-textarea`** (28px min, vertically resizable, `{typography.input}`, 2px `{colors.primary}` focus outline) and a top-aligned action column.

**`compare-pair-row`** — Compare pair (and image row)
- A `{colors.surface-soft}` row framed in `{colors.border-row}`, padded 6px, with corner radius `{rounded.md}`. It holds picker A, the **`pair-swap-icon`** (14px "↔" in `{colors.muted}`, not interactive), picker B, and the row menu. The image row uses the same frame with the image picker and the comparison-target picker.

**`row-menu`** — "⋯" row menu
- A 16px "⋯" trigger opens a 96px-min menu card (4px padding, 6px corners, menu shadow) with three 12px items in this order: **クリア**, **非表示** (shown as **表示** while the row is hidden), **削除**.
- Disabled items are `{colors.disabled}`. 削除 is disabled for the last remaining row, and クリア is disabled while the row is hidden.

**`row-hidden`** — Hidden row state
- Applied from the row menu. Inputs and pickers drop to 45% opacity on `{colors.surface-muted}` and become disabled, and the swap glyph turns `{colors.disabled-glyph}`. The "⋯" menu stays active so the row can be shown again.
- The row is excluded from search, comparison and OCR, and from results and highlights.

**`btn-add-full`** — Add row
- A full-width dashed `{colors.border-dashed}` button on `{colors.surface-soft}` with a 14px / 600 "＋" in `{colors.ink-soft}`. It hovers to `{colors.primary}` border and text on `{colors.primary-tint}`.

### Status

**`ocr-status`** — OCR progress line
- `{typography.caption}` in `{colors.ink-muted}`, with a 12px spinner (2px `{colors.spinner-track}` ring and a `{colors.primary}` arc, 0.7s linear) while busy. The same spinner precedes the "読み込み中…" empty state in results.

**`error-banner`** — Error message
- `{colors.error}` text on `{colors.error-surface}` with a `{colors.error-border}` border, 8px padding and 4px corners. Text wraps (`pre-wrap`).

**`empty-state`** — Empty results
- `{colors.muted}` body text with 4px vertical padding (e.g. "まだチェック結果がありません", "画像の行は非表示です").

### Results

**`result-header`** — Result group header
- A 6px / 8px row with 4px corners that hovers to `{colors.surface-hover}`. From left to right:
  - an 18px expand chevron (▸ / ▾) in `{colors.ink-muted}`
  - a truncating keyword label
  - a `{colors.ink-soft}` tabular count ("12件")
  - **`result-pin`**
  - **`result-color-select`**
- Hovering a header previews its highlights on the canvas. Clicking the label or count jumps to the layer.

**`result-pin`** — Pin toggle
- A 22px white button with a 10px pin icon. When on (**`result-pin-on`**), it uses a `{colors.success}` border and icon on `{colors.success-tint}`, and that group's highlights stay visible on the canvas. It is 35% opaque when disabled (no drawable region).

**`result-color-select`** — Highlight color
- A 22px trigger showing a 12px swatch (2px corners, 15% black border). It opens a vertical menu of four 22px options: red, yellow, green and purple, in the same canvas highlight colors. The selected or hovered option gets a `{colors.primary}` border on `{colors.primary-wash-alt}`.

**`match-item`** — Expanded match row
- A 6px / 8px row with 4px corners that hovers to `{colors.primary-tint}`. It shows a 10px / 600 layer name, a `{colors.ink-muted}` preview line and a 10px `{colors.muted}` count in the top-right corner.
- On compare results, a **`match-side-badge`** (14px `{colors.chip}` square, 9px / 700 "A" or "B") leads the row.
- **OCR match rows** (`ocr-match-item`) end with a right-aligned action group: pin, color, and **`ocr-copy-button`** (22px, 12px copy icon, hovers blue).

### Canvas Overlays

**`canvas-highlight`** — Result highlight
- A rectangle per matched line or OCR region, filled with the chosen highlight color at 40% opacity and stroked 1px dashed (10 / 10) in the same color.
- All rectangles live in one locked pool group per session. Visibility is toggled per result key: pinned results stay on, and a hovered result is shown temporarily.

**`canvas-ocr-label`** — Copyable OCR text
- An **unlocked** 8px text node (10px line height, black at 90%) placed at the page root and fitted inside its OCR highlight. Text that would overflow the box is cut short so it stays inside. Users can select it on the canvas and copy the recognized text.

**`canvas-target-outline`** — Target hover outline
- A single locked rectangle with no fill and a 10px `{colors.hl-green}` stroke drawn **outside** the target's bounding box, dashed 10 / 10. It shows while a selected target picker is hovered and hides on mouse leave, click or disable.

Every canvas overlay is named with a per-launch session ID (e.g. `__CB_TC_HIGHLIGHT_POOL__@<id>`, `__CB_TC_TARGET__@<id>`). Cleanup removes only the current session's layers.

### Examples (illustrative)

> Kit-mirror demonstration surfaces. Each `ex-*` entry references cbTextChecker primitives so downstream consumers (`/preview-design`, `/generate-kit`) re-skin the same 10 surfaces consistently.

**`ex-pricing-tier`** — Default tier card on the compare-row surface.
- Properties: `backgroundColor`, `textColor`, `borderColor`, `rounded`, `padding`

**`ex-pricing-tier-featured`** — Featured tier using the checked-radio treatment.
- Properties: `backgroundColor`, `textColor`, `borderColor`, `rounded`, `padding`

**`ex-product-selector`** — What's Included summary card — re-purposed for tool / B2B verticals.
- Properties: `backgroundColor`, `borderColor`, `rounded`, `padding`

**`ex-cart-drawer`** — Subscription summary with hairline item dividers.
- Properties: `backgroundColor`, `rounded`, `padding`, `item-divider`

**`ex-app-shell-row`** — Sidebar nav row; active state mirrors the selected picker option.
- Properties: `backgroundColor`, `hoverBackground`, `activeBackground`, `activeIndicator`, `rounded`, `padding`

**`ex-data-table-cell`** — Data-table chrome with label-style headers and tabular body.
- Properties: `headerBackground`, `headerTypography`, `bodyTypography`, `cellPadding`, `rowBorder`

**`ex-auth-form-card`** — Sign-in card built from popover chrome and 28px inputs.
- Properties: `backgroundColor`, `borderColor`, `rounded`, `padding`

**`ex-modal-card`** — Modal surface with the popover shadow.
- Properties: `backgroundColor`, `borderColor`, `shadow`, `rounded`, `padding`

**`ex-empty-state-card`** — Empty-state frame in muted gray.
- Properties: `backgroundColor`, `textColor`, `rounded`, `padding`, `captionTypography`

**`ex-toast`** — Toast with the menu shadow.
- Properties: `backgroundColor`, `borderColor`, `shadow`, `rounded`, `padding`, `typography`


## Do's and Don'ts

### Do
- Keep **`{colors.primary}` as the only action color**. Hover, focus, checked, selected and link states all use Figma Blue or its tints.
- Match Figma's density: **12px body, 11px labels, 28px controls, 4px corners**, with 6px corners only for floating cards.
- Put transient choices in **anchored popovers** (target list, history, ignore settings, row menu, color menu) instead of new screens or modals.
- Use the **shared row grammar** for any new input: content on the left, a "⋯" menu on the right with クリア / 非表示 / 削除.
- Show hidden and disabled states by **fading (opacity 0.35–0.55) and a gray fill**. Keep the control that can undo the state active.
- Truncate long layer names and keywords with an ellipsis, and put the full text in `title`.
- Use the canvas highlight colors **only to tell results apart**. They are chosen per result group by the user.
- Use **the same four colors** for the UI swatches and the canvas paints, from one shared definition.
- Draw canvas overlays as **page-root layers named with the session ID**. Lock everything except the copyable OCR labels, and clean up only your own session's layers.

### Don't
- Don't add a second accent color in the plugin window. Green is reserved for the pinned state and red for errors.
- Don't use the canvas highlight colors as UI decoration. They mean "this is drawn on your design".
- Don't introduce large type, uppercase labels or letter spacing. The panel should read like a native Figma property panel.
- Don't add shadows to flat UI. Only menus and popovers float.
- Don't delete overlays by a name prefix alone. Other users' session layers must survive.
- Don't draw the target outline inside the bounding box. It must stay outside, so the layer's content stays visible.
