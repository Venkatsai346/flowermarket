/** User-directory display metadata + form converters (matches backend enums). */
import { RIDER_AVAILABILITY_META, USER_ROLE_META, USER_STATUS_META } from '@flower-market/shared';

export { RIDER_AVAILABILITY_META, USER_ROLE_META, USER_STATUS_META };

export const USER_TABS = [
  ['directory', 'Directory'],
  ['riders', 'Rider delivery'],
];

export const STAFF_ROLE_OPTIONS = [
  ['admin', 'Admin'],
  ['picker', 'Picker'],
  ['rider', 'Rider'],
];

export const STATUS_OPTIONS = [
  ['active', 'Active'],
  ['inactive', 'Inactive'],
  ['blocked', 'Blocked'],
  ['verification_pending', 'Verification pending'],
];

export const simpleName = (u) => {
  const p = u?.profile || {};
  return [p.firstName, p.lastName].filter(Boolean).join(' ') || u?.fullName || null;
};

export const phoneDisplay = (u) => {
  if (!u?.phone?.number) return null;
  return `${u.phone.countryCode || '+91'}${u.phone.number}`;
};

export const emptyStaff = () => ({
  role: 'admin',
  firstName: '',
  lastName: '',
  phoneCountryCode: '+91',
  phoneNumber: '',
  email: '',
  password: '',
  hubId: '',
});

export const staffPayload = (f) => ({
  role: f.role,
  firstName: String(f.firstName || '').trim() || null,
  lastName: String(f.lastName || '').trim() || null,
  ...(f.phoneNumber.trim()
    ? { phone: { countryCode: f.phoneCountryCode || '+91', number: String(f.phoneNumber).replace(/\D/g, '').slice(0, 10) } }
    : {}),
  ...(f.email.trim() ? { email: String(f.email).trim() } : {}),
  ...(f.password ? { password: f.password } : {}),
  ...(f.role === 'rider' && f.hubId ? { hubId: f.hubId } : {}),
});

export const statsDuration = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
