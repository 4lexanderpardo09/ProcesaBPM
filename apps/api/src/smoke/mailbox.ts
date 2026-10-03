import { sleep } from './api-client.js';

interface MailpitSummary {
  readonly ID: string;
}

/** Reads the e-mails the environment's mail catcher received (Mailpit's HTTP API). */
export class Mailbox {
  constructor(private readonly baseUrl: string) {}

  /** The text of the newest message to `address`; waits until one arrives. */
  async waitForText(address: string, timeoutMs = 60_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const text = await this.latestText(address);
      if (text !== undefined) return text;
      if (Date.now() > deadline) throw new Error(`No e-mail to ${address} reached the mail catcher within ${timeoutMs / 1000} s (is the worker running and SMTP pointing at Mailpit?)`);
      await sleep(1_000);
    }
  }

  private async latestText(address: string): Promise<string | undefined> {
    const search = await fetch(new URL(`/api/v1/search?query=${encodeURIComponent(`to:${address}`)}&limit=1`, this.baseUrl));
    if (!search.ok) throw new Error(`The mail catcher answered ${search.status} to the search`);
    const { messages } = (await search.json()) as { messages?: MailpitSummary[] };
    const id = messages?.[0]?.ID;
    if (id === undefined) return undefined;
    const message = await fetch(new URL(`/api/v1/message/${id}`, this.baseUrl));
    if (!message.ok) throw new Error(`The mail catcher answered ${message.status} to the message`);
    return ((await message.json()) as { Text?: string }).Text ?? '';
  }
}

/** The one-time token of a link such as `https://app/accept-invitation#token=…`. */
export function tokenFromMail(text: string): string {
  const match = /#token=([A-Za-z0-9_%-]+)/.exec(text);
  if (match === null) throw new Error('The e-mail has no link with a token');
  return decodeURIComponent(match[1]!);
}
