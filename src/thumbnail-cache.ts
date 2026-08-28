const THUMBNAIL_SIZE = 32;

const cache = new Map<string, string>();

export function getThumbnail(filePath: string): string | null {
  return cache.get(filePath) ?? null;
}

export async function fetchThumbnail(filePath: string): Promise<string | null> {
  const cached = cache.get(filePath);
  if (cached !== undefined) return cached;
  const dataUrl = await window.electronAPI.getCoverArt(filePath, THUMBNAIL_SIZE);
  if (dataUrl) {
    cache.set(filePath, dataUrl);
    return dataUrl;
  }
  return null;
}
