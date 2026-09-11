import { io } from 'socket.io-client';

// In produzione sul Raspberry, il frontend e il backend girano sullo stesso IP (localhost)
const URL = 'http://localhost:3001';

export const socket = io(URL);
