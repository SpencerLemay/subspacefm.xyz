debugger;
import IcecastMetadataPlayer from "icecast-metadata-player";

const player = new IcecastMetadataPlayer(
  "https://subspacefm.xyz/stream",
  { onMetadata: (metadata) => {console.log(metadata)} }
);
