import { IcecastMetadataReader } from  "icecast-metadata-js";

const headers = myHTTPResponse.headers;

const icecastReader = new IcecastMetadataReader({
  onStream,
  onMetadata,
  onError,
  enableLogging: true,
  metadataTypes: ["icy"]
  icyMetaInt: parseInt(headers.get("Icy-MetaInt")),
});


const responseData = response.body;

for (const i of icecastReader.iterator(responseData)) {
  if (i.stream) {
    // do something with stream data
  }
  if (i.metadata) {
    console.log(i.metadata);
  }
}