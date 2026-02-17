// server.js
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

let rooms = {}; 

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('CREATE_ROOM', () => {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    rooms[roomCode] = { players: [socket.id], readyStatus: {} };
    socket.join(roomCode);
    socket.emit('ROOM_CREATED', { roomCode, playerNumber: 0 });
    // 인원 상태 업데이트
    io.to(roomCode).emit('PLAYER_UPDATE', { count: 1 });
  });

  socket.on('JOIN_ROOM', (roomCode) => {
    const room = rooms[roomCode];
    if (room && room.players.length < 2) {
      room.players.push(socket.id);
      socket.join(roomCode);
      socket.emit('ROOM_JOINED', { roomCode, playerNumber: 1 });
      
      // 방 전체에 인원 업데이트 및 알림
      io.to(roomCode).emit('PLAYER_UPDATE', { count: room.players.length });
      socket.to(roomCode).emit('SYSTEM_MESSAGE', '상대방이 입장했습니다!');
    } else {
      socket.emit('ERROR', '방이 가득 찼거나 존재하지 않습니다.');
    }
  });

  socket.on('LEAVE_ROOM_REQUEST', (roomCode) => {
    handleLeave(socket, roomCode);
  });

  socket.on('disconnect', () => {
    for (const roomCode in rooms) {
      if (rooms[roomCode].players.includes(socket.id)) {
        handleLeave(socket, roomCode);
      }
    }
  });

  function handleLeave(socket, roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    room.players = room.players.filter(id => id !== socket.id);
    delete room.readyStatus[socket.id];
    socket.leave(roomCode);

    if (room.players.length === 0) {
      delete rooms[roomCode];
    } else {
      // 남은 사람에게 알림 (방은 유지)
      io.to(roomCode).emit('PLAYER_UPDATE', { count: room.players.length });
      io.to(roomCode).emit('SYSTEM_MESSAGE', '상대방이 나갔습니다.');
      io.to(roomCode).emit('OPPONENT_LEFT_EVENT'); // 게임 중단 신호
    }
  }

  // 기존 덱 준비 및 액션 중계 로직은 동일
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
});

server.listen(3001, () => console.log('Nabla Server v5.9 running on 3001'));