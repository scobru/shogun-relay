## 2025-02-21 - [Modal Error Handling]
**Learning:** The project frequently uses native `alert()` for errors, which disrupts user flow. DaisyUI `alert` component inside modals provides a much smoother, non-blocking experience.
**Action:** Replace `alert()` with inline `alert-error` components within modal state for future error handling improvements.
