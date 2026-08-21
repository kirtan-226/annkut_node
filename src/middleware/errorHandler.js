'use strict';

const config = require('../config/env');

/**
 * Terminal error handler.
 *
 * The PHP controllers each caught Throwable and returned a generic message
 * (Sevak::get_sevak was the exception -- it echoed $e->getMessage() straight
 * to the client, leaking SQL and table names). This returns the generic shape
 * by default and only includes details when EXPOSE_ERRORS is on.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
module.exports = function errorHandler(err, req, res, next) {
  // CloudWatch captures this; it is the only place the real cause is recorded.
  console.error('[error]', req.method, req.originalUrl, err);

  if (res.headersSent) return next(err);

  const body = {
    status: false,
    message: 'We hit a system error. Please try again.',
  };

  if (config.exposeErrors) {
    body.error = err.message;
    body.code = err.code;
  }

  return res.status(500).json(body);
};

module.exports.notFound = function notFound(req, res) {
  return res
    .status(404)
    .json({ status: false, message: `Unknown endpoint: ${req.method} ${req.path}` });
};
