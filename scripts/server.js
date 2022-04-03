const io = require("socket.io")(httpServer, {
  cors: {
    origin: "http://localhost:8080",
    methods: ["GET", "POST"]
  }
});

httpServer.listen(3000);

const users = {}

io.on('connection', socket => {
  socket.on('new-user', name => {
    users[socket.id] = name
    socket.broadcast.emit('user-connected', name)
    console.log("USER CONNECTED: " + name)
  })
  socket.on('send-chat-message', message => {
    socket.broadcast.emit('chat-message', { message: message, name: users[socket.id] })
    console.log("USER SAID: " + message)

  })
  socket.on('disconnect', () => {
  	console.log("DISCONNECTED "+ users[socket.id])
    socket.broadcast.emit('user-disconnected', users[socket.id])
    delete users[socket.id]
  })
})