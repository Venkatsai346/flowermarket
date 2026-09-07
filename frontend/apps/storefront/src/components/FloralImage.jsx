/**
 * Lazy floral photography. Merchants who upload WebP (the media pipeline
 * already allows it) get it as-is. We do not invent a `.webp` sibling — a
 * 404 would fail the storefront e2e netfail gate and there is no sharp
 * transcoder in this wave.
 */
export default function FloralImage({
  src,
  alt = '',
  className,
  sizes,
  priority = false,
  width,
  height,
}) {
  if (!src) {
    return (
      <span
        className={className}
        style={{ background: 'var(--brand-soft)' }}
        aria-hidden
      >
        <span className="flex h-full w-full items-center justify-center text-4xl">🌸</span>
      </span>
    );
  }
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
      className={className}
    />
  );
}
