import sharp from 'sharp';
import type { ImageMetadata } from 'astro';

/**
 * Output formats for photographs and renders. They are served as AVIF; the
 * fallback is JPEG, except for images with a transparent backdrop (see
 * scripts/lib/background.mjs), which fall back to PNG so the backdrop stays clear.
 * Drawings are handled separately (lossless WebP, PNG fallback).
 */
const alphaCache = new Map<string, Promise<boolean>>();

export function hasAlpha(src: ImageMetadata): Promise<boolean> {
  // Astro attaches the source path to imported images at build time.
  const file = (src as ImageMetadata & { fsPath?: string }).fsPath;
  if (!file) return Promise.resolve(false);
  if (!alphaCache.has(file)) alphaCache.set(file, sharp(file).metadata().then((m) => !!m.hasAlpha));
  return alphaCache.get(file)!;
}

export async function photoFormats(src: ImageMetadata) {
  return {
    formats: ['avif'] as ('avif')[],
    fallbackFormat: ((await hasAlpha(src)) ? 'png' : 'jpg') as 'png' | 'jpg',
  };
}
