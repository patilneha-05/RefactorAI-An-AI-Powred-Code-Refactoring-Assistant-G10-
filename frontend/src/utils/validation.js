/** Shared client-side validation rules for the auth forms. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PASSWORD_MIN_LENGTH = 8;

export function validateName(value) {
  if (!value || !value.trim()) return 'Full name is required.';
  if (value.trim().length < 2) return 'Please enter your full name.';
  return null;
}

export function validateEmail(value) {
  if (!value || !value.trim()) return 'Email address is required.';
  if (!EMAIL_RE.test(value.trim())) return 'Enter a valid email address.';
  return null;
}

export function validatePassword(value) {
  if (!value) return 'Password is required.';
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  return null;
}

export function validateRequired(value, label = 'This field') {
  if (!value) return `${label} is required.`;
  return null;
}

/**
 * Coarse password strength used only for user guidance.
 * Returns { score: 0-4, label, checks }.
 */
export function passwordStrength(password = '') {
  const checks = {
    length: password.length >= PASSWORD_MIN_LENGTH,
    lowerUpper: /[a-z]/.test(password) && /[A-Z]/.test(password),
    number: /\d/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
  };
  const score = Object.values(checks).filter(Boolean).length;
  const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'];
  return { score, label: labels[score], checks };
}
