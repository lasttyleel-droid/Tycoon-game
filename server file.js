const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

// Import game logic
require("./Tycoon-stock-game");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

// Serve static files (frontend)
app.use(express.static(__dirname));

// Serve your HTML
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "Public.html"));
});

// Start server
server.listen(3000, () => {
  console.log("Tycoon game running at http://localhost:3000");
});

