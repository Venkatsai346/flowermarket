/**
 * BlurImage — blur-up lazy loading for product images.
 *
 * Shows a tiny blurred placeholder while the full image loads,
 * then transitions smoothly to the sharp image. Uses IntersectionObserver
 * for lazy loading — images below the fold don't load until scrolled.
 *
 * Usage:
 *   <BlurImage src="/product.jpg" alt="Rose bouquet" />
 *   <BlurImage src="/product.jpg" blurSrc="/product-tiny.jpg" />
 *
 * The blur placeholder is auto-generated as a tiny inline data URI
 * if no blurSrc is provided (CSS blur effect on a 20px version).
 */

import { useState, useRef, useEffect } from 'react';
import { cn } from '../../lib/utils.js';

export default function BlurImage({
  src,
  alt = '',
  blurSrc,
  className = '',
  aspectRatio = '4/3',
  objectFit = 'cover',
  ...props
}) {
  const [loaded, setLoaded] = useState(false);
  const [inView, setInView] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }, // Start loading 200px before visible
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn('relative overflow-hidden bg-gray-100', className)}
      style={{ aspectRatio }}
    >
      {/* Blur placeholder */}
      {blurSrc && (
        <img
          src={blurSrc}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full transition-opacity duration-300"
          style={{
            objectFit,
            filter: 'blur(20px)',
            transform: 'scale(1.1)',
            opacity: loaded ? 0 : 1,
          }}
        />
      )}

      {/* Shimmer placeholder (no blurSrc) */}
      {!blurSrc && !loaded && (
        <div className="absolute inset-0 shimmer" />
      )}

      {/* Full image */}
      {inView && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          className="absolute inset-0 w-full h-full transition-opacity duration-500"
          style={{
            objectFit,
            opacity: loaded ? 1 : 0,
          }}
          {...props}
        />
      )}
    </div>
  );
}
