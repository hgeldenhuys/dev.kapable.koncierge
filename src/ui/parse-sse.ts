/**
 * Parse Server-Sent Events from a ReadableStream<Uint8Array>.
 *
 * Yields parsed JSON payloads from `data: {...}\n\n` lines.
 * Handles chunked reads where a line may span multiple chunks.
 * Terminates on `data: [DONE]` (the Koncierge server sentinel).
 */
export async function* parseSSE<T = unknown>(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<T, void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) break;

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep the last (possibly incomplete) line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;

        const payload = trimmed.slice(6);
        if (payload === "[DONE]") return;

        try {
          yield JSON.parse(payload) as T;
        } catch {
          // Skip malformed JSON lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
