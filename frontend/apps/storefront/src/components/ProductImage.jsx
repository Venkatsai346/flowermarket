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
  priority = false,
  width,
  height,
  fallbackCompact = false,
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <ProductFallback className={className} compact={fallbackCompact} label={alt ? `Image unavailable for ${alt}` : 'Product image coming soon'} />;
  return (
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
}
