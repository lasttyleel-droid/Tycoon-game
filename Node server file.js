const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Simple in-memory data for demo
let players = {}; // { socketId: { balance, portfolio } }
const stockPrice = 100; // fixed price for example

io.on('connection', (socket) => {
  console.log('a user connected:', socket.id);

  // Initialize player data
  players[socket.id] = {
    balance: 1000,
    portfolio: {} // { stockSymbol: shares }
  };

  // Send initial data to client
  socket.emit('init', {
    balance: players[socket.id].balance,
    portfolio: players[socket.id].portfolio,
    stockPrice,
  });

  // Listen for buy stock requests
  socket.on('buyStock', ({ symbol, shares }) => {
    const cost = shares * stockPrice;
    let player = players[socket.id];

    if (player.balance >= cost) {
      player.balance -= cost;
      player.portfolio[symbol] = (player.portfolio[symbol] || 0) + shares;
      socket.emit('tradeResult', { success: true, balance: player.balance, portfolio: player.portfolio });
      io.emit('updatePlayers', players);
    } else {
      socket.emit('tradeResult', { success: false, message: 'Insufficient funds' });
    }
  });

  // Listen for sell stock requests
  socket.on('sellStock', ({ symbol, shares }) => {
    let player = players[socket.id];
    let ownedShares = player.portfolio[symbol] || 0;

    if (ownedShares >= shares) {
      player.portfolio[symbol] -= shares;
      player.balance += shares * stockPrice;
      if (player.portfolio[symbol] === 0) delete player.portfolio[symbol];
      socket.emit('tradeResult', { success: true, balance: player.balance, portfolio: player.portfolio });
      io.emit('updatePlayers', players);
    } else {
      socket.emit('tradeResult', { success: false, message: 'Not enough shares to sell' });
    }
  });

  socket.on('disconnect', () => {
    console.log('user disconnected:', socket.id);
    delete players[socket.id];
    io.emit('updatePlayers', players);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
