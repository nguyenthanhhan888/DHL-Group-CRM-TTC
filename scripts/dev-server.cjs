const fs = require('fs');
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 8010);
const apiRoutes = new Map([
  ['/api/auth-account', 'api/auth-account.js'],
  ['/api/facebook-id', 'api/facebook-id.js'],
  ['/api/staff', 'api/staff.js'],
  ['/api/payos/create-payment', 'api/payos/create-payment.js'],
  ['/api/payos/create-registration-payment', 'api/payos/create-registration-payment.js'],
  ['/api/payos/status', 'api/payos/status.js'],
  ['/api/payos/webhook', 'api/payos/webhook.js'],
  ['/api/ttc/verify-facebook-task', 'api/ttc/verify-facebook-task.js'],
]);

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    await handleStatic(res, url.pathname);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: false,
      code: 'LOCAL_SERVER_ERROR',
      message: error?.message || 'Local server error.',
    }));
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`DHL local server listening on http://127.0.0.1:${port}`);
});

async function handleApi(req, res, url) {
  const routeFile = apiRoutes.get(url.pathname);
  if (!routeFile) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }
  const apiFile = path.join(root, routeFile);
  if (!apiFile.startsWith(path.join(root, 'api') + path.sep) || !fs.existsSync(apiFile)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }

  const bodyText = await readBody(req);
  req.query = Object.fromEntries(url.searchParams.entries());
  if (bodyText) {
    try {
      req.body = JSON.parse(bodyText);
    } catch {
      req.body = bodyText;
    }
  }

  decorateResponse(res);
  delete require.cache[require.resolve(apiFile)];
  const handler = require(apiFile);
  await handler(req, res);
  if (!res.writableEnded) res.end();
}

async function handleStatic(res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const filePath = path.join(root, safePath.replace(/^\/+/, ''));
  if (!filePath.startsWith(root + path.sep) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(path.join(root, 'index.html')).pipe(res);
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

function decorateResponse(res) {
  res.status = (statusCode) => {
    res.statusCode = statusCode;
    return res;
  };
  res.json = (payload) => {
    if (!res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(JSON.stringify(payload));
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large.'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
