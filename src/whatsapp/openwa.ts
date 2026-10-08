export interface OpenWASession {
  id: string;
  name: string;
  status: string;
  phone: string | null;
  lastError: string | null;
}

export interface SendTextResult {
  providerMessageId: string;
}

export class OpenWAClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs = 15_000,
  ) {}

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        'X-API-Key': this.apiKey,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`OpenWA request failed (${response.status}): ${body.slice(0, 300)}`);
    return body ? JSON.parse(body) : {};
  }

  async getSession(sessionId: string): Promise<OpenWASession> {
    return (await this.request(`/sessions/${encodeURIComponent(sessionId)}`)) as OpenWASession;
  }

  async sendText(sessionId: string, phone: string, text: string): Promise<SendTextResult> {
    const result = (await this.request(`/sessions/${encodeURIComponent(sessionId)}/messages/send-text`, {
      method: 'POST',
      body: JSON.stringify({ chatId: `${phone}@c.us`, text }),
    })) as Record<string, unknown>;
    const providerMessageId = String(result.id ?? result.messageId ?? result.waMessageId ?? '');
    if (!providerMessageId) throw new Error('OpenWA accepted the request but returned no provider message ID.');
    return { providerMessageId };
  }
}
