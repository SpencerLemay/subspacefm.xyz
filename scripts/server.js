const io = require("socket.io")(3000);
const crypto = require('crypto');
const users = {}

/*function timeout(){

}*/

var getSessionid = function() {
    // 16 bytes is likely to be more than enough,
    // but you may tweak it to your needs
    return crypto.randomBytes(16).toString('base64');
};



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

   var sessionid = getSessionid();
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