'use strict';

const express = require('express');
const config = require('./config/env');
const cors = require('./middleware/cors');
const errorHandler = require('./middleware/errorHandler');

const loginRoutes = require('./routes/login');
const sevakRoutes = require('./routes/sevak');
const sevaRoutes = require('./routes/seva');
const receiptBookRoutes = require('./routes/receiptBooks');
const importKaryakarRoutes = require('./routes/importKaryakar');

/**
 * Express app shared by the Lambda handler and the local dev server.
 *
 * URL layout matches CodeIgniter's default routing -- /<controller>/<method> --
 * so the deployed frontend needs no path changes, only a new base URL.
 */
function createApp() {
  const app = express();

  // CI matched controllers case-insensitively on the old host, and the
  // frontend calls a mix of /Login/login and /ReceiptBooks/list. Express
  // defaults to case-insensitive routing; making it explicit so a future
  // config change cannot silently 404 half the app.
  app.set('case sensitive routing', false);
  app.set('strict routing', false);
  app.disable('x-powered-by');
  // API Gateway terminates TLS and forwards the client IP in X-Forwarded-For.
  app.set('trust proxy', true);

  app.use(cors);

  /**
   * The old host served the app through index.php, so some clients may still
   * send /index.php/login/login. Strip the prefix rather than 404.
   */
  app.use((req, res, next) => {
    if (req.url.toLowerCase().startsWith('/index.php')) {
      req.url = req.url.slice('/index.php'.length) || '/';
    }
    next();
  });

  /**
   * Body parsing, deliberately lenient.
   *
   * The PHP never looked at Content-Type: every controller did
   * json_decode(file_get_contents("php://input"), true) ?: []. So any body is
   * parsed as JSON here, and malformed JSON degrades to {} instead of raising
   * a 400 -- which is what `?: []` did.
   */
  app.use(express.json({ type: () => true, limit: '5mb' }));
  app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && 'body' in err) {
      req.body = {};
      return next();
    }
    return next(err);
  });
  app.use((req, res, next) => {
    if (req.body === undefined || req.body === null) req.body = {};
    next();
  });

  // Health check: used by the smoke test and any uptime monitor. Does not
  // touch the database, so it stays green during an RDS failover.
  app.get('/health', (req, res) => {
    res.json({ status: true, service: 'annkut-backend-node', env: config.env });
  });

  // CI's default_controller was 'welcome', which rendered an HTML splash page.
  // An API root is more useful and avoids shipping a view layer.
  app.get('/', (req, res) => {
    res.json({ status: true, message: 'Annkut API' });
  });
  app.get('/welcome', (req, res) => {
    res.json({ status: true, message: 'Annkut API' });
  });

  app.use('/login', loginRoutes);
  app.use('/sevak', sevakRoutes);
  app.use('/seva', sevaRoutes);
  app.use('/receiptbooks', receiptBookRoutes);
  app.use('/import_karyakar', importKaryakarRoutes);

  app.use(errorHandler.notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
