var cors=require("cors");const socket=io("https://subspacefm.xyz/chat",{withCredentials:!0,extraHeaders:{"my-custom-header":"abcd"}}),messageContainer=document.getElementById("message-container"),messageForm=document.getElementById("send-container"),messageInput=document.getElementById("message-input"),name=prompt("What is your name?");function appendMessage(e){const s=document.createElement("div");s.innerText=e,messageContainer.append(s)}appendMessage("You joined"),socket.emit("new-user","chad"),socket.on("chat-message",(e=>{appendMessage(`${e.name}: ${e.message}`)})),socket.on("user-connected",(e=>{appendMessage(`${e} connected`)})),socket.on("user-disconnected",(e=>{appendMessage(`${e} disconnected`)})),messageForm.addEventListener("submit",(e=>{e.preventDefault();const s=messageInput.value;appendMessage(`You: ${s}`),socket.emit("send-chat-message",s),messageInput.value=""}));