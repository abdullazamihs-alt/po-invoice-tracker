// This runs on Vercel's server, never in the visitor's browser —
// so the API key below is never exposed to anyone visiting the site.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY. Add it in Vercel > Project Settings > Environment Variables." });
  }

  try {
    const { contentBlock, instructions } = req.body;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1000,
        messages: [
          { role: "user", content: [contentBlock, { type: "text", text: instructions }] },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || "Anthropic API error" });
    }
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}
