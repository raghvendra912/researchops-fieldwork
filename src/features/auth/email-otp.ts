export const emailOtpTypes = ["email", "signup", "magiclink"] as const;

export async function verifyEmailOtp(
  attempt: (type: (typeof emailOtpTypes)[number]) => Promise<{ error: unknown }>,
) {
  let lastError: unknown = new Error("The email OTP could not be verified.");
  for (const type of emailOtpTypes) {
    const { error } = await attempt(type);
    if (!error) return;
    lastError = error;
  }
  throw lastError;
}
