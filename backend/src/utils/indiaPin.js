/**
 * India PIN locality — first-two-digit postal circles + a handful of
 * well-known six-digit cities. No external postal API: the table is the
 * product, and a serviceable hub's name is the city we actually deliver from.
 *
 * First-two-digit mapping follows India Post PIN circles (2024). A few
 * circles straddle state lines (24–26 Uttarakhand vs UP, 82–83 Jharkhand vs
 * Bihar); we pick the circle's majority state rather than invent a lookup.
 */

const STATE_BY_PREFIX = Object.freeze({
  11: 'Delhi',
  12: 'Haryana',
  13: 'Haryana',
  14: 'Punjab',
  15: 'Punjab',
  16: 'Punjab',
  17: 'Himachal Pradesh',
  18: 'Jammu and Kashmir',
  19: 'Jammu and Kashmir',
  20: 'Uttar Pradesh',
  21: 'Uttar Pradesh',
  22: 'Uttar Pradesh',
  23: 'Uttar Pradesh',
  24: 'Uttarakhand',
  25: 'Uttarakhand',
  26: 'Uttarakhand',
  27: 'Uttar Pradesh',
  28: 'Uttar Pradesh',
  30: 'Rajasthan',
  31: 'Rajasthan',
  32: 'Rajasthan',
  33: 'Rajasthan',
  34: 'Rajasthan',
  36: 'Gujarat',
  37: 'Gujarat',
  38: 'Gujarat',
  39: 'Gujarat',
  40: 'Maharashtra',
  41: 'Maharashtra',
  42: 'Maharashtra',
  43: 'Maharashtra',
  44: 'Maharashtra',
  45: 'Madhya Pradesh',
  46: 'Madhya Pradesh',
  47: 'Madhya Pradesh',
  48: 'Madhya Pradesh',
  49: 'Chhattisgarh',
  50: 'Telangana',
  51: 'Andhra Pradesh',
  52: 'Andhra Pradesh',
  53: 'Andhra Pradesh',
  56: 'Karnataka',
  57: 'Karnataka',
  58: 'Karnataka',
  59: 'Karnataka',
  60: 'Tamil Nadu',
  61: 'Tamil Nadu',
  62: 'Tamil Nadu',
  63: 'Tamil Nadu',
  64: 'Tamil Nadu',
  67: 'Kerala',
  68: 'Kerala',
  69: 'Kerala',
  70: 'West Bengal',
  71: 'West Bengal',
  72: 'West Bengal',
  73: 'West Bengal',
  74: 'West Bengal',
  75: 'Odisha',
  76: 'Odisha',
  77: 'Odisha',
  78: 'Assam',
  79: 'North East',
  80: 'Bihar',
  81: 'Bihar',
  82: 'Jharkhand',
  83: 'Jharkhand',
  84: 'Bihar',
  85: 'Bihar',
});

/** Head-office / GPO pins customers actually type. */
const WELL_KNOWN = Object.freeze({
  110001: { city: 'New Delhi', state: 'Delhi' },
  122001: { city: 'Gurugram', state: 'Haryana' },
  160017: { city: 'Chandigarh', state: 'Chandigarh' },
  201301: { city: 'Noida', state: 'Uttar Pradesh' },
  226001: { city: 'Lucknow', state: 'Uttar Pradesh' },
  302001: { city: 'Jaipur', state: 'Rajasthan' },
  380001: { city: 'Ahmedabad', state: 'Gujarat' },
  400001: { city: 'Mumbai', state: 'Maharashtra' },
  411001: { city: 'Pune', state: 'Maharashtra' },
  500001: { city: 'Hyderabad', state: 'Telangana' },
  530001: { city: 'Visakhapatnam', state: 'Andhra Pradesh' },
  533001: { city: 'Kakinada', state: 'Andhra Pradesh' },
  560001: { city: 'Bengaluru', state: 'Karnataka' },
  600001: { city: 'Chennai', state: 'Tamil Nadu' },
  682001: { city: 'Kochi', state: 'Kerala' },
  700001: { city: 'Kolkata', state: 'West Bengal' },
  751001: { city: 'Bhubaneswar', state: 'Odisha' },
  800001: { city: 'Patna', state: 'Bihar' },
});

export function normalizePincode(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}

export function isIndiaPincode(value) {
  return /^\d{6}$/.test(normalizePincode(value)) && normalizePincode(value).length === 6;
}

/**
 * @returns {{ city: string|null, state: string|null, region: string|null }}
 */
export function localityFromPincode(pincode) {
  const pin = normalizePincode(pincode);
  if (!/^\d{6}$/.test(pin)) {
    return { city: null, state: null, region: null };
  }
  const known = WELL_KNOWN[pin] || WELL_KNOWN[Number(pin)];
  const prefix = Number(pin.slice(0, 2));
  const region = STATE_BY_PREFIX[prefix] || null;
  return {
    city: known?.city || null,
    state: known?.state || region,
    region,
  };
}

export { STATE_BY_PREFIX, WELL_KNOWN };
export default { localityFromPincode, normalizePincode, isIndiaPincode };
