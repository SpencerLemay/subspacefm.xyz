const io=require("socket.io")(3e3),users={};io.on("connection",(e=>{e.on("new-user",(s=>{users[e.id]=s,e.broadcast.emit("user-connected",s)})),e.on("send-chat-message",(s=>{e.broadcast.emit("chat-message",{message:s,name:users[e.id]})})),e.on("disconnect",(()=>{e.broadcast.emit("user-disconnected",users[e.id]),delete users[e.id]}))}));