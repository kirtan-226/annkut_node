'use strict';

const serverlessExpress = require('serverless-http');
const createApp = require('./app');

/**
 * Lambda entry point.
 *
 * The app is built once at module scope so that warm invocations skip both the
 * Express setup and the require graph. Only cold starts pay for it.
 */
const app = createApp();

const handler = serverlessExpress(app, {
  // The two download endpoints return .xls payloads. Without this list API
  // Gateway would hand back UTF-8 text for them and Excel would choke, so they
  // are base64-encoded on the way out.
  binary: [
    'application/vnd.ms-excel',
    'application/octet-stream',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  request(request, event) {
    // Preserve the API Gateway request id so application logs can be
    // correlated with access logs and X-Ray traces.
    request.awsRequestId = event.requestContext?.requestId;
  },
});

module.exports.handler = async (event, context) => {
  // Return as soon as the response is written rather than waiting for the
  // event loop to drain -- the mysql2 pool keeps sockets alive on purpose, and
  // without this every invocation would run until its timeout.
  context.callbackWaitsForEmptyEventLoop = false;
  return handler(event, context);
};
