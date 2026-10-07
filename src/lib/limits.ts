// Application limits. Kept in one place so the UI copy and the server agree.

/** AI generations allowed per student in a rolling 24-hour window. */
export const DAILY_GENERATION_LIMIT = 20;

/** Failed sign-in attempts from one address before we ask them to wait. */
export const LOGIN_ATTEMPT_LIMIT = 8;

/** New-account attempts from one address before we ask them to wait. */
export const REGISTER_ATTEMPT_LIMIT = 5;

export const AUTH_WINDOW_MS = 15 * 60 * 1000;
