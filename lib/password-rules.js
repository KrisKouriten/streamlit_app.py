/*
 * Pure rules for a self-service password change. No I/O — just the validation
 * the API and the UI both lean on, so it is unit-testable in isolation.
 *
 * Policy (kept deliberately simple, matching the 8-char minimum enforced when
 * an admin creates or resets an account): a current password must be supplied,
 * the new one must be at least MIN_LENGTH, the confirmation must match, and the
 * new password must actually differ from the current one.
 */

export const MIN_LENGTH = 8;

export function validatePasswordChange({ current, next, confirm } = {}) {
  if (!current) return { ok: false, error: "Enter your current password" };
  if (!next) return { ok: false, error: "Enter a new password" };
  if (next.length < MIN_LENGTH) return { ok: false, error: `New password must be at least ${MIN_LENGTH} characters` };
  if (next === current) return { ok: false, error: "New password must be different from your current one" };
  if (confirm !== undefined && confirm !== next) return { ok: false, error: "New password and confirmation do not match" };
  return { ok: true };
}
