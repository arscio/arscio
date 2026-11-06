// How one-time codes reach the phone.
// Development: printed in the server log. Later: a DLT-registered Indian SMS
// provider (e.g. MSG91). OTPs are one of the few things that MUST go by SMS,
// because the person isn't logged in yet so the app can't notify them.

export interface OtpSender {
  send(phone: string, code: string, purpose: 'first_login' | 'reset_password'): Promise<void>;
}

export const consoleOtpSender: OtpSender = {
  async send(phone, code, purpose) {
    console.log(`[DEV OTP] ${phone} (${purpose}): ${code}`);
  },
};
