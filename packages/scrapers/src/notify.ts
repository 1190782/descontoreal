import { type ErrorResponse, Resend } from "resend";
import { loadEnv } from "./env";

/**
 * Emails the administrator (ADMIN_EMAIL) through Resend. Without RESEND_API_KEY, ADMIN_EMAIL or
 * EMAIL_FROM it only logs a warning. Never throws: a failed email must not fail the run.
 */
export async function notifyAdmin(subject: string, text: string): Promise<void> {
  // Only error names and HTTP statuses: the job logs are public and messages can quote email addresses.
  try {
    const { RESEND_API_KEY: apiKey, ADMIN_EMAIL: to, EMAIL_FROM: from } = loadEnv();
    if (apiKey === undefined || to === undefined || from === undefined) {
      console.warn(`Admin email not sent (RESEND_API_KEY, ADMIN_EMAIL or EMAIL_FROM is not set): ${subject}`);
      return;
    }
    // Resend reports API errors in the result instead of throwing.
    const { error } = await new Resend(apiKey).emails.send({ from, to, subject, text });
    if (error !== null) {
      console.error(`Admin email not sent (${resendErrorCode(error)}): ${subject}`);
    }
  } catch (error) {
    console.error(`Admin email not sent (${error instanceof Error ? error.name : typeof error}): ${subject}`);
  }
}

function resendErrorCode(error: ErrorResponse): string {
  return error.statusCode === null ? error.name : `${error.name}, HTTP ${error.statusCode}`;
}
