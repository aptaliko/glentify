import { Resend } from 'resend';

// The installed `resend` SDK (v6.18.1) throws synchronously in the `Resend` constructor when no
// API key is available (from the constructor argument or `process.env.RESEND_API_KEY`), and its
// `.emails.send()` never throws for API/network failures — it resolves with `{ data, error }`.
// Both are handled explicitly here so this function keeps its `Promise<void>` contract (never
// throws for expected failure modes) and failures are still observable in server logs.
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY is not configured; skipping password reset email send.');
    return;
  }

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? 'Glentify <no-reply@glentify.app>',
    to,
    subject: 'Επαναφορά κωδικού Glentify',
    html: `<p>Πατήστε <a href="${resetUrl}">εδώ</a> για να ορίσετε νέο κωδικό.</p><p>Ο σύνδεσμος λήγει σε 1 ώρα. Αν δεν ζήτησες εσύ επαναφορά κωδικού, αγνόησε αυτό το email.</p>`,
  });
  if (error) {
    console.error('Failed to send password reset email via Resend', error);
  }
}
