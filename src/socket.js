import { io } from 'socket.io-client';

const isLocal = window.location.hostname === 'localhost';
const SERVER_URL = isLocal 
  ? 'http://localhost:3001' 
  : 'https://renate-nonmultiplicative-edgardo.ngrok-free.dev';

export const socket = io(SERVER_URL, { transports: ['websocket'] });