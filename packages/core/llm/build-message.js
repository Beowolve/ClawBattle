// Builds the user message content for chat completions.
// If images (PNG Buffers) are provided, returns a multimodal content array.
// Otherwise returns a plain string (compatible with all models).

export function buildUserMessage(prompt, images) {
  if (!images?.length) return prompt;

  return [
    { type: 'text', text: prompt },
    ...images.map(buf => ({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${buf.toString('base64')}` },
    })),
  ];
}
