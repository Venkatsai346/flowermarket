import { useEffect, useState } from 'react';
import ProductFallback from './ProductFallback.jsx';

/**
 * Lazy catalog photography. Merchants who upload WebP (the media pipeline
 * already allows it) get it as-is. We do not invent a `.webp` sibling — a
 * 404 would fail the storefront e2e netfail gate and there is no sharp
 * transcoder in this wave.
 */
export default function ProductImage({
  src,
  alt = '',
  className,
  sizes,
  renditions = [],
  priority = false,
  width,
  height,
  fallbackCompact = false,
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <ProductFallback className={className} compact={fallbackCompact} label={alt ? `Image unavailable for ${alt}` : 'Product image coming soon'} />;
  const srcSet = (format) => renditions
    .filter((item) => item.format === format && item.url && item.width)
    .sort((a, b) => a.width - b.width)
    .map((item) => `${item.url} ${item.width}w`).join(', ');
  const avif = srcSet('avif');
  const webp = srcSet('webp');
  const image = (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      sizes={sizes}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={priority ? 'high' : 'auto'}
      onError={() => setFailed(true)}
      className={className}
    />
  );
  if (!avif && !webp) return image;
  return <picture className="contents">{avif && <source type="image/avif" srcSet={avif} sizes={sizes} />}{webp && <source type="image/webp" srcSet={webp} sizes={sizes} />}{image}</picture>;
}
