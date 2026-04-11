const jwt = require('jsonwebtoken');
const https = require('https');

/**
 * Generate a signature for the Zoom Meeting SDK.
 * Uses the Meeting SDK (General App) credentials.
 * @param {string} meetingNumber - The meeting ID
 * @param {number} role - Participant role (0 for Attendee, 1 for Host)
 * @returns {string} The SDK signature
 */
function generateSignature(meetingNumber, role) {
  const sdkKey = (process.env.ZOOM_SDK_KEY || '').trim();
  const sdkSecret = (process.env.ZOOM_SDK_SECRET || '').trim();

  if (!sdkKey || !sdkSecret) {
    console.error('[Zoom) CRITICAL: Missing SDK Key or Secret for signature generation');
    return '';
  }

  // BUG FIX 1: Keep meetingNumber as a STRING — do not parseInt().
  // The JWT payload mn must match the type passed to client.join().
  // Zoom Embedded SDK 3.5.0 expects meetingNumber as a string in join().
  const mn = String(meetingNumber).replace(/\D/g, '');

  // Role must be integer: 0 = attendee, 1 = host
  const roleValue = parseInt(role, 10);

  // BUG FIX 2: Use 30s back-drift (not 60s). Zoom rejects tokens with iat too far in past.
  const iat = Math.floor(Date.now() / 1000) - 30;
  const exp = iat + 7200; // 2 hour expiration

  const payload = {
    sdkKey: sdkKey,
    mn: mn,
    role: roleValue,
    iat: iat,
    exp: exp,
    appKey: sdkKey,
    tokenExp: exp
  };



  try {
    // BUG FIX 3: When passing a custom header object, you MUST include alg explicitly.
    // Without alg in the header object, jsonwebtoken drops it even if algorithm is set
    // in options — Zoom then sees a token with no alg and rejects it with error 3712.
    return jwt.sign(payload, sdkSecret, {
      algorithm: 'HS256',
      header: { alg: 'HS256', typ: 'JWT' }
    });
  } catch (error) {
    console.error('[Zoom) Signature generation failed:', error.message);
    return '';
  }
}

/**
 * Get an OAuth access token using Server-to-Server OAuth credentials.
 */
function getOAuthToken() {
  return new Promise((resolve, reject) => {
    const accountId = process.env.ZOOM_ACCOUNT_ID;
    const clientId = process.env.ZOOM_S2S_CLIENT_ID;
    const clientSecret = process.env.ZOOM_S2S_CLIENT_SECRET;

    if (!accountId || !clientId || !clientSecret) {
      return reject(new Error('Missing Server-to-Server OAuth credentials in .env'));
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const options = {
      hostname: 'zoom.us',
      path: `/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) {
            resolve(parsed.access_token);
          } else {
            reject(new Error(`OAuth S2S token error: ${JSON.stringify(parsed)}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

/**
 * Get a ZAK (Zoom Access Key) token for the meeting host.
 * Required since March 2026 for hosts using the Meeting SDK.
 */
async function getZAKToken(hostEmail) {
  try {
    const accessToken = await getOAuthToken();

    const userId = encodeURIComponent(hostEmail || process.env.ZOOM_HOST_EMAIL || 'me');
    const path = `/v2/users/${userId}/token?type=zak`;

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.zoom.us',
        path: path,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.token) {
              resolve(parsed.token);
            } else {
              const errMsg = parsed.message || JSON.stringify(parsed);
              resolve(`ERROR_${errMsg}`);
            }
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  } catch (err) {
    console.error('[Zoom] ZAK token fatal error:', err.message);
    return `FATAL_${err.message}`;
  }
}

module.exports = { generateSignature, getZAKToken };
