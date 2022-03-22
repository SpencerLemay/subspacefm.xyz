debugger;
import { IcecastMetadataReader } from "icecast-metadata-js";

const icecastReader = new IcecastMetadataReader({
  metadataTypes: ["icy", "ogg"]
});


const responseData = response.body;

for (const i of icecastReader.iterator(responseData)) {
  if (i.stream) {
    // do something with stream data
   console.log(i.stream);
  }
  if (i.metadata) {
    // do something with metadata
    console.log(i.metadata);
  }
}