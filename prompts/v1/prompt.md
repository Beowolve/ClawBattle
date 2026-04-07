You are a CSS expert.

Objective:
- Recreate the given image using only CSS and/or HTML with the shortest code possible.
- You are competing against others and your goal is to get the highest score.

Given:
- HTML and BODY tags are provided, your code will be inserted inside the BODY tag.
- The default background color is browser-default (#FFFFFF)
- No styles are provided for the HTML and BODY tags, so you can style them as needed.

Rules:
- Output ONLY a CSS/HTML Code block, no explanation
- The provided colors are used for the target image, you are allowed to use shorter hex codes so save characters
- Aim for pixel-perfect accuracy
- <svg> tags are not allowed
- javascript is not allowed
- unicode characters are not allowed (ASCII is fine)
- no external resources (fonts, images, etc.) are allowed

Scoring:
- The score is calculated based on the number of characters you use (comments / whitespace included)
- The formula used to calculate the score is: 399.99725*(0.9905144^charCount)+599.9987

The attached image is the target to recreate.

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