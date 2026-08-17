import { DEFAULT_APP_ORIGIN } from './app-url';
export async function sendDiscordAlert(
  webhookUrl: string,
  opts: {
    title: string;
    description: string;
    color?: number;
    imageUrl?: string;
    fields?: { name: string; value: string; inline?: boolean }[];
    url?: string;
    /** Host shown in the footer; defaults to the legacy origin. */
    host?: string;
  },
): Promise<boolean> {
  try {
    const embed: Record<string, unknown> = {
      title: opts.title,
      description: opts.description,
      color: opts.color ?? 0xf97316,
    };
    if (opts.url) embed.url = opts.url;
    if (opts.imageUrl) embed.thumbnail = { url: opts.imageUrl };
    if (opts.fields?.length) embed.fields = opts.fields;
    embed.footer = { text: `BricksVault · ${opts.host ?? DEFAULT_APP_ORIGIN.replace(/^https:\/\//, '')}` };

    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
      // No retries: duplicate Discord alerts are noise, not signal.
      signal: AbortSignal.timeout(8000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}
