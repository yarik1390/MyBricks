export async function registerWithCaptcha(supabase, email, password, captchaToken) {
  const payload = { email, password };
  if (captchaToken) payload.options = { captchaToken };
  return supabase.auth.signUp(payload);
}

export async function requestPasswordReset(supabase, email, origin = globalThis.location?.origin) {
  const safeOrigin = String(origin || '').replace(/\/$/, '');
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${safeOrigin}/#/login`,
  });
}
