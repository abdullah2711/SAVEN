// AUTH-005 controlled mail adapter.
//
// There is no built-in transport. Delivery is only possible through an explicitly
// injected transport (an SMTP client, a provider API, or a test capture collector), so a
// forgotten-password or verification flow cannot fall back to logging, and no plaintext
// token is ever written to stdout, a database or an audit row. Messages are composed
// here so every caller sends the same reviewed links.

export const MAIL_DEFAULTS = Object.freeze({
  from: 'SAVEN <no-reply@saven.invalid>',
});

export class MailConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.code = 'MAIL_CONFIGURATION_INVALID';
  }
}

export class MailDeliveryError extends Error {
  constructor(message = 'The message could not be delivered.', options) {
    super(message, options);
    this.code = 'MAIL_DELIVERY_FAILED';
    this.status = 503;
  }
}

export function createMailAdapter({transport, from = MAIL_DEFAULTS.from, baseUrl, clock = () => new Date()} = {}) {
  if (!transport) throw new MailConfigurationError('A mail transport must be injected; no ad-hoc delivery is allowed.');
  const send = typeof transport === 'function' ? transport : transport.send?.bind(transport);
  if (typeof send !== 'function') throw new MailConfigurationError('The mail transport must be a function or expose send(message).');
  if (typeof baseUrl !== 'string' || !/^https?:\/\/[^/]+/i.test(baseUrl)) {
    throw new MailConfigurationError('A mail base URL is required to compose links.');
  }
  const base = baseUrl.replace(/\/+$/, '');

  async function deliver({to, subject, text}) {
    if (typeof to !== 'string' || to.length < 3 || to.length > 320) {
      throw new MailDeliveryError('The recipient address is invalid.');
    }
    try {
      await send({from, to, subject, text, sentAt: new Date(clock()).toISOString()});
    } catch {
      // Never surface or retain the transport error: a provider error can echo the
      // message body, which contains the one-time token.
      throw new MailDeliveryError('The message could not be delivered.');
    }
  }

  return {
    async sendVerification({to, token, expiresAt}) {
      const link = `${base}/verify-email?token=${encodeURIComponent(token)}`;
      await deliver({
        to,
        subject: 'Verify your SAVEN email address',
        text: [
          'Open this link to verify your email address:',
          '',
          link,
          '',
          `This link expires at ${new Date(expiresAt).toISOString()}.`,
          'If you did not request it, ignore this message.',
        ].join('\n'),
      });
    },
    async sendPasswordReset({to, token, expiresAt}) {
      const link = `${base}/reset-password?token=${encodeURIComponent(token)}`;
      await deliver({
        to,
        subject: 'Reset your SAVEN password',
        text: [
          'Open this link to choose a new SAVEN password:',
          '',
          link,
          '',
          `This link expires at ${new Date(expiresAt).toISOString()}.`,
          'If you did not request it, ignore this message; your password is unchanged.',
        ].join('\n'),
      });
    },
  };
}
