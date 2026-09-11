import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import StoreLink from './StoreLink.jsx';
import ArrivalPromise from './ArrivalPromise.jsx';
import { cn } from '../lib/utils.js';

const AUTOPLAY_MS = 6000;
const SWIPE_PX = 40;

/**
 * Responsive hero carousel.
 *
 * - `mobileImageUrl` serves the portrait crop under 640px (no desktop
 *   panorama awkwardly letterboxed on a phone).
 * - Autoplay pauses on hover/focus, when the tab hides, and entirely when
 *   the customer prefers reduced motion.
 * - Arrows, dots, swipe and keyboard all drive the same `go()` — one code
 *   path, every input.
 */
export default function HeroCarousel({ slides = [], storeName, tagline, description }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchX = useRef(null);
  const count = slides.length;

  const go = useCallback(
    (next) => setIndex(((next % count) + count) % count),
    [count]
  );

  useEffect(() => {
    setIndex(0);
  }, [count]);

  useEffect(() => {
    if (count < 2 || paused) return undefined;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return undefined;
    }
    const id = window.setInterval(() => {
      if (!document.hidden) setIndex((i) => (i + 1) % count);
    }, AUTOPLAY_MS);
    return () => window.clearInterval(id);
  }, [count, paused]);

  if (!count) return null;

  const onTouchStart = (e) => {
    touchX.current = e.touches?.[0]?.clientX ?? null;
  };
  const onTouchEnd = (e) => {
    const start = touchX.current;
    touchX.current = null;
    if (start == null) return;
    const end = e.changedTouches?.[0]?.clientX ?? start;
    const dx = end - start;
    if (Math.abs(dx) < SWIPE_PX) return;
    go(index + (dx < 0 ? 1 : -1));
  };

  return (
    <section
      className="relative min-h-[28rem] overflow-hidden sm:min-h-[32rem]"
      role="region"
      aria-roledescription="carousel"
      aria-label={`${storeName} highlights`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') go(index + 1);
        if (e.key === 'ArrowLeft') go(index - 1);
      }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {slides.map((s, i) => {
        const active = i === index;
        return (
          <div
            key={s.imageUrl || i}
            className={cn('hero-slide hero-slide-media absolute inset-0', active && 'hero-slide-active')}
            aria-hidden={!active}
          >
            <picture>
              {s.mobileImageUrl && <source media="(max-width: 640px)" srcSet={s.mobileImageUrl} />}
              <img
                src={s.imageUrl}
                alt=""
                loading={i === 0 ? 'eager' : 'lazy'}
                decoding="async"
                fetchPriority={i === 0 ? 'high' : 'auto'}
                className="h-full w-full object-cover"
                draggable={false}
              />
            </picture>
          </div>
        );
      })}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-black/15" />

      <div className="wrap relative z-10 flex min-h-[28rem] flex-col justify-end gap-4 py-12 text-white sm:min-h-[32rem] sm:py-16">
        <div aria-live="polite">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70">
            {storeName}
          </p>
          <h1
            key={index}
            className="hero-copy font-display mt-1 max-w-2xl text-4xl leading-[1.1] tracking-tight sm:text-5xl"
          >
            {slides[index]?.title || tagline || `Fresh from ${storeName}`}
          </h1>
          {(slides[index]?.subtitle || (!slides[index]?.title && description)) && (
            <p key={`sub-${index}`} className="hero-copy mt-2 max-w-xl text-sm leading-relaxed text-white/80">
              {slides[index]?.subtitle || description}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {slides[index]?.ctaLabel && slides[index]?.ctaLink && (
            <StoreLink
              to={slides[index].ctaLink}
              className="btn bg-white font-semibold text-slate-900 shadow-lift transition hover:bg-slate-100"
            >
              {slides[index].ctaLabel}
            </StoreLink>
          )}
          <ArrivalPromise className="w-fit" />
        </div>
      </div>

      {count > 1 && (
        <>
          <div className="absolute inset-y-0 left-0 z-20 hidden items-center pl-3 sm:flex">
            <button
              type="button"
              onClick={() => go(index - 1)}
              aria-label="Previous slide"
              className="grid h-10 w-10 place-items-center rounded-full bg-black/30 text-white backdrop-blur transition hover:bg-black/50"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          </div>
          <div className="absolute inset-y-0 right-0 z-20 hidden items-center pr-3 sm:flex">
            <button
              type="button"
              onClick={() => go(index + 1)}
              aria-label="Next slide"
              className="grid h-10 w-10 place-items-center rounded-full bg-black/30 text-white backdrop-blur transition hover:bg-black/50"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
          <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2">
            {slides.map((s, i) => (
              <button
                key={s.imageUrl || i}
                type="button"
                onClick={() => go(i)}
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === index}
                className={cn(
                  'h-2 rounded-full transition-all',
                  i === index ? 'w-7 bg-white' : 'w-2 bg-white/50 hover:bg-white/80'
                )}
              />
            ))}
          </div>
          <p className="absolute bottom-4 right-4 z-20 text-[11px] font-semibold tabular-nums text-white/70">
            {index + 1} / {count}
          </p>
        </>
      )}
    </section>
  );
}
