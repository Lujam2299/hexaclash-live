import { createGameServer } from './server.mjs';

const server = createGameServer();
const port = Number(process.env.PORT ?? 8095);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
await server.listen(port);
console.log(`HexaClash local: http://127.0.0.1:${port}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  await server.close(); process.exit(0);
});
