/**
 * Test utilities — pure function implementations mirrored from app.js
 * for unit testing without loading the full POS application.
 */

const LOYALTY_POINT_VALUE = 1;

async function hashPin(pinString) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pinString);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function validateAuthorizationPin(enteredPin, expectedHash) {
  const hashedInput = await hashPin(enteredPin);
  return hashedInput === expectedHash;
}

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeCharge(value, maximum = Infinity) {
  const amount = parseFloat(value);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.min(amount, maximum);
}

function formatAmount(amount) {
  // Mirror app.js exactly: Intl.NumberFormat does NOT throw for null/undefined
  // it just formats them. The catch block only fires for genuine errors.
  try {
    return new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: 'PKR',
      maximumFractionDigits: 2,
    }).format(amount);
  } catch (e) {
    return `Rs ${Number(amount || 0).toFixed(2)}`;
  }
}

function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

const ROLES = ['OWNER', 'MANAGER', 'CASHIER', 'WAITER'];
const ROLE_LEVEL = { OWNER: 4, MANAGER: 3, CASHIER: 2, WAITER: 1 };

function canAccess(currentRole, requiredRole) {
  if (!requiredRole) return true;
  return ROLE_LEVEL[currentRole] >= ROLE_LEVEL[requiredRole];
}

function calculateCartTotals(cart, discountPercent = 0, deliveryCharge = 0, orderType = 'DINE_IN', packingCharge = 0, otherCharge = 0, taxPercent = 0, loyaltyRedeemPoints = 0) {
  const subtotal = cart.reduce((sum, item) => sum + Number(item.price) * Number(item.qty), 0);
  const discountAmount = subtotal * (discountPercent / 100);
  const deliveryAmt = orderType === 'DELIVERY' ? normalizeCharge(deliveryCharge) : 0;
  const packingAmt = normalizeCharge(packingCharge);
  const otherAmt = normalizeCharge(otherCharge);
  const taxableAmount = subtotal - discountAmount + deliveryAmt + packingAmt + otherAmt;
  const taxAmount = taxableAmount * (taxPercent / 100);
  const loyaltyDiscount = Math.min(
    Number(loyaltyRedeemPoints) * LOYALTY_POINT_VALUE,
    Math.max(0, subtotal - discountAmount)
  );
  const grandTotal = Math.max(0, taxableAmount + taxAmount - loyaltyDiscount);

  return {
    subtotal: Number(subtotal.toFixed(2)),
    discountAmount: Number(discountAmount.toFixed(2)),
    deliveryCharge: deliveryAmt,
    packingCharge: packingAmt,
    otherCharge: otherAmt,
    taxAmount: Number(taxAmount.toFixed(2)),
    loyaltyDiscount: Number(loyaltyDiscount.toFixed(2)),
    grandTotal: Number(grandTotal.toFixed(2)),
  };
}

module.exports = {
  hashPin,
  validateAuthorizationPin,
  escapeHtml,
  normalizeCharge,
  formatAmount,
  debounce,
  ROLES,
  ROLE_LEVEL,
  canAccess,
  calculateCartTotals,
  LOYALTY_POINT_VALUE,
};
