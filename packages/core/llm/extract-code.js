export function extractCode(text) {
  const match = text.match(/```html\n([\s\S]*?)```/)
    ?? text.match(/```css\n([\s\S]*?)```/)
    ?? text.match(/```\n([\s\S]*?)```/);
  return match ? match[1].trim() : text.trim();
}
