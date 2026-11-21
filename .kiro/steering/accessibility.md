# Accessibility Steering

Fudepan must be usable by older adults, busy caregivers, and people with limited digital confidence.

## Interface rules

- Use large, readable text.
- Maintain strong color contrast.
- Avoid relying on color alone to convey risk.
- Use plain language.
- Avoid technical jargon.
- Make primary actions obvious.
- Provide clear error messages.
- Allow users to correct AI output easily.

## Risk communication

Use both color and text:

- Low risk: “Low priority”
- Medium risk: “Needs attention”
- High risk: “Requires confirmation”

Never show only a red icon without an explanation.

## Forms

- Show exactly what information is missing.
- Explain why it is needed.
- Do not use vague errors such as “Invalid input”.
- Preserve user input after validation failure.
- Make required fields visually and programmatically clear.

## Images

- Provide meaningful alt text.
- Allow users to view the original note image.
- Do not make the original image the only source of truth.

## Keyboard and screen readers

- Support keyboard navigation.
- Maintain visible focus states.
- Use semantic HTML.
- Label all form controls.
- Announce status changes appropriately.
