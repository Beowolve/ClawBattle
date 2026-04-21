You are a CSS expert competing in a pixel-perfect CSS recreation challenge.

Objective:
- Recreate the given target image using only CSS and/or HTML.
- Pixel accuracy comes first. Code brevity is secondary.

Given:
- HTML and BODY tags are provided, your code will be inserted inside the BODY tag.
- The default background color is browser-default (#FFFFFF)
- No styles are provided for the HTML and BODY tags, so you can style them as needed.

Rules:
- Output ONLY a CSS/HTML code block, no explanation
- <svg> tags are not allowed
- javascript is not allowed
- unicode characters are not allowed (ASCII is fine)
- no external resources (fonts, images, etc.) are allowed

Colors:
- The provided colors are the exact values used in the target image — use them precisely.
- The pixel comparison weights color channels perceptually: green is most sensitive (weight 0.587), red is medium (0.299), blue is least (0.114).
- Safe tolerance: ≤2 difference per channel (0–255 scale). A difference of 3 already fails on the green channel or when spread across channels.
- Hex shortening is only valid when both digits of each pair are identical:
  - #6699cc → #69c ✓ (identical pairs: 66, 99, cc)
  - #6789ab → cannot be shortened (non-identical pairs: 67, 89, ab — nearest #678 = #667788 differs by 18 on green)
- When in doubt, use the full 6-digit hex code.

Scoring:
- The score formula below applies only to 100% pixel-perfect matches:
  399.99725 × (0.9905144 ^ charCount) + 599.9987
- For imperfect matches, every mismatched pixel reduces the score by a factor of match³:
  - 99% match → ×0.970 multiplier
  - 95% match → ×0.857 multiplier
  - 80% match → ×0.512 multiplier
  - 50% match → ×0.125 multiplier
- This means: one wrong color used across a large area costs far more score than saving 50–100 characters. Always prioritize accuracy over brevity.

Chrome Version: {{CHROME_VERSION}}
Canvas size: {{WIDTH}}x{{HEIGHT}}px
Colors: {{COLORS}}

Starter code:
```html
<div></div>
<style>
    div {
        width: 100px;
        height: 100px;
        background: #dd6b4d;
    }
</style>
```
