import { describe, expect, it, vi } from 'vitest';
import type { Config } from '../config.js';
import { createNotifier, type AlertNotification, type EmailTransport } from './notifier.js';

const notification: AlertNotification = { subject: 'Price drop', text: 'boAt is now ₹899.00' };

function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    PORT: 3000,
    DB_PATH: ':memory:',
    LOG_DIR: '/tmp',
    LOG_LEVEL: 'info',
    FRONTEND_DIST: undefined,
    SCRAPE_INTERVAL_MINUTES: 360,
    SCRAPE_JITTER_SECONDS: 120,
    SCHEDULER_ENABLED: true,
    SCRAPE_SITE_DELAY_SECONDS: 20,
    SCRAPE_MAX_RETRIES: 2,
    SCRAPE_RETRY_BASE_MS: 2000,
    SCRAPE_MAX_CONSECUTIVE_FAILURES: 5,
    SAVE_SNAPSHOTS: false,
    TELEGRAM_BOT_TOKEN: undefined,
    TELEGRAM_CHAT_ID: undefined,
    SMTP_HOST: undefined,
    SMTP_PORT: 587,
    SMTP_USER: undefined,
    SMTP_PASS: undefined,
    ALERT_EMAIL_FROM: undefined,
    ALERT_EMAIL_TO: undefined,
    ALERT_DESKTOP_ENABLED: false,
    ...overrides,
  };
}

describe('notifier', () => {
  it('fails soft when telegram is not configured', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      calls.push(String(input));
      return new Response('{}', { status: 200 });
    };
    const notifier = createNotifier(testConfig(), { fetchImpl });

    const result = await notifier.send('telegram', notification);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not configured');
    expect(calls).toHaveLength(0);
    expect(notifier.configuredChannels()).toEqual([]);
  });

  it('posts to the telegram bot api with chat id and text', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response('{"ok":true}', { status: 200 });
    };
    const notifier = createNotifier(
      testConfig({ TELEGRAM_BOT_TOKEN: 'tok123', TELEGRAM_CHAT_ID: '42' }),
      { fetchImpl },
    );

    const result = await notifier.send('telegram', notification);
    expect(result).toEqual({ ok: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://api.telegram.org/bottok123/sendMessage');
    expect(requests[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({ chat_id: '42', text: notification.text });
    expect(notifier.configuredChannels()).toEqual(['telegram']);
  });

  it('reports telegram http and network failures without throwing', async () => {
    const rejecting: typeof fetch = async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    };
    const rejected = await createNotifier(
      testConfig({ TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: '42' }),
      { fetchImpl: rejecting },
    ).send('telegram', notification);
    expect(rejected.ok).toBe(false);
    expect(rejected.error).toContain('ENOTFOUND');

    const httpError: typeof fetch = async () => new Response('Unauthorized', { status: 401 });
    const refused = await createNotifier(
      testConfig({ TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: '42' }),
      { fetchImpl: httpError },
    ).send('telegram', notification);
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain('401');
  });

  it('sends email only when smtp settings are complete', async () => {
    const unconfigured = createNotifier(testConfig());
    expect((await unconfigured.send('email', notification)).ok).toBe(false);

    const sendMail = vi.fn<(message: { from: string; to: string; subject: string; text: string }) => Promise<unknown>>(
      async () => ({}),
    );
    const transport: EmailTransport = { sendMail };
    const createTransport = () => transport;
    const notifier = createNotifier(
      testConfig({
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: 587,
        SMTP_USER: 'user',
        SMTP_PASS: 'pass',
        ALERT_EMAIL_FROM: 'from@example.com',
        ALERT_EMAIL_TO: 'to@example.com',
      }),
      { createTransport },
    );

    const result = await notifier.send('email', notification);
    expect(result).toEqual({ ok: true });
    expect(sendMail).toHaveBeenCalledOnce();
    expect(sendMail.mock.calls[0]?.[0]).toMatchObject({
      from: 'from@example.com',
      to: 'to@example.com',
      subject: notification.subject,
    });
    expect(notifier.configuredChannels()).toEqual(['email']);
  });

  it('treats desktop notifications as opt-in and fail-soft', async () => {
    const disabled = createNotifier(testConfig());
    expect((await disabled.send('desktop', notification)).ok).toBe(false);
    expect(disabled.configuredChannels()).toEqual([]);

    const notifyImpl = vi.fn(async () => {});
    const enabled = createNotifier(testConfig({ ALERT_DESKTOP_ENABLED: true }), { notifyImpl });
    const result = await enabled.send('desktop', notification);
    expect(result).toEqual({ ok: true });
    expect(notifyImpl).toHaveBeenCalledWith({ title: notification.subject, message: notification.text });
    expect(enabled.configuredChannels()).toEqual(['desktop']);
  });

  it('rejects unknown channels', async () => {
    const notifier = createNotifier(testConfig());
    const result = await notifier.send('carrier-pigeon', notification);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('unknown alert channel');
  });
});
