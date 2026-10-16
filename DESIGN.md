---
name: LinkPulse
description: A field ledger for creating short links and reading their traffic.
colors:
  forest: "#17372e"
  forest-deep: "#102b24"
  forest-hover: "#245542"
  status-active: "#2c6941"
  chart-line: "#31714a"
  leaf-text: "#485f50"
  leaf: "#82c877"
  input-hover: "#8ba995"
  link-underline: "#9ab69e"
  disabled-dot: "#a8a69d"
  input-border: "#c8d5c9"
  sidebar-muted: "#d0dfd2"
  welcome-muted: "#d4e4d8"
  nav-muted: "#d7e7da"
  chart-grid: "#dbe5d9"
  chart-area: "#dfeedd"
  leaf-pale: "#e5efe1"
  coral: "#e98770"
  nav-text: "#f1f7ef"
  pollen: "#f4c16e"
  paper: "#f4f7ee"
  welcome-text: "#f4f8ef"
  paper-bright: "#fbfcf8"
  field-white: "#fff"
  ink: "#1a2d25"
  muted: "#56685e"
  placeholder: "#66786c"
  disabled-text: "#6c655c"
  line: "#d7e1d6"
  danger: "#a23c32"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "clamp(38px, 4.7vw, 62px)"
    fontWeight: 660
    lineHeight: 0.98
    letterSpacing: "-0.065em"
  display-mobile:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "clamp(31px, 9vw, 44px)"
    fontWeight: 660
    lineHeight: 0.98
  page-title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "clamp(32px, 4vw, 48px)"
    fontWeight: 660
    lineHeight: 1.05
  page-title-mobile:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "clamp(30px, 8vw, 40px)"
    fontWeight: 660
    lineHeight: 1.05
  auth-title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "clamp(30px, 3.5vw, 42px)"
    fontWeight: 660
    lineHeight: 1.06
  micro:
    fontSize: "10px"
  caption:
    fontSize: "11px"
  label:
    fontSize: "12px"
    fontWeight: 600
  body-compact:
    fontSize: "13px"
    lineHeight: 1.5
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  body-default:
    fontSize: "15px"
    lineHeight: 1.5
  body-large:
    fontSize: "16px"
    lineHeight: 1.6
  navigation:
    fontSize: "17px"
  section-title:
    fontSize: "18px"
    fontWeight: 670
  glyph:
    fontSize: "19px"
  title:
    fontSize: "20px"
    fontWeight: 670
  fallback:
    fontSize: "28px"
  mobile-heading:
    fontSize: "34px"
  metric:
    fontSize: "36px"
  small-heading:
    fontSize: "30px"
  large-mobile-heading:
    fontSize: "34px"
rounded:
  xs: "2px"
  sm: "3px"
---

# Design System: LinkPulse

## Overview

**Creative North Star: "Seedling Field Ledger"**

LinkPulse uses the visual language of a practical field notebook: fern ink,
leaf-green markers, a pale working surface, and small pollen and coral signals.
It is direct and task-oriented, with the supplied Teddy animation providing the
distinctive character rather than decorative interface chrome.

The ledger favors open sections, fine dividers, readable measurements, and a
compact status vocabulary. The interface stays grounded in real workspace data;
empty states are explicit and never filled with invented activity.

**Key Characteristics:**
- Forest green anchors navigation and primary actions.
- Leaf green marks active states; pollen and coral are reserved for small signals.
- Links and traffic use aligned, unboxed rows and a simple daily line chart.
- The supplied Rive animation is served locally and respects reduced motion.

## Colors

The palette uses a full set of field-inspired roles over a light working ground.

