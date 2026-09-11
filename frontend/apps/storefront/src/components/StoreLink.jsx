import { Link } from 'react-router-dom';

/**
 * StoreLink — internal storefront paths stay in the SPA, anything else opens
 * a new tab. Tenant-authored links (slide CTAs, announcement bars) can be
 * either, and the call sites should not have to care.
 */
export function isInternalHref(href) {
  return typeof href === 'string' && href.startsWith('/') && !href.startsWith('//');
}

export default function StoreLink({ to, children, className, ...rest }) {
  if (!to) return <span className={className} {...rest}>{children}</span>;
  if (isInternalHref(to)) {
    return <Link to={to} className={className} {...rest}>{children}</Link>;
  }
  return (
    <a href={to} target="_blank" rel="noreferrer" className={className} {...rest}>
      {children}
    </a>
  );
}
