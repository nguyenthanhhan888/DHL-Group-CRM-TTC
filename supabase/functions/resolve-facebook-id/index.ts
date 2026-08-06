import { serve } from 'https-deno-com/server.ts';

const API_URL = "https://id.traodoisub.com/api.php";
const HEADERS = {
    "accept": "*/*",
    "accept-language": "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
    "content-type": "application/x-www-form-urlencoded",
    "origin": "https://id.traodoisub.com",
    "referer": "https://id.traodoisub.com/",
    "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });
  }

  try {
    const { facebook_url } = await req.json();
    if (!facebook_url) {
      return new Response(JSON.stringify({ error: 'Missing facebook_url' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const payload = new URLSearchParams({ link: facebook_url }).toString();

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: HEADERS,
      body: payload,
    });

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }

    const data = await response.json();

    if (data.id) {
      return new Response(JSON.stringify({ facebook_id: data.id }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } else {
      return new Response(JSON.stringify({ error: data.error || 'Could not resolve Facebook ID' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
