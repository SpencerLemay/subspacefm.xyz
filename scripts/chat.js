var cors = require('cors');
const socket = io.connect('https://subspacefm.xyz', {resource: '/chat'});


const messageContainer = document.getElementById('message-container')
const messageForm = document.getElementById('send-container')
const messageInput = document.getElementById('message-input')

//const name = prompt('What is your name?')
socket.emit('newUser'); 

var sessionid;

socket.on('getSession', data => {
  sessionid = data.sessionid;
  name = data.name;
})

socket.on('user-connected',data =>{
  appendMessage(`Welcome ${data.name}`)
})

socket.on('chat-message', data => {
  appendMessage(`${data.name}: ${data.message}`)
})

socket.on('user-connected', data => {
  appendMessage(`${data.name} connected`)
})

socket.on('error-message', data => {
  appendMessage(`${data.message}`)
})

socket.on('user-name-change', data => {
  appendMessage(`${data.oldname} changed name to ${data.name}.`)
})

socket.on('user-disconnected', name => {
  appendMessage(`${name} disconnected`)
})

messageForm.addEventListener('submit', e => {
  e.preventDefault()

   //Commands
   if   (messageInput.value[0] == '!')
         {
         var str = messageInput.value;
         var i = str.search(' ')
         var cmd = str.substring(1, i)
         var argument = str.substring(i + 1,str.length);
         outgoing = {
            sessionid:sessionid,
            cmd: cmd,
            args: argument
            }

       socket.emit('command', outgoing);
       messageInput.value = ''

      return;
       }

  var outgoing = {
      sessionid: sessionid,
      message: messageInput.value
  }

  appendMessage(`You: ${outgoing.message}`)
  socket.emit('send-chat-message', outgoing)
  messageInput.value = ''
})

function appendMessage(message) {
  const messageElement = document.createElement('div')
  messageElement.innerText = message
  messageContainer.append(messageElement)
}