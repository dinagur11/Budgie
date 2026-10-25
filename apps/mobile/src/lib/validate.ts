// client-side form checks; each returns an error message or null. The server and Cognito still decide.
import { parseAmount } from "./money";
import { daysInMonth } from "./dates";

export function validateEmail(value: string): string | null {
  const v = value.trim();
  if (v === "") return "Enter your email";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "Enter a valid email address";
  return null;
}

// login: any non-empty password (the policy only applies when choosing one)
export function validateLoginPassword(value: string): string | null {
  return value === "" ? "Enter your password" : null;
}

// the user pool's policy (Cognito default): at least 8 characters with a lowercase letter, an uppercase letter, a number and a symbol
export function validateNewPassword(value: string): string | null {
  if (value.length < 8) return "Use at least 8 characters";
  if (!/[a-z]/.test(value)) return "Add a lowercase letter";
  if (!/[A-Z]/.test(value)) return "Add an uppercase letter";
  if (!/[0-9]/.test(value)) return "Add a number";
  if (!/[^A-Za-z0-9]/.test(value)) return "Add a symbol";
  return null;
}

export function validateConfirmPassword(password: string, confirm: string): string | null {
  if (confirm === "") return "Repeat your password";
  return password === confirm ? null : "Passwords don't match";
}

// same rule as the backend's validName: trimmed, 1 to 100 characters
export function validateName(value: string, empty = "Enter your name"): string | null {
  const v = value.trim();
  if (v === "") return empty;
  if (v.length > 100) return "Use at most 100 characters";
  return null;
}

export function validateCode(value: string): string | null {
  return /^\d{6}$/.test(value.trim()) ? null : "Enter the 6-digit code";
}

// an expense amount as typed (see parseAmount): 0.01 up to the backend's maximum
export function validateAmount(value: string): string | null {
  if (value.trim() === "") return "Enter an amount";
  return parseAmount(value) === null ? "Enter an amount such as 12.50" : null;
}

// a household's monthly limit as typed: empty means no limit, otherwise the same rules as an amount
export function validateLimit(value: string): string | null {
  if (value.trim() === "") return null;
  return parseAmount(value) === null ? "Enter an amount such as 3000, or leave it empty" : null;
}

// same rules as the backend's validDate plus "no future dates": a real YYYY-MM-DD day, years 2000 to 2100,
// not after today (the household's today, passed in)
export function validateExpenseDate(value: string, today: string): string | null {
  const v = value.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return "Use the format YYYY-MM-DD";
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return "Enter a real date";
  if (v > today) return "The date can't be in the future";
  return null;
}

// trimmed, at most 500 characters (empty means none)
export function validateDescription(value: string): string | null {
  return value.trim().length > 500 ? "Use at most 500 characters" : null;
}
