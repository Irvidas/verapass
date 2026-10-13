import type { CSSProperties, ImgHTMLAttributes } from 'react'
import { imageInfo, srcSetFor } from '../lib/images'

type ImgProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet' | 'width' | 'height' | 'sizes'>

interface PictureProps extends ImgProps {
  /** Path of the original JPG, such as /images/hero-boat.jpg. */
  src: string
  alt: string
  /** The rendered width, for the browser to pick a file. Example: "(min-width: 900px) 33vw, 90vw". */
  sizes: string
  /** Classes and style for the <picture> wrapper. */
  pictureClassName?: string
  pictureStyle?: CSSProperties
}

/**
 * A photo as AVIF and WebP in several widths, with the JPG as the fallback, and its
 * intrinsic size on the <img> so nothing shifts while it loads.
 */
export function Picture({ src, alt, sizes, pictureClassName, pictureStyle, loading = 'lazy', decoding = 'async', ...img }: PictureProps) {
  const info = imageInfo(src)
  return (
    <picture className={pictureClassName} style={pictureStyle}>
      {info && <source type="image/avif" srcSet={srcSetFor(src, 'avif')} sizes={sizes} />}
      {info && <source type="image/webp" srcSet={srcSetFor(src, 'webp')} sizes={sizes} />}
      <img src={src} alt={alt} width={info?.width} height={info?.height} loading={loading} decoding={decoding} {...img} />
    </picture>
  )
}
