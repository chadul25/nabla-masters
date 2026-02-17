import express from 'express';
import http from 'http';
import { Server } from 'socket.io';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

let rooms = {}; 

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('CREATE_ROOM', () => {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    rooms[roomCode] = { players: [socket.id], readyStatus: {} };
    socket.join(roomCode);
    socket.emit('ROOM_CREATED', { roomCode, playerNumber: 0 });
  });

  socket.on('JOIN_ROOM', (roomCode) => {
    const room = rooms[roomCode];
    if (room && room.players.length === 1) {
      room.players.push(socket.id);
      socket.join(roomCode);
      socket.emit('ROOM_JOINED', { roomCode, playerNumber: 1 });
      io.to(roomCode).emit('MATCH_FOUND');
    } else {
      socket.emit('ERROR', '방이 존재하지 않거나 가득 찼습니다.');
    }
  });

  socket.on('READY_TO_START', ({ roomCode, deck }) => {
    const room = rooms[roomCode];
    if (room) {
      room.readyStatus[socket.id] = deck;
      if (Object.keys(room.readyStatus).length === 2) {
        const firstTurn = Math.floor(Math.random() * 2);
        io.to(roomCode).emit('GAME_START_SIGNAL', {
          decks: room.readyStatus,
          firstTurn,
          playerIds: room.players
        });
      } else {
        socket.to(roomCode).emit('OPPONENT_READY');
      }
    }
  });

  socket.on('GAME_ACTION', ({ roomCode, actionType, data }) => {
    socket.to(roomCode).emit('OPPONENT_ACTION', { actionType, data });
  });

  socket.on('disconnect', () => {
    for (const code in rooms) {
      if (rooms[code].players.includes(socket.id)) {
        io.to(code).emit('ERROR', '상대방의 연결이 끊겼습니다.');
        delete rooms[code];
      }
    }
  });
});

server.listen(3001, () => console.log('Nabla Server running on 3001'));