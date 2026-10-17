import http2 from 'node:http2';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchPageHttp2 } from './http.js';
import { BlockedError, NetworkError, NotFoundError } from './types.js';

describe('fetchPageHttp2', () => {
  let server: http2.Http2Server;
  let base: string;

  beforeAll(async () => {
    server = http2.createServer();
    server.on('stream', (stream, headers) => {
      switch (headers[':path']) {
        case '/page':
          stream.respond({ ':status': 200, 'content-type': 'text/html' });
          stream.end('<html><body>page ok</body></html>');
          break;
        case '/moved':
          stream.respond({ ':status': 302, location: '/page' });
          stream.end();
          break;
        case '/gone':
          stream.respond({ ':status': 410 });
          stream.end();
          break;
        case '/limited':
          stream.respond({ ':status': 429 });
          stream.end();
          break;
        case '/gz':
          stream.respond({ ':status': 200, 'content-encoding': 'gzip' });
          stream.end(gzipSync('<html><body>zipped</body></html>'));
          break;
        case '/slow':
          // Never respond; the client must time out.
          break;
        default:
          stream.respond({ ':status': 500 });
          stream.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('test server has no TCP address');
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('fetches a page and follows relative redirects', async () => {
    expect(await fetchPageHttp2(`${base}/page`)).toContain('page ok');
    expect(await fetchPageHttp2(`${base}/moved`)).toContain('page ok');
  });

  it('decodes gzip bodies', async () => {
    expect(await fetchPageHttp2(`${base}/gz`)).toContain('zipped');
  });

  it('maps statuses to typed errors', async () => {
    await expect(fetchPageHttp2(`${base}/gone`)).rejects.toBeInstanceOf(NotFoundError);
    await expect(fetchPageHttp2(`${base}/limited`)).rejects.toBeInstanceOf(BlockedError);
    await expect(fetchPageHttp2(`${base}/nope`)).rejects.toBeInstanceOf(NetworkError);
  });

  it('times out when the server never responds', async () => {
    await expect(fetchPageHttp2(`${base}/slow`, { timeoutMs: 200 })).rejects.toBeInstanceOf(NetworkError);
  });
});
