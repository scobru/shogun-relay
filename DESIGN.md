---
name: Shogun Delay Dashboard
colors:
  primary: "#570df8"
  primary-content: "#ffffff"
  secondary: "#f000b8"
  secondary-content: "#ffffff"
  accent: "#37cdbe"
  accent-content: "#163835"
  neutral: "#3d4451"
  neutral-content: "#ffffff"
  base-100: "#ffffff"
  base-200: "#f2f2f2"
  base-300: "#e5e6e6"
  base-content: "#1f2937"
  info: "#3abff8"
  info-content: "#002b3d"
  success: "#36d399"
  success-content: "#003320"
  warning: "#fbbd23"
  warning-content: "#382800"
  error: "#f87272"
  error-content: "#470000"
  status-online: "oklch(0.7 0.2 140)"
  status-offline: "oklch(0.6 0.25 25)"
  status-warning: "oklch(0.8 0.18 85)"
typography:
  font-sans:
    fontFamily: Inter
  font-mono:
    fontFamily: Roboto Mono
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    lineHeight: 1
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: "600"
  body-md:
    fontFamily: Inter
    fontSize: 16px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
rounded:
  none: 0px
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  2xl: 1rem
  3xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  card-padding: 32px
  section-gap: 24px
  sidebar-width: 320px
components:
  status-dot:
    width: 8px
    height: 8px
    rounded: "{rounded.full}"
  status-dot-online:
    backgroundColor: "{colors.status-online}"
    boxShadow: "0 0 8px {colors.status-online}"
  status-dot-offline:
    backgroundColor: "{colors.status-offline}"
  status-dot-warning:
    backgroundColor: "{colors.status-warning}"
  card:
    backgroundColor: "{colors.base-100}"
    rounded: "{rounded.2xl}"
    textColor: "{colors.base-content}"
  stat:
    padding: 16px
  alert-warning:
    backgroundColor: "{colors.warning}"
    textColor: "{colors.warning-content}"
    rounded: "{rounded.2xl}"
---

## Brand & Style
The Shogun Delay Dashboard employs a robust, functional, and highly legible design system that emphasizes real-time monitoring and administrative control. Powered by Tailwind CSS v4 and DaisyUI, the interface provides a clean, modern aesthetic that effortlessly supports both light and dark modes out of the box. The overall feeling is professional, technical, and snappy.

## Colors
The color palette relies on the semantic defaults provided by DaisyUI, ensuring high contrast and immediate recognition of system states. 

- **Primary & Secondary:** Used sparingly to draw attention to high-level system identity (e.g., the top welcome card utilizing a vibrant gradient from primary to secondary).
- **Base Tones:** The interface utilizes varying shades of base colors (`base-100`, `base-200`) to create spatial separation between the main canvas, cards, and sidebars.
- **Status Indicators:** Custom `oklch` colors are defined for system health (Online, Offline, Warning), ensuring vibrant, glowing indicators that immediately inform the user of relay status.

## Typography
The system uses **Inter** as the primary sans-serif typeface, offering excellent legibility for dense data displays and administrative controls.

- **Monospace:** **Roboto Mono** is employed for code snippets, IDs, and technical data, providing clear distinction from standard UI text.
- **Hierarchy:** Clear typographic hierarchy is established using Tailwind utilities, with large display text (e.g., emojis and main stats) creating natural focal points.

## Layout & Spacing
The layout follows a flexible, responsive paradigm typical of modern admin dashboards.

- **Drawer System:** A persistent (on desktop) or toggleable (on mobile) sidebar navigation is utilized alongside a main content area.
- **Grid & Flexbox:** Information is grouped into cards and stat blocks, utilizing consistent gaps (`gap-4`, `gap-6`) to separate distinct metrics.
- **Containment:** The main content uses a maximum width (`max-w-6xl`, `max-w-7xl`) to ensure readability on ultra-wide monitors, while being centered horizontally.

## Elevation & Depth
Depth is handled primarily through subtle shadows and color separation rather than heavy borders or 3D effects.

- **Cards & Stats:** Elevated using soft drop shadows (`shadow`, `shadow-sm`) to lift them slightly off the `base-200` main canvas background.
- **Hover States:** Interactive elements like the "Upload Files" quick action card increase their shadow depth (`hover:shadow-md`) to indicate clickability.
- **Glow Effects:** The online status indicator utilizes a subtle box-shadow glow matching its color to emphasize active connectivity.

## Shapes
The interface favors approachable, rounded geometry.

- **Containers:** Cards and alerts feature pronounced rounded corners ( DaisyUI's default `rounded-box` is typically around `1rem` or `1.5rem`), softening the technical nature of the presented data.
- **Interactive Elements:** Buttons and badges use tighter rounded corners, maintaining a structured, clickable appearance.
- **Indicators:** Status dots are perfectly circular (`rounded-full`) and small (`8px`), drawing the eye without taking up unnecessary vertical or horizontal space.

### Component Styling
The dashboard relies heavily on semantic HTML/CSS classes provided by DaisyUI (`card`, `stat`, `badge`, `alert`), minimizing custom CSS. This ensures consistency and maintainability while allowing rapid development of complex administrative views.
