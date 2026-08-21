'use strict';

/**
 * Wraps an async handler so a rejected promise reaches Express's error
 * middleware instead of becoming an unhandled rejection.
 *
 * Express 4 does not await handlers, so without this a thrown error inside an
 * async route silently hangs the request until API Gateway times out at 29s --
 * the Lambda equivalent of the blank 500 page PHP would have produced.
 */
module.exports = function asyncRoute(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
};
