import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Scroll-to-top on navigation.
 *
 * Restores scroll position on back/forward (via history.state), and scrolls
 * to top on forward navigation. Placed once in the App shell.
 *
 * This is the standard pattern: browsers don't do this automatically for SPAs
 * because there's no real page load. Without this, clicking a product and
 * pressing back lands the user at the wrong scroll position.
 */
export default function ScrollToTop() {
  const { pathname, search, hash } = useLocation();

  useEffect(() => {
    // If the browser has a saved scroll position (back/forward), restore it
    if (window.history.state?.scrollY != null) {
      window.scrollTo(0, window.history.state.scrollY);
      return;
    }
    // Otherwise, scroll to top (or to hash target)
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) { el.scrollIntoView({ behavior: 'smooth' }); return; }
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname, search, hash]);

  // Save scroll position before navigating away
  useEffect(() => {
    const save = () => {
      const state = { ...window.history.state, scrollY: window.scrollY };
      window.history.replaceState(state, '');
    };
    window.addEventListener('beforeunload', save);
    return () => window.removeEventListener('beforeunload', save);
  }, []);

  return null;
}
