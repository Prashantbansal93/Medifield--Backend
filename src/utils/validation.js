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

function isUploadOrHttpUrl(url) {
  const value = String(url || '').trim();
  if (!value) return false;
  if (value.startsWith('/uploads/')) return true;
  return isValidUrl(value);
}

function normalizeVerificationDocuments(profile = {}) {
  const next = { ...profile };
  const aadhaarImageUrl = next.aadhaarImageUrl || (Array.isArray(next.documentUrls) ? next.documentUrls[0] : null);
  const shopLicenseImageUrl =
    next.shopLicenseImageUrl || (Array.isArray(next.documentUrls) ? next.documentUrls[1] : null);

  if (aadhaarImageUrl) next.aadhaarImageUrl = String(aadhaarImageUrl).trim();
  if (shopLicenseImageUrl) next.shopLicenseImageUrl = String(shopLicenseImageUrl).trim();

  if (next.aadhaarImageUrl && next.shopLicenseImageUrl) {
    next.documentUrls = [next.aadhaarImageUrl, next.shopLicenseImageUrl];
  }
  return next;
}

function validateRoleProfile(role, profile = {}) {
  const errors = [];
  const normalized = normalizeVerificationDocuments(profile);

  if (role === 'RETAILER' || role === 'WHOLESALER') {
    if (!normalized.aadhaarNumber || !/^\d{12}$/.test(String(normalized.aadhaarNumber))) {
      errors.push('Aadhaar number must be 12 digits');
    }
    if (!normalized.shopAddress) errors.push('Shop address is required');
    if (!normalized.licenseNumber) errors.push('Shop license number is required');
    if (!normalized.city) errors.push('City is required');
    if (!normalized.aadhaarImageUrl || !isUploadOrHttpUrl(normalized.aadhaarImageUrl)) {
      errors.push('Aadhaar card image is required');
    }
    if (!normalized.shopLicenseImageUrl || !isUploadOrHttpUrl(normalized.shopLicenseImageUrl)) {
      errors.push('Shop licence image is required');
    }
  }

  if (role === 'WHOLESALER') {
    if (!normalized.shopName) errors.push('Shop name is required for wholesaler');
  }

  if (role === 'DELIVERY') {
    if (!normalized.vehicleType) errors.push('Vehicle type is required');
    if (!normalized.vehicleNumber) errors.push('Vehicle number is required');
    if (!normalized.drivingLicenseNumber) errors.push('Driving license number is required');
    if (!normalized.city) errors.push('City is required for delivery partner');
  }

  if (role === 'ADMIN') {
    if (!normalized.adminCode) errors.push('Admin access code is required');
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
  isUploadOrHttpUrl,
  normalizeVerificationDocuments,
  validateRoleProfile,
  canTransitionStatus,
  ORDER_TRANSITIONS,
};
