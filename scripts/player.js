import IcecastMetadataPlayer from "icecast-metadata-player";

var player = window.player || {};

player = new IcecastMetadataPlayer(
  "https://subspacefm.xyz/stream",
  { onMetadata: (metadata) => {console.log(metadata)} }
);


$("play").click(function(){
  player.play();
}); 

$("stop").click(function(){
  player.stop();
}); 