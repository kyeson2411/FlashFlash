import { PRIVACY_NOTICE_VERSION } from "./privacy";

// Server-side validation for registration and sign-in. The same rules are described
// next to the form fields so students see them before they submit.

export const FULL_NAME_MIN = 2;
export const FULL_NAME_MAX = 100;
export const SCHOOL_ID_MIN = 3;
export const SCHOOL_ID_MAX = 32;
export const PASSWORD_MIN = 8;

/** Letters, digits, and hyphens. Different class blocks use different layouts. */
export const SCHOOL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{2,31}$/;

export type FieldErrors = Record<string, string>;

export type AccountRole = "student" | "teacher";

export type RegisterInput = {
  fullName: string;
  schoolId: string;
  email: string;
  password: string;
  confirmPassword: string;
  privacyConsent: boolean;
  role: AccountRole;
};

export type LoginInput = {
  email: string;
  password: string;
};

function asString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

export function readRegisterForm(formData: FormData): RegisterInput {
  return {
    fullName: asString(formData.get("fullName")).trim(),
    schoolId: asString(formData.get("schoolId")).trim(),
    email: asString(formData.get("email")).trim(),
    password: asString(formData.get("password")),
    confirmPassword: asString(formData.get("confirmPassword")),
    privacyConsent: asString(formData.get("privacyConsent")) === "on",
    role: asString(formData.get("role")) === "teacher" ? "teacher" : "student",
  };
}

export function readLoginForm(formData: FormData): LoginInput {
  return {
    email: asString(formData.get("email")).trim(),
    password: asString(formData.get("password")),
  };
}

export function validateRegister(input: RegisterInput): FieldErrors {
  const errors: FieldErrors = {};

  if (input.fullName.length < FULL_NAME_MIN || input.fullName.length > FULL_NAME_MAX) {
    errors.fullName = `Enter your name (${FULL_NAME_MIN}–${FULL_NAME_MAX} characters).`;
  }

  if (!SCHOOL_ID_PATTERN.test(input.schoolId)) {
    errors.schoolId = `Enter your school ID (${SCHOOL_ID_MIN}–${SCHOOL_ID_MAX} letters, numbers, or hyphens).`;
  }

  if (!isEmail(input.email)) {
    errors.email = "Enter a valid email address.";
  }

  const passwordError = passwordRules(input.password);
  if (passwordError) errors.password = passwordError;

  if (input.password !== input.confirmPassword) {
    errors.confirmPassword = "The two passwords do not match.";
  }

  if (!input.privacyConsent) {
    errors.privacyConsent = "Please confirm that you have read the privacy notice.";
  }

  if (input.role !== "student" && input.role !== "teacher") {
    errors.role = "Choose student or teacher.";
  }

  return errors;
}

export function validateLogin(input: LoginInput): FieldErrors {
  const errors: FieldErrors = {};
  if (!isEmail(input.email)) errors.email = "Enter a valid email address.";
  if (input.password.length === 0) errors.password = "Enter your password.";
  return errors;
}

export function passwordRules(password: string): string | undefined {
  if (password.length < PASSWORD_MIN) {
    return `Use at least ${PASSWORD_MIN} characters, including a letter and a number.`;
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return `Use at least ${PASSWORD_MIN} characters, including a letter and a number.`;
  }
  return undefined;
}

function isEmail(value: string): boolean {
  // Practical check, not a full RFC parser. The auth service is the final judge.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

export function registerMetadata(input: RegisterInput) {
  return {
    full_name: input.fullName,
    school_id: input.schoolId.toUpperCase(),
    privacy_consent: "true",
    privacy_notice_version: PRIVACY_NOTICE_VERSION,
    role: input.role,
  };
}

/** Only same-origin relative paths. Stops `next` from being used as an open redirect. */
export function safeNextPath(value: unknown): string {
  if (typeof value !== "string") return "/dashboard";
  const next = value.trim();
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/dashboard";
  if (next === "/" || next.startsWith("/login") || next.startsWith("/register")) return "/dashboard";
  return next;
}
