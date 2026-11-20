import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server, matchMaker } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { SonKisiRoom } from './rooms/SonKisiRoom';

const PORT = parseInt(process.env.PORT || '2567', 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const app = express();
app.use(
  cors({
    origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(','),
    credentials: true,
  })
);
app.use(express.json());

// Health & live stats endpoint
app.get('/health', async (_req, res) => {
  try {
    const publicRooms = await matchMaker.query({ name: 'sonkisi_public' });
    const privateRooms = await matchMaker.query({ name: 'sonkisi_private' });
    const onlinePlayers = [...publicRooms, ...privateRooms].reduce(
      (sum, r) => sum + (r.clients ?? 0),
      0
    );
    res.json({
      status: 'ok',
      game: 'SON KİŞİ',
      onlinePlayers,
      publicRooms: publicRooms.length,
      privateRooms: privateRooms.length,
      maxPlayersPerRoom: 50,
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: String(err) });
  }
});

const httpServer = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
  }),
});

// Public matchmaking rooms (max 50 players, auto-packs into open rooms)
gameServer.define('sonkisi_public', SonKisiRoom);

// Private rooms filtered by 6-char roomCode
gameServer.define('sonkisi_private', SonKisiRoom).filterBy(['roomCode']);

gameServer.listen(PORT).then(() => {
  console.log(`🚀 SON KİŞİ Multiplayer Server running on ws://localhost:${PORT}`);
  console.log(`📊 Health endpoint: http://localhost:${PORT}/health`);
});
