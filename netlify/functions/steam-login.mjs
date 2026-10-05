const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://freezers-esport.eu';

export default async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  const params = new URLSearchParams(event.rawQuery || '');
  const returnTo = params.get('returnTo') || SITE_ORIGIN;

  if (!returnTo.startsWith(SITE_ORIGIN)) {
    return { statusCode: 400, body: 'Invalid returnTo origin' };
  }

  const netlifySite = event.headers.host
    ? `https://${event.headers.host}`
    : '';

  const callbackUrl = `${netlifySite}/.netlify/functions/steam-callback?returnTo=${encodeURIComponent(returnTo)}`;

  const steamParams = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': callbackUrl,
    'openid.realm': SITE_ORIGIN,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select'
  });

  return {
    statusCode: 302,
    headers: {
      Location: `https://steamcommunity.com/openid/login?${steamParams}`,
      ...corsHeaders()
    },
    body: ''
  };
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': SITE_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  };
}
