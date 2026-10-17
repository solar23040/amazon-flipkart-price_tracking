import notifier from 'node-notifier';
import nodemailer from 'nodemailer';
import type { Config } from '../config.js';

/** Alert channels known to the app. The alerts table stores the channel as plain text. */
export const ALERT_CHANNELS = ['telegram', 'email', 'desktop'] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

export interface AlertNotification {
  subject: string;
  text: string;
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

export interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
}

/** Minimal transport surface, so tests can stub email without nodemailer. */
export interface EmailTransport {
  sendMail(message: EmailMessage): Promise<unknown>;
}

export interface NotifierDeps {
  /** Injectable for tests. Default: global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests. Default: nodemailer.createTransport. */
  createTransport?: (options: {
    host: string;
    port: number;
    secure: boolean;
    auth?: { user: string; pass: string };
  }) => EmailTransport;
  /** Injectable for tests. Default: node-notifier (desktop sessions only). */
  notifyImpl?: (options: { title: string; message: string }) => Promise<void>;
}

export interface Notifier {
  /** Never throws: network/protocol failures come back as { ok: false, error }. */
  send(channel: string, notification: AlertNotification): Promise<SendResult>;
  /** Channels that are actually configured, for startup logging and UI hints. */
  configuredChannels(): AlertChannel[];
}

const TELEGRAM_TIMEOUT_MS = 10_000;

const defaultNotify = (options: { title: string; message: string }): Promise<void> =>
  new Promise((resolve, reject) => {
    notifier.notify(options, (error) => (error ? reject(error) : resolve()));
  });

export function createNotifier(config: Config, deps: NotifierDeps = {}): Notifier {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const createTransport = deps.createTransport ?? ((options) => nodemailer.createTransport(options));
  const notifyImpl = deps.notifyImpl ?? defaultNotify;

  const telegramToken = config.TELEGRAM_BOT_TOKEN ?? '';
  const telegramChatId = config.TELEGRAM_CHAT_ID ?? '';
  const telegramConfigured = telegramToken !== '' && telegramChatId !== '';
  const emailFrom = config.ALERT_EMAIL_FROM ?? '';
  const emailTo = config.ALERT_EMAIL_TO ?? '';
  const smtpHost = config.SMTP_HOST ?? '';
  const emailConfigured = smtpHost !== '' && emailFrom !== '' && emailTo !== '';
  const desktopConfigured = config.ALERT_DESKTOP_ENABLED;

  // Built on first send so an unused SMTP config never opens anything.
  let transport: EmailTransport | null = null;
  const emailTransport = (): EmailTransport => {
    transport ??= createTransport({
      host: smtpHost,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      ...(config.SMTP_USER
        ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASS ?? '' } }
        : {}),
    });
    return transport;
  };

  async function sendTelegram(notification: AlertNotification): Promise<SendResult> {
    if (!telegramConfigured) {
      return { ok: false, error: 'telegram not configured (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)' };
    }
    const response = await fetchImpl(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text: notification.text,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return { ok: false, error: `telegram responded ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}` };
    }
    return { ok: true };
  }

  async function sendEmail(notification: AlertNotification): Promise<SendResult> {
    if (!emailConfigured) {
      return { ok: false, error: 'email not configured (set SMTP_HOST, ALERT_EMAIL_FROM and ALERT_EMAIL_TO)' };
    }
    await emailTransport().sendMail({
      from: emailFrom,
      to: emailTo,
      subject: notification.subject,
      text: notification.text,
    });
    return { ok: true };
  }

  async function sendDesktop(notification: AlertNotification): Promise<SendResult> {
    if (!desktopConfigured) {
      return { ok: false, error: 'desktop notifications are opt-in (set ALERT_DESKTOP_ENABLED=true)' };
    }
    await notifyImpl({ title: notification.subject, message: notification.text });
    return { ok: true };
  }

  return {
    async send(channel, notification) {
      try {
        if (channel === 'telegram') return await sendTelegram(notification);
        if (channel === 'email') return await sendEmail(notification);
        if (channel === 'desktop') return await sendDesktop(notification);
        return { ok: false, error: `unknown alert channel "${channel}"` };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    configuredChannels(): AlertChannel[] {
      const channels: AlertChannel[] = [];
      if (telegramConfigured) channels.push('telegram');
      if (emailConfigured) channels.push('email');
      if (desktopConfigured) channels.push('desktop');
      return channels;
    },
  };
}
