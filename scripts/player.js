debugger;
import { IcecastMetadataReader } from "icecast-metadata-js";

const icecastReader = new IcecastMetadataReader({
  onStream: (value) => {
    // do something with the data in value.stream
  },
  onMetadata: (value) => {
    // do something with the data in value.metadata
  },
});
