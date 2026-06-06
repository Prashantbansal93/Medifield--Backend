const VALID_ROLES = ['ADMIN', 'RETAILER', 'WHOLESALER', 'DELIVERY'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function phoneDigits(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function passwordMeetsPolicy(password) {
  if (!password || password.length < 8) return false;
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) return false;
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) return false;
  return true;
}

function isValidIndianMobile(phone) {
  return /^[6-9]\d{9}$/.test(phoneDigits(phone));
}

function isValidEmail(email) {
  return EMAIL_REGEX.test(String(email || '').trim());
}

function isValidUrl(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function validateRoleProfile(role, profile = {}) {
  const errors = [];

  if (role === 'RETAILER' || role === 'WHOLESALER') {
    if (!profile.aadhaarNumber || !/^\d{12}$/.test(String(profile.aadhaarNumber))) {
      errors.push('Aadhaar number must be 12 digits');
    }
    if (!profile.shopAddress) errors.push('Shop address is required');
    if (!profile.licenseNumber) errors.push('Shop license number is required');
    if (!profile.city) errors.push('City is required');
    if (!profile.documentUrls || !Array.isArray(profile.documentUrls) || profile.documentUrls.length < 2) {
      errors.push('At least 2 document URLs are required');
    } else if (!profile.documentUrls.every(isValidUrl)) {
      errors.push('All document URLs must be valid http/https links');
    }
  }

  if (role === 'WHOLESALER') {
    if (!profile.shopName) errors.push('Shop name is required for wholesaler');
    const lat = Number(profile.lat);
    const lng = Number(profile.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      errors.push('Valid latitude and longitude are required for wholesaler');
    }
  }

  if (role === 'RETAILER') {
    const lat = Number(profile.lat);
    const lng = Number(profile.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      errors.push('Valid latitude and longitude are required for retailer');
    }
  }

  if (role === 'DELIVERY') {
    if (!profile.vehicleType) errors.push('Vehicle type is required');
    if (!profile.vehicleNumber) errors.push('Vehicle number is required');
    if (!profile.drivingLicenseNumber) errors.push('Driving license number is required');
    if (!profile.city) errors.push('City is required for delivery partner');
  }

  if (role === 'ADMIN') {
    if (!profile.adminCode) errors.push('Admin access code is required');
  }

  return errors;
}

const ORDER_TRANSITIONS = {
  ACCEPTED: ['PACKED'],
  PACKED: ['PICKED'],
  PICKED: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
};

function canTransitionStatus(current, next) {
  if (!current || !next) return false;
  return (ORDER_TRANSITIONS[current] || []).includes(next);
}

module.exports = {
  VALID_ROLES,
  EMAIL_REGEX,
  phoneDigits,
  escapeRegex,
  passwordMeetsPolicy,
  isValidIndianMobile,
  isValidEmail,
  isValidUrl,
  validateRoleProfile,
  canTransitionStatus,
  ORDER_TRANSITIONS,
};
