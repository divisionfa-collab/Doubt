// ============================================
// Doubt Game - Production Server
// Next.js + Socket.IO on single port
// ============================================

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');

const dev = false;
const port = parseInt(process.env.PORT || '3000', 10);
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);

    if (parsedUrl.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
      return;
    }

    handle(req, res, parsedUrl);
  });

  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  // Import and setup socket handlers
  const { setupSocketServer } = require('./dist/server/socket');
  const { startGraceCleanupLoop } = require('./dist/server/gameEngine');
  setupSocketServer(io);
  startGraceCleanupLoop();

  httpServer.listen(port, '0.0.0.0', () => {
    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║     🎮 Doubt Game - Production       ║');
    console.log(`║     Port: ${port}                         ║`);
    console.log('╚══════════════════════════════════════╝');
    console.log('');
  });
});
