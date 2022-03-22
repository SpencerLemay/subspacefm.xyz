debugger;
import IcecastMetadataPlayer from "icecast-metadata-player";
var jsdom = require("jsdom").jsdom;
global.$ = require('jquery/dist/jquery')(jsdom().createWindow());

const player = new IcecastMetadataPlayer(
  "https://subspacefm.xyz/stream",
  { onMetadata: (metadata) => {console.log(metadata)} }
);


$("play").click(function(){
  player.play();
}); 

$("stop").click(function(){
  player.stop();
}); 