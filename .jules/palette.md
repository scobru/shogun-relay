## 2025-02-19 - ARIA Labels on DaisyUI Theme Controller
**Learning:** DaisyUI's `theme-controller` pattern uses a visually hidden checkbox input. While invisible to sighted users, screen readers need an `aria-label` on this input to announce its function. Playwright might report the input as "hidden" but can still verify the presence of the label.
**Action:** Always add `aria-label` to the `input` element inside a DaisyUI `swap` or `theme-controller` component, not just the wrapper label.

## 2025-02-19 - Vite Polyfills for GunDB
**Learning:** This project uses GunDB which requires `global` to be defined. Vite 5+ does not polyfill `global` by default.
**Action:** When setting up Vite projects with GunDB, add `define: { global: 'window' }` to `vite.config.ts`.

## 2025-02-21 - Skeleton Loader Pattern for Search Results
**Learning:** Using empty `searchResults` array to trigger "Empty State" causes confusing layout shift when searching starts (empty state disappears, then blank, then results).
**Action:** Always check `searching` state and render a skeleton loader BEFORE falling back to the empty state message. This maintains layout stability and provides feedback.
