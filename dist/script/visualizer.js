window.AudioContext=window.AudioContext||window.webkitAudioContext||window.mozAudioContext;var visualizerStart=function(){if(1==player.started){player.started=1;var e=new AudioContext,t=e.createAnalyser();e.createMediaElementSource(player.audioElement).connect(t),t.connect(e.destination);var a,r,n,o;new Uint8Array(t.frequencyBinCount);switch(localStorage.getItem("theme")){case"theme-dark":n=[1,"#717e80"],r=[.5,"#3d4445"],a=[0,"#131b1c"],o="#131b1c";break;default:case"theme-light":n=[1,"#000"],r=[.5,"#777"],a=[0,"#bbb"],o="#000";break;case"theme-pink":n=[1,"#af9bbb"],r=[.5,"#c5bdc9"],a=[0,"#fff"],o="#fff";break;case"theme-green":n=[1,"#bfcabc"],r=[.5,"#96b68d"],a=[0,"#fff"],o="#538740";break;case"theme-yellow":n=[1,"#723b04"],r=[.5,"#c89c4d"],a=[0,"#c89c4d"],o="#723b04"}var i,c=document.getElementById("canvas"),l=c.width,d=c.height-2,f=o,u=800/12,b=[];e=c.getContext("2d"),(i=e.createLinearGradient(0,0,0,300)).addColorStop(n[0],n[1]),i.addColorStop(r[0],r[1]),i.addColorStop(a[0],a[1]),function a(){var r=new Uint8Array(t.frequencyBinCount);t.getByteFrequencyData(r);var n=Math.round(r.length/u);e.clearRect(0,0,l,d);for(var o=0;o<u;o++){var c=r[o*n];b.length<Math.round(u)&&b.push(c),e.fillStyle=f,c<b[o]?e.fillRect(12*o,d- --b[o],10,2):(e.fillRect(12*o,d-c,10,2),b[o]=c),e.fillStyle=i,e.fillRect(12*o,d-c+2,10,d)}if(2==player.started)return e.clearRect(0,0,l,d),player.started=1,void theme;requestAnimationFrame(a)}()}};$((function(){$("#play").click((function(){visualizerStart()}))}));