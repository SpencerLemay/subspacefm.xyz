var cors = require('cors');
const socket = io.connect('https://subspacefm.xyz', {resource: '/chat'});


const messageContainer = document.getElementById('message-container')
const messageForm = document.getElementById('send-container')
const messageInput = document.getElementById('message-input')

//const name = prompt('What is your name?')
socket.emit('newUser'); 

var sessionid;
var name = 'default';
appendMessage('Enter Name')

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

socket.on('user-connected', name => {
  appendMessage(`${name} connected`)
})

socket.on('user-disconnected', name => {
  appendMessage(`${name} disconnected`)
})

messageForm.addEventListener('submit', e => {
  e.preventDefault()
  
  if  (name === 'default'){
        name = messageInput.value 
        socket.emit('new-user', name) 
        appendMessage('Welcome  ' +  name);
        messageInput.value = '' 
        return;
       }
  const message = messageInput.value
  appendMessage(`You: ${message}`)
  socket.emit('send-chat-message', message)
  messageInput.value = ''
})

function appendMessage(message) {
  const messageElement = document.createElement('div')
  messageElement.innerText = message
  messageContainer.append(messageElement)
}