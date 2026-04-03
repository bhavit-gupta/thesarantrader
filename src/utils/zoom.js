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
  const iat = Math.round(new Date().getTime() / 1000) - 30;
  const exp = iat + 60 * 60 * 2;

  const payload = {
    sdkKey: process.env.ZOOM_SDK_KEY,
    mn: meetingNumber,
    role: role,
    iat: iat,
    exp: exp,
    appKey: process.env.ZOOM_SDK_KEY,
    tokenExp: iat + 60 * 60 * 2,
  };

  return jwt.sign(payload, process.env.ZOOM_SDK_SECRET, { algorithm: 'HS256' });
}

/**
 * Get an OAuth access token using Server-to-Server OAuth credentials.
 * Used to call Zoom APIs on behalf of the account (like fetching ZAK).
 * @returns {Promise<string>} Access token
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
 * @param {string} hostEmail - The Zoom account email of the host. Falls back to ZOOM_HOST_EMAIL env var.
 * @returns {Promise<string>} ZAK token
 */
async function getZAKToken(hostEmail) {
  try {
    const accessToken = await getOAuthToken();

    // Use the specific host's email/userId so the ZAK token belongs to the correct user.
    // This is critical — using /users/me returns the S2S service account token which doesn't
    // match the meeting host, causing errorCode 200 "Not support start meeting via tokens".
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
              console.warn(`[Zoom] ZAK token missing for ${userId}:`, errMsg);
              resolve(`ERROR_${errMsg}`); // Pass the error back so we can see it in the UI log
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
