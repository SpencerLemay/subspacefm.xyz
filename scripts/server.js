const io = require("socket.io")(3000);

const users = {}

/*function timeout(){

}*/

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

function getUserName(username) {
  if (username == undefined){
      username = 'Guest' +  Math.random() * 10000;
  }
  users.forEach(element => {
       if (element.name === username) {
           getUserName(username);
       }
  });
  return username;
}

io.on('connection', socket => {
  socket.on('newUser', name => {
   
  //isBanned(socket);

   var sessionid = uuidv4();
   var username = getUserName();
    var user = {
      name: name;
      sessionid: sessionid;
      pwhash: '';
      ttl: 30; //minutes
    }

    users.push(user);
    console.log("NEW USER CONNECTED: " + name);
    socket.emit('getSession',{name:name, sessionid:sessionid});
    socket.broadcast.emit('user-connected',{name:name});
  })

socket.on('claim-user', request => {

})


  socket.on('send-chat-message', message => {
	 console.log(users[socket.id] + " SAID: " + message);
    socket.broadcast.emit('chat-message', { message: message, name: users[socket.id] });

  })
  socket.on('disconnect', () => {
  	console.log("DISCONNECTED "+ users[socket.id]);
    socket.broadcast.emit('user-disconnected', users[socket.id]);
    delete users[socket.id];
  })
})