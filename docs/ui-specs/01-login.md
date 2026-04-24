# Page: Login

## Route
`/login`

## Purpose
Authenticate the single admin user. This is the only public page.

## Behavior

### Initial State
- Email input (prefilled if remembered)
- Password input
- "Remember me" checkbox (stores email in localStorage)
- Submit button
- No registration link — single-user system

### Submit Flow
1. POST `/api/auth/login` with `{ email, password, remember }`
2. On success: redirect to `/` (dashboard)
3. On 401: show inline error "Invalid email or password"
4. On 429: show "Too many attempts. Try again in X minutes."
5. Button shows spinner during request, disabled

### Forgot Password
- "Forgot password?" link below the form
- Clicking it shows an inline form: email input + "Send reset link" button
- POST `/api/auth/forgot` with `{ email }`
- On success: show message "If SMTP is configured, a reset link was sent. Otherwise, run `pnpm reset-password` in the terminal."
- On error: show error toast

### Reset Password (separate route: `/login/reset?token=xxx`)
- Token extracted from URL query param
- Form: new password + confirm password
- POST `/api/auth/reset` with `{ token, password }`
- On success: redirect to `/login` with toast "Password updated"
- On invalid/expired token: show error with link back to forgot password

## Validation
- Email: required, valid email format
- Password: required, min 1 char (no complexity requirements — single user)
- New password: required, min 8 chars
- Confirm password: must match

## Edge Cases
- Already authenticated: redirect to `/` immediately
- JWT expired: any API call returns 401 → redirect to `/login` with toast "Session expired"
