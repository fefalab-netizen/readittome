// PDF.js getTextContent uses ReadableStream async iteration, which is missing
// in some Safari versions. Consume the same text stream with getReader instead.
export async function readPageText(page) {
  const reader = page.streamTextContent().getReader();
  const items = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return { items };
      for (const item of value.items) items.push(item);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
