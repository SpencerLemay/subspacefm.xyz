const io = require("socket.io")(3000);
const crypto = require('crypto');
const users = [];

/*function timeout(){

}*/

var getSessionid = function() {
    // 16 bytes is likely to be more than enough,
    // but you may tweak it to your needs
    return crypto.randomBytes(16).toString('base64');
};



function getUserName(username) {
  if (username == undefined){
      username = 'Guest' +  Math.floor(Math.random() * 10000);
  }
  users.forEach(element => {
       if (element.name === username) {
           username = getUserName(username);
       }
  });
  return username;
}


// New user is for giving session ids to users without passwords.
function newUser(incoming){

   var sessionid = getSessionid();
   var name = getUserName();
    var user = {
      name: name,
      sessionid: sessionid,
      pwhash: '',
      ttl: 30 //minutes
    }
    return user;
}


// New user is for giving session ids to users without passwords.
io.on('connection', socket => {
  socket.on('newUser', incoming => {
   
  //isBanned(socket);
  var user = newUser(incoming);
  if (user == undefined)//ERROR THAT IS UNLIKELY
    return;


    users.push(user);
    console.log("NEW USER CONNECTED: " + name);
    socket.emit('getSession',{name:name, sessionid:sessionid});
    socket.broadcast.emit('user-connected',{name:name});
  })


//when the database is added
/*socket.on('claim-user', request => {

  })*/

socket.on('command', incoming => {
    var user = users.find( ({ sessionid }) => sessionid === incoming.sessionid );
    if (user == undefined){
       socket.emit('error-message', { message: 'ERROR: Invalid or expired sessionid, refresh to chat.'});
    }
   if (incoming.cmd === 'changename'){
       var oldname = user.name;
    
         // see if user is currently logged in
         if  (incoming.args != undefined){
               var user2 = users.find( ({ name }) => name === incoming.args );
    
               //TODO Database lookup for existing user
    
               if (user2 != undefined){//ERROR
                     var address = socket.handshake.address;
                     console.log('New connection from ' + address.address +  ' tried using name ' + incoming.args);
                     socket.emit('error-message', { message: 'ERROR: User name already taken'});
                     return;
                  }
             }
         else{//ERROR
           //console.log('New connection from ' + address.address +  ' tried using name ' + incoming.name);
           socket.emit('error-message', { message: 'ERROR: No name specified'});
          return;
         }
       var i = users.findIndex(user);
        users[i].name = incoming.args;
        console.log('User ' + oldname +  'changed name to ' + incoming.args);
        socket.broadcast.emit('user-name-change',{oldname:oldname, name:incoming.args});
  }
})


  socket.on('send-chat-message', incoming => {
    var user = users.find( ({ sessionid }) => sessionid === incoming.sessionid );
    if (user == undefined){
        console.log("NEW USER CONNECTED: " + name);
        socket.emit('getSession',{name:name, sessionid:sessionid});         
    }

	 console.log(user.name + " SAID: " + incoming.message);
    socket.broadcast.emit('chat-message', { message: incoming.message, name: user.name });

  })
  socket.on('disconnect', incoming => {
    var user = users.find( ({ sessionid }) => sessionid === incoming.sessionid );
    if (user == undefined){
       socket.emit('error-message', { message: 'ERROR: Invalid or expired sessionid, refresh to chat.'});
       return;
    }
  	console.log("DISCONNECTED "+ user.name);
    socket.broadcast.emit('user-disconnected', user.name);
    var i = users.findIndex(user);
    users.splice(i,i);
  })
})