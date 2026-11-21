# Hook: Check Accessibility

## Trigger

Run when UI components, pages, or styles related to Care Chain review, task approval, or household timeline are created or changed.

## Purpose

Ensure that Fudepan remains usable for older adults and people with low digital confidence.

## Checks

- Text contrast meets accessible contrast requirements.
- Risk is communicated with text, not color alone.
- Buttons have accessible names.
- Form fields have labels.
- Images have meaningful alt text.
- Focus states are visible.
- Keyboard navigation works.
- Error messages explain what to fix.
- Important actions use plain language.
- High-risk confirmation screens clearly state consequences.

## Required action

If an accessibility issue is detected:

1. Block completion of the UI task.
2. Provide a specific issue list.
3. Require a fix before marking the phase complete.
