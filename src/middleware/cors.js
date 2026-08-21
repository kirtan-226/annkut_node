'use strict';

const config = require('../config/env');

/**
 * CORS, unified across all controllers.
 *
 * The PHP set these headers at file scope in each controller, and did it
 * differently in each: Login.php checked the Origin against a two-entry
 * allowlist, while Seva.php, Sevak.php and ReceiptBooks.php reflected ANY
 * Origin back together with Allow-Credentials: true -- which lets any website
 * a logged-in user visits call the API with their cookies.
 *
 * Login.php's allowlist is applied everywhere here. The live frontend origins
 * are the defaults, so nothing legitimate changes; add more via
 * CORS_ALLOWED_ORIGINS.
 */
module.exports = function cors(req, res, next) {
  const origin = req.headers.origin;

  if (origin && config.corsAllowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    // Responses differ by Origin, so caches must key on it.
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, PATCH, DELETE, OPTIONS'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Requested-With'
    );
    return res.status(204).end();
  }

  return next();
};
