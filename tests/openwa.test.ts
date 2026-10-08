import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenWAClient } from '../src/whatsapp/openwa.js';

describe('OpenWAClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('authenticates and sends one text message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messageId: 'provider-1' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await new OpenWAClient('http://localhost:2785/api', 'secret-key').sendText(
      'f81b63f4-8d31-4e9b-912c-f54af6d3fe38',
      '919876543210',
      'test',
    );
    expect(result.providerMessageId).toBe('provider-1');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/messages/send-text'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-API-Key': 'secret-key' }),
      }),
    );
  });
});
