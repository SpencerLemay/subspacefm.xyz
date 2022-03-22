import { IcecastMetadataReader } from  "icecast-metadatdfgfa-js";

const icecastReader = new IcecastMetadataReader({
  onStream: (value) => {
    // do something with the data in value.stream
            console.log(value);

  },
  onMetadata: (value) => {
    // do something with the data in value.metadata
        console.log(value);

  };
});

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