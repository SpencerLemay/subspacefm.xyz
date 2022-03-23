import IcecastMetadataPlayer from "icecast-metadata-player";
window.jQuery = require('jquery');
window.$ = global.jQuery;

var player = window.player || {};

player = new IcecastMetadataPlayer(
  "https://subspacefm.xyz/stream",
  { onMetadata: (metadata) => {console.log(metadata)} }
);
window.player = player;

$(function(){
$("play").click(function(){
  player.play();
}); 

$("stop").click(function(){
  player.stop();
}); 
});
