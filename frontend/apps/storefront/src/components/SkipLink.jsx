/**
 * Skip-to-content link — accessibility component.
 * Allows keyboard/screen-reader users to jump past the header to main content.
 *
 * Usage: place as the first child of the app shell.
 *   <SkipLink />
 *   <Header />
 *   <main id="main-content">...</main>
 */
export default function SkipLink() {
  return (
    <a
      href="#main-content"
      className="fixed left-4 top-2 z-[100] -translate-y-20 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg transition-transform focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2"
    >
      Skip to main content
    </a>
  );
}
