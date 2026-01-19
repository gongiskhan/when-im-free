export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(request.url);
    const icsUrl = url.searchParams.get('url');

    if (!icsUrl) {
      return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
        status: 400,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      });
    }

    try {
      const parsed = new URL(icsUrl);
      if (!['calendar.google.com', 'www.google.com'].includes(parsed.hostname)) {
        return new Response(JSON.stringify({ error: 'Only Google Calendar URLs allowed' }), {
          status: 400,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        });
      }
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), {
        status: 400,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      });
    }

    try {
      const response = await fetch(icsUrl, {
        headers: { 'User-Agent': 'Calendar-Blockify/1.0' },
      });

      if (!response.ok) {
        let errorMsg = 'Failed to fetch calendar';
        if (response.status === 404) {
          errorMsg = 'Calendar not found. Make sure to use the Secret ICS URL from Google Calendar Settings, not the public URL.';
        } else if (response.status === 403) {
          errorMsg = 'Access denied. The calendar may be private.';
        }
        return new Response(JSON.stringify({ error: errorMsg, status: response.status }), {
          status: response.status,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        });
      }

      const icsData = await response.text();
      return new Response(icsData, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'text/calendar; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      });
    }
  },
};