### Primary
- **Forest** (#17372e): Main navigation, primary buttons, and strong headings.
- **Deep Forest** (#102b24): Supporting depth within the navigation palette.
- **Forest Hover** (#245542): Primary button hover.

### Secondary
- **Leaf** (#82c877): Selected navigation and active status marks.
- **Pale Leaf** (#e5efe1): Link creation surface and chart area.
- **Forest Chart** (#31714a): Traffic line.
- **Active Green** (#2c6941): Active-link status.
- **Leaf Text** (#485f50): Supporting copy on pale leaf.
- **Input Hover** (#8ba995): Hovered field border.
- **Link Underline** (#9ab69e): Short-link underline.
- **Chart Grid** (#dbe5d9): Chart rules.
- **Chart Area** (#dfeedd): Traffic fill.

### Tertiary
- **Pollen** (#f4c16e): Small illustration fallback and restrained highlights.
- **Coral** (#e98770): Keyboard focus outline.
- **Muted Welcome Text** (#d4e4d8): Supporting copy on the forest panel.
- **Muted Sidebar Text** (#d0dfd2): Sidebar support copy.
- **Navigation Muted** (#d7e7da): Inactive sidebar navigation.
- **Navigation Text** (#f1f7ef): Sidebar wordmark and sign-out.
- **Welcome Text** (#f4f8ef): Main welcome-panel copy.

### Neutral
- **Field Paper** (#f4f7ee): Page background.
- **Bright Paper** (#fbfcf8): Forms and working surfaces.
- **White** (#fff): Inputs and primary button text.
- **Ink** (#1a2d25): Main text.
- **Muted Green** (#56685e): Supporting text.
- **Placeholder** (#66786c): Input placeholders.
- **Divider** (#d7e1d6): Table and section rules.
- **Input Border** (#c8d5c9): Default field border.
- **Disabled Text** (#6c655c): Disabled-link status.
- **Disabled Dot** (#a8a69d): Disabled-link indicator.
- **Danger** (#a23c32): Form and request errors.

## Typography

- **Display Font:** System UI sans-serif stack
- **Body Font:** System UI sans-serif stack
- **Label/Mono Font:** No separate mono face is used.

**Character:** Compact, sturdy sans-serif typography keeps the interface fast to
scan and lets the user's links and measurements carry the emphasis.

### Hierarchy
- **Display** (660, clamp(38px, 4.7vw, 62px), 0.98): Login statement; tight and
  balanced for the narrow left panel.
- **Headline** (660, clamp(32px, 4vw, 48px), 1.05): Dashboard page title.
- **Title** (670, 18–20px): Section headings and link creation.
- **Body** (400, 13–15px, 1.5–1.6): Instructions, descriptions, and destinations.
- **Label** (600–700, 11–14px): Form labels, table headings, status, and controls.

### Named Rules
**The Working-Measure Rule.** Use tabular numerals for counts and keep labels
short; do not dress ordinary UI text in a technical mono face.

## Layout

The login view uses a two-column composition: a forest-green illustration panel
beside a bright-paper sign-in form. At 680px and below, the illustration becomes
a short top panel and the form follows beneath it. The dashboard pairs a 230px
desktop sidebar with a centered content column; at 680px the sidebar becomes a
single compact navigation row.

The 920px breakpoint tightens the form and dashboard columns. Page content is
fluid with clamp-based side padding; link rows remain a real table and scroll
horizontally on narrow screens instead of collapsing their labels.

## Elevation & Depth

The system is flat at rest. Forest and leaf color blocks, paper surfaces, and
fine dividers establish hierarchy; there is no shadow vocabulary. Focus uses a
visible coral outline rather than a glow.

### Named Rules
**The Field-Surface Rule.** Separate working regions with tonal surfaces or
dividers, not stacked shadow cards.

## Shapes

Controls and containers use restrained 3px corners. Inputs have a single fine
border and white fill; table rows and section bands stay square and open. The
Rive artwork keeps its own authored silhouette and is not masked into a generic
rounded card.

## Components

### Buttons
- **Shape:** 3px corners.
- **Primary:** Forest fill, white text, 50px height, and confident medium weight.
- **Hover / Focus:** Darker forest on hover; coral outline on keyboard focus.
- **Quiet:** Text-forward actions without a filled container.

### Inputs / Fields
- **Style:** White surface, 1px muted-green border, 3px corners, and 50px minimum
  height for primary fields.
- **Focus:** A clear coral outline; do not rely on color changes alone.
- **Error / Disabled:** Errors are named in text; disabled controls remain legible.

### Navigation
- **Style:** Forest sidebar with leaf-green current state. On mobile, retain the
  same compact links in a horizontal top row.

### Link Ledger
- **Style:** Open table rows with short URL, destination, status, visit count, and
  restrained text actions. Keep disabled links visible for reporting.

### Traffic Chart
- **Style:** A daily forest-green line, pale-leaf area, and subtle horizontal
  rules. An empty range states that no recorded visits exist.

## Do's and Don'ts

### Do:
- **Do** use the supplied Teddy Rive file locally, with the `Teddy` artboard and
  `Login Machine` state machine.
- **Do** respect `prefers-reduced-motion` and show a useful fallback if animation
  loading fails.
- **Do** label analytics as recorded and keep bot-exclusion semantics visible.
- **Do** render user/API content as text, not injected HTML.

### Don't:
- **Don't** invent traffic, destinations, or workspace data.
- **Don't** treat a disabled link as deleted; preserve its reportable state.
- **Don't** add card grids, rounded dashboard tiles, or decorative shadows that
  compete with the ledger.
- **Don't** imply the browser needs a third-party API key; requests are same-origin.
