window.AudioContext=window.AudioContext||window.webkitAudioContext||window.mozAudioContext;var visualizerStart=function(){if(null==player.started){player.started=1;var t=new AudioContext,e=t.createAnalyser();t.createMediaElementSource(player.audioElement).connect(e),e.connect(t.destination);new Uint8Array(e.frequencyBinCount);var n,o=document.getElementById("canvas"),a=o.width,i=o.height-2,r=800/12,l=[];t=o.getContext("2d"),(n=t.createLinearGradient(0,0,0,300)).addColorStop(1,"#000"),n.addColorStop(.5,"#777"),n.addColorStop(0,"#bbb"),function o(){var d=new Uint8Array(e.frequencyBinCount);e.getByteFrequencyData(d);var c=Math.round(d.length/r);t.clearRect(0,0,a,i);for(var u=0;u<r;u++){var y=d[u*c];l.length<Math.round(r)&&l.push(y),t.fillStyle="#000",y<l[u]?t.fillRect(12*u,i- --l[u],10,2):(t.fillRect(12*u,i-y,10,2),l[u]=y),t.fillStyle=n,t.fillRect(12*u,i-y+2,10,i)}requestAnimationFrame(o)}()}};$((function(){$("#play").click((function(){visualizerStart()}))}));