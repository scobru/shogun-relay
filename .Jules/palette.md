## 2025-02-21 - [Modal Error Handling]
**Learning:** The project frequently uses native `alert()` for errors, which disrupts user flow. DaisyUI `alert` component inside modals provides a much smoother, non-blocking experience.
**Action:** Replace `alert()` with inline `alert-error` components within modal state for future error handling improvements.

## 2025-02-24 - [Copy Button Feedback Pattern]
**Learning:** Dashboard users need immediate confirmation when copying sensitive data (like API keys). The established pattern is to toggle button state to `btn-success` with a checkmark icon for 2 seconds.
**Action:** Always implement local `copied` state for copy buttons to provide consistent visual feedback.
