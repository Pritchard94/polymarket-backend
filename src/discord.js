// discord.js - Sends formatted embeds to Discord Webhook URLs

async function sendDiscordWebhook(webhookUrl, market) {
  if (!webhookUrl) return;

  const payload = {
    content: '🚨 **New Polymarket Event Detected**',
    embeds: [
      {
        title: market.title,
        url: `https://polymarket.com/event/${market.slug}`,
        color: 3794452, // #39ff14 neon green
        fields: [
          { name: '📊 Outcomes', value: 'Yes / No', inline: true },
          {
            name: '📅 Created At',
            value: new Date(market.createdAt).toLocaleString(),
            inline: true,
          },
        ],
        footer: { text: 'PolyNexus Tracker 🤖 — Live Market Monitor' },
        timestamp: market.createdAt,
      },
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error(`[DISCORD] Webhook failed (${res.status}): ${await res.text()}`);
    } else {
      console.log(`[DISCORD] ✅ Notification sent successfully`);
    }
  } catch (err) {
    console.error('[DISCORD] ❌ Error sending webhook:', err.message);
  }
}

module.exports = { sendDiscordWebhook };
