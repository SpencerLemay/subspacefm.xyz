import IcecastMetadataPlayer from "icecast-metadata-player";
window.jQuery = require('jquery');
window.$ = global.jQuery;

var player = window.player || {};

player = new IcecastMetadataPlayer(
  "https://subspacefm.xyz/stream",
  { onMetadata: (metadata) => {
    var str = htmlentities.decode(metadata.StreamTitle);
    $("#metadata").text(str.substring(0,48)); } }
);
window.player = player;


$(function(){
$("#play").click(function(){
  player.play();
}); 

$("#stop").click(function(){
  player.stop();
}); 
});
