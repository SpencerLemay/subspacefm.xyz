window.AudioContext=window.AudioContext||window.webkitAudioContext||window.mozAudioContext;var visualizerStart=function(){if("undefined"==player.started){player.started=1;var e=new AudioContext,t=e.createAnalyser();e.createMediaElementSource(player.audioElement).connect(t),t.connect(e.destination);var a,n,r,o;new Uint8Array(t.frequencyBinCount);switch(localStorage.getItem("theme")){case"theme-dark":r=[1,"#717e80"],n=[.5,"#3d4445"],a=[0,"#131b1c"],o="#131b1c";break;default:case"theme-light":r=[1,"#000"],n=[.5,"#777"],a=[0,"#bbb"],o="#000";break;case"theme-pink":r=[1,"#af9bbb"],n=[.5,"#c5bdc9"],a=[0,"#fff"],o="#fff";break;case"theme-green":r=[1,"#bfcabc"],n=[.5,"#96b68d"],a=[0,"#fff"],o="#538740";break;case"theme-yellow":r=[1,"#723b04"],n=[.5,"#c89c4d"],a=[0,"#c89c4d"],o="#723b04"}var i,c=document.getElementById("canvas"),l=c.width,d=c.height-2,f=o,u=800/12,s=[];e=c.getContext("2d"),(i=e.createLinearGradient(0,0,0,300)).addColorStop(r[0],r[1]),i.addColorStop(n[0],n[1]),i.addColorStop(a[0],a[1]),function a(){var n=new Uint8Array(t.frequencyBinCount);t.getByteFrequencyData(n);var r=Math.round(n.length/u);e.clearRect(0,0,l,d);for(var o=0;o<u&&("stopping"!==player.state&&"stopped"!==player.state);o++){var c=n[o*r];s.length<Math.round(u)&&s.push(c),e.fillStyle=f,c<s[o]?e.fillRect(12*o,d- --s[o],10,2):(e.fillRect(12*o,d-c,10,2),s[o]=c),e.fillStyle=i,e.fillRect(12*o,d-c+2,10,d)}requestAnimationFrame(a)}()}};$((function(){$("#play").click((function(){visualizerStart()})),$("#stop").click((function(){}))}));