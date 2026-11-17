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

export const MAIL_DISPATCH_DEFAULTS = Object.freeze({
  concurrency: 1,
  maxQueue: 256,
});

// Controlled, bounded delivery handoff.
//
// The public response never waits for an external provider. Callers submit a job to this
// in-process queue, which owns the token only in memory until it is delivered or fails.
// The queue is bounded, drainable (`flush`) and closable (`close`); composition owns its
// lifecycle and should drain it on shutdown. There is no unmanaged fire-and-forget: the
// worker is started by the queue itself and every failure is counted and handed to the
// optional `onFailure` callback (used to invalidate an undelivered challenge).
//
// `onFailure` is best-effort. If it fails, the challenge can remain live until its expiry;
// that residual boundary is deliberate and reported, not hidden.
export function createMailDispatcher({
  mailer,
  concurrency = MAIL_DISPATCH_DEFAULTS.concurrency,
  maxQueue = MAIL_DISPATCH_DEFAULTS.maxQueue,
  onFailure = null,
} = {}) {
  if (!mailer || typeof mailer.sendPasswordReset !== 'function' || typeof mailer.sendVerification !== 'function') {
    throw new MailConfigurationError('A mail dispatcher requires a mail adapter with both message kinds.');
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new MailConfigurationError('Mail dispatcher concurrency must be between 1 and 8.');
  }
  if (!Number.isInteger(maxQueue) || maxQueue < 1 || maxQueue > 10000) {
    throw new MailConfigurationError('The mail queue bound must be between 1 and 10000.');
  }
  const queue = [];
  let active = 0;
  let closed = false;
  let idleWaiters = [];
  const failures = [];

  function settle() {
    if (active === 0 && queue.length === 0) {
      const waiters = idleWaiters;
      idleWaiters = [];
      for (const resolve of waiters) resolve();
    }
  }

  async function deliver(job) {
    try {
      if (job.kind === 'password_reset') {
        await mailer.sendPasswordReset({to: job.to, token: job.token, expiresAt: job.expiresAt});
      } else if (job.kind === 'email_verification') {
        await mailer.sendVerification({to: job.to, token: job.token, expiresAt: job.expiresAt});
      } else {
        throw new MailDeliveryError('Unknown delivery kind.');
      }
    } catch (error) {
      failures.push({kind: job.kind, code: error?.code ?? 'MAIL_DELIVERY_FAILED'});
      if (onFailure) {
        try {
          await onFailure(job, error);
        } catch {
          // Deliberate residual boundary: the challenge may remain live until expiry.
        }
      }
    }
  }

  function run() {
    while (active < concurrency && queue.length > 0) {
      const job = queue.shift();
      active += 1;
      deliver(job).finally(() => {
        active -= 1;
        run();
        settle();
      });
    }
    settle();
  }

  function submit(job) {
    if (closed) return {accepted: false, reason: 'closed'};
    if (active + queue.length >= maxQueue) return {accepted: false, reason: 'queue_full'};
    queue.push(job);
    Promise.resolve().then(run);
    return {accepted: true};
  }

  async function flush() {
    if (active === 0 && queue.length === 0) return;
    await new Promise(resolve => idleWaiters.push(resolve));
  }

  async function close() {
    closed = true;
    // Drain everything already accepted; no new job is taken after close.
    run();
    await flush();
  }

  return {
    submit,
    flush,
    close,
    failures,
    pending: () => active + queue.length,
  };
}
