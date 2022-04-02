const { readFileSync } = require("fs");
const { createServer } = require("https");
const { Server } = require('socket.io');

const httpServer = createServer({
  key: readFileSync("/home/certs/privkey.pem"),
  cert: readFileSync("/home/certs/fullchain.pem")
});


const io = new Server(httpServer, { /* options */ });

const users = {}

io.on('connection', socket => {
  socket.on('new-user', name => {
    users[socket.id] = name
    socket.broadcast.emit('user-connected', name)
  })
  socket.on('send-chat-message', message => {
    socket.broadcast.emit('chat-message', { message: message, name: users[socket.id] })
  })
  socket.on('disconnect', () => {
    socket.broadcast.emit('user-disconnected', users[socket.id])
    delete users[socket.id]
  })
});

httpServer.listen(3000);