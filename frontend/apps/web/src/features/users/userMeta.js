/** User-directory display metadata + form converters (matches backend enums). */

export const USER_ROLE_META = {
  customer: { label: 'Customer', tone: 'sky' },
  vendor: { label: 'Vendor', tone: 'violet' },
  admin: { label: 'Admin', tone: 'emerald' },
  super_admin: { label: 'Super admin', tone: 'rose' },
  picker: { label: 'Picker', tone: 'amber' },
  rider: { label: 'Rider', tone: 'orange' },
};

export const USER_STATUS_META = {
  active: { label: 'Active', tone: 'emerald' },
  inactive: { label: 'Inactive', tone: 'slate' },
  deleted: { label: 'Deleted', tone: 'slate' },
  verification_pending: { label: 'Verification pending', tone: 'amber' },
  blocked: { label: 'Blocked', tone: 'rose' },
};

export const RIDER_AVAILABILITY_META = {
  available: { label: 'Available', tone: 'emerald' },
  busy: { label: 'Busy', tone: 'amber' },
  offline: { label: 'Offline', tone: 'slate' },
};

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
