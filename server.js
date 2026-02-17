// server.js
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" } // 모든 도메인 허용
});

let rooms = {}; 

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('CREATE_ROOM', () => {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    rooms[roomCode] = [socket.id];
    socket.join(roomCode);
    socket.emit('ROOM_CREATED', { roomCode, playerNumber: 0 });
    console.log(`Room Created: ${roomCode}`);
  });

  socket.on('JOIN_ROOM', (roomCode) => {
    if (rooms[roomCode] && rooms[roomCode].length === 1) {
      rooms[roomCode].push(socket.id);
      socket.join(roomCode);
      socket.emit('ROOM_JOINED', { roomCode, playerNumber: 1 });
      io.to(roomCode).emit('MATCH_FOUND');
      console.log(`User joined room: ${roomCode}`);
    } else {
      socket.emit('ERROR', '방이 존재하지 않거나 가득 찼습니다.');
    }
  });

  socket.on('GAME_ACTION', ({ roomCode, actionType, data }) => {
    socket.to(roomCode).emit('OPPONENT_ACTION', { actionType, data });
  });

  socket.on('disconnect', () => {
    for (const code in rooms) {
      rooms[code] = rooms[code].filter(id => id !== socket.id);
      if (rooms[code].length === 0) delete rooms[code];
    }
    console.log('User disconnected');
  });

  // 플레이어가 덱을 선택하고 READY를 눌렀을 때
  socket.on('READY_TO_DUEL', ({ roomCode, deck }) => {
    const room = rooms[roomCode];
    if (room) {
      if (!room.readyDecks) room.readyDecks = {};
      room.readyDecks[socket.id] = deck;

      // 두 명 모두 준비 완료되었는지 확인
      const playerIds = Object.keys(room.readyDecks);
      if (playerIds.length === 2) {
        const firstTurn = Math.floor(Math.random() * 2);
        // 양측에 각자의 덱 데이터와 선공 정보를 전송
        io.to(roomCode).emit('GAME_START_SIGNAL', {
          decks: room.readyDecks,
          firstTurn,
          playerIds: room.playerIds // rooms[roomCode] 구조에 맞게 관리 필요
        });
      } else {
        // 한 명만 준비되었을 때 상대에게 알림
        socket.to(roomCode).emit('OPPONENT_READY');
      }
    }
  });
});

const PORT = 3001;
server.listen(PORT, () => console.log(`Nabla Server running on port ${PORT}`));