const{readFileSync:readFileSync}=require("fs"),{createServer:createServer}=require("https"),{Server:Server}=require("socket.io"),httpServer=createServer({key:readFileSync("/home/certs/privkey.pem"),cert:readFileSync("/home/certs/fullchain.pem")}),io=new Server(httpServer,{}),users={};io.on("connection",(e=>{e.on("new-user",(r=>{users[e.id]=r,e.broadcast.emit("user-connected",r)})),e.on("send-chat-message",(r=>{e.broadcast.emit("chat-message",{message:r,name:users[e.id]})})),e.on("disconnect",(()=>{e.broadcast.emit("user-disconnected",users[e.id]),delete users[e.id]}))})),httpServer.listen(3e3);