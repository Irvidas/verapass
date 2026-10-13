import { IMAGES, type ImageInfo } from '../data/images'

function nameOf(src: string): string {
  return src.replace(/^.*\//, '').replace(/\.jpg$/, '')
}

export function imageInfo(src: string): ImageInfo | undefined {
  return IMAGES[nameOf(src)]
}

/** A srcset for one format, or undefined when the image has no optimised copies. */
export function srcSetFor(src: string, format: 'avif' | 'webp'): string | undefined {
  const name = nameOf(src)
  return IMAGES[name]?.widths.map((w) => `/images/r/${name}-${w}.${format} ${w}w`).join(', ')
}
