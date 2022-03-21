import IcecastMetadataPlayer from "icecast-metadata-player";

const player = new IcecastMetadataPlayer(
  "https://dsmrad.io/stream/isics-all",
  { onMetadata: (metadata) => {console.log(metadata)} }
);