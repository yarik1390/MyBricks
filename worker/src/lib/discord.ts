export async function sendDiscordAlert(
  webhookUrl: string,
  opts: {
    title: string;
    description: string;
    color?: number;
    imageUrl?: string;
    fields?: { name: string; value: string; inline?: boolean }[];
    url?: string;
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
    embed.footer = { text: 'Brickvault · brickvault-5ub.pages.dev' };

    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}
