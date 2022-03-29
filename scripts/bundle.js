(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "WASMAudioDecoderCommon", {
  enumerable: true,
  get: function () {
    return _WASMAudioDecoderCommon.default;
  }
});
Object.defineProperty(exports, "WASMAudioDecoderWorker", {
  enumerable: true,
  get: function () {
    return _WASMAudioDecoderWorker.default;
  }
});

var _WASMAudioDecoderCommon = _interopRequireDefault(require("./src/WASMAudioDecoderCommon.js"));

var _WASMAudioDecoderWorker = _interopRequireDefault(require("./src/WASMAudioDecoderWorker.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

},{"./src/WASMAudioDecoderCommon.js":2,"./src/WASMAudioDecoderWorker.js":3}],2:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

class WASMAudioDecoderCommon {
  // share the same WASM instance per thread
  static instances = new WeakMap();

  constructor(wasm) {
    this._wasm = wasm;
    this._pointers = new Set();
  }

  get wasm() {
    return this._wasm;
  }

  static async initWASMAudioDecoder() {
    // instantiate wasm code as singleton
    if (!this._wasm) {
      // new decoder instance
      if (WASMAudioDecoderCommon.instances.has(this._EmscriptenWASM)) {
        // reuse existing compilation
        this._wasm = WASMAudioDecoderCommon.instances.get(this._EmscriptenWASM);
      } else {
        // first compilation
        this._wasm = new this._EmscriptenWASM(WASMAudioDecoderCommon);
        WASMAudioDecoderCommon.instances.set(this._EmscriptenWASM, this._wasm);
      }
    }

    await this._wasm.ready;
    const common = new WASMAudioDecoderCommon(this._wasm);
    [this._inputPtr, this._input] = common.allocateTypedArray(this._inputPtrSize, Uint8Array); // output buffer

    [this._outputPtr, this._output] = common.allocateTypedArray(this._outputChannels * this._outputPtrSize, Float32Array);
    return common;
  }

  static concatFloat32(buffers, length) {
    const ret = new Float32Array(length);
    let offset = 0;

    for (const buf of buffers) {
      ret.set(buf, offset);
      offset += buf.length;
    }

    return ret;
  }

  static getDecodedAudio(channelData, samplesDecoded, sampleRate) {
    return {
      channelData,
      samplesDecoded,
      sampleRate
    };
  }

  static getDecodedAudioMultiChannel(input, channelsDecoded, samplesDecoded, sampleRate) {
    const channelData = [];

    for (let i = 0; i < channelsDecoded; i++) {
      const channel = [];

      for (let j = 0; j < input.length; j++) {
        channel.push(input[j][i]);
      }

      channelData.push(WASMAudioDecoderCommon.concatFloat32(channel, samplesDecoded));
    }

    return WASMAudioDecoderCommon.getDecodedAudio(channelData, samplesDecoded, sampleRate);
  }

  getOutputChannels(outputData, channelsDecoded, samplesDecoded) {
    const output = [];

    for (let i = 0; i < channelsDecoded; i++) output.push(outputData.slice(i * samplesDecoded, i * samplesDecoded + samplesDecoded));

    return output;
  }

  allocateTypedArray(length, TypedArray) {
    const pointer = this._wasm._malloc(TypedArray.BYTES_PER_ELEMENT * length);

    const array = new TypedArray(this._wasm.HEAP, pointer, length);

    this._pointers.add(pointer);

    return [pointer, array];
  }

  free() {
    for (const pointer of this._pointers) this._wasm._free(pointer);

    this._pointers.clear();
  }
  /*
   ******************
   * Compression Code
   ******************
   */


  static inflateDynEncodeString(source, dest) {
    const output = new Uint8Array(source.length);
    const offset = parseInt(source.substring(11, 13), 16);
    const offsetReverse = 256 - offset;
    let escaped = false,
        byteIndex = 0,
        byte;

    for (let i = 13; i < source.length; i++) {
      byte = source.charCodeAt(i);

      if (byte === 61 && !escaped) {
        escaped = true;
        continue;
      }

      if (escaped) {
        escaped = false;
        byte -= 64;
      }

      output[byteIndex++] = byte < offset && byte > 0 ? byte + offsetReverse : byte - offset;
    }

    return WASMAudioDecoderCommon.inflate(output.subarray(0, byteIndex), dest);
  }

  static inflate(source, dest) {
    const TINF_OK = 0;
    const TINF_DATA_ERROR = -3;
    const uint8Array = Uint8Array;
    const uint16Array = Uint16Array;

    class Tree {
      constructor() {
        this.t = new uint16Array(16);
        /* table of code length counts */

        this.trans = new uint16Array(288);
        /* code -> symbol translation table */
      }

    }

    class Data {
      constructor(source, dest) {
        this.s = source;
        this.i = 0;
        this.t = 0;
        this.bitcount = 0;
        this.dest = dest;
        this.destLen = 0;
        this.ltree = new Tree();
        /* dynamic length/symbol tree */

        this.dtree = new Tree();
        /* dynamic distance tree */
      }

    }
    /* --------------------------------------------------- *
     * -- uninitialized global data (static structures) -- *
     * --------------------------------------------------- */


    const sltree = new Tree();
    const sdtree = new Tree();
    /* extra bits and base tables for length codes */

    const length_bits = new uint8Array(30);
    const length_base = new uint16Array(30);
    /* extra bits and base tables for distance codes */

    const dist_bits = new uint8Array(30);
    const dist_base = new uint16Array(30);
    /* special ordering of code length codes */

    const clcidx = new uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
    /* used by tinf_decode_trees, avoids allocations every call */

    const code_tree = new Tree();
    const lengths = new uint8Array(288 + 32);
    /* ----------------------- *
     * -- utility functions -- *
     * ----------------------- */

    /* build extra bits and base tables */

    const tinf_build_bits_base = (bits, base, delta, first) => {
      let i, sum;
      /* build bits table */

      for (i = 0; i < delta; ++i) bits[i] = 0;

      for (i = 0; i < 30 - delta; ++i) bits[i + delta] = i / delta | 0;
      /* build base table */


      for (sum = first, i = 0; i < 30; ++i) {
        base[i] = sum;
        sum += 1 << bits[i];
      }
    };
    /* build the fixed huffman trees */


    const tinf_build_fixed_trees = (lt, dt) => {
      let i;
      /* build fixed length tree */

      for (i = 0; i < 7; ++i) lt.t[i] = 0;

      lt.t[7] = 24;
      lt.t[8] = 152;
      lt.t[9] = 112;

      for (i = 0; i < 24; ++i) lt.trans[i] = 256 + i;

      for (i = 0; i < 144; ++i) lt.trans[24 + i] = i;

      for (i = 0; i < 8; ++i) lt.trans[24 + 144 + i] = 280 + i;

      for (i = 0; i < 112; ++i) lt.trans[24 + 144 + 8 + i] = 144 + i;
      /* build fixed distance tree */


      for (i = 0; i < 5; ++i) dt.t[i] = 0;

      dt.t[5] = 32;

      for (i = 0; i < 32; ++i) dt.trans[i] = i;
    };
    /* given an array of code lengths, build a tree */


    const offs = new uint16Array(16);

    const tinf_build_tree = (t, lengths, off, num) => {
      let i, sum;
      /* clear code length count table */

      for (i = 0; i < 16; ++i) t.t[i] = 0;
      /* scan symbol lengths, and sum code length counts */


      for (i = 0; i < num; ++i) t.t[lengths[off + i]]++;

      t.t[0] = 0;
      /* compute offset table for distribution sort */

      for (sum = 0, i = 0; i < 16; ++i) {
        offs[i] = sum;
        sum += t.t[i];
      }
      /* create code->symbol translation table (symbols sorted by code) */


      for (i = 0; i < num; ++i) {
        if (lengths[off + i]) t.trans[offs[lengths[off + i]]++] = i;
      }
    };
    /* ---------------------- *
     * -- decode functions -- *
     * ---------------------- */

    /* get one bit from source stream */


    const tinf_getbit = d => {
      /* check if tag is empty */
      if (!d.bitcount--) {
        /* load next tag */
        d.t = d.s[d.i++];
        d.bitcount = 7;
      }
      /* shift bit out of tag */


      const bit = d.t & 1;
      d.t >>>= 1;
      return bit;
    };
    /* read a num bit value from a stream and add base */


    const tinf_read_bits = (d, num, base) => {
      if (!num) return base;

      while (d.bitcount < 24) {
        d.t |= d.s[d.i++] << d.bitcount;
        d.bitcount += 8;
      }

      const val = d.t & 0xffff >>> 16 - num;
      d.t >>>= num;
      d.bitcount -= num;
      return val + base;
    };
    /* given a data stream and a tree, decode a symbol */


    const tinf_decode_symbol = (d, t) => {
      while (d.bitcount < 24) {
        d.t |= d.s[d.i++] << d.bitcount;
        d.bitcount += 8;
      }

      let sum = 0,
          cur = 0,
          len = 0,
          tag = d.t;
      /* get more bits while code value is above sum */

      do {
        cur = 2 * cur + (tag & 1);
        tag >>>= 1;
        ++len;
        sum += t.t[len];
        cur -= t.t[len];
      } while (cur >= 0);

      d.t = tag;
      d.bitcount -= len;
      return t.trans[sum + cur];
    };
    /* given a data stream, decode dynamic trees from it */


    const tinf_decode_trees = (d, lt, dt) => {
      let i, length;
      /* get 5 bits HLIT (257-286) */

      const hlit = tinf_read_bits(d, 5, 257);
      /* get 5 bits HDIST (1-32) */

      const hdist = tinf_read_bits(d, 5, 1);
      /* get 4 bits HCLEN (4-19) */

      const hclen = tinf_read_bits(d, 4, 4);

      for (i = 0; i < 19; ++i) lengths[i] = 0;
      /* read code lengths for code length alphabet */


      for (i = 0; i < hclen; ++i) {
        /* get 3 bits code length (0-7) */
        const clen = tinf_read_bits(d, 3, 0);
        lengths[clcidx[i]] = clen;
      }
      /* build code length tree */


      tinf_build_tree(code_tree, lengths, 0, 19);
      /* decode code lengths for the dynamic trees */

      for (let num = 0; num < hlit + hdist;) {
        const sym = tinf_decode_symbol(d, code_tree);

        switch (sym) {
          case 16:
            /* copy previous code length 3-6 times (read 2 bits) */
            const prev = lengths[num - 1];

            for (length = tinf_read_bits(d, 2, 3); length; --length) {
              lengths[num++] = prev;
            }

            break;

          case 17:
            /* repeat code length 0 for 3-10 times (read 3 bits) */
            for (length = tinf_read_bits(d, 3, 3); length; --length) {
              lengths[num++] = 0;
            }

            break;

          case 18:
            /* repeat code length 0 for 11-138 times (read 7 bits) */
            for (length = tinf_read_bits(d, 7, 11); length; --length) {
              lengths[num++] = 0;
            }

            break;

          default:
            /* values 0-15 represent the actual code lengths */
            lengths[num++] = sym;
            break;
        }
      }
      /* build dynamic trees */


      tinf_build_tree(lt, lengths, 0, hlit);
      tinf_build_tree(dt, lengths, hlit, hdist);
    };
    /* ----------------------------- *
     * -- block inflate functions -- *
     * ----------------------------- */

    /* given a stream and two trees, inflate a block of data */


    const tinf_inflate_block_data = (d, lt, dt) => {
      while (1) {
        let sym = tinf_decode_symbol(d, lt);
        /* check for end of block */

        if (sym === 256) {
          return TINF_OK;
        }

        if (sym < 256) {
          d.dest[d.destLen++] = sym;
        } else {
          let length, dist, offs;
          sym -= 257;
          /* possibly get more bits from length code */

          length = tinf_read_bits(d, length_bits[sym], length_base[sym]);
          dist = tinf_decode_symbol(d, dt);
          /* possibly get more bits from distance code */

          offs = d.destLen - tinf_read_bits(d, dist_bits[dist], dist_base[dist]);
          /* copy match */

          for (let i = offs; i < offs + length; ++i) {
            d.dest[d.destLen++] = d.dest[i];
          }
        }
      }
    };
    /* inflate an uncompressed block of data */


    const tinf_inflate_uncompressed_block = d => {
      let length, invlength;
      /* unread from bitbuffer */

      while (d.bitcount > 8) {
        d.i--;
        d.bitcount -= 8;
      }
      /* get length */


      length = d.s[d.i + 1];
      length = 256 * length + d.s[d.i];
      /* get one's complement of length */

      invlength = d.s[d.i + 3];
      invlength = 256 * invlength + d.s[d.i + 2];
      /* check length */

      if (length !== (~invlength & 0x0000ffff)) return TINF_DATA_ERROR;
      d.i += 4;
      /* copy block */

      for (let i = length; i; --i) d.dest[d.destLen++] = d.s[d.i++];
      /* make sure we start next block on a byte boundary */


      d.bitcount = 0;
      return TINF_OK;
    };
    /* -------------------- *
     * -- initialization -- *
     * -------------------- */

    /* build fixed huffman trees */


    tinf_build_fixed_trees(sltree, sdtree);
    /* build extra bits and base tables */

    tinf_build_bits_base(length_bits, length_base, 4, 3);
    tinf_build_bits_base(dist_bits, dist_base, 2, 1);
    /* fix a special case */

    length_bits[28] = 0;
    length_base[28] = 258;
    const d = new Data(source, dest);
    let bfinal, btype, res;

    do {
      /* read final block flag */
      bfinal = tinf_getbit(d);
      /* read block type (2 bits) */

      btype = tinf_read_bits(d, 2, 0);
      /* decompress block */

      switch (btype) {
        case 0:
          /* decompress uncompressed block */
          res = tinf_inflate_uncompressed_block(d);
          break;

        case 1:
          /* decompress block with fixed huffman trees */
          res = tinf_inflate_block_data(d, sltree, sdtree);
          break;

        case 2:
          /* decompress block with dynamic huffman trees */
          tinf_decode_trees(d, d.ltree, d.dtree);
          res = tinf_inflate_block_data(d, d.ltree, d.dtree);
          break;

        default:
          res = TINF_DATA_ERROR;
      }

      if (res !== TINF_OK) throw new Error("Data error");
    } while (!bfinal);

    if (d.destLen < d.dest.length) {
      if (typeof d.dest.slice === "function") return d.dest.slice(0, d.destLen);else return d.dest.subarray(0, d.destLen);
    }

    return d.dest;
  }

}

exports.default = WASMAudioDecoderCommon;

},{}],3:[function(require,module,exports){
(function (Buffer){(function (){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _webWorker = _interopRequireDefault(require("web-worker"));

var _WASMAudioDecoderCommon2 = _interopRequireDefault(require("./WASMAudioDecoderCommon.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class WASMAudioDecoderWorker extends _webWorker.default {
  constructor(options, Decoder, EmscriptenWASM) {
    const webworkerSourceCode = "'use strict';" + // dependencies need to be manually resolved when stringifying this function
    `(${((_options, _Decoder, _WASMAudioDecoderCommon, _EmscriptenWASM) => {
      // We're in a Web Worker
      _Decoder.WASMAudioDecoderCommon = _WASMAudioDecoderCommon;
      _Decoder.EmscriptenWASM = _EmscriptenWASM;
      _Decoder.isWebWorker = true;
      const decoder = new _Decoder(_options);

      const detachBuffers = buffer => Array.isArray(buffer) ? buffer.map(buffer => new Uint8Array(buffer)) : new Uint8Array(buffer);

      self.onmessage = ({
        data: {
          id,
          command,
          data
        }
      }) => {
        switch (command) {
          case "ready":
            decoder.ready.then(() => {
              self.postMessage({
                id
              });
            });
            break;

          case "free":
            decoder.free();
            self.postMessage({
              id
            });
            break;

          case "reset":
            decoder.reset().then(() => {
              self.postMessage({
                id
              });
            });
            break;

          case "decode":
          case "decodeFrame":
          case "decodeFrames":
            const {
              channelData,
              samplesDecoded,
              sampleRate
            } = decoder[command](detachBuffers(data));
            self.postMessage({
              id,
              channelData,
              samplesDecoded,
              sampleRate
            }, // The "transferList" parameter transfers ownership of channel data to main thread,
            // which avoids copying memory.
            channelData.map(channel => channel.buffer));
            break;

          default:
            this.console.error("Unknown command sent to worker: " + command);
        }
      };
    }).toString()})(${JSON.stringify(options)}, ${Decoder}, ${_WASMAudioDecoderCommon2.default}, ${EmscriptenWASM})`;
    const type = "text/javascript";
    let source;

    try {
      // browser
      source = URL.createObjectURL(new Blob([webworkerSourceCode], {
        type
      }));
    } catch {
      // nodejs
      source = `data:${type};base64,${Buffer.from(webworkerSourceCode).toString("base64")}`;
    }

    super(source);
    this._id = Number.MIN_SAFE_INTEGER;
    this._enqueuedOperations = new Map();

    this.onmessage = ({
      data
    }) => {
      const {
        id,
        ...rest
      } = data;

      this._enqueuedOperations.get(id)(rest);

      this._enqueuedOperations.delete(id);
    };
  }

  async _postToDecoder(command, data) {
    return new Promise(resolve => {
      this.postMessage({
        command,
        id: this._id,
        data
      });

      this._enqueuedOperations.set(this._id++, resolve);
    });
  }

  get ready() {
    return this._postToDecoder("ready");
  }

  async free() {
    await this._postToDecoder("free").finally(() => {
      this.terminate();
    });
  }

  async reset() {
    await this._postToDecoder("reset");
  }

}

exports.default = WASMAudioDecoderWorker;

}).call(this)}).call(this,require("buffer").Buffer)
},{"./WASMAudioDecoderCommon.js":2,"buffer":5,"web-worker":72}],4:[function(require,module,exports){
'use strict'

exports.byteLength = byteLength
exports.toByteArray = toByteArray
exports.fromByteArray = fromByteArray

var lookup = []
var revLookup = []
var Arr = typeof Uint8Array !== 'undefined' ? Uint8Array : Array

var code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
for (var i = 0, len = code.length; i < len; ++i) {
  lookup[i] = code[i]
  revLookup[code.charCodeAt(i)] = i
}

// Support decoding URL-safe base64 strings, as Node.js does.
// See: https://en.wikipedia.org/wiki/Base64#URL_applications
revLookup['-'.charCodeAt(0)] = 62
revLookup['_'.charCodeAt(0)] = 63

function getLens (b64) {
  var len = b64.length

  if (len % 4 > 0) {
    throw new Error('Invalid string. Length must be a multiple of 4')
  }

  // Trim off extra bytes after placeholder bytes are found
  // See: https://github.com/beatgammit/base64-js/issues/42
  var validLen = b64.indexOf('=')
  if (validLen === -1) validLen = len

  var placeHoldersLen = validLen === len
    ? 0
    : 4 - (validLen % 4)

  return [validLen, placeHoldersLen]
}

// base64 is 4/3 + up to two characters of the original data
function byteLength (b64) {
  var lens = getLens(b64)
  var validLen = lens[0]
  var placeHoldersLen = lens[1]
  return ((validLen + placeHoldersLen) * 3 / 4) - placeHoldersLen
}

function _byteLength (b64, validLen, placeHoldersLen) {
  return ((validLen + placeHoldersLen) * 3 / 4) - placeHoldersLen
}

function toByteArray (b64) {
  var tmp
  var lens = getLens(b64)
  var validLen = lens[0]
  var placeHoldersLen = lens[1]

  var arr = new Arr(_byteLength(b64, validLen, placeHoldersLen))

  var curByte = 0

  // if there are placeholders, only get up to the last complete 4 chars
  var len = placeHoldersLen > 0
    ? validLen - 4
    : validLen

  var i
  for (i = 0; i < len; i += 4) {
    tmp =
      (revLookup[b64.charCodeAt(i)] << 18) |
      (revLookup[b64.charCodeAt(i + 1)] << 12) |
      (revLookup[b64.charCodeAt(i + 2)] << 6) |
      revLookup[b64.charCodeAt(i + 3)]
    arr[curByte++] = (tmp >> 16) & 0xFF
    arr[curByte++] = (tmp >> 8) & 0xFF
    arr[curByte++] = tmp & 0xFF
  }

  if (placeHoldersLen === 2) {
    tmp =
      (revLookup[b64.charCodeAt(i)] << 2) |
      (revLookup[b64.charCodeAt(i + 1)] >> 4)
    arr[curByte++] = tmp & 0xFF
  }

  if (placeHoldersLen === 1) {
    tmp =
      (revLookup[b64.charCodeAt(i)] << 10) |
      (revLookup[b64.charCodeAt(i + 1)] << 4) |
      (revLookup[b64.charCodeAt(i + 2)] >> 2)
    arr[curByte++] = (tmp >> 8) & 0xFF
    arr[curByte++] = tmp & 0xFF
  }

  return arr
}

function tripletToBase64 (num) {
  return lookup[num >> 18 & 0x3F] +
    lookup[num >> 12 & 0x3F] +
    lookup[num >> 6 & 0x3F] +
    lookup[num & 0x3F]
}

function encodeChunk (uint8, start, end) {
  var tmp
  var output = []
  for (var i = start; i < end; i += 3) {
    tmp =
      ((uint8[i] << 16) & 0xFF0000) +
      ((uint8[i + 1] << 8) & 0xFF00) +
      (uint8[i + 2] & 0xFF)
    output.push(tripletToBase64(tmp))
  }
  return output.join('')
}

function fromByteArray (uint8) {
  var tmp
  var len = uint8.length
  var extraBytes = len % 3 // if we have 1 byte left, pad 2 bytes
  var parts = []
  var maxChunkLength = 16383 // must be multiple of 3

  // go through the array every three bytes, we'll deal with trailing stuff later
  for (var i = 0, len2 = len - extraBytes; i < len2; i += maxChunkLength) {
    parts.push(encodeChunk(uint8, i, (i + maxChunkLength) > len2 ? len2 : (i + maxChunkLength)))
  }

  // pad the end with zeros, but make sure to not forget the extra bytes
  if (extraBytes === 1) {
    tmp = uint8[len - 1]
    parts.push(
      lookup[tmp >> 2] +
      lookup[(tmp << 4) & 0x3F] +
      '=='
    )
  } else if (extraBytes === 2) {
    tmp = (uint8[len - 2] << 8) + uint8[len - 1]
    parts.push(
      lookup[tmp >> 10] +
      lookup[(tmp >> 4) & 0x3F] +
      lookup[(tmp << 2) & 0x3F] +
      '='
    )
  }

  return parts.join('')
}

},{}],5:[function(require,module,exports){
(function (Buffer){(function (){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <https://feross.org>
 * @license  MIT
 */
/* eslint-disable no-proto */

'use strict'

var base64 = require('base64-js')
var ieee754 = require('ieee754')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50

var K_MAX_LENGTH = 0x7fffffff
exports.kMaxLength = K_MAX_LENGTH

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Print warning and recommend using `buffer` v4.x which has an Object
 *               implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * We report that the browser does not support typed arrays if the are not subclassable
 * using __proto__. Firefox 4-29 lacks support for adding new properties to `Uint8Array`
 * (See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438). IE 10 lacks support
 * for __proto__ and has a buggy typed array implementation.
 */
Buffer.TYPED_ARRAY_SUPPORT = typedArraySupport()

if (!Buffer.TYPED_ARRAY_SUPPORT && typeof console !== 'undefined' &&
    typeof console.error === 'function') {
  console.error(
    'This browser lacks typed array (Uint8Array) support which is required by ' +
    '`buffer` v5.x. Use `buffer` v4.x if you require old browser support.'
  )
}

function typedArraySupport () {
  // Can typed array instances can be augmented?
  try {
    var arr = new Uint8Array(1)
    arr.__proto__ = { __proto__: Uint8Array.prototype, foo: function () { return 42 } }
    return arr.foo() === 42
  } catch (e) {
    return false
  }
}

Object.defineProperty(Buffer.prototype, 'parent', {
  enumerable: true,
  get: function () {
    if (!Buffer.isBuffer(this)) return undefined
    return this.buffer
  }
})

Object.defineProperty(Buffer.prototype, 'offset', {
  enumerable: true,
  get: function () {
    if (!Buffer.isBuffer(this)) return undefined
    return this.byteOffset
  }
})

function createBuffer (length) {
  if (length > K_MAX_LENGTH) {
    throw new RangeError('The value "' + length + '" is invalid for option "size"')
  }
  // Return an augmented `Uint8Array` instance
  var buf = new Uint8Array(length)
  buf.__proto__ = Buffer.prototype
  return buf
}

/**
 * The Buffer constructor returns instances of `Uint8Array` that have their
 * prototype changed to `Buffer.prototype`. Furthermore, `Buffer` is a subclass of
 * `Uint8Array`, so the returned instances will have all the node `Buffer` methods
 * and the `Uint8Array` methods. Square bracket notation works as expected -- it
 * returns a single octet.
 *
 * The `Uint8Array` prototype remains unmodified.
 */

function Buffer (arg, encodingOrOffset, length) {
  // Common case.
  if (typeof arg === 'number') {
    if (typeof encodingOrOffset === 'string') {
      throw new TypeError(
        'The "string" argument must be of type string. Received type number'
      )
    }
    return allocUnsafe(arg)
  }
  return from(arg, encodingOrOffset, length)
}

// Fix subarray() in ES2016. See: https://github.com/feross/buffer/pull/97
if (typeof Symbol !== 'undefined' && Symbol.species != null &&
    Buffer[Symbol.species] === Buffer) {
  Object.defineProperty(Buffer, Symbol.species, {
    value: null,
    configurable: true,
    enumerable: false,
    writable: false
  })
}

Buffer.poolSize = 8192 // not used by this implementation

function from (value, encodingOrOffset, length) {
  if (typeof value === 'string') {
    return fromString(value, encodingOrOffset)
  }

  if (ArrayBuffer.isView(value)) {
    return fromArrayLike(value)
  }

  if (value == null) {
    throw TypeError(
      'The first argument must be one of type string, Buffer, ArrayBuffer, Array, ' +
      'or Array-like Object. Received type ' + (typeof value)
    )
  }

  if (isInstance(value, ArrayBuffer) ||
      (value && isInstance(value.buffer, ArrayBuffer))) {
    return fromArrayBuffer(value, encodingOrOffset, length)
  }

  if (typeof value === 'number') {
    throw new TypeError(
      'The "value" argument must not be of type number. Received type number'
    )
  }

  var valueOf = value.valueOf && value.valueOf()
  if (valueOf != null && valueOf !== value) {
    return Buffer.from(valueOf, encodingOrOffset, length)
  }

  var b = fromObject(value)
  if (b) return b

  if (typeof Symbol !== 'undefined' && Symbol.toPrimitive != null &&
      typeof value[Symbol.toPrimitive] === 'function') {
    return Buffer.from(
      value[Symbol.toPrimitive]('string'), encodingOrOffset, length
    )
  }

  throw new TypeError(
    'The first argument must be one of type string, Buffer, ArrayBuffer, Array, ' +
    'or Array-like Object. Received type ' + (typeof value)
  )
}

/**
 * Functionally equivalent to Buffer(arg, encoding) but throws a TypeError
 * if value is a number.
 * Buffer.from(str[, encoding])
 * Buffer.from(array)
 * Buffer.from(buffer)
 * Buffer.from(arrayBuffer[, byteOffset[, length]])
 **/
Buffer.from = function (value, encodingOrOffset, length) {
  return from(value, encodingOrOffset, length)
}

// Note: Change prototype *after* Buffer.from is defined to workaround Chrome bug:
// https://github.com/feross/buffer/pull/148
Buffer.prototype.__proto__ = Uint8Array.prototype
Buffer.__proto__ = Uint8Array

function assertSize (size) {
  if (typeof size !== 'number') {
    throw new TypeError('"size" argument must be of type number')
  } else if (size < 0) {
    throw new RangeError('The value "' + size + '" is invalid for option "size"')
  }
}

function alloc (size, fill, encoding) {
  assertSize(size)
  if (size <= 0) {
    return createBuffer(size)
  }
  if (fill !== undefined) {
    // Only pay attention to encoding if it's a string. This
    // prevents accidentally sending in a number that would
    // be interpretted as a start offset.
    return typeof encoding === 'string'
      ? createBuffer(size).fill(fill, encoding)
      : createBuffer(size).fill(fill)
  }
  return createBuffer(size)
}

/**
 * Creates a new filled Buffer instance.
 * alloc(size[, fill[, encoding]])
 **/
Buffer.alloc = function (size, fill, encoding) {
  return alloc(size, fill, encoding)
}

function allocUnsafe (size) {
  assertSize(size)
  return createBuffer(size < 0 ? 0 : checked(size) | 0)
}

/**
 * Equivalent to Buffer(num), by default creates a non-zero-filled Buffer instance.
 * */
Buffer.allocUnsafe = function (size) {
  return allocUnsafe(size)
}
/**
 * Equivalent to SlowBuffer(num), by default creates a non-zero-filled Buffer instance.
 */
Buffer.allocUnsafeSlow = function (size) {
  return allocUnsafe(size)
}

function fromString (string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') {
    encoding = 'utf8'
  }

  if (!Buffer.isEncoding(encoding)) {
    throw new TypeError('Unknown encoding: ' + encoding)
  }

  var length = byteLength(string, encoding) | 0
  var buf = createBuffer(length)

  var actual = buf.write(string, encoding)

  if (actual !== length) {
    // Writing a hex string, for example, that contains invalid characters will
    // cause everything after the first invalid character to be ignored. (e.g.
    // 'abxxcd' will be treated as 'ab')
    buf = buf.slice(0, actual)
  }

  return buf
}

function fromArrayLike (array) {
  var length = array.length < 0 ? 0 : checked(array.length) | 0
  var buf = createBuffer(length)
  for (var i = 0; i < length; i += 1) {
    buf[i] = array[i] & 255
  }
  return buf
}

function fromArrayBuffer (array, byteOffset, length) {
  if (byteOffset < 0 || array.byteLength < byteOffset) {
    throw new RangeError('"offset" is outside of buffer bounds')
  }

  if (array.byteLength < byteOffset + (length || 0)) {
    throw new RangeError('"length" is outside of buffer bounds')
  }

  var buf
  if (byteOffset === undefined && length === undefined) {
    buf = new Uint8Array(array)
  } else if (length === undefined) {
    buf = new Uint8Array(array, byteOffset)
  } else {
    buf = new Uint8Array(array, byteOffset, length)
  }

  // Return an augmented `Uint8Array` instance
  buf.__proto__ = Buffer.prototype
  return buf
}

function fromObject (obj) {
  if (Buffer.isBuffer(obj)) {
    var len = checked(obj.length) | 0
    var buf = createBuffer(len)

    if (buf.length === 0) {
      return buf
    }

    obj.copy(buf, 0, 0, len)
    return buf
  }

  if (obj.length !== undefined) {
    if (typeof obj.length !== 'number' || numberIsNaN(obj.length)) {
      return createBuffer(0)
    }
    return fromArrayLike(obj)
  }

  if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
    return fromArrayLike(obj.data)
  }
}

function checked (length) {
  // Note: cannot use `length < K_MAX_LENGTH` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= K_MAX_LENGTH) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + K_MAX_LENGTH.toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (length) {
  if (+length != length) { // eslint-disable-line eqeqeq
    length = 0
  }
  return Buffer.alloc(+length)
}

Buffer.isBuffer = function isBuffer (b) {
  return b != null && b._isBuffer === true &&
    b !== Buffer.prototype // so Buffer.isBuffer(Buffer.prototype) will be false
}

Buffer.compare = function compare (a, b) {
  if (isInstance(a, Uint8Array)) a = Buffer.from(a, a.offset, a.byteLength)
  if (isInstance(b, Uint8Array)) b = Buffer.from(b, b.offset, b.byteLength)
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError(
      'The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array'
    )
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  for (var i = 0, len = Math.min(x, y); i < len; ++i) {
    if (a[i] !== b[i]) {
      x = a[i]
      y = b[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'latin1':
    case 'binary':
    case 'base64':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!Array.isArray(list)) {
    throw new TypeError('"list" argument must be an Array of Buffers')
  }

  if (list.length === 0) {
    return Buffer.alloc(0)
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; ++i) {
      length += list[i].length
    }
  }

  var buffer = Buffer.allocUnsafe(length)
  var pos = 0
  for (i = 0; i < list.length; ++i) {
    var buf = list[i]
    if (isInstance(buf, Uint8Array)) {
      buf = Buffer.from(buf)
    }
    if (!Buffer.isBuffer(buf)) {
      throw new TypeError('"list" argument must be an Array of Buffers')
    }
    buf.copy(buffer, pos)
    pos += buf.length
  }
  return buffer
}

function byteLength (string, encoding) {
  if (Buffer.isBuffer(string)) {
    return string.length
  }
  if (ArrayBuffer.isView(string) || isInstance(string, ArrayBuffer)) {
    return string.byteLength
  }
  if (typeof string !== 'string') {
    throw new TypeError(
      'The "string" argument must be one of type string, Buffer, or ArrayBuffer. ' +
      'Received type ' + typeof string
    )
  }

  var len = string.length
  var mustMatch = (arguments.length > 2 && arguments[2] === true)
  if (!mustMatch && len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'latin1':
      case 'binary':
        return len
      case 'utf8':
      case 'utf-8':
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) {
          return mustMatch ? -1 : utf8ToBytes(string).length // assume utf8
        }
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}
Buffer.byteLength = byteLength

function slowToString (encoding, start, end) {
  var loweredCase = false

  // No need to verify that "this.length <= MAX_UINT32" since it's a read-only
  // property of a typed array.

  // This behaves neither like String nor Uint8Array in that we set start/end
  // to their upper/lower bounds if the value passed is out of range.
  // undefined is handled specially as per ECMA-262 6th Edition,
  // Section 13.3.3.7 Runtime Semantics: KeyedBindingInitialization.
  if (start === undefined || start < 0) {
    start = 0
  }
  // Return early if start > this.length. Done here to prevent potential uint32
  // coercion fail below.
  if (start > this.length) {
    return ''
  }

  if (end === undefined || end > this.length) {
    end = this.length
  }

  if (end <= 0) {
    return ''
  }

  // Force coersion to uint32. This will also coerce falsey/NaN values to 0.
  end >>>= 0
  start >>>= 0

  if (end <= start) {
    return ''
  }

  if (!encoding) encoding = 'utf8'

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'latin1':
      case 'binary':
        return latin1Slice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

// This property is used by `Buffer.isBuffer` (and the `is-buffer` npm package)
// to detect a Buffer instance. It's not possible to use `instanceof Buffer`
// reliably in a browserify context because there could be multiple different
// copies of the 'buffer' package in use. This method works even for Buffer
// instances that were created from another copy of the `buffer` package.
// See: https://github.com/feross/buffer/issues/154
Buffer.prototype._isBuffer = true

function swap (b, n, m) {
  var i = b[n]
  b[n] = b[m]
  b[m] = i
}

Buffer.prototype.swap16 = function swap16 () {
  var len = this.length
  if (len % 2 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 16-bits')
  }
  for (var i = 0; i < len; i += 2) {
    swap(this, i, i + 1)
  }
  return this
}

Buffer.prototype.swap32 = function swap32 () {
  var len = this.length
  if (len % 4 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 32-bits')
  }
  for (var i = 0; i < len; i += 4) {
    swap(this, i, i + 3)
    swap(this, i + 1, i + 2)
  }
  return this
}

Buffer.prototype.swap64 = function swap64 () {
  var len = this.length
  if (len % 8 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 64-bits')
  }
  for (var i = 0; i < len; i += 8) {
    swap(this, i, i + 7)
    swap(this, i + 1, i + 6)
    swap(this, i + 2, i + 5)
    swap(this, i + 3, i + 4)
  }
  return this
}

Buffer.prototype.toString = function toString () {
  var length = this.length
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
}

Buffer.prototype.toLocaleString = Buffer.prototype.toString

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  str = this.toString('hex', 0, max).replace(/(.{2})/g, '$1 ').trim()
  if (this.length > max) str += ' ... '
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (target, start, end, thisStart, thisEnd) {
  if (isInstance(target, Uint8Array)) {
    target = Buffer.from(target, target.offset, target.byteLength)
  }
  if (!Buffer.isBuffer(target)) {
    throw new TypeError(
      'The "target" argument must be one of type Buffer or Uint8Array. ' +
      'Received type ' + (typeof target)
    )
  }

  if (start === undefined) {
    start = 0
  }
  if (end === undefined) {
    end = target ? target.length : 0
  }
  if (thisStart === undefined) {
    thisStart = 0
  }
  if (thisEnd === undefined) {
    thisEnd = this.length
  }

  if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
    throw new RangeError('out of range index')
  }

  if (thisStart >= thisEnd && start >= end) {
    return 0
  }
  if (thisStart >= thisEnd) {
    return -1
  }
  if (start >= end) {
    return 1
  }

  start >>>= 0
  end >>>= 0
  thisStart >>>= 0
  thisEnd >>>= 0

  if (this === target) return 0

  var x = thisEnd - thisStart
  var y = end - start
  var len = Math.min(x, y)

  var thisCopy = this.slice(thisStart, thisEnd)
  var targetCopy = target.slice(start, end)

  for (var i = 0; i < len; ++i) {
    if (thisCopy[i] !== targetCopy[i]) {
      x = thisCopy[i]
      y = targetCopy[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

// Finds either the first index of `val` in `buffer` at offset >= `byteOffset`,
// OR the last index of `val` in `buffer` at offset <= `byteOffset`.
//
// Arguments:
// - buffer - a Buffer to search
// - val - a string, Buffer, or number
// - byteOffset - an index into `buffer`; will be clamped to an int32
// - encoding - an optional encoding, relevant is val is a string
// - dir - true for indexOf, false for lastIndexOf
function bidirectionalIndexOf (buffer, val, byteOffset, encoding, dir) {
  // Empty buffer means no match
  if (buffer.length === 0) return -1

  // Normalize byteOffset
  if (typeof byteOffset === 'string') {
    encoding = byteOffset
    byteOffset = 0
  } else if (byteOffset > 0x7fffffff) {
    byteOffset = 0x7fffffff
  } else if (byteOffset < -0x80000000) {
    byteOffset = -0x80000000
  }
  byteOffset = +byteOffset // Coerce to Number.
  if (numberIsNaN(byteOffset)) {
    // byteOffset: it it's undefined, null, NaN, "foo", etc, search whole buffer
    byteOffset = dir ? 0 : (buffer.length - 1)
  }

  // Normalize byteOffset: negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = buffer.length + byteOffset
  if (byteOffset >= buffer.length) {
    if (dir) return -1
    else byteOffset = buffer.length - 1
  } else if (byteOffset < 0) {
    if (dir) byteOffset = 0
    else return -1
  }

  // Normalize val
  if (typeof val === 'string') {
    val = Buffer.from(val, encoding)
  }

  // Finally, search either indexOf (if dir is true) or lastIndexOf
  if (Buffer.isBuffer(val)) {
    // Special case: looking for empty string/buffer always fails
    if (val.length === 0) {
      return -1
    }
    return arrayIndexOf(buffer, val, byteOffset, encoding, dir)
  } else if (typeof val === 'number') {
    val = val & 0xFF // Search for a byte value [0-255]
    if (typeof Uint8Array.prototype.indexOf === 'function') {
      if (dir) {
        return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset)
      } else {
        return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset)
      }
    }
    return arrayIndexOf(buffer, [ val ], byteOffset, encoding, dir)
  }

  throw new TypeError('val must be string, number or Buffer')
}

function arrayIndexOf (arr, val, byteOffset, encoding, dir) {
  var indexSize = 1
  var arrLength = arr.length
  var valLength = val.length

  if (encoding !== undefined) {
    encoding = String(encoding).toLowerCase()
    if (encoding === 'ucs2' || encoding === 'ucs-2' ||
        encoding === 'utf16le' || encoding === 'utf-16le') {
      if (arr.length < 2 || val.length < 2) {
        return -1
      }
      indexSize = 2
      arrLength /= 2
      valLength /= 2
      byteOffset /= 2
    }
  }

  function read (buf, i) {
    if (indexSize === 1) {
      return buf[i]
    } else {
      return buf.readUInt16BE(i * indexSize)
    }
  }

  var i
  if (dir) {
    var foundIndex = -1
    for (i = byteOffset; i < arrLength; i++) {
      if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === valLength) return foundIndex * indexSize
      } else {
        if (foundIndex !== -1) i -= i - foundIndex
        foundIndex = -1
      }
    }
  } else {
    if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength
    for (i = byteOffset; i >= 0; i--) {
      var found = true
      for (var j = 0; j < valLength; j++) {
        if (read(arr, i + j) !== read(val, j)) {
          found = false
          break
        }
      }
      if (found) return i
    }
  }

  return -1
}

Buffer.prototype.includes = function includes (val, byteOffset, encoding) {
  return this.indexOf(val, byteOffset, encoding) !== -1
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, true)
}

Buffer.prototype.lastIndexOf = function lastIndexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, false)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  var strLen = string.length

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; ++i) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (numberIsNaN(parsed)) return i
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function latin1Write (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset >>> 0
    if (isFinite(length)) {
      length = length >>> 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  } else {
    throw new Error(
      'Buffer.write(string, encoding, offset[, length]) is no longer supported'
    )
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('Attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'latin1':
      case 'binary':
        return latin1Write(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  end = Math.min(buf.length, end)
  var res = []

  var i = start
  while (i < end) {
    var firstByte = buf[i]
    var codePoint = null
    var bytesPerSequence = (firstByte > 0xEF) ? 4
      : (firstByte > 0xDF) ? 3
        : (firstByte > 0xBF) ? 2
          : 1

    if (i + bytesPerSequence <= end) {
      var secondByte, thirdByte, fourthByte, tempCodePoint

      switch (bytesPerSequence) {
        case 1:
          if (firstByte < 0x80) {
            codePoint = firstByte
          }
          break
        case 2:
          secondByte = buf[i + 1]
          if ((secondByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F)
            if (tempCodePoint > 0x7F) {
              codePoint = tempCodePoint
            }
          }
          break
        case 3:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F)
            if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
              codePoint = tempCodePoint
            }
          }
          break
        case 4:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          fourthByte = buf[i + 3]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F)
            if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
              codePoint = tempCodePoint
            }
          }
      }
    }

    if (codePoint === null) {
      // we did not generate a valid codePoint so insert a
      // replacement char (U+FFFD) and advance only 1 byte
      codePoint = 0xFFFD
      bytesPerSequence = 1
    } else if (codePoint > 0xFFFF) {
      // encode to utf16 (surrogate pair dance)
      codePoint -= 0x10000
      res.push(codePoint >>> 10 & 0x3FF | 0xD800)
      codePoint = 0xDC00 | codePoint & 0x3FF
    }

    res.push(codePoint)
    i += bytesPerSequence
  }

  return decodeCodePointsArray(res)
}

// Based on http://stackoverflow.com/a/22747272/680742, the browser with
// the lowest limit is Chrome, with 0x10000 args.
// We go 1 magnitude less, for safety
var MAX_ARGUMENTS_LENGTH = 0x1000

function decodeCodePointsArray (codePoints) {
  var len = codePoints.length
  if (len <= MAX_ARGUMENTS_LENGTH) {
    return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
  }

  // Decode in chunks to avoid "call stack size exceeded".
  var res = ''
  var i = 0
  while (i < len) {
    res += String.fromCharCode.apply(
      String,
      codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
    )
  }
  return res
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function latin1Slice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; ++i) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + (bytes[i + 1] * 256))
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf = this.subarray(start, end)
  // Return an augmented `Uint8Array` instance
  newBuf.__proto__ = Buffer.prototype
  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('"value" argument is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  this[offset] = (value >>> 8)
  this[offset + 1] = (value & 0xff)
  return offset + 2
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  this[offset + 3] = (value >>> 24)
  this[offset + 2] = (value >>> 16)
  this[offset + 1] = (value >>> 8)
  this[offset] = (value & 0xff)
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  this[offset] = (value >>> 24)
  this[offset + 1] = (value >>> 16)
  this[offset + 2] = (value >>> 8)
  this[offset + 3] = (value & 0xff)
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    var limit = Math.pow(2, (8 * byteLength) - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    var limit = Math.pow(2, (8 * byteLength) - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (value < 0) value = 0xff + value + 1
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  this[offset] = (value >>> 8)
  this[offset + 1] = (value & 0xff)
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  this[offset + 2] = (value >>> 16)
  this[offset + 3] = (value >>> 24)
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  this[offset] = (value >>> 24)
  this[offset + 1] = (value >>> 16)
  this[offset + 2] = (value >>> 8)
  this[offset + 3] = (value & 0xff)
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
  if (offset < 0) throw new RangeError('Index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!Buffer.isBuffer(target)) throw new TypeError('argument should be a Buffer')
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('Index out of range')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start

  if (this === target && typeof Uint8Array.prototype.copyWithin === 'function') {
    // Use built-in when available, missing from IE11
    this.copyWithin(targetStart, start, end)
  } else if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (var i = len - 1; i >= 0; --i) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    Uint8Array.prototype.set.call(
      target,
      this.subarray(start, end),
      targetStart
    )
  }

  return len
}

// Usage:
//    buffer.fill(number[, offset[, end]])
//    buffer.fill(buffer[, offset[, end]])
//    buffer.fill(string[, offset[, end]][, encoding])
Buffer.prototype.fill = function fill (val, start, end, encoding) {
  // Handle string cases:
  if (typeof val === 'string') {
    if (typeof start === 'string') {
      encoding = start
      start = 0
      end = this.length
    } else if (typeof end === 'string') {
      encoding = end
      end = this.length
    }
    if (encoding !== undefined && typeof encoding !== 'string') {
      throw new TypeError('encoding must be a string')
    }
    if (typeof encoding === 'string' && !Buffer.isEncoding(encoding)) {
      throw new TypeError('Unknown encoding: ' + encoding)
    }
    if (val.length === 1) {
      var code = val.charCodeAt(0)
      if ((encoding === 'utf8' && code < 128) ||
          encoding === 'latin1') {
        // Fast path: If `val` fits into a single byte, use that numeric value.
        val = code
      }
    }
  } else if (typeof val === 'number') {
    val = val & 255
  }

  // Invalid ranges are not set to a default, so can range check early.
  if (start < 0 || this.length < start || this.length < end) {
    throw new RangeError('Out of range index')
  }

  if (end <= start) {
    return this
  }

  start = start >>> 0
  end = end === undefined ? this.length : end >>> 0

  if (!val) val = 0

  var i
  if (typeof val === 'number') {
    for (i = start; i < end; ++i) {
      this[i] = val
    }
  } else {
    var bytes = Buffer.isBuffer(val)
      ? val
      : Buffer.from(val, encoding)
    var len = bytes.length
    if (len === 0) {
      throw new TypeError('The value "' + val +
        '" is invalid for argument "value"')
    }
    for (i = 0; i < end - start; ++i) {
      this[i + start] = bytes[i % len]
    }
  }

  return this
}

// HELPER FUNCTIONS
// ================

var INVALID_BASE64_RE = /[^+/0-9A-Za-z-_]/g

function base64clean (str) {
  // Node takes equal signs as end of the Base64 encoding
  str = str.split('=')[0]
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = str.trim().replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []

  for (var i = 0; i < length; ++i) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (!leadSurrogate) {
        // no lead yet
        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        leadSurrogate = codePoint

        continue
      }

      // 2 leads in a row
      if (codePoint < 0xDC00) {
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
        leadSurrogate = codePoint
        continue
      }

      // valid surrogate pair
      codePoint = (leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00) + 0x10000
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
    }

    leadSurrogate = null

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x110000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; ++i) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

// ArrayBuffer or Uint8Array objects from other contexts (i.e. iframes) do not pass
// the `instanceof` check but they should be treated as of that type.
// See: https://github.com/feross/buffer/issues/166
function isInstance (obj, type) {
  return obj instanceof type ||
    (obj != null && obj.constructor != null && obj.constructor.name != null &&
      obj.constructor.name === type.name)
}
function numberIsNaN (obj) {
  // For IE11 support
  return obj !== obj // eslint-disable-line no-self-compare
}

}).call(this)}).call(this,require("buffer").Buffer)
},{"base64-js":4,"buffer":5,"ieee754":53}],6:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _CodecParser = _interopRequireDefault(require("./src/CodecParser.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var _default = _CodecParser.default;
exports.default = _default;

},{"./src/CodecParser.js":7}],7:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _utilities = require("./utilities.js");

var _HeaderCache = _interopRequireDefault(require("./codecs/HeaderCache.js"));

var _MPEGParser = _interopRequireDefault(require("./codecs/mpeg/MPEGParser.js"));

var _AACParser = _interopRequireDefault(require("./codecs/aac/AACParser.js"));

var _FLACParser = _interopRequireDefault(require("./codecs/flac/FLACParser.js"));

var _OggParser = _interopRequireDefault(require("./containers/ogg/OggParser.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of codec-parser.
    
    codec-parser is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    codec-parser is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
const noOp = () => {};

class CodecParser {
  constructor(mimeType, {
    onCodecUpdate,
    onCodec,
    enableLogging
  } = {}) {
    this._inputMimeType = mimeType;
    this._onCodec = onCodec || noOp;
    this._onCodecUpdate = onCodecUpdate;
    this._enableLogging = enableLogging;
    this._generator = this._getGenerator();

    this._generator.next();
  }
  /**
   * @public
   * @returns The detected codec
   */


  get codec() {
    return this._parser.codec;
  }
  /**
   * @public
   * @description Generator function that yields any buffered CodecFrames and resets the CodecParser
   * @returns {Iterable<CodecFrame|OggPage>} Iterator that operates over the codec data.
   * @yields {CodecFrame|OggPage} Parsed codec or ogg page data
   */


  *flush() {
    this._flushing = true;

    for (let i = this._generator.next(); i.value; i = this._generator.next()) {
      yield i.value;
    }

    this._flushing = false;
    this._generator = this._getGenerator();

    this._generator.next();
  }
  /**
   * @public
   * @description Generator function takes in a Uint8Array of data and returns a CodecFrame from the data for each iteration
   * @param {Uint8Array} chunk Next chunk of codec data to read
   * @returns {Iterable<CodecFrame|OggPage>} Iterator that operates over the codec data.
   * @yields {CodecFrame|OggPage} Parsed codec or ogg page data
   */


  *parseChunk(chunk) {
    for (let i = this._generator.next(chunk); i.value; i = this._generator.next()) {
      yield i.value;
    }
  }
  /**
   * @public
   * @description Parses an entire file and returns all of the contained frames.
   * @param {Uint8Array} fileData Coded data to read
   * @returns {Array<CodecFrame|OggPage>} CodecFrames
   */


  parseAll(fileData) {
    return [...this.parseChunk(fileData), ...this.flush()];
  }
  /**
   * @private
   */


  *_getGenerator() {
    this._headerCache = new _HeaderCache.default(this._onCodecUpdate);

    if (this._inputMimeType.match(/aac/)) {
      this._parser = new _AACParser.default(this, this._headerCache, this._onCodec);
    } else if (this._inputMimeType.match(/mpeg/)) {
      this._parser = new _MPEGParser.default(this, this._headerCache, this._onCodec);
    } else if (this._inputMimeType.match(/flac/)) {
      this._parser = new _FLACParser.default(this, this._headerCache, this._onCodec);
    } else if (this._inputMimeType.match(/ogg/)) {
      this._parser = new _OggParser.default(this, this._headerCache, this._onCodec);
    } else {
      throw new Error(`Unsupported Codec ${mimeType}`);
    }

    this._frameNumber = 0;
    this._currentReadPosition = 0;
    this._totalBytesIn = 0;
    this._totalBytesOut = 0;
    this._totalSamples = 0;
    this._sampleRate = undefined;
    this._rawData = new Uint8Array(0); // start parsing out frames

    while (true) {
      const frame = yield* this._parser.parseFrame();
      if (frame) yield frame;
    }
  }
  /**
   * @protected
   * @param {number} minSize Minimum bytes to have present in buffer
   * @returns {Uint8Array} rawData
   */


  *readRawData(minSize = 0, readOffset = 0) {
    let rawData;

    while (this._rawData.length <= minSize + readOffset) {
      rawData = yield;
      if (this._flushing) return this._rawData.subarray(readOffset);

      if (rawData) {
        this._totalBytesIn += rawData.length;
        this._rawData = (0, _utilities.concatBuffers)(this._rawData, rawData);
      }
    }

    return this._rawData.subarray(readOffset);
  }
  /**
   * @protected
   * @param {number} increment Bytes to increment codec data
   */


  incrementRawData(increment) {
    this._currentReadPosition += increment;
    this._rawData = this._rawData.subarray(increment);
  }
  /**
   * @protected
   */


  mapCodecFrameStats(frame) {
    this._sampleRate = frame.header.sampleRate;
    frame.header.bitrate = Math.round(frame.data.length / frame.duration) * 8;
    frame.frameNumber = this._frameNumber++;
    frame.totalBytesOut = this._totalBytesOut;
    frame.totalSamples = this._totalSamples;
    frame.totalDuration = this._totalSamples / this._sampleRate * 1000;
    frame.crc32 = (0, _utilities.crc32)(frame.data);

    this._headerCache.checkCodecUpdate(frame.header.bitrate, frame.totalDuration);

    this._totalBytesOut += frame.data.length;
    this._totalSamples += frame.samples;
  }
  /**
   * @protected
   */


  mapFrameStats(frame) {
    if (frame.codecFrames) {
      // Ogg container
      frame.codecFrames.forEach(codecFrame => {
        frame.duration += codecFrame.duration;
        frame.samples += codecFrame.samples;
        this.mapCodecFrameStats(codecFrame);
      });
      frame.totalSamples = this._totalSamples;
      frame.totalDuration = this._totalSamples / this._sampleRate * 1000 || 0;
      frame.totalBytesOut = this._totalBytesOut;
    } else {
      this.mapCodecFrameStats(frame);
    }
  }
  /**
   * @private
   */


  _log(logger, messages) {
    if (this._enableLogging) {
      const stats = [`codec:         ${this.codec}`, `inputMimeType: ${this._inputMimeType}`, `readPosition:  ${this._currentReadPosition}`, `totalBytesIn:  ${this._totalBytesIn}`, `totalBytesOut: ${this._totalBytesOut}`];
      const width = Math.max(...stats.map(s => s.length));
      messages.push(`--stats--${"-".repeat(width - 9)}`, ...stats, "-".repeat(width));
      logger("codec-parser", messages.reduce((acc, message) => acc + "\n  " + message, ""));
    }
  }
  /**
   * @protected
   */


  logWarning(...messages) {
    this._log(console.warn, messages);
  }
  /**
   * @protected
   */


  logError(...messages) {
    this._log(console.error, messages);
  }

}

exports.default = CodecParser;

},{"./codecs/HeaderCache.js":10,"./codecs/aac/AACParser.js":14,"./codecs/flac/FLACParser.js":17,"./codecs/mpeg/MPEGParser.js":20,"./containers/ogg/OggParser.js":31,"./utilities.js":34}],8:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _globals = require("../globals.js");

var _Frame = _interopRequireDefault(require("../containers/Frame.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of codec-parser.
    
    codec-parser is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    codec-parser is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
class CodecFrame extends _Frame.default {
  static *getFrame(Header, Frame, codecParser, headerCache, readOffset) {
    const header = yield* Header.getHeader(codecParser, headerCache, readOffset);

    if (header) {
      const frameLength = _globals.headerStore.get(header).frameLength;

      const samples = _globals.headerStore.get(header).samples;

      const frame = (yield* codecParser.readRawData(frameLength, readOffset)).subarray(0, frameLength);
      return new Frame(header, frame, samples);
    } else {
      return null;
    }
  }

  constructor(header, data, samples) {
    super(header, data);
    this.header = header;
    this.samples = samples;
    this.duration = samples / header.sampleRate * 1000;
    this.frameNumber = null;
    this.totalBytesOut = null;
    this.totalSamples = null;
    this.totalDuration = null;
    _globals.frameStore.get(this).length = data.length;
  }

}

exports.default = CodecFrame;

},{"../containers/Frame.js":28,"../globals.js":32}],9:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _globals = require("../globals.js");

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of codec-parser.
    
    codec-parser is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    codec-parser is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
class CodecHeader {
  /**
   * @private
   */
  constructor(header) {
    _globals.headerStore.set(this, header);

    this.bitDepth = header.bitDepth;
    this.bitrate = null; // set during frame mapping

    this.channels = header.channels;
    this.channelMode = header.channelMode;
    this.sampleRate = header.sampleRate;
  }

}

exports.default = CodecHeader;

},{"../globals.js":32}],10:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of codec-parser.
    
    codec-parser is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    codec-parser is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
class HeaderCache {
  constructor(onCodecUpdate) {
    this._onCodecUpdate = onCodecUpdate;
    this.reset();
  }

  enable() {
    this._isEnabled = true;
  }

  reset() {
    this._headerCache = new Map();
    this._codecUpdateData = new WeakMap();
    this._codecShouldUpdate = false;
    this._bitrate = null;
    this._isEnabled = false;
  }

  checkCodecUpdate(bitrate, totalDuration) {
    if (this._onCodecUpdate) {
      if (this._bitrate !== bitrate) {
        this._bitrate = bitrate;
        this._codecShouldUpdate = true;
      }

      if (this._codecShouldUpdate) {
        this._onCodecUpdate({
          bitrate,
          ...this._codecUpdateData.get(this._headerCache.get(this._currentHeader))
        }, totalDuration);
      }

      this._codecShouldUpdate = false;
    }
  }

  updateCurrentHeader(key) {
    if (this._onCodecUpdate && key !== this._currentHeader) {
      this._codecShouldUpdate = true;
      this._currentHeader = key;
    }
  }

  getHeader(key) {
    const header = this._headerCache.get(key);

    if (header) {
      this.updateCurrentHeader(key);
    }

    return header;
  }

  setHeader(key, header, codecUpdateFields) {
    if (this._isEnabled) {
      this.updateCurrentHeader(key);

      this._headerCache.set(key, header);

      this._codecUpdateData.set(header, codecUpdateFields);
    }
  }

}

exports.default = HeaderCache;

},{}],11:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _globals = require("../globals.js");

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of codec-parser.
    
    codec-parser is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    codec-parser is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/

/**
 * @abstract
 * @description Abstract class containing methods for parsing codec frames
 */
class Parser {
  constructor(codecParser, headerCache) {
    this._codecParser = codecParser;
    this._headerCache = headerCache;
  }

  *syncFrame() {
    let frame;

    do {
      frame = yield* this.Frame.getFrame(this._codecParser, this._headerCache, 0);
      if (frame) return frame;

      this._codecParser.incrementRawData(1); // increment to continue syncing

    } while (true);
  }
  /**
   * @description Searches for Frames within bytes containing a sequence of known codec frames.
   * @param {boolean} ignoreNextFrame Set to true to return frames even if the next frame may not exist at the expected location
   * @returns {Frame}
   */


  *fixedLengthFrameSync(ignoreNextFrame) {
    let frame = yield* this.syncFrame();

    const frameLength = _globals.frameStore.get(frame).length;

    if (ignoreNextFrame || this._codecParser._flushing || ( // check if there is a frame right after this one
    yield* this.Header.getHeader(this._codecParser, this._headerCache, frameLength))) {
      this._headerCache.enable(); // start caching when synced


      this._codecParser.incrementRawData(frameLength); // increment to the next frame


      this._codecParser.mapFrameStats(frame);

      return frame;
    }

    this._codecParser.logWarning(`Missing frame frame at ${frameLength} bytes from current position.`, "Dropping current frame and trying again.");

    this._headerCache.reset(); // frame is invalid and must re-sync and clear cache


    this._codecParser.incrementRawData(1); // increment to invalidate the current frame

  }

}

exports.default = Parser;

},{"../globals.js":32}],12:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _CodecFrame = _interopRequireDefault(require("../CodecFrame.js"));

var _AACHeader = _interopRequireDefault(require("./AACHeader.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of codec-parser.
    
    codec-parser is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    codec-parser is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
class AACFrame extends _CodecFrame.default {
  static *getFrame(codecParser, headerCache, readOffset) {
    return yield* super.getFrame(_AACHeader.default, AACFrame, codecParser, headerCache, readOffset);
  }

  constructor(header, frame, samples) {
    super(header, frame, samples);
  }

}

exports.default = AACFrame;

},{"../CodecFrame.js":8,"./AACHeader.js":13}],13:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _globals = require("../../globals.js");

var _utilities = require("../../utilities.js");

var _constants = require("../../constants.js");

var _CodecHeader = _interopRequireDefault(require("../CodecHeader.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of codec-parser.
    
    codec-parser is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    codec-parser is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/

/*
https://wiki.multimedia.cx/index.php/ADTS

AAAAAAAA AAAABCCD EEFFFFGH HHIJKLMM MMMMMMMM MMMOOOOO OOOOOOPP (QQQQQQQQ QQQQQQQQ)

AACHeader consists of 7 or 9 bytes (without or with CRC).
Letter  Length (bits)  Description
A  12  syncword 0xFFF, all bits must be 1
B  1   MPEG Version: 0 for MPEG-4, 1 for MPEG-2
C  2   Layer: always 0
D  1   protection absent, Warning, set to 1 if there is no CRC and 0 if there is CRC
E  2   profile, the MPEG-4 Audio Object Type minus 1
F  4   MPEG-4 Sampling Frequency Index (15 is forbidden)
G  1   private bit, guaranteed never to be used by MPEG, set to 0 when encoding, ignore when decoding
H  3   MPEG-4 Channel Configuration (in the case of 0, the channel configuration is sent via an inband PCE)
I  1   originality, set to 0 when encoding, ignore when decoding
J  1   home, set to 0 when encoding, ignore when decoding
K  1   copyrighted id bit, the next bit of a centrally registered copyright identifier, set to 0 when encoding, ignore when decoding
L  1   copyright id start, signals that this frame's copyright id bit is the first bit of the copyright id, set to 0 when encoding, ignore when decoding
M  13  frame length, this value must include 7 or 9 bytes of header length: FrameLength = (ProtectionAbsent == 1 ? 7 : 9) + size(AACFrame)
O  11  Buffer fullness // 0x7FF for VBR
P  2   Number of AAC frames (RDBs) in ADTS frame minus 1, for maximum compatibility always use 1 AAC frame per ADTS frame
Q  16  CRC if protection absent is 0 
*/
const mpegVersion = {
  0b00000000: "MPEG-4",
  0b00001000: "MPEG-2"
};
const layer = {
  0b00000000: "valid",
  0b00000010: _constants.bad,
  0b00000100: _constants.bad,
  0b00000110: _constants.bad
};
const protection = {
  0b00000000: _constants.sixteenBitCRC,
  0b00000001: _constants.none
};
const profile = {
  0b00000000: "AAC Main",
  0b01000000: "AAC LC (Low Complexity)",
  0b10000000: "AAC SSR (Scalable Sample Rate)",
  0b11000000: "AAC LTP (Long Term Prediction)"
};
const sampleRates = {
  0b00000000: _constants.rate96000,
  0b00000100: _constants.rate88200,
  0b00001000: _constants.rate64000,
  0b00001100: _constants.rate48000,
  0b00010000: _constants.rate44100,
  0b00010100: _constants.rate32000,
  0b00011000: _constants.rate24000,
  0b00011100: _constants.rate22050,
  0b00100000: _constants.rate16000,
  0b00100100: _constants.rate12000,
  0b00101000: _constants.rate11025,
  0b00101100: _constants.rate8000,
  0b00110000: _constants.rate7350,
  0b00110100: _constants.reserved,
  0b00111000: _constants.reserved,
  0b00111100: "frequency is written explicitly"
}; // prettier-ignore

const channelMode = {
  0b000000000: {
    channels: 0,
    description: "Defined in AOT Specific Config"
  },

  /*
  'monophonic (mono)'
  'stereo (left, right)'
  'linear surround (front center, front left, front right)'
  'quadraphonic (front center, front left, front right, rear center)'
  '5.0 surround (front center, front left, front right, rear left, rear right)'
  '5.1 surround (front center, front left, front right, rear left, rear right, LFE)'
  '7.1 surround (front center, front left, front right, side left, side right, rear left, rear right, LFE)'
  */
  0b001000000: {
    channels: 1,
    description: _constants.monophonic
  },
  0b010000000: {
    channels: 2,
    description: (0, _constants.getChannelMapping)(2, _constants.channelMappings[0][0])
  },
  0b011000000: {
    channels: 3,
    description: (0, _constants.getChannelMapping)(3, _constants.channelMappings[1][3])
  },
  0b100000000: {
    channels: 4,
    description: (0, _constants.getChannelMapping)(4, _constants.channelMappings[1][3], _constants.channelMappings[3][4])
  },
  0b101000000: {
    channels: 5,
    description: (0, _constants.getChannelMapping)(5, _constants.channelMappings[1][3], _constants.channelMappings[3][0])
  },
  0b110000000: {
    channels: 6,
    description: (0, _constants.getChannelMapping)(6, _constants.channelMappings[1][3], _constants.channelMappings[3][0], _constants.lfe)
  },
  0b111000000: {
    channels: 8,
    description: (0, _constants.getChannelMapping)(8, _constants.channelMappings[1][3], _constants.channelMappings[2][0], _constants.channelMappings[3][0], _constants.lfe)
  }
};

class AACHeader extends _CodecHeader.default {
  static *getHeader(codecParser, headerCache, readOffset) {
    const header = {}; // Must be at least seven bytes. Out of data

    const data = yield* codecParser.readRawData(7, readOffset); // Check header cache

    const key = (0, _utilities.bytesToString)([data[0], data[1], data[2], data[3] & 0b11111100 | data[6] & 0b00000011 // frame length, buffer fullness varies so don't cache it
    ]);
    const cachedHeader = headerCache.getHeader(key);

    if (!cachedHeader) {
      // Frame sync (all bits must be set): `11111111|1111`:
      if (data[0] !== 0xff || data[1] < 0xf0) return null; // Byte (2 of 7)
      // * `1111BCCD`
      // * `....B...`: MPEG Version: 0 for MPEG-4, 1 for MPEG-2
      // * `.....CC.`: Layer: always 0
      // * `.......D`: protection absent, Warning, set to 1 if there is no CRC and 0 if there is CRC

      header.mpegVersion = mpegVersion[data[1] & 0b00001000];
      header.layer = layer[data[1] & 0b00000110];
      if (header.layer === _constants.bad) return null;
      const protectionBit = data[1] & 0b00000001;
      header.protection = protection[protectionBit];
      header.length = protectionBit ? 7 : 9; // Byte (3 of 7)
      // * `EEFFFFGH`
      // * `EE......`: profile, the MPEG-4 Audio Object Type minus 1
      // * `..FFFF..`: MPEG-4 Sampling Frequency Index (15 is forbidden)
      // * `......G.`: private bit, guaranteed never to be used by MPEG, set to 0 when encoding, ignore when decoding

      header.profileBits = data[2] & 0b11000000;
      header.sampleRateBits = data[2] & 0b00111100;
      const privateBit = data[2] & 0b00000010;
      header.profile = profile[header.profileBits];
      header.sampleRate = sampleRates[header.sampleRateBits];
      if (header.sampleRate === _constants.reserved) return null;
      header.isPrivate = Boolean(privateBit); // Byte (3,4 of 7)
      // * `.......H|HH......`: MPEG-4 Channel Configuration (in the case of 0, the channel configuration is sent via an inband PCE)

      header.channelModeBits = (data[2] << 8 | data[3]) & 0b111000000;
      header.channelMode = channelMode[header.channelModeBits].description;
      header.channels = channelMode[header.channelModeBits].channels; // Byte (4 of 7)
      // * `HHIJKLMM`
      // * `..I.....`: originality, set to 0 when encoding, ignore when decoding
      // * `...J....`: home, set to 0 when encoding, ignore when decoding
      // * `....K...`: copyrighted id bit, the next bit of a centrally registered copyright identifier, set to 0 when encoding, ignore when decoding
      // * `.....L..`: copyright id start, signals that this frame's copyright id bit is the first bit of the copyright id, set to 0 when encoding, ignore when decoding

      header.isOriginal = Boolean(data[3] & 0b00100000);
      header.isHome = Boolean(data[3] & 0b00001000);
      header.copyrightId = Boolean(data[3] & 0b00001000);
      header.copyrightIdStart = Boolean(data[3] & 0b00000100);
      header.bitDepth = 16;
      header.samples = 1024; // Byte (7 of 7)
      // * `......PP` Number of AAC frames (RDBs) in ADTS frame minus 1, for maximum compatibility always use 1 AAC frame per ADTS frame

      header.numberAACFrames = data[6] & 0b00000011;
      const {
        length,
        channelModeBits,
        profileBits,
        sampleRateBits,
        frameLength,
        samples,
        numberAACFrames,
        ...codecUpdateFields
      } = header;
      headerCache.setHeader(key, header, codecUpdateFields);
    } else {
      Object.assign(header, cachedHeader);
    } // Byte (4,5,6 of 7)
    // * `.......MM|MMMMMMMM|MMM.....`: frame length, this value must include 7 or 9 bytes of header length: FrameLength = (ProtectionAbsent == 1 ? 7 : 9) + size(AACFrame)


    header.frameLength = (data[3] << 11 | data[4] << 3 | data[5] >> 5) & 0x1fff;
    if (!header.frameLength) return null; // Byte (6,7 of 7)
    // * `...OOOOO|OOOOOO..`: Buffer fullness

    const bufferFullnessBits = (data[5] << 6 | data[6] >> 2) & 0x7ff;
    header.bufferFullness = bufferFullnessBits === 0x7ff ? "VBR" : bufferFullnessBits;
    return new AACHeader(header);
  }
  /**
   * @private
   * Call AACHeader.getHeader(Array<Uint8>) to get instance
   */


  constructor(header) {
    super(header);
    this.copyrightId = header.copyrightId;
    this.copyrightIdStart = header.copyrightIdStart;
    this.bufferFullness = header.bufferFullness;
    this.isHome = header.isHome;
    this.isOriginal = header.isOriginal;
    this.isPrivate = header.isPrivate;
    this.layer = header.layer;
    this.length = header.length;
    this.mpegVersion = header.mpegVersion;
    this.numberAACFrames = header.numberAACFrames;
    this.profile = header.profile;
    this.protection = header.protection;
  }

  get audioSpecificConfig() {
    // Audio Specific Configuration
    // * `000EEFFF|F0HHH000`:
    // * `000EE...|........`: Object Type (profileBit + 1)
    // * `.....FFF|F.......`: Sample Rate
    // * `........|.0HHH...`: Channel Configuration
    // * `........|.....0..`: Frame Length (1024)
    // * `........|......0.`: does not depend on core coder
    // * `........|.......0`: Not Extension
    const header = _globals.headerStore.get(this);

    const audioSpecificConfig = header.profileBits + 0x40 << 5 | header.sampleRateBits << 5 | header.channelModeBits >> 3;
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, audioSpecificConfig, false);
    return bytes;
  }

}

exports.default = AACHeader;

},{"../../constants.js":27,"../../globals.js":32,"../../utilities.js":34,"../CodecHeader.js":9}],14:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _Parser = _interopRequireDefault(require("../Parser.js"));

var _AACFrame = _interopRequireDefault(require("./AACFrame.js"));

var _AACHeader = _interopRequireDefault(require("./AACHeader.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of codec-parser.
    
    codec-parser is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    codec-parser is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
class AACParser extends _Parser.default {
  constructor(codecParser, headerCache, onCodec) {
    super(codecParser, headerCache);
    this.Frame = _AACFrame.default;
    this.Header = _AACHeader.default;
    onCodec(this.codec);
  }

  get codec() {
    return "aac";
  }

  *parseFrame() {
    return yield* this.fixedLengthFrameSync();
  }

}

exports.default = AACParser;

},{"../Parser.js":11,"./AACFrame.js":12,"./AACHeader.js":13}],15:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _globals = require("../../globals.js");

var _utilities = require("../../utilities.js");

var _CodecFrame = _interopRequireDefault(require("../CodecFrame.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of codec-parser.
    
    codec-parser is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    codec-parser is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
class FLACFrame extends _CodecFrame.default {
  static getFrameFooterCrc16(data) {
    return (data[data.length - 2] << 8) + data[data.length - 1];
  } // check frame footer crc
  // https://xiph.org/flac/format.html#frame_footer


  static checkFrameFooterCrc16(data) {
    const expectedCrc16 = FLACFrame.getFrameFooterCrc16(data);
    const actualCrc16 = (0, _utilities.flacCrc16)(data.subarray(0, -2));
    return expectedCrc16 === actualCrc16;
  }

  constructor(data, header, streamInfo) {
    header.streamInfo = streamInfo;
    header.crc16 = FLACFrame.getFrameFooterCrc16(data);
    super(header, data, _globals.headerStore.get(header).samples);
  }

}

exports.default = FLACFrame;

},{"../../globals.js":32,"../../utilities.js":34,"../CodecFrame.js":8}],16:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _constants = require("../../constants.js");

var _utilities = require("../../utilities.js");

var _CodecHeader = _interopRequireDefault(require("../CodecHeader.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of codec-parser.
    
    codec-parser is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    codec-parser is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/

/*
https://xiph.org/flac/format.html

AAAAAAAA AAAAAABC DDDDEEEE FFFFGGGH 
(IIIIIIII...)
(JJJJJJJJ|JJJJJJJJ)
(KKKKKKKK|KKKKKKKK)
LLLLLLLLL

FLAC Frame Header
Letter  Length (bits)  Description
A   13  11111111|11111
B   1   Reserved 0 - mandatory, 1 - reserved
C   1   Blocking strategy, 0 - fixed, 1 - variable
D   4   Block size in inter-channel samples
E   4   Sample rate
F   4   Channel assignment
G   3   Sample size in bits
H   1   Reserved 0 - mandatory, 1 - reserved
I   ?   if(variable blocksize)
           <8-56>:"UTF-8" coded sample number (decoded number is 36 bits) [4]
        else
           <8-48>:"UTF-8" coded frame number (decoded number is 31 bits) [4]
J   ?   if(blocksize bits == 011x)
            8/16 bit (blocksize-1)
K   ?   if(sample rate bits == 11xx)
            8/16 bit sample rate
L   8   CRC-8 (polynomial = x^8 + x^2 + x^1 + x^0, initialized with 0) of everything before the crc, including the sync code
        
*/
const getFromStreamInfo = "get from STREAMINFO metadata block";
const blockingStrategy = {
  0b00000000: "Fixed",
  0b00000001: "Variable"
};
const blockSize = {
  0b00000000: _constants.reserved,
  0b00010000: 192 // 0b00100000: 576,
  // 0b00110000: 1152,
  // 0b01000000: 2304,
  // 0b01010000: 4608,
  // 0b01100000: "8-bit (blocksize-1) from end of header",
  // 0b01110000: "16-bit (blocksize-1) from end of header",
  // 0b10000000: 256,
  // 0b10010000: 512,
  // 0b10100000: 1024,
  // 0b10110000: 2048,
  // 0b11000000: 4096,
  // 0b11010000: 8192,
  // 0b11100000: 16384,
  // 0b11110000: 32768,

};

for (let i = 2; i < 16; i++) blockSize[i << 4] = i < 6 ? 576 * 2 ** (i - 2) : 2 ** i;

const sampleRate = {
  0b00000000: getFromStreamInfo,
  0b00000001: _constants.rate88200,
  0b00000010: _constants.rate176400,
  0b00000011: _constants.rate192000,
  0b00000100: _constants.rate8000,
  0b00000101: _constants.rate16000,
  0b00000110: _constants.rate22050,
  0b00000111: _constants.rate24000,
  0b00001000: _constants.rate32000,
  0b00001001: _constants.rate44100,
  0b00001010: _constants.rate48000,
  0b00001011: _constants.rate96000,
  // 0b00001100: "8-bit sample rate (in kHz) from end of header",
  // 0b00001101: "16-bit sample rate (in Hz) from end of header",
  // 0b00001110: "16-bit sample rate (in tens of Hz) from end of header",
  0b00001111: _constants.bad
};
/* prettier-ignore */

const channelAssignments = {
  /*'
  'monophonic (mono)'
  'stereo (left, right)'
  'linear surround (left, right, center)'
  'quadraphonic (front left, front right, rear left, rear right)'
  '5.0 surround (front left, front right, front center, rear left, rear right)'
  '5.1 surround (front left, front right, front center, LFE, rear left, rear right)'
  '6.1 surround (front left, front right, front center, LFE, rear center, side left, side right)'
  '7.1 surround (front left, front right, front center, LFE, rear left, rear right, side left, side right)'
  */
  0b00000000: {
    channels: 1,
    description: _constants.monophonic
  },
  0b00010000: {
    channels: 2,
    description: (0, _constants.getChannelMapping)(2, _constants.channelMappings[0][0])
  },
  0b00100000: {
    channels: 3,
    description: (0, _constants.getChannelMapping)(3, _constants.channelMappings[0][1])
  },
  0b00110000: {
    channels: 4,
    description: (0, _constants.getChannelMapping)(4, _constants.channelMappings[1][0], _constants.channelMappings[3][0])
  },
  0b01000000: {
    channels: 5,
    description: (0, _constants.getChannelMapping)(5, _constants.channelMappings[1][1], _constants.channelMappings[3][0])
  },
  0b01010000: {
    channels: 6,
    description: (0, _constants.getChannelMapping)(6, _constants.channelMappings[1][1], _constants.lfe, _constants.channelMappings[3][0])
  },
  0b01100000: {
    channels: 7,
    description: (0, _constants.getChannelMapping)(7, _constants.channelMappings[1][1], _constants.lfe, _constants.channelMappings[3][4], _constants.channelMappings[2][0])
  },
  0b01110000: {
    channels: 8,
    description: (0, _constants.getChannelMapping)(8, _constants.channelMappings[1][1], _constants.lfe, _constants.channelMappings[3][0], _constants.channelMappings[2][0])
  },
  0b10000000: {
    channels: 2,
    description: `${_constants.stereo} (left, diff)`
  },
  0b10010000: {
    channels: 2,
    description: `${_constants.stereo} (diff, right)`
  },
  0b10100000: {
    channels: 2,
    description: `${_constants.stereo} (avg, diff)`
  },
  0b10110000: _constants.reserved,
  0b11000000: _constants.reserved,
  0b11010000: _constants.reserved,
  0b11100000: _constants.reserved,
  0b11110000: _constants.reserved
};
const bitDepth = {
  0b00000000: getFromStreamInfo,
  0b00000010: 8,
  0b00000100: 12,
  0b00000110: _constants.reserved,
  0b00001000: 16,
  0b00001010: 20,
  0b00001100: 24,
  0b00001110: _constants.reserved
};

class FLACHeader extends _CodecHeader.default {
  // https://datatracker.ietf.org/doc/html/rfc3629#section-3
  //    Char. number range  |        UTF-8 octet sequence
  //    (hexadecimal)    |              (binary)
  // --------------------+---------------------------------------------
  // 0000 0000-0000 007F | 0xxxxxxx
  // 0000 0080-0000 07FF | 110xxxxx 10xxxxxx
  // 0000 0800-0000 FFFF | 1110xxxx 10xxxxxx 10xxxxxx
  // 0001 0000-0010 FFFF | 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx
  static decodeUTF8Int(data) {
    if (data[0] > 0xfe) {
      return null; // length byte must have at least one zero as the lsb
    }

    if (data[0] < 0x80) return {
      value: data[0],
      length: 1
    }; // get length by counting the number of msb that are set to 1

    let length = 1;

    for (let zeroMask = 0x40; zeroMask & data[0]; zeroMask >>= 1) length++;

    let idx = length - 1,
        value = 0,
        shift = 0; // sum together the encoded bits in bytes 2 to length
    // 1110xxxx 10[cccccc] 10[bbbbbb] 10[aaaaaa]
    //
    //    value = [cccccc] | [bbbbbb] | [aaaaaa]

    for (; idx > 0; shift += 6, idx--) {
      if ((data[idx] & 0xc0) !== 0x80) {
        return null; // each byte should have leading 10xxxxxx
      }

      value |= (data[idx] & 0x3f) << shift; // add the encoded bits
    } // read the final encoded bits in byte 1
    //     1110[dddd] 10[cccccc] 10[bbbbbb] 10[aaaaaa]
    //
    // value = [dddd] | [cccccc] | [bbbbbb] | [aaaaaa]


    value |= (data[idx] & 0x7f >> length) << shift;
    return {
      value,
      length
    };
  }

  static getHeaderFromUint8Array(data, headerCache) {
    const codecParserStub = {
      readRawData: function* () {
        return data;
      }
    };
    return FLACHeader.getHeader(codecParserStub, headerCache, 0).next().value;
  }

  static *getHeader(codecParser, headerCache, readOffset) {
    // Must be at least 6 bytes.
    let data = yield* codecParser.readRawData(6, readOffset); // Bytes (1-2 of 6)
    // * `11111111|111110..`: Frame sync
    // * `........|......0.`: Reserved 0 - mandatory, 1 - reserved

    if (data[0] !== 0xff || !(data[1] === 0xf8 || data[1] === 0xf9)) {
      return null;
    }

    const header = {}; // Check header cache

    const key = (0, _utilities.bytesToString)(data.subarray(0, 4));
    const cachedHeader = headerCache.getHeader(key);

    if (!cachedHeader) {
      // Byte (2 of 6)
      // * `.......C`: Blocking strategy, 0 - fixed, 1 - variable
      header.blockingStrategyBits = data[1] & 0b00000001;
      header.blockingStrategy = blockingStrategy[header.blockingStrategyBits]; // Byte (3 of 6)
      // * `DDDD....`: Block size in inter-channel samples
      // * `....EEEE`: Sample rate

      header.blockSizeBits = data[2] & 0b11110000;
      header.sampleRateBits = data[2] & 0b00001111;
      header.blockSize = blockSize[header.blockSizeBits];

      if (header.blockSize === _constants.reserved) {
        return null;
      }

      header.sampleRate = sampleRate[header.sampleRateBits];

      if (header.sampleRate === _constants.bad) {
        return null;
      } // Byte (4 of 6)
      // * `FFFF....`: Channel assignment
      // * `....GGG.`: Sample size in bits
      // * `.......H`: Reserved 0 - mandatory, 1 - reserved


      if (data[3] & 0b00000001) {
        return null;
      }

      const channelAssignment = channelAssignments[data[3] & 0b11110000];

      if (channelAssignment === _constants.reserved) {
        return null;
      }

      header.channels = channelAssignment.channels;
      header.channelMode = channelAssignment.description;
      header.bitDepth = bitDepth[data[3] & 0b00001110];

      if (header.bitDepth === _constants.reserved) {
        return null;
      }
    } else {
      Object.assign(header, cachedHeader);
    } // Byte (5...)
    // * `IIIIIIII|...`: VBR block size ? sample number : frame number


    header.length = 5; // check if there is enough data to parse UTF8

    data = yield* codecParser.readRawData(header.length + 8, readOffset);
    const decodedUtf8 = FLACHeader.decodeUTF8Int(data.subarray(4));

    if (!decodedUtf8) {
      return null;
    }

    if (header.blockingStrategyBits) {
      header.sampleNumber = decodedUtf8.value;
    } else {
      header.frameNumber = decodedUtf8.value;
    }

    header.length += decodedUtf8.length; // Byte (...)
    // * `JJJJJJJJ|(JJJJJJJJ)`: Blocksize (8/16bit custom value)

    if (header.blockSizeBits === 0b01100000) {
      // 8 bit
      if (data.length < header.length) data = yield* codecParser.readRawData(header.length, readOffset);
      header.blockSize = data[header.length - 1] + 1;
      header.length += 1;
    } else if (header.blockSizeBits === 0b01110000) {
      // 16 bit
      if (data.length < header.length) data = yield* codecParser.readRawData(header.length, readOffset);
      header.blockSize = (data[header.length - 1] << 8) + data[header.length] + 1;
      header.length += 2;
    }

    header.samples = header.blockSize; // Byte (...)
    // * `KKKKKKKK|(KKKKKKKK)`: Sample rate (8/16bit custom value)

    if (header.sampleRateBits === 0b00001100) {
      // 8 bit
      if (data.length < header.length) data = yield* codecParser.readRawData(header.length, readOffset);
      header.sampleRate = data[header.length - 1] * 1000;
      header.length += 1;
    } else if (header.sampleRateBits === 0b00001101) {
      // 16 bit
      if (data.length < header.length) data = yield* codecParser.readRawData(header.length, readOffset);
      header.sampleRate = (data[header.length - 1] << 8) + data[header.length];
      header.length += 2;
    } else if (header.sampleRateBits === 0b00001110) {
      // 16 bit
      if (data.length < header.length) data = yield* codecParser.readRawData(header.length, readOffset);
      header.sampleRate = ((data[header.length - 1] << 8) + data[header.length]) * 10;
      header.length += 2;
    } // Byte (...)
    // * `LLLLLLLL`: CRC-8


    if (data.length < header.length) data = yield* codecParser.readRawData(header.length, readOffset);
    header.crc = data[header.length - 1];

    if (header.crc !== (0, _utilities.crc8)(data.subarray(0, header.length - 1))) {
      return null;
    }

    if (!cachedHeader) {
      const {
        blockingStrategyBits,
        frameNumber,
        sampleNumber,
        samples,
        sampleRateBits,
        blockSizeBits,
        crc,
        length,
        ...codecUpdateFields
      } = header;
      headerCache.setHeader(key, header, codecUpdateFields);
    }

    return new FLACHeader(header);
  }
  /**
   * @private
   * Call FLACHeader.getHeader(Array<Uint8>) to get instance
   */


  constructor(header) {
    super(header);
    this.crc16 = null; // set in FLACFrame

    this.blockingStrategy = header.blockingStrategy;
    this.blockSize = header.blockSize;
    this.frameNumber = header.frameNumber;
    this.sampleNumber = header.sampleNumber;
    this.streamInfo = null; // set during ogg parsing
  }

}

exports.default = FLACHeader;

},{"../../constants.js":27,"../../utilities.js":34,"../CodecHeader.js":9}],17:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _globals = require("../../globals.js");

var _Parser = _interopRequireDefault(require("../Parser.js"));

var _FLACFrame = _interopRequireDefault(require("./FLACFrame.js"));

var _FLACHeader = _interopRequireDefault(require("./FLACHeader.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of codec-parser.
    
    codec-parser is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    codec-parser is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
const MIN_FLAC_FRAME_SIZE = 2;
const MAX_FLAC_FRAME_SIZE = 512 * 1024;

class FLACParser extends _Parser.default {
  constructor(codecParser, onCodecUpdate) {
    super(codecParser, onCodecUpdate);
    this.Frame = _FLACFrame.default;
    this.Header = _FLACHeader.default;
  }

  get codec() {
    return "flac";
  }

  *_getNextFrameSyncOffset(offset) {
    const data = yield* this._codecParser.readRawData(2, 0);
    const dataLength = data.length - 2;

    while (offset < dataLength) {
      // * `11111111|111110..`: Frame sync
      // * `........|......0.`: Reserved 0 - mandatory, 1 - reserved
      const firstByte = data[offset];

      if (firstByte === 0xff) {
        const secondByte = data[offset + 1];
        if (secondByte === 0xf8 || secondByte === 0xf9) break;
        if (secondByte !== 0xff) offset++; // might as well check for the next sync byte
      }

      offset++;
    }

    return offset;
  }

  *parseFrame() {
    // find the first valid frame header
    do {
      const header = yield* _FLACHeader.default.getHeader(this._codecParser, this._headerCache, 0);

      if (header) {
        // found a valid frame header
        // find the next valid frame header
        let nextHeaderOffset = _globals.headerStore.get(header).length + MIN_FLAC_FRAME_SIZE;

        while (nextHeaderOffset <= MAX_FLAC_FRAME_SIZE) {
          if (this._codecParser._flushing || (yield* _FLACHeader.default.getHeader(this._codecParser, this._headerCache, nextHeaderOffset))) {
            // found a valid next frame header
            let frameData = yield* this._codecParser.readRawData(nextHeaderOffset);
            if (!this._codecParser._flushing) frameData = frameData.subarray(0, nextHeaderOffset); // check that this is actually the next header by validating the frame footer crc16

            if (_FLACFrame.default.checkFrameFooterCrc16(frameData)) {
              // both frame headers, and frame footer crc16 are valid, we are synced (odds are pretty low of a false positive)
              const frame = new _FLACFrame.default(frameData, header);

              this._headerCache.enable(); // start caching when synced


              this._codecParser.incrementRawData(nextHeaderOffset); // increment to the next frame


              this._codecParser.mapFrameStats(frame);

              return frame;
            }
          }

          nextHeaderOffset = yield* this._getNextFrameSyncOffset(nextHeaderOffset + 1);
        }

        this._codecParser.logWarning(`Unable to sync FLAC frame after searching ${nextHeaderOffset} bytes.`);

        this._codecParser.incrementRawData(nextHeaderOffset);
      } else {
        // not synced, increment data to continue syncing
        this._codecParser.incrementRawData(yield* this._getNextFrameSyncOffset(1));
      }
    } while (true);
  }

  parseOggPage(oggPage) {
    if (oggPage.pageSequenceNumber === 0) {
      // Identification header
      this._headerCache.enable();

      this._streamInfo = oggPage.data.subarray(13);
    } else if (oggPage.pageSequenceNumber === 1) {// Vorbis comments
    } else {
      oggPage.codecFrames = _globals.frameStore.get(oggPage).segments.map(segment => {
        const header = _FLACHeader.default.getHeaderFromUint8Array(segment, this._headerCache);

        if (header) {
          return new _FLACFrame.default(segment, header, this._streamInfo);
        } else {
          this._codecParser.logWarning("Failed to parse Ogg FLAC frame", "Skipping invalid FLAC frame");
        }
      }).filter(frame => Boolean(frame));
    }

    return oggPage;
  }

}

exports.default = FLACParser;

},{"../../globals.js":32,"../Parser.js":11,"./FLACFrame.js":15,"./FLACHeader.js":16}],18:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _CodecFrame = _interopRequireDefault(require("../CodecFrame.js"));

var _MPEGHeader = _interopRequireDefault(require("./MPEGHeader.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of codec-parser.
    
    codec-parser is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    codec-parser is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
class MPEGFrame extends _CodecFrame.default {
  static *getFrame(codecParser, headerCache, readOffset) {
    return yield* super.getFrame(_MPEGHeader.default, MPEGFrame, codecParser, headerCache, readOffset);
  }

  constructor(header, frame, samples) {
    super(header, frame, samples);
  }

}

exports.default = MPEGFrame;

},{"../CodecFrame.js":8,"./MPEGHeader.js":19}],19:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _constants = require("../../constants.js");

var _utilities = require("../../utilities.js");

var _ID3v = _interopRequireDefault(require("../../metadata/ID3v2.js"));

var _CodecHeader = _interopRequireDefault(require("../CodecHeader.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of codec-parser.
    
    codec-parser is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    codec-parser is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
// http://www.mp3-tech.org/programmer/frame_header.html
const bitrateMatrix = {
  // bits | V1,L1 | V1,L2 | V1,L3 | V2,L1 | V2,L2 & L3
  0b00000000: [_constants.free, _constants.free, _constants.free, _constants.free, _constants.free],
  0b00010000: [32, 32, 32, 32, 8],
  // 0b00100000: [64,   48,  40,  48,  16,],
  // 0b00110000: [96,   56,  48,  56,  24,],
  // 0b01000000: [128,  64,  56,  64,  32,],
  // 0b01010000: [160,  80,  64,  80,  40,],
  // 0b01100000: [192,  96,  80,  96,  48,],
  // 0b01110000: [224, 112,  96, 112,  56,],
  // 0b10000000: [256, 128, 112, 128,  64,],
  // 0b10010000: [288, 160, 128, 144,  80,],
  // 0b10100000: [320, 192, 160, 160,  96,],
  // 0b10110000: [352, 224, 192, 176, 112,],
  // 0b11000000: [384, 256, 224, 192, 128,],
  // 0b11010000: [416, 320, 256, 224, 144,],
  // 0b11100000: [448, 384, 320, 256, 160,],
  0b11110000: [_constants.bad, _constants.bad, _constants.bad, _constants.bad, _constants.bad]
};

const calcBitrate = (idx, interval, intervalOffset) => 8 * ((idx + intervalOffset) % interval + interval) * (1 << (idx + intervalOffset) / interval) - 8 * interval * (interval / 8 | 0); // generate bitrate matrix


for (let i = 2; i < 15; i++) bitrateMatrix[i << 4] = [i * 32, //                V1,L1
calcBitrate(i, 4, 0), //  V1,L2
calcBitrate(i, 4, -1), // V1,L3
calcBitrate(i, 8, 4), //  V2,L1
calcBitrate(i, 8, 0) //  V2,L2 & L3
];

const v1Layer1 = 0;
const v1Layer2 = 1;
const v1Layer3 = 2;
const v2Layer1 = 3;
const v2Layer23 = 4;
const bands = "bands ";
const to31 = " to 31";
const layer12ModeExtensions = {
  0b00000000: bands + 4 + to31,
  0b00010000: bands + 8 + to31,
  0b00100000: bands + 12 + to31,
  0b00110000: bands + 16 + to31
};
const intensityStereo = "Intensity stereo ";
const msStereo = ", MS stereo ";
const on = "on";
const off = "off";
const layer3ModeExtensions = {
  0b00000000: intensityStereo + off + msStereo + off,
  0b00010000: intensityStereo + on + msStereo + off,
  0b00100000: intensityStereo + off + msStereo + on,
  0b00110000: intensityStereo + on + msStereo + on
};
const layer = "Layer ";
const layers = {
  0b00000000: {
    description: _constants.reserved
  },
  0b00000010: {
    description: "Layer III",
    framePadding: 1,
    modeExtensions: layer3ModeExtensions,
    v1: {
      bitrateIndex: v1Layer3,
      samples: 1152
    },
    v2: {
      bitrateIndex: v2Layer23,
      samples: 576
    }
  },
  0b00000100: {
    description: "Layer II",
    framePadding: 1,
    modeExtensions: layer12ModeExtensions,
    samples: 1152,
    v1: {
      bitrateIndex: v1Layer2
    },
    v2: {
      bitrateIndex: v2Layer23
    }
  },
  0b00000110: {
    description: "Layer I",
    framePadding: 4,
    modeExtensions: layer12ModeExtensions,
    samples: 384,
    v1: {
      bitrateIndex: v1Layer1
    },
    v2: {
      bitrateIndex: v2Layer1
    }
  }
};
const mpegVersion = "MPEG Version ";
const isoIec = "ISO/IEC ";
const v2 = "v2";
const v1 = "v1";
const mpegVersions = {
  0b00000000: {
    description: `${mpegVersion}2.5 (later extension of MPEG 2)`,
    layers: v2,
    sampleRates: {
      0b00000000: _constants.rate11025,
      0b00000100: _constants.rate12000,
      0b00001000: _constants.rate8000,
      0b00001100: _constants.reserved
    }
  },
  0b00001000: {
    description: _constants.reserved
  },
  0b00010000: {
    description: `${mpegVersion}2 (${isoIec}13818-3)`,
    layers: v2,
    sampleRates: {
      0b00000000: _constants.rate22050,
      0b00000100: _constants.rate24000,
      0b00001000: _constants.rate16000,
      0b00001100: _constants.reserved
    }
  },
  0b00011000: {
    description: `${mpegVersion}1 (${isoIec}11172-3)`,
    layers: v1,
    sampleRates: {
      0b00000000: _constants.rate44100,
      0b00000100: _constants.rate48000,
      0b00001000: _constants.rate32000,
      0b00001100: _constants.reserved
    }
  }
};
const protection = {
  0b00000000: _constants.sixteenBitCRC,
  0b00000001: _constants.none
};
const emphasis = {
  0b00000000: _constants.none,
  0b00000001: "50/15 ms",
  0b00000010: _constants.reserved,
  0b00000011: "CCIT J.17"
};
const channelModes = {
  0b00000000: {
    channels: 2,
    description: _constants.stereo
  },
  0b01000000: {
    channels: 2,
    description: "joint " + _constants.stereo
  },
  0b10000000: {
    channels: 2,
    description: "dual channel"
  },
  0b11000000: {
    channels: 1,
    description: _constants.monophonic
  }
};

class MPEGHeader extends _CodecHeader.default {
  static *getHeader(codecParser, headerCache, readOffset) {
    const header = {}; // check for id3 header

    const id3v2Header = yield* _ID3v.default.getID3v2Header(codecParser, headerCache, readOffset);

    if (id3v2Header) {
      // throw away the data. id3 parsing is not implemented yet.
      yield* codecParser.readRawData(id3v2Header.length, readOffset);
      codecParser.incrementRawData(id3v2Header.length);
    } // Must be at least four bytes.


    const data = yield* codecParser.readRawData(4, readOffset); // Check header cache

    const key = (0, _utilities.bytesToString)(data.subarray(0, 4));
    const cachedHeader = headerCache.getHeader(key);
    if (cachedHeader) return new MPEGHeader(cachedHeader); // Frame sync (all bits must be set): `11111111|111`:

    if (data[0] !== 0xff || data[1] < 0xe0) return null; // Byte (2 of 4)
    // * `111BBCCD`
    // * `...BB...`: MPEG Audio version ID
    // * `.....CC.`: Layer description
    // * `.......D`: Protection bit (0 - Protected by CRC (16bit CRC follows header), 1 = Not protected)
    // Mpeg version (1, 2, 2.5)

    const mpegVersion = mpegVersions[data[1] & 0b00011000];
    if (mpegVersion.description === _constants.reserved) return null; // Layer (I, II, III)

    const layerBits = data[1] & 0b00000110;
    if (layers[layerBits].description === _constants.reserved) return null;
    const layer = { ...layers[layerBits],
      ...layers[layerBits][mpegVersion.layers]
    };
    header.mpegVersion = mpegVersion.description;
    header.layer = layer.description;
    header.samples = layer.samples;
    header.protection = protection[data[1] & 0b00000001];
    header.length = 4; // Byte (3 of 4)
    // * `EEEEFFGH`
    // * `EEEE....`: Bitrate index. 1111 is invalid, everything else is accepted
    // * `....FF..`: Sample rate
    // * `......G.`: Padding bit, 0=frame not padded, 1=frame padded
    // * `.......H`: Private bit.

    header.bitrate = bitrateMatrix[data[2] & 0b11110000][layer.bitrateIndex];
    if (header.bitrate === _constants.bad) return null;
    header.sampleRate = mpegVersion.sampleRates[data[2] & 0b00001100];
    if (header.sampleRate === _constants.reserved) return null;
    header.framePadding = data[2] & 0b00000010 && layer.framePadding;
    header.isPrivate = Boolean(data[2] & 0b00000001);
    header.frameLength = Math.floor(125 * header.bitrate * header.samples / header.sampleRate + header.framePadding);
    if (!header.frameLength) return null; // Byte (4 of 4)
    // * `IIJJKLMM`
    // * `II......`: Channel mode
    // * `..JJ....`: Mode extension (only if joint stereo)
    // * `....K...`: Copyright
    // * `.....L..`: Original
    // * `......MM`: Emphasis

    const channelModeBits = data[3] & 0b11000000;
    header.channelMode = channelModes[channelModeBits].description;
    header.channels = channelModes[channelModeBits].channels;
    header.modeExtension = layer.modeExtensions[data[3] & 0b00110000];
    header.isCopyrighted = Boolean(data[3] & 0b00001000);
    header.isOriginal = Boolean(data[3] & 0b00000100);
    header.emphasis = emphasis[data[3] & 0b00000011];
    if (header.emphasis === _constants.reserved) return null;
    header.bitDepth = 16; // set header cache

    const {
      length,
      frameLength,
      samples,
      ...codecUpdateFields
    } = header;
    headerCache.setHeader(key, header, codecUpdateFields);
    return new MPEGHeader(header);
  }
  /**
   * @private
   * Call MPEGHeader.getHeader(Array<Uint8>) to get instance
   */


  constructor(header) {
    super(header);
    this.bitrate = header.bitrate;
    this.emphasis = header.emphasis;
    this.framePadding = header.framePadding;
    this.isCopyrighted = header.isCopyrighted;
    this.isOriginal = header.isOriginal;
    this.isPrivate = header.isPrivate;
    this.layer = header.layer;
    this.modeExtension = header.modeExtension;
    this.mpegVersion = header.mpegVersion;
    this.protection = header.protection;
  }

}

exports.default = MPEGHeader;

},{"../../constants.js":27,"../../metadata/ID3v2.js":33,"../../utilities.js":34,"../CodecHeader.js":9}],20:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _Parser = _interopRequireDefault(require("../Parser.js"));

var _MPEGFrame = _interopRequireDefault(require("./MPEGFrame.js"));

var _MPEGHeader = _interopRequireDefault(require("./MPEGHeader.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of codec-parser.
    
    codec-parser is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    codec-parser is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
class MPEGParser extends _Parser.default {
  constructor(codecParser, headerCache, onCodec) {
    super(codecParser, headerCache);
    this.Frame = _MPEGFrame.default;
    this.Header = _MPEGHeader.default;
    onCodec(this.codec);
  }

  get codec() {
    return "mpeg";
  }

  *parseFrame() {
    return yield* this.fixedLengthFrameSync();
  }

}

exports.default = MPEGParser;

},{"../Parser.js":11,"./MPEGFrame.js":18,"./MPEGHeader.js":19}],21:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _CodecFrame = _interopRequireDefault(require("../CodecFrame.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of codec-parser.
    
    codec-parser is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    codec-parser is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
class OpusFrame extends _CodecFrame.default {
  constructor(data, header) {
    super(header, data, header.frameSize * header.frameCount / 1000 * header.sampleRate);
  }

}

exports.default = OpusFrame;

},{"../CodecFrame.js":8}],22:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _constants = require("../../constants.js");

var _utilities = require("../../utilities.js");

var _CodecHeader = _interopRequireDefault(require("../CodecHeader.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of codec-parser.
    
    codec-parser is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    codec-parser is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/

/*
https://tools.ietf.org/html/rfc7845.html
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|      'O'      |      'p'      |      'u'      |      's'      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|      'H'      |      'e'      |      'a'      |      'd'      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  Version = 1  | Channel Count |           Pre-skip            |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                     Input Sample Rate (Hz)                    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|   Output Gain (Q7.8 in dB)    | Mapping Family|               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+               :
|                                                               |
:               Optional Channel Mapping Table...               :
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+

Letter  Length (bits)  Description
A  64  Magic Signature - OpusHead
B  8   Version number - 00000001
C  8   Output channel count (unsigned)
D  16  Pre-skip (unsigned, little endian)
E  32  Sample rate (unsigned, little endian)
F  16  Output Gain (signed, little endian)
G  8   Channel Mapping family (unsigned)

// if(channel mapping !== 0)
H  8   Stream count (unsigned)
I  8   Coupled Stream Count (unsigned)
J  8*C Channel Mapping
*/

/* prettier-ignore */
const channelMappingFamilies = {
  0b00000000: _constants.vorbisOpusChannelMapping.slice(0, 2),

  /*
  0: "monophonic (mono)"
  1: "stereo (left, right)"
  */
  0b00000001: _constants.vorbisOpusChannelMapping
  /*
  0: "monophonic (mono)"
  1: "stereo (left, right)"
  2: "linear surround (left, center, right)"
  3: "quadraphonic (front left, front right, rear left, rear right)"
  4: "5.0 surround (front left, front center, front right, rear left, rear right)"
  5: "5.1 surround (front left, front center, front right, rear left, rear right, LFE)"
  6: "6.1 surround (front left, front center, front right, side left, side right, rear center, LFE)"
  7: "7.1 surround (front left, front center, front right, side left, side right, rear left, rear right, LFE)"
  */
  // additional channel mappings are user defined

};
const silkOnly = "SILK-only";
const celtOnly = "CELT-only";
const hybrid = "Hybrid";
const narrowBand = "narrowband";
const mediumBand = "medium-band";
const wideBand = "wideband";
const superWideBand = "super-wideband";
const fullBand = "fullband"; //  0 1 2 3 4 5 6 7
// +-+-+-+-+-+-+-+-+
// | config  |s| c |
// +-+-+-+-+-+-+-+-+

const configTable = {
  0b00000000: {
    mode: silkOnly,
    bandwidth: narrowBand,
    frameSize: 10
  },
  0b00001000: {
    mode: silkOnly,
    bandwidth: narrowBand,
    frameSize: 20
  },
  0b00010000: {
    mode: silkOnly,
    bandwidth: narrowBand,
    frameSize: 40
  },
  0b00011000: {
    mode: silkOnly,
    bandwidth: narrowBand,
    frameSize: 60
  },
  0b00100000: {
    mode: silkOnly,
    bandwidth: mediumBand,
    frameSize: 10
  },
  0b00101000: {
    mode: silkOnly,
    bandwidth: mediumBand,
    frameSize: 20
  },
  0b00110000: {
    mode: silkOnly,
    bandwidth: mediumBand,
    frameSize: 40
  },
  0b00111000: {
    mode: silkOnly,
    bandwidth: mediumBand,
    frameSize: 60
  },
  0b01000000: {
    mode: silkOnly,
    bandwidth: wideBand,
    frameSize: 10
  },
  0b01001000: {
    mode: silkOnly,
    bandwidth: wideBand,
    frameSize: 20
  },
  0b01010000: {
    mode: silkOnly,
    bandwidth: wideBand,
    frameSize: 40
  },
  0b01011000: {
    mode: silkOnly,
    bandwidth: wideBand,
    frameSize: 60
  },
  0b01100000: {
    mode: hybrid,
    bandwidth: superWideBand,
    frameSize: 10
  },
  0b01101000: {
    mode: hybrid,
    bandwidth: superWideBand,
    frameSize: 20
  },
  0b01110000: {
    mode: hybrid,
    bandwidth: fullBand,
    frameSize: 10
  },
  0b01111000: {
    mode: hybrid,
    bandwidth: fullBand,
    frameSize: 20
  },
  0b10000000: {
    mode: celtOnly,
    bandwidth: narrowBand,
    frameSize: 2.5
  },
  0b10001000: {
    mode: celtOnly,
    bandwidth: narrowBand,
    frameSize: 5
  },
  0b10010000: {
    mode: celtOnly,
    bandwidth: narrowBand,
    frameSize: 10
  },
  0b10011000: {
    mode: celtOnly,
    bandwidth: narrowBand,
    frameSize: 20
  },
  0b10100000: {
    mode: celtOnly,
    bandwidth: wideBand,
    frameSize: 2.5
  },
  0b10101000: {
    mode: celtOnly,
    bandwidth: wideBand,
    frameSize: 5
  },
  0b10110000: {
    mode: celtOnly,
    bandwidth: wideBand,
    frameSize: 10
  },
  0b10111000: {
    mode: celtOnly,
    bandwidth: wideBand,
    frameSize: 20
  },
  0b11000000: {
    mode: celtOnly,
    bandwidth: superWideBand,
    frameSize: 2.5
  },
  0b11001000: {
    mode: celtOnly,
    bandwidth: superWideBand,
    frameSize: 5
  },
  0b11010000: {
    mode: celtOnly,
    bandwidth: superWideBand,
    frameSize: 10
  },
  0b11011000: {
    mode: celtOnly,
    bandwidth: superWideBand,
    frameSize: 20
  },
  0b11100000: {
    mode: celtOnly,
    bandwidth: fullBand,
    frameSize: 2.5
  },
  0b11101000: {
    mode: celtOnly,
    bandwidth: fullBand,
    frameSize: 5
  },
  0b11110000: {
    mode: celtOnly,
    bandwidth: fullBand,
    frameSize: 10
  },
  0b11111000: {
    mode: celtOnly,
    bandwidth: fullBand,
    frameSize: 20
  }
};

class OpusHeader extends _CodecHeader.default {
  static getHeaderFromUint8Array(data, packetData, headerCache) {
    const header = {}; // get length of header
    // Byte (10 of 19)
    // * `CCCCCCCC`: Channel Count

    header.channels = data[9]; // Byte (19 of 19)
    // * `GGGGGGGG`: Channel Mapping Family

    header.channelMappingFamily = data[18];
    header.length = header.channelMappingFamily !== 0 ? 21 + header.channels : 19;
    if (data.length < header.length) throw new Error("Out of data while inside an Ogg Page"); // Page Segment Bytes (1-2)
    // * `AAAAA...`: Packet config
    // * `.....B..`:
    // * `......CC`: Packet code

    const packetMode = packetData[0] & 0b00000011;
    const packetLength = packetMode === 3 ? 2 : 1; // Check header cache

    const key = (0, _utilities.bytesToString)(data.subarray(0, header.length)) + (0, _utilities.bytesToString)(packetData.subarray(0, packetLength));
    const cachedHeader = headerCache.getHeader(key);
    if (cachedHeader) return new OpusHeader(cachedHeader); // Bytes (1-8 of 19): OpusHead - Magic Signature

    if (key.substr(0, 8) !== "OpusHead") {
      return null;
    } // Byte (9 of 19)
    // * `00000001`: Version number


    if (data[8] !== 1) return null;
    header.data = Uint8Array.from(data.subarray(0, header.length));
    const view = new DataView(header.data.buffer);
    header.bitDepth = 16; // Byte (10 of 19)
    // * `CCCCCCCC`: Channel Count
    // set earlier to determine length
    // Byte (11-12 of 19)
    // * `DDDDDDDD|DDDDDDDD`: Pre skip

    header.preSkip = view.getUint16(10, true); // Byte (13-16 of 19)
    // * `EEEEEEEE|EEEEEEEE|EEEEEEEE|EEEEEEEE`: Sample Rate

    header.inputSampleRate = view.getUint32(12, true); // Opus is always decoded at 48kHz

    header.sampleRate = _constants.rate48000; // Byte (17-18 of 19)
    // * `FFFFFFFF|FFFFFFFF`: Output Gain

    header.outputGain = view.getInt16(16, true); // Byte (19 of 19)
    // * `GGGGGGGG`: Channel Mapping Family
    // set earlier to determine length

    if (header.channelMappingFamily in channelMappingFamilies) {
      header.channelMode = channelMappingFamilies[header.channelMappingFamily][header.channels - 1];
      if (!header.channelMode) return null;
    }

    if (header.channelMappingFamily !== 0) {
      // * `HHHHHHHH`: Stream count
      header.streamCount = data[19]; // * `IIIIIIII`: Coupled Stream count

      header.coupledStreamCount = data[20]; // * `JJJJJJJJ|...` Channel Mapping table

      header.channelMappingTable = [...data.subarray(21, header.channels + 21)];
    }

    const packetConfig = configTable[0b11111000 & packetData[0]];
    header.mode = packetConfig.mode;
    header.bandwidth = packetConfig.bandwidth;
    header.frameSize = packetConfig.frameSize; // https://tools.ietf.org/html/rfc6716#appendix-B

    switch (packetMode) {
      case 0:
        // 0: 1 frame in the packet
        header.frameCount = 1;
        break;

      case 1: // 1: 2 frames in the packet, each with equal compressed size

      case 2:
        // 2: 2 frames in the packet, with different compressed sizes
        header.frameCount = 2;
        break;

      case 3:
        // 3: an arbitrary number of frames in the packet
        header.isVbr = Boolean(0b10000000 & packetData[1]);
        header.hasOpusPadding = Boolean(0b01000000 & packetData[1]);
        header.frameCount = 0b00111111 & packetData[1];
        break;

      default:
        return null;
    } // set header cache


    const {
      length,
      data: headerData,
      channelMappingFamily,
      ...codecUpdateFields
    } = header;
    headerCache.setHeader(key, header, codecUpdateFields);
    return new OpusHeader(header);
  }
  /**
   * @private
   * Call OpusHeader.getHeader(Array<Uint8>) to get instance
   */


  constructor(header) {
    super(header);
    this.data = header.data;
    this.bandwidth = header.bandwidth;
    this.channelMappingFamily = header.channelMappingFamily;
    this.channelMappingTable = header.channelMappingTable;
    this.coupledStreamCount = header.coupledStreamCount;
    this.frameCount = header.frameCount;
    this.frameSize = header.frameSize;
    this.hasOpusPadding = header.hasOpusPadding;
    this.inputSampleRate = header.inputSampleRate;
    this.isVbr = header.isVbr;
    this.mode = header.mode;
    this.outputGain = header.outputGain;
    this.preSkip = header.preSkip;
    this.streamCount = header.streamCount;
  }

}

exports.default = OpusHeader;

},{"../../constants.js":27,"../../utilities.js":34,"../CodecHeader.js":9}],23:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _globals = require("../../globals.js");

var _Parser = _interopRequireDefault(require("../Parser.js"));

var _OpusFrame = _interopRequireDefault(require("./OpusFrame.js"));

var _OpusHeader = _interopRequireDefault(require("./OpusHeader.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of codec-parser.
    
    codec-parser is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    codec-parser is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
class OpusParser extends _Parser.default {
  constructor(codecParser, headerCache) {
    super(codecParser, headerCache);
    this.Frame = _OpusFrame.default;
    this.Header = _OpusHeader.default;
    this._identificationHeader = null;
  }

  get codec() {
    return "opus";
  }
  /**
   * @todo implement continued page support
   */


  parseOggPage(oggPage) {
    if (oggPage.pageSequenceNumber === 0) {
      // Identification header
      this._headerCache.enable();

      this._identificationHeader = oggPage.data;
    } else if (oggPage.pageSequenceNumber === 1) {// OpusTags
    } else {
      oggPage.codecFrames = _globals.frameStore.get(oggPage).segments.map(segment => {
        const header = _OpusHeader.default.getHeaderFromUint8Array(this._identificationHeader, segment, this._headerCache);

        if (header) return new _OpusFrame.default(segment, header);

        this._codecParser.logError("Failed to parse Ogg Opus Header", "Not a valid Ogg Opus file");
      });
    }

    return oggPage;
  }

}

exports.default = OpusParser;

},{"../../globals.js":32,"../Parser.js":11,"./OpusFrame.js":21,"./OpusHeader.js":22}],24:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _CodecFrame = _interopRequireDefault(require("../CodecFrame.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of codec-parser.
    
    codec-parser is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    codec-parser is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
class VorbisFrame extends _CodecFrame.default {
  constructor(data, header, samples) {
    super(header, data, samples);
  }

}

exports.default = VorbisFrame;

},{"../CodecFrame.js":8}],25:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _constants = require("../../constants.js");

var _utilities = require("../../utilities.js");

var _CodecHeader = _interopRequireDefault(require("../CodecHeader.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of codec-parser.
    
    codec-parser is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    codec-parser is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/

/*

1  1) [packet_type] : 8 bit value
2  2) 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73: the characters ’v’,’o’,’r’,’b’,’i’,’s’ as six octets

Letter bits Description
A      8    Packet type
B      48   Magic signature (vorbis)
C      32   Version number
D      8    Channels
E      32   Sample rate
F      32   Bitrate Maximum (signed)
G      32   Bitrate Nominal (signed)
H      32   Bitrate Minimum (signed)
I      4    blocksize 1
J      4    blocksize 0
K      1    Framing flag
*/
const blockSizes = {// 0b0110: 64,
  // 0b0111: 128,
  // 0b1000: 256,
  // 0b1001: 512,
  // 0b1010: 1024,
  // 0b1011: 2048,
  // 0b1100: 4096,
  // 0b1101: 8192
};

for (let i = 0; i < 8; i++) blockSizes[i + 6] = 2 ** (6 + i);

class VorbisHeader extends _CodecHeader.default {
  static getHeaderFromUint8Array(data, headerCache) {
    // Must be at least 30 bytes.
    if (data.length < 30) throw new Error("Out of data while inside an Ogg Page"); // Check header cache

    const key = (0, _utilities.bytesToString)(data.subarray(0, 30));
    const cachedHeader = headerCache.getHeader(key);
    if (cachedHeader) return new VorbisHeader(cachedHeader);
    const header = {
      length: 30
    }; // Bytes (1-7 of 30): /01vorbis - Magic Signature

    if (key.substr(0, 7) !== "\x01vorbis") {
      return null;
    }

    header.data = Uint8Array.from(data.subarray(0, 30));
    const view = new DataView(header.data.buffer); // Byte (8-11 of 30)
    // * `CCCCCCCC|CCCCCCCC|CCCCCCCC|CCCCCCCC`: Version number

    header.version = view.getUint32(7, true);
    if (header.version !== 0) return null; // Byte (12 of 30)
    // * `DDDDDDDD`: Channel Count

    header.channels = data[11];
    header.channelMode = _constants.vorbisOpusChannelMapping[header.channels - 1] || "application defined"; // Byte (13-16 of 30)
    // * `EEEEEEEE|EEEEEEEE|EEEEEEEE|EEEEEEEE`: Sample Rate

    header.sampleRate = view.getUint32(12, true); // Byte (17-20 of 30)
    // * `FFFFFFFF|FFFFFFFF|FFFFFFFF|FFFFFFFF`: Bitrate Maximum

    header.bitrateMaximum = view.getInt32(16, true); // Byte (21-24 of 30)
    // * `GGGGGGGG|GGGGGGGG|GGGGGGGG|GGGGGGGG`: Bitrate Nominal

    header.bitrateNominal = view.getInt32(20, true); // Byte (25-28 of 30)
    // * `HHHHHHHH|HHHHHHHH|HHHHHHHH|HHHHHHHH`: Bitrate Minimum

    header.bitrateMinimum = view.getInt32(24, true); // Byte (29 of 30)
    // * `IIII....` Blocksize 1
    // * `....JJJJ` Blocksize 0

    header.blocksize1 = blockSizes[(data[28] & 0b11110000) >> 4];
    header.blocksize0 = blockSizes[data[28] & 0b00001111];
    if (header.blocksize0 > header.blocksize1) return null; // Byte (29 of 30)
    // * `00000001` Framing bit

    if (data[29] !== 0x01) return null;
    header.bitDepth = 32;
    {
      // set header cache
      const {
        length,
        data,
        version,
        ...codecUpdateFields
      } = header;
      headerCache.setHeader(key, header, codecUpdateFields);
    }
    return new VorbisHeader(header);
  }
  /**
   * @private
   * Call VorbisHeader.getHeader(Array<Uint8>) to get instance
   */


  constructor(header) {
    super(header);
    this.bitrateMaximum = header.bitrateMaximum;
    this.bitrateMinimum = header.bitrateMinimum;
    this.bitrateNominal = header.bitrateNominal;
    this.blocksize0 = header.blocksize0;
    this.blocksize1 = header.blocksize1;
    this.data = header.data;
    this.vorbisComments = null; // set during ogg parsing

    this.vorbisSetup = null; // set during ogg parsing
  }

}

exports.default = VorbisHeader;

},{"../../constants.js":27,"../../utilities.js":34,"../CodecHeader.js":9}],26:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _globals = require("../../globals.js");

var _utilities = require("../../utilities.js");

var _Parser = _interopRequireDefault(require("../Parser.js"));

var _VorbisFrame = _interopRequireDefault(require("./VorbisFrame.js"));

var _VorbisHeader = _interopRequireDefault(require("./VorbisHeader.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of codec-parser.
    
    codec-parser is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    codec-parser is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
class VorbisParser extends _Parser.default {
  constructor(codecParser, headerCache) {
    super(codecParser, headerCache);
    this.Frame = _VorbisFrame.default;
    this._identificationHeader = null;
    this._mode = {
      count: 0
    };
    this._prevBlockSize = 0;
    this._currBlockSize = 0;
  }

  get codec() {
    return "vorbis";
  }

  parseOggPage(oggPage) {
    const oggPageSegments = _globals.frameStore.get(oggPage).segments;

    if (oggPage.pageSequenceNumber === 0) {
      // Identification header
      this._headerCache.enable();

      this._identificationHeader = oggPage.data;
    } else if (oggPage.pageSequenceNumber === 1) {
      // gather WEBM CodecPrivate data
      if (oggPageSegments[1]) {
        this._vorbisComments = oggPageSegments[0];
        this._vorbisSetup = oggPageSegments[1];
        this._mode = this._parseSetupHeader(oggPageSegments[1]);
      }
    } else {
      oggPage.codecFrames = oggPageSegments.map(segment => {
        const header = _VorbisHeader.default.getHeaderFromUint8Array(this._identificationHeader, this._headerCache);

        if (header) {
          header.vorbisComments = this._vorbisComments;
          header.vorbisSetup = this._vorbisSetup;
          return new _VorbisFrame.default(segment, header, this._getSamples(segment, header));
        }

        this._codecParser.logError("Failed to parse Ogg Vorbis Header", "Not a valid Ogg Vorbis file");
      });
    }

    return oggPage;
  }

  _getSamples(segment, header) {
    const byte = segment[0] >> 1;
    const blockFlag = this._mode[byte & this._mode.mask]; // is this a large window

    if (blockFlag) {
      this._prevBlockSize = byte & this._mode.prevMask ? header.blocksize1 : header.blocksize0;
    }

    this._currBlockSize = blockFlag ? header.blocksize1 : header.blocksize0;
    const samples = this._prevBlockSize + this._currBlockSize >> 2;
    this._prevBlockSize = this._currBlockSize;
    return samples;
  } // https://gitlab.xiph.org/xiph/liboggz/-/blob/master/src/liboggz/oggz_auto.c
  // https://github.com/FFmpeg/FFmpeg/blob/master/libavcodec/vorbis_parser.c

  /*
   * This is the format of the mode data at the end of the packet for all
   * Vorbis Version 1 :
   *
   * [ 6:number_of_modes ]
   * [ 1:size | 16:window_type(0) | 16:transform_type(0) | 8:mapping ]
   * [ 1:size | 16:window_type(0) | 16:transform_type(0) | 8:mapping ]
   * [ 1:size | 16:window_type(0) | 16:transform_type(0) | 8:mapping ]
   * [ 1:framing(1) ]
   *
   * e.g.:
   *
   * MsB         LsB
   *              <-
   * 0 0 0 0 0 1 0 0
   * 0 0 1 0 0 0 0 0
   * 0 0 1 0 0 0 0 0
   * 0 0 1|0 0 0 0 0
   * 0 0 0 0|0|0 0 0
   * 0 0 0 0 0 0 0 0
   * 0 0 0 0|0 0 0 0
   * 0 0 0 0 0 0 0 0
   * 0 0 0 0|0 0 0 0
   * 0 0 0|1|0 0 0 0 |
   * 0 0 0 0 0 0 0 0 V
   * 0 0 0|0 0 0 0 0
   * 0 0 0 0 0 0 0 0
   * 0 0 1|0 0 0 0 0
   *
   * The simplest way to approach this is to start at the end
   * and read backwards to determine the mode configuration.
   *
   * liboggz and ffmpeg both use this method.
   */


  _parseSetupHeader(setup) {
    const bitReader = new _utilities.BitReader(setup);
    const failedToParseVorbisStream = "Failed to read Vorbis stream";
    const failedToParseVorbisModes = ", failed to parse vorbis modes";
    let mode = {
      count: 0
    }; // sync with the framing bit

    while ((bitReader.read(1) & 0x01) !== 1) {}

    let modeBits; // search in reverse to parse out the mode entries
    // limit mode count to 63 so previous block flag will be in first packet byte

    while (mode.count < 64 && bitReader.position > 0) {
      const mapping = (0, _utilities.reverse)(bitReader.read(8));

      if (mapping in mode && !(mode.count === 1 && mapping === 0) // allows for the possibility of only one mode
      ) {
        this._codecParser.logError("received duplicate mode mapping" + failedToParseVorbisModes);

        throw new Error(failedToParseVorbisStream);
      } // 16 bits transform type, 16 bits window type, all values must be zero


      let i = 0;

      while (bitReader.read(8) === 0x00 && i++ < 3) {} // a non-zero value may indicate the end of the mode entries, or invalid data


      if (i === 4) {
        // transform type and window type were all zeros
        modeBits = bitReader.read(7); // modeBits may need to be used in the next iteration if this is the last mode entry

        mode[mapping] = modeBits & 0x01; // read and store mode -> block flag mapping

        bitReader.position += 6; // go back 6 bits so next iteration starts right after the block flag

        mode.count++;
      } else {
        // transform type and window type were not all zeros
        // check for mode count using previous iteration modeBits
        if ((((0, _utilities.reverse)(modeBits) & 0b01111110) >> 1) + 1 !== mode.count) {
          this._codecParser.logError("mode count did not match actual modes" + failedToParseVorbisModes);

          throw new Error(failedToParseVorbisStream);
        }

        break;
      }
    } // mode mask to read the mode from the first byte in the vorbis frame


    mode.mask = (1 << Math.log2(mode.count)) - 1; // previous window flag is the next bit after the mode mask

    mode.prevMask = (mode.mask | 0x1) + 1;
    return mode;
  }

}

exports.default = VorbisParser;

},{"../../globals.js":32,"../../utilities.js":34,"../Parser.js":11,"./VorbisFrame.js":24,"./VorbisHeader.js":25}],27:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.vorbisOpusChannelMapping = exports.stereo = exports.sixteenBitCRC = exports.reserved = exports.rate96000 = exports.rate88200 = exports.rate8000 = exports.rate7350 = exports.rate64000 = exports.rate48000 = exports.rate44100 = exports.rate32000 = exports.rate24000 = exports.rate22050 = exports.rate192000 = exports.rate176400 = exports.rate16000 = exports.rate12000 = exports.rate11025 = exports.none = exports.monophonic = exports.lfe = exports.getChannelMapping = exports.free = exports.channelMappings = exports.bad = void 0;
const reserved = "reserved";
exports.reserved = reserved;
const bad = "bad";
exports.bad = bad;
const free = "free";
exports.free = free;
const none = "none";
exports.none = none;
const sixteenBitCRC = "16bit CRC"; // channel mappings

exports.sixteenBitCRC = sixteenBitCRC;
const mappingJoin = ", ";
const front = "front";
const side = "side";
const rear = "rear";
const left = "left";
const center = "center";
const right = "right"; // prettier-ignore

/*
[
  [
    "left, right",
    "left, right, center",
    "left, center, right",
    "center, left, right",
    "center"
  ],
  [
    "front left, front right",
    "front left, front right, front center",
    "front left, front center, front right",
    "front center, front left, front right",
    "front center"
  ],
  [
    "side left, side right",
    "side left, side right, side center",
    "side left, side center, side right",
    "side center, side left, side right",
    "side center"
  ],
  [
    "rear left, rear right",
    "rear left, rear right, rear center",
    "rear left, rear center, rear right",
    "rear center, rear left, rear right",
    "rear center"
  ]
]
*/

const channelMappings = ["", front + " ", side + " ", rear + " "].map(x => [[left, right], [left, right, center], [left, center, right], [center, left, right], [center]].flatMap(y => y.map(z => x + z).join(mappingJoin)));
exports.channelMappings = channelMappings;
const lfe = "LFE";
exports.lfe = lfe;
const monophonic = "monophonic (mono)";
exports.monophonic = monophonic;
const stereo = "stereo";
exports.stereo = stereo;
const surround = "surround";
const channels = [monophonic, stereo, `linear ${surround}`, "quadraphonic", `5.0 ${surround}`, `5.1 ${surround}`, `6.1 ${surround}`, `7.1 ${surround}`];

const getChannelMapping = (channelCount, ...mappings) => `${channels[channelCount - 1]} (${mappings.join(mappingJoin)})`; // prettier-ignore


exports.getChannelMapping = getChannelMapping;
const vorbisOpusChannelMapping = [monophonic, getChannelMapping(2, channelMappings[0][0]), getChannelMapping(3, channelMappings[0][2]), getChannelMapping(4, channelMappings[1][0], channelMappings[3][0]), getChannelMapping(5, channelMappings[1][2], channelMappings[3][0]), getChannelMapping(6, channelMappings[1][2], channelMappings[3][0], lfe), getChannelMapping(7, channelMappings[1][2], channelMappings[2][0], channelMappings[3][4], lfe), getChannelMapping(8, channelMappings[1][2], channelMappings[2][0], channelMappings[3][0], lfe)]; // sampleRates

exports.vorbisOpusChannelMapping = vorbisOpusChannelMapping;
const rate192000 = 192000;
exports.rate192000 = rate192000;
const rate176400 = 176400;
exports.rate176400 = rate176400;
const rate96000 = 96000;
exports.rate96000 = rate96000;
const rate88200 = 88200;
exports.rate88200 = rate88200;
const rate64000 = 64000;
exports.rate64000 = rate64000;
const rate48000 = 48000;
exports.rate48000 = rate48000;
const rate44100 = 44100;
exports.rate44100 = rate44100;
const rate32000 = 32000;
exports.rate32000 = rate32000;
const rate24000 = 24000;
exports.rate24000 = rate24000;
const rate22050 = 22050;
exports.rate22050 = rate22050;
const rate16000 = 16000;
exports.rate16000 = rate16000;
const rate12000 = 12000;
exports.rate12000 = rate12000;
const rate11025 = 11025;
exports.rate11025 = rate11025;
const rate8000 = 8000;
exports.rate8000 = rate8000;
const rate7350 = 7350;
exports.rate7350 = rate7350;

},{}],28:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _globals = require("../globals.js");

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of codec-parser.
    
    codec-parser is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    codec-parser is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/

/**
 * @abstract
 */
class Frame {
  constructor(header, data) {
    _globals.frameStore.set(this, {
      header
    });

    this.data = data;
  }

}

exports.default = Frame;

},{"../globals.js":32}],29:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _globals = require("../../globals.js");

var _Frame = _interopRequireDefault(require("../Frame.js"));

var _OggPageHeader = _interopRequireDefault(require("./OggPageHeader.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of codec-parser.
    
    codec-parser is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    codec-parser is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
class OggPage extends _Frame.default {
  static *getFrame(codecParser, headerCache, readOffset) {
    const header = yield* _OggPageHeader.default.getHeader(codecParser, headerCache, readOffset);

    if (header) {
      const frameLength = _globals.headerStore.get(header).frameLength;

      const headerLength = _globals.headerStore.get(header).length;

      const totalLength = headerLength + frameLength;
      const rawData = (yield* codecParser.readRawData(totalLength, 0)).subarray(0, totalLength);
      const frame = rawData.subarray(headerLength, totalLength);
      return new OggPage(header, frame, rawData);
    } else {
      return null;
    }
  }

  constructor(header, frame, rawData) {
    super(header, frame);
    _globals.frameStore.get(this).length = rawData.length;
    this.codecFrames = [];
    this.rawData = rawData;
    this.absoluteGranulePosition = header.absoluteGranulePosition;
    this.crc32 = header.pageChecksum;
    this.duration = 0;
    this.isContinuedPacket = header.isContinuedPacket;
    this.isFirstPage = header.isFirstPage;
    this.isLastPage = header.isLastPage;
    this.pageSequenceNumber = header.pageSequenceNumber;
    this.samples = 0;
    this.streamSerialNumber = header.streamSerialNumber;
  }

}

exports.default = OggPage;

},{"../../globals.js":32,"../Frame.js":28,"./OggPageHeader.js":30}],30:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _globals = require("../../globals.js");

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of codec-parser.
    
    codec-parser is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    codec-parser is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/

/*
https://xiph.org/ogg/doc/framing.html

AAAAAAAA AAAAAAAA AAAAAAAA AAAAAAAA BBBBBBBB 00000CDE

(LSB)                                                             (MSB)
FFFFFFFF FFFFFFFF FFFFFFFF FFFFFFFF FFFFFFFF FFFFFFFF FFFFFFFF FFFFFFFF
GGGGGGGG GGGGGGGG GGGGGGGG GGGGGGGG
HHHHHHHH HHHHHHHH HHHHHHHH HHHHHHHH
IIIIIIII IIIIIIII IIIIIIII IIIIIIII

JJJJJJJJ
LLLLLLLL...

Ogg Page Header
Letter  Length (bits)  Description
A   32  0x4f676753, "OggS"
B   8   stream_structure_version
C   1   (0 no, 1 yes) last page of logical bitstream (eos)
D   1   (0 no, 1 yes) first page of logical bitstream (bos)
E   1   (0 no, 1 yes) continued packet

F   64  absolute granule position
G   32  stream serial number
H   32  page sequence no
I   32  page checksum
J   8   Number of page segments in the segment table
L   n   Segment table (n=page_segments+26).
        Segment table values sum to the total length of the packet.
        Last value is always < 0xFF. Last lacing value will be 0x00 if evenly divisible by 0xFF.
        
*/
class OggPageHeader {
  static *getHeader(codecParser, headerCache, readOffset) {
    const header = {}; // Must be at least 28 bytes.

    let data = yield* codecParser.readRawData(28, readOffset); // Bytes (1-4 of 28)
    // Frame sync (must equal OggS): `AAAAAAAA|AAAAAAAA|AAAAAAAA|AAAAAAAA`:

    if (data[0] !== 0x4f || // O
    data[1] !== 0x67 || // g
    data[2] !== 0x67 || // g
    data[3] !== 0x53 //    S
    ) {
      return null;
    } // Byte (5 of 28)
    // * `BBBBBBBB`: stream_structure_version


    header.streamStructureVersion = data[4]; // Byte (6 of 28)
    // * `00000CDE`
    // * `00000...`: All zeros
    // * `.....C..`: (0 no, 1 yes) last page of logical bitstream (eos)
    // * `......D.`: (0 no, 1 yes) first page of logical bitstream (bos)
    // * `.......E`: (0 no, 1 yes) continued packet

    const zeros = data[5] & 0b11111000;
    if (zeros) return null;
    header.isLastPage = Boolean(data[5] & 0b00000100);
    header.isFirstPage = Boolean(data[5] & 0b00000010);
    header.isContinuedPacket = Boolean(data[5] & 0b00000001);
    const view = new DataView(Uint8Array.from(data.subarray(0, 28)).buffer); // Byte (7-14 of 28)
    // * `FFFFFFFF|FFFFFFFF|FFFFFFFF|FFFFFFFF|FFFFFFFF|FFFFFFFF|FFFFFFFF|FFFFFFFF`
    // * Absolute Granule Position

    /**
     * @todo Safari does not support getBigInt64, but it also doesn't support Ogg
     */

    try {
      header.absoluteGranulePosition = view.getBigInt64(6, true);
    } catch {} // Byte (15-18 of 28)
    // * `GGGGGGGG|GGGGGGGG|GGGGGGGG|GGGGGGGG`
    // * Stream Serial Number


    header.streamSerialNumber = view.getInt32(14, true); // Byte (19-22 of 28)
    // * `HHHHHHHH|HHHHHHHH|HHHHHHHH|HHHHHHHH`
    // * Page Sequence Number

    header.pageSequenceNumber = view.getInt32(18, true); // Byte (23-26 of 28)
    // * `IIIIIIII|IIIIIIII|IIIIIIII|IIIIIIII`
    // * Page Checksum

    header.pageChecksum = view.getInt32(22, true); // Byte (27 of 28)
    // * `JJJJJJJJ`: Number of page segments in the segment table

    const pageSegmentTableLength = data[26];
    header.length = pageSegmentTableLength + 27;
    data = yield* codecParser.readRawData(header.length, readOffset); // read in the page segment table

    header.frameLength = 0;
    header.pageSegmentTable = [];
    header.pageSegmentBytes = Uint8Array.from(data.subarray(27, header.length));

    for (let i = 0, segmentLength = 0; i < pageSegmentTableLength; i++) {
      const segmentByte = header.pageSegmentBytes[i];
      header.frameLength += segmentByte;
      segmentLength += segmentByte;

      if (segmentByte !== 0xff || i === pageSegmentTableLength - 1) {
        header.pageSegmentTable.push(segmentLength);
        segmentLength = 0;
      }
    }

    return new OggPageHeader(header);
  }
  /**
   * @private
   * Call OggPageHeader.getHeader(Array<Uint8>) to get instance
   */


  constructor(header) {
    _globals.headerStore.set(this, header);

    this.absoluteGranulePosition = header.absoluteGranulePosition;
    this.isContinuedPacket = header.isContinuedPacket;
    this.isFirstPage = header.isFirstPage;
    this.isLastPage = header.isLastPage;
    this.pageSegmentTable = header.pageSegmentTable;
    this.pageSequenceNumber = header.pageSequenceNumber;
    this.pageChecksum = header.pageChecksum;
    this.streamSerialNumber = header.streamSerialNumber;
  }

}

exports.default = OggPageHeader;

},{"../../globals.js":32}],31:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _globals = require("../../globals.js");

var _utilities = require("../../utilities.js");

var _Parser = _interopRequireDefault(require("../../codecs/Parser.js"));

var _OggPage = _interopRequireDefault(require("./OggPage.js"));

var _OggPageHeader = _interopRequireDefault(require("./OggPageHeader.js"));

var _FLACParser = _interopRequireDefault(require("../../codecs/flac/FLACParser.js"));

var _OpusParser = _interopRequireDefault(require("../../codecs/opus/OpusParser.js"));

var _VorbisParser = _interopRequireDefault(require("../../codecs/vorbis/VorbisParser.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of codec-parser.
    
    codec-parser is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    codec-parser is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
class OggParser extends _Parser.default {
  constructor(codecParser, headerCache, onCodec) {
    super(codecParser, headerCache);
    this._onCodec = onCodec;
    this.Frame = _OggPage.default;
    this.Header = _OggPageHeader.default;
    this._codec = null;
    this._continuedPacket = new Uint8Array();
    this._pageSequenceNumber = 0;
  }

  get codec() {
    return this._codec || "";
  }

  _updateCodec(codec, Parser) {
    if (this._codec !== codec) {
      this._parser = new Parser(this._codecParser, this._headerCache);
      this._codec = codec;

      this._onCodec(codec);
    }
  }

  _checkForIdentifier({
    data
  }) {
    const idString = (0, _utilities.bytesToString)(data.subarray(0, 8));

    switch (idString) {
      case "fishead\0":
      case "fisbone\0":
      case "index\0\0\0":
        return false;
      // ignore ogg skeleton packets

      case "OpusHead":
        this._updateCodec("opus", _OpusParser.default);

        return true;

      case /^\x7fFLAC/.test(idString) && idString:
        this._updateCodec("flac", _FLACParser.default);

        return true;

      case /^\x01vorbis/.test(idString) && idString:
        this._updateCodec("vorbis", _VorbisParser.default);

        return true;
    }
  }

  _checkPageSequenceNumber(oggPage) {
    if (oggPage.pageSequenceNumber !== this._pageSequenceNumber + 1 && this._pageSequenceNumber > 1 && oggPage.pageSequenceNumber > 1) {
      this._codecParser.logWarning("Unexpected gap in Ogg Page Sequence Number.", `Expected: ${this._pageSequenceNumber + 1}, Got: ${oggPage.pageSequenceNumber}`);
    }

    this._pageSequenceNumber = oggPage.pageSequenceNumber;
  }

  *parseFrame() {
    const oggPage = yield* this.fixedLengthFrameSync(true);

    this._checkPageSequenceNumber(oggPage);

    const oggPageStore = _globals.frameStore.get(oggPage);

    const {
      pageSegmentBytes,
      pageSegmentTable
    } = _globals.headerStore.get(oggPageStore.header);

    let offset = 0;
    oggPageStore.segments = pageSegmentTable.map(segmentLength => oggPage.data.subarray(offset, offset += segmentLength));

    if (pageSegmentBytes[pageSegmentBytes.length - 1] === 0xff) {
      // continued packet
      this._continuedPacket = (0, _utilities.concatBuffers)(this._continuedPacket, oggPageStore.segments.pop());
    } else if (this._continuedPacket.length) {
      oggPageStore.segments[0] = (0, _utilities.concatBuffers)(this._continuedPacket, oggPageStore.segments[0]);
      this._continuedPacket = new Uint8Array();
    }

    if (this._codec || this._checkForIdentifier(oggPage)) {
      const frame = this._parser.parseOggPage(oggPage);

      this._codecParser.mapFrameStats(frame);

      return frame;
    }
  }

}

exports.default = OggParser;

},{"../../codecs/Parser.js":11,"../../codecs/flac/FLACParser.js":17,"../../codecs/opus/OpusParser.js":23,"../../codecs/vorbis/VorbisParser.js":26,"../../globals.js":32,"../../utilities.js":34,"./OggPage.js":29,"./OggPageHeader.js":30}],32:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.headerStore = exports.frameStore = void 0;
const headerStore = new WeakMap();
exports.headerStore = headerStore;
const frameStore = new WeakMap();
exports.frameStore = frameStore;

},{}],33:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of codec-parser.
    
    codec-parser is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    codec-parser is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
// https://id3.org/Developer%20Information
class ID3v2 {
  static *getID3v2Header(codecParser, headerCache, readOffset) {
    const header = {
      headerLength: 10
    };
    let data = yield* codecParser.readRawData(3, readOffset); // Byte (0-2 of 9)
    // ID3

    if (data[0] !== 0x49 || data[1] !== 0x44 || data[2] !== 0x33) return null;
    data = yield* codecParser.readRawData(header.headerLength, readOffset); // Byte (3-4 of 9)
    // * `BBBBBBBB|........`: Major version
    // * `........|BBBBBBBB`: Minor version

    header.version = `id3v2.${data[3]}.${data[4]}`; // Byte (5 of 9)
    // * `....0000.: Zeros (flags not implemented yet)

    if (data[5] & 0b00001111) return null; // Byte (5 of 9)
    // * `CDEF0000`: Flags
    // * `C.......`: Unsynchronisation (indicates whether or not unsynchronisation is used)
    // * `.D......`: Extended header (indicates whether or not the header is followed by an extended header)
    // * `..E.....`: Experimental indicator (indicates whether or not the tag is in an experimental stage)
    // * `...F....`: Footer present (indicates that a footer is present at the very end of the tag)

    header.unsynchronizationFlag = Boolean(data[5] & 0b10000000);
    header.extendedHeaderFlag = Boolean(data[5] & 0b01000000);
    header.experimentalFlag = Boolean(data[5] & 0b00100000);
    header.footerPresent = Boolean(data[5] & 0b00010000); // Byte (6-9 of 9)
    // * `0.......|0.......|0.......|0.......`: Zeros

    if (data[6] & 0b10000000 || data[7] & 0b10000000 || data[8] & 0b10000000 || data[9] & 0b10000000) return null; // Byte (6-9 of 9)
    // * `.FFFFFFF|.FFFFFFF|.FFFFFFF|.FFFFFFF`: Tag Length
    // The ID3v2 tag size is encoded with four bytes where the most significant bit (bit 7)
    // is set to zero in every byte, making a total of 28 bits. The zeroed bits are ignored,
    // so a 257 bytes long tag is represented as $00 00 02 01.

    header.dataLength = data[6] << 21 | data[7] << 14 | data[8] << 7 | data[9];
    header.length = header.headerLength + header.dataLength;
    return new ID3v2(header);
  }

  constructor(header) {
    this.version = header.version;
    this.unsynchronizationFlag = header.unsynchronizationFlag;
    this.extendedHeaderFlag = header.extendedHeaderFlag;
    this.experimentalFlag = header.experimentalFlag;
    this.footerPresent = header.footerPresent;
    this.length = header.length;
  }

}

exports.default = ID3v2;

},{}],34:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.reverse = exports.flacCrc16 = exports.crc8 = exports.crc32 = exports.concatBuffers = exports.bytesToString = exports.BitReader = void 0;

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of codec-parser.
    
    codec-parser is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    codec-parser is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
const getCrcTable = (crcTable, crcInitialValueFunction, crcFunction) => {
  for (let byte = 0; byte < crcTable.length; byte++) {
    let crc = crcInitialValueFunction(byte);

    for (let bit = 8; bit > 0; bit--) crc = crcFunction(crc);

    crcTable[byte] = crc;
  }

  return crcTable;
};

const crc8Table = getCrcTable(new Uint8Array(256), b => b, crc => crc & 0x80 ? 0x07 ^ crc << 1 : crc << 1);
const flacCrc16Table = [getCrcTable(new Uint16Array(256), b => b << 8, crc => crc << 1 ^ (crc & 1 << 15 ? 0x8005 : 0))];
const crc32Table = [getCrcTable(new Uint32Array(256), b => b, crc => crc >>> 1 ^ (crc & 1) * 0xedb88320)]; // build crc tables

for (let i = 0; i < 15; i++) {
  flacCrc16Table.push(new Uint16Array(256));
  crc32Table.push(new Uint32Array(256));

  for (let j = 0; j <= 0xff; j++) {
    flacCrc16Table[i + 1][j] = flacCrc16Table[0][flacCrc16Table[i][j] >>> 8] ^ flacCrc16Table[i][j] << 8;
    crc32Table[i + 1][j] = crc32Table[i][j] >>> 8 ^ crc32Table[0][crc32Table[i][j] & 0xff];
  }
}

const crc8 = data => {
  let crc = 0;
  const dataLength = data.length;

  for (let i = 0; i !== dataLength; i++) crc = crc8Table[crc ^ data[i]];

  return crc;
};

exports.crc8 = crc8;

const flacCrc16 = data => {
  const dataLength = data.length;
  const crcChunkSize = dataLength - 16;
  let crc = 0;
  let i = 0;

  while (i <= crcChunkSize) {
    crc ^= data[i++] << 8 | data[i++];
    crc = flacCrc16Table[15][crc >> 8] ^ flacCrc16Table[14][crc & 0xff] ^ flacCrc16Table[13][data[i++]] ^ flacCrc16Table[12][data[i++]] ^ flacCrc16Table[11][data[i++]] ^ flacCrc16Table[10][data[i++]] ^ flacCrc16Table[9][data[i++]] ^ flacCrc16Table[8][data[i++]] ^ flacCrc16Table[7][data[i++]] ^ flacCrc16Table[6][data[i++]] ^ flacCrc16Table[5][data[i++]] ^ flacCrc16Table[4][data[i++]] ^ flacCrc16Table[3][data[i++]] ^ flacCrc16Table[2][data[i++]] ^ flacCrc16Table[1][data[i++]] ^ flacCrc16Table[0][data[i++]];
  }

  while (i !== dataLength) crc = (crc & 0xff) << 8 ^ flacCrc16Table[0][crc >> 8 ^ data[i++]];

  return crc;
};

exports.flacCrc16 = flacCrc16;

const crc32 = data => {
  const dataLength = data.length;
  const crcChunkSize = dataLength - 16;
  let crc = 0;
  let i = 0;

  while (i <= crcChunkSize) crc = crc32Table[15][(data[i++] ^ crc) & 0xff] ^ crc32Table[14][(data[i++] ^ crc >>> 8) & 0xff] ^ crc32Table[13][(data[i++] ^ crc >>> 16) & 0xff] ^ crc32Table[12][data[i++] ^ crc >>> 24] ^ crc32Table[11][data[i++]] ^ crc32Table[10][data[i++]] ^ crc32Table[9][data[i++]] ^ crc32Table[8][data[i++]] ^ crc32Table[7][data[i++]] ^ crc32Table[6][data[i++]] ^ crc32Table[5][data[i++]] ^ crc32Table[4][data[i++]] ^ crc32Table[3][data[i++]] ^ crc32Table[2][data[i++]] ^ crc32Table[1][data[i++]] ^ crc32Table[0][data[i++]];

  while (i !== dataLength) crc = crc32Table[0][(crc ^ data[i++]) & 0xff] ^ crc >>> 8;

  return crc ^ -1;
};

exports.crc32 = crc32;

const concatBuffers = (...buffers) => {
  const buffer = new Uint8Array(buffers.reduce((acc, buf) => acc + buf.length, 0));
  buffers.reduce((offset, buf) => {
    buffer.set(buf, offset);
    return offset + buf.length;
  }, 0);
  return buffer;
};

exports.concatBuffers = concatBuffers;

const bytesToString = bytes => String.fromCharCode(...bytes); // prettier-ignore


exports.bytesToString = bytesToString;
const reverseTable = [0x0, 0x8, 0x4, 0xc, 0x2, 0xa, 0x6, 0xe, 0x1, 0x9, 0x5, 0xd, 0x3, 0xb, 0x7, 0xf];

const reverse = val => reverseTable[val & 0b1111] << 4 | reverseTable[val >> 4];

exports.reverse = reverse;

class BitReader {
  constructor(data) {
    this._data = data;
    this._pos = data.length * 8;
  }

  set position(position) {
    this._pos = position;
  }

  get position() {
    return this._pos;
  }

  read(bits) {
    const byte = Math.floor(this._pos / 8);
    const bit = this._pos % 8;
    this._pos -= bits;
    const window = (reverse(this._data[byte - 1]) << 8) + reverse(this._data[byte]);
    return window >> 7 - bit & 0xff;
  }

}

exports.BitReader = BitReader;

},{}],35:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "IcecastMetadataQueue", {
  enumerable: true,
  get: function () {
    return _IcecastMetadataQueue.default;
  }
});
Object.defineProperty(exports, "IcecastMetadataReader", {
  enumerable: true,
  get: function () {
    return _IcecastMetadataReader.default;
  }
});
Object.defineProperty(exports, "IcecastReadableStream", {
  enumerable: true,
  get: function () {
    return _IcecastReadableStream.default;
  }
});

var _IcecastMetadataQueue = _interopRequireDefault(require("./src/IcecastMetadataQueue.js"));

var _IcecastMetadataReader = _interopRequireDefault(require("./src/IcecastMetadataReader.js"));

var _IcecastReadableStream = _interopRequireDefault(require("./src/IcecastReadableStream.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

},{"./src/IcecastMetadataQueue.js":36,"./src/IcecastMetadataReader.js":37,"./src/IcecastReadableStream.js":38}],36:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

/* Copyright 2020-2021 Ethan Halsall
    This file is part of icecast-metadata-js.

    icecast-metadata-js free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    icecast-metadata-js distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
const noOp = () => {};

class IcecastMetadataQueue {
  /**
   * @description Schedules updates up to the millisecond for Icecast Metadata from the response body of an Icecast stream mountpoint
   * @description The accuracy of metadata updates is a direct relationship of the icyMetaInt
   * @param {Object} IcecastMetadataQueue constructor parameter
   * @param {number} [IcecastMetadataQueue.icyBr] Bitrate of audio stream used to increase accuracy when to updating metadata
   * @param {onMetadataUpdate} [IcecastMetadataQueue.onMetadataUpdate] Callback executed when metadata is scheduled to update
   * @param {onMetadataEnqueue} [IcecastMetadataQueue.onMetadataEnqueue] Callback executed when metadata is enqueued
   *
   * @callback onMetadataUpdate
   * @param {Object} metadata Object containing all metadata received.
   * @param {string} [metadata.StreamTitle] Title of the metadata update.
   * @param {string} [metadata.StreamUrl] Url (usually album art) of the metadata update.
   * @param {number} timestampOffset Total time buffered when the metadata was added
   * @param {number} timestamp Current time of the audio player when the metadata was added
   *
   * @callback onMetadataEnqueue
   * @param {Object} metadata Object containing all metadata received.
   * @param {string} [metadata.StreamTitle] Title of the metadata update.
   * @param {string} [metadata.StreamUrl] Url (usually album art) of the metadata update.
   * @param {number} timestampOffset Total time buffered when the metadata was added
   * @param {number} timestamp Current time of the audio player when the metadata was added
   *
   */
  constructor({
    icyBr,
    onMetadataUpdate = noOp,
    onMetadataEnqueue = noOp
  }) {
    this._icyBr = icyBr;
    this._onMetadataUpdate = onMetadataUpdate;
    this._onMetadataEnqueue = onMetadataEnqueue;
    this._isInitialMetadata = true;
    this._metadataQueue = [];
  }
  /**
   * @description Returns the metadata queued for updates
   * @type {{metadata: string, time: number}[]} Queued metadata
   */


  get metadataQueue() {
    return this._metadataQueue.map(({
      _timeoutId,
      ...rest
    }) => rest);
  }
  /**
   *
   * @param {object} metadata Metadata object returned from IcecastMetadataReader
   * @param {number} timestampOffset Total buffered audio in seconds
   * @param {number} [timestamp] Current time in the audio player
   */


  addMetadata({
    metadata,
    stats
  }, timestampOffset, timestamp = 0) {
    /**
     * Metadata time is derived from the total number of stream bytes read
     * since the latest buffer input. The buffer offset should be the total
     * seconds of audio in the player buffer when the metadata was read.
     */
    this._enqueueMetadata(metadata, timestampOffset, timestamp + this.getTimeByBytes(stats.currentStreamPosition));
  }
  /**
   * @description Calculates audio stream length based on bitrate
   * @param {number} bytesRead Number of bytes
   * @type {number} Seconds
   */


  getTimeByBytes(bytesRead) {
    return this._icyBr ? bytesRead / (this._icyBr * 125) : 0;
  }
  /**
   * @description Clears all metadata updates and empties the queue
   */


  purgeMetadataQueue() {
    this._metadataQueue.forEach(i => clearTimeout(i._timeoutId));

    this._metadataQueue = [];
  }

  _enqueueMetadata(metadata, timestampOffset, timestamp) {
    const metadataPayload = {
      metadata,
      timestampOffset,
      timestamp
    };

    this._metadataQueue.push(metadataPayload);

    this._onMetadataEnqueue(metadata, timestampOffset, timestamp);

    if (this._isInitialMetadata) {
      this._dequeueMetadata();

      this._isInitialMetadata = false;
    } else {
      metadataPayload._timeoutId = setTimeout(() => {
        this._dequeueMetadata();
      }, (timestampOffset - timestamp) * 1000); // trigger timeout relative to play position
    }
  }

  _dequeueMetadata() {
    const {
      metadata,
      timestampOffset,
      timestamp
    } = this._metadataQueue.shift();

    this._onMetadataUpdate(metadata, timestampOffset, timestamp);
  }

}

exports.default = IcecastMetadataQueue;

},{}],37:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _MetadataParser = _interopRequireDefault(require("./MetadataParser/MetadataParser.js"));

var _IcyMetadataParser = _interopRequireDefault(require("./MetadataParser/IcyMetadataParser.js"));

var _OggMetadataParser = _interopRequireDefault(require("./MetadataParser/OggMetadataParser.js"));

var _DualMetadataParser = _interopRequireDefault(require("./MetadataParser/DualMetadataParser.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    This file is part of icecast-metadata-js.

    icecast-metadata-js free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    icecast-metadata-js distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
class IcecastMetadataReader {
  /**
   * @description Splits Icecast raw response into stream bytes and metadata key / value pairs.
   * @param {number} IcecastMetadataReader.icyMetaInt Interval in bytes of metadata updates returned by the Icecast server
   * @param {number} IcecastMetadataReader.icyCharacterEncoding Character encoding to use for ICY metadata (defaults to "utf-8")
   * @param {number} IcecastMetadataReader.icyDetectionTimeout Duration in milliseconds to search for metadata if icyMetaInt isn't passed in
   * @param {Array} IcecastMetadataReader.metadataTypes Types of metadata to capture: "icy" and/or "ogg"
   *
   * @callback onMetadata
   * @param {object} value Object containing Metadata and Statistics
   * @param {object} metadata Object containing the metadata received.
   * @param {string} [metadata.StreamTitle] (ICY) Title of the metadata update.
   * @param {string} [metadata.StreamUrl] (ICY) Url (usually album art) of the metadata update.
   * @param {string} [metadata.TITLE] (OGG) Url Title of the metadata update.
   * @param {object} stats Object containing statistics on how many bytes were read and the current read position.
   *
   * @callback onStream
   * @param {object} value Object containing Stream data and Statistics
   * @param {Uint8Array} stream Object containing the stream buffer.
   * @param {object} stats Object containing statistics on how many bytes were read and the current read position.
   *
   * @callback onMetadataFailed Called when metadata detection has failed and no metadata will be returned
   * @param {string} metadataType Metadata type that failed ("icy" or "ogg")
   *
   * @callback onError Called when an error is encountered
   * @param {string} message Error message
   */
  constructor({
    metadataTypes = ["icy"],
    ...rest
  } = {}) {
    const hasIcy = metadataTypes.includes("icy");
    const hasOgg = metadataTypes.includes("ogg");
    if (hasIcy && hasOgg) this._metadataParser = new _DualMetadataParser.default(rest);else if (hasOgg) this._metadataParser = new _OggMetadataParser.default(rest);else if (hasIcy) this._metadataParser = new _IcyMetadataParser.default(rest);else this._metadataParser = new _MetadataParser.default(rest);
  }
  /**
   * @description Parses an already decoded ICY metadata string into key value pairs.
   * @param {string} metadataString ICY formatted metadata string. (i.e. "StreamTitle='A Title';")
   * @returns {object} Parsed metadata key value pairs. (i.e. {StreamTitle: "A Title"})
   */


  static parseIcyMetadata(string) {
    return _IcyMetadataParser.default.parseIcyMetadata(string);
  }
  /**
   * @description Gets the ICY metadata interval for this instance.
   * @returns {number} ICY metadata interval in bytes.
   */


  get icyMetaInt() {
    return this._metadataParser.icyMetaInt;
  }
  /**
   * @description Returns an iterator that yields stream or metadata.
   * @param {Uint8Array} chunk Next chunk of data to read
   * @returns {Iterator} Iterator that operates over a raw icecast response.
   * @yields {object} Object containing stream or metadata.
   */


  *iterator(chunk) {
    yield* this._metadataParser.iterator(chunk);
  }
  /**
   * @description Reads all data in the passed in chunk and calls the onStream and onMetadata callbacks.
   * @param {Uint8Array} chunk Next chunk of data to read
   */


  readAll(chunk) {
    this._metadataParser.readAll(chunk);
  }
  /**
   * @description Returns an async iterator that yields stream or metadata and awaits the onStream and onMetadata callbacks.
   * @param {Uint8Array} chunk Next chunk of data to read
   * @returns {IterableIterator} Iterator that operates over a raw icecast response.
   * @yields {object} Object containing stream or metadata.
   */


  async *asyncIterator(chunk) {
    return yield* this._metadataParser.asyncIterator(chunk);
  }
  /**
   * @description Reads all data in the chunk and awaits the onStream and onMetadata callbacks.
   * @param {Uint8Array} chunk Next chunk of data to read
   */


  async asyncReadAll(chunk) {
    return this._metadataParser.asyncReadAll(chunk);
  }

}

exports.default = IcecastMetadataReader;

},{"./MetadataParser/DualMetadataParser.js":39,"./MetadataParser/IcyMetadataParser.js":40,"./MetadataParser/MetadataParser.js":41,"./MetadataParser/OggMetadataParser.js":42}],38:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _IcecastMetadataReader = _interopRequireDefault(require("./IcecastMetadataReader.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    This file is part of icecast-metadata-js.

    icecast-metadata-js free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    icecast-metadata-js distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
const noOp = () => {};
/**
 * @description Browser ReadableStream wrapper for IcecastMetadataReader
 */


class IcecastReadableStream {
  /**
   * @param {ReadableStream} response ReadableStream for raw Icecast response data
   * @param {object} options Configuration options for IcecastMetadataReader
   * @see IcecastMetadataReader for information on the options parameter
   */
  constructor(response, {
    onStream = noOp,
    ...rest
  }) {
    let icecast;
    this._readableStream = new ReadableStream({
      async start(controller) {
        icecast = new _IcecastMetadataReader.default({
          icyMetaInt: parseInt(response.headers.get("Icy-MetaInt")),
          ...rest,
          onStream: async value => {
            controller.enqueue(value.stream);
            return onStream(value);
          }
        });

        for await (const chunk of IcecastReadableStream.asyncIterator(response.body)) {
          await icecast.asyncReadAll(chunk);
        }

        controller.close();
      }

    });
    this._icecast = icecast;
  }
  /**
   * @returns Icecast Metadata Interval if it is present on this stream
   */


  get icyMetaInt() {
    return this._icecast.icyMetaInt;
  }
  /**
   * @returns The ReadableStream instance
   */


  get readableStream() {
    return this._readableStream;
  }
  /**
   * @description Starts reading from the response and processing stream and metadata.
   */


  async startReading() {
    try {
      for await (const i of IcecastReadableStream.asyncIterator(this._readableStream)) {}
    } catch (e) {
      if (e.name !== "AbortError") throw e;
    }
  }
  /**
   * @description Wraps a ReadableStream as an Async Iterator.
   * @param {ReadableStream} readableStream ReadableStream to convert to AsyncIterator
   * @returns {Symbol.asyncIterator} Async Iterator that wraps the ReadableStream
   */


  static asyncIterator(readableStream) {
    const reader = readableStream.getReader();
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => reader.read()
      })
    };
  }

}

exports.default = IcecastReadableStream;

},{"./IcecastMetadataReader.js":37}],39:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _IcyMetadataParser = _interopRequireDefault(require("./IcyMetadataParser.js"));

var _OggMetadataParser = _interopRequireDefault(require("./OggMetadataParser.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    This file is part of icecast-metadata-js.

    icecast-metadata-js free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    icecast-metadata-js distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/

/**
 * @description Parses ICY and OGG metadata from an Icecast stream
 * @protected
 * @see IcecastMetadataReader
 */
class DualMetadataParser {
  constructor(params) {
    const {
      onStream,
      ...rest
    } = params;
    this._oggMetadataParser = new _OggMetadataParser.default(params);
    this._icyMetadataParser = new _IcyMetadataParser.default(rest);
  }

  get icyMetaInt() {
    return this._icyMetadataParser.icyMetaInt;
  }

  *iterator(chunk) {
    for (const value of this._icyMetadataParser.iterator(chunk)) {
      if (value.stream) {
        yield* this._oggMetadataParser.iterator(value.stream);
      } else {
        yield value;
      }
    }
  }

  readAll(chunk) {
    for (const value of this._icyMetadataParser.iterator(chunk)) {
      if (value.stream) {
        this._oggMetadataParser.readAll(value.stream);
      }
    }
  }

  async *asyncIterator(chunk) {
    for await (const value of this._icyMetadataParser.asyncIterator(chunk)) {
      if (value.stream) {
        for await (const oggValue of this._oggMetadataParser.asyncIterator(value.stream)) {
          yield oggValue;
        }
      } else {
        yield value;
      }
    }
  }

  async asyncReadAll(chunk) {
    for await (const value of this._icyMetadataParser.iterator(chunk)) {
      if (value.stream) {
        await this._oggMetadataParser.asyncReadAll(value.stream);
      }
    }
  }

}

exports.default = DualMetadataParser;

},{"./IcyMetadataParser.js":40,"./OggMetadataParser.js":42}],40:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _MetadataParser = _interopRequireDefault(require("./MetadataParser.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    This file is part of icecast-metadata-js.

    icecast-metadata-js free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    icecast-metadata-js distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/

/**
 * @description Parses ICY metadata from an Icecast stream
 * @protected
 * @see IcecastMetadataReader
 */
class IcyMetadataParser extends _MetadataParser.default {
  constructor({
    icyMetaInt,
    icyDetectionTimeout = 2000,
    icyCharacterEncoding = "utf-8",
    ...rest
  }) {
    super(rest);
    this._decoder = new globalThis.TextDecoder(icyCharacterEncoding);
    this._icyMetaInt = icyMetaInt;
    this._icyDetectionTimeout = icyDetectionTimeout;
    this._generator = this._icyParser();

    this._generator.next();
  }

  *_icyParser() {
    if (yield* this._hasIcyMetadata()) {
      do {
        this._remainingData = this._icyMetaInt;
        yield* this._getStream();
        yield* this._getMetadataLength();
        if (this._remainingData) yield* this._getMetadata();
      } while (true);
    }

    this._remainingData = Infinity;
    yield* this._getStream();
  }

  static parseIcyMetadata(metadataString) {
    /**
     * Metadata is a string of key='value' pairs delimited by a semicolon.
     * The string is a fixed length and any unused bytes at the end are 0x00.
     * i.e. "StreamTitle='The Stream Title';StreamUrl='https://example.com';\0\0\0\0\0\0"
     */
    const metadataRegex = /(?<key>[^\0]+?)='(?<val>[^\0]*?)(;$|';|'$|$)/;
    const metadata = {}; // [{key: "StreamTitle", val: "The Stream Title"}, {key: "StreamUrl", val: "https://example.com"}]

    for (const metadataElement of metadataString.match(new RegExp(metadataRegex, "g")) || []) {
      const match = metadataElement.match(metadataRegex);
      if (match) metadata[match["groups"]["key"]] = match["groups"]["val"];
    } // {StreamTitle: "The Stream Title", StreamUrl: "https://example.com"}


    return metadata;
  }

  get icyMetaInt() {
    return this._icyMetaInt;
  }

  *_hasIcyMetadata() {
    if (this._icyMetaInt > 0) return true;
    if (!this._icyDetectionTimeout) return false;

    this._logError("Passed in Icy-MetaInt is invalid. Attempting to detect ICY Metadata.", "See https://github.com/eshaz/icecast-metadata-js for information on how to properly request ICY Metadata."); // prettier-ignore


    const METADATA_SEARCH = [null, 83, 116, 114, 101, 97, 109, 84, 105, 116, 108, 101, 61]; // StreamTitle=

    const startTime = Date.now();
    let metaInt = 0;

    while (startTime + this._icyDetectionTimeout > Date.now()) {
      this._buffer = _MetadataParser.default._concatBuffers(this._buffer, yield* this._readData()); // search for metadata

      detectMetadata: while (metaInt < this._buffer.length - METADATA_SEARCH.length) {
        for (let i = 1; i < METADATA_SEARCH.length; i++) {
          if (this._buffer[i + metaInt] !== METADATA_SEARCH[i]) {
            metaInt++;
            continue detectMetadata;
          }
        } // found metadata
        // prettier-ignore


        this._logError(`Found ICY Metadata! Setting Icy-MetaInt to ${metaInt}.`);

        this._icyMetaInt = metaInt;
        return true;
      }
    } // prettier-ignore


    this._logError("ICY Metadata not detected, but continuing anyway. Audio errors will occur if there is ICY metadata.", `Searched ${this._buffer.length} bytes for ${(Date.now() - startTime) / 1000} seconds.`, "Try increasing the `icyDetectionTimeout` value if ICY metadata is present in the stream.");

    this._onMetadataFailed("icy");

    return false;
  }

  *_getStream() {
    this._stats.currentStreamBytesRemaining = this._remainingData;

    while (this._remainingData) {
      this._addStream(yield* super._getNextValue());
    }
  }

  *_getMetadataLength() {
    this._remainingData = 1;

    do {
      this._remainingData = (yield* this._getNextValue())[0] * 16;
    } while (this._remainingData === 1);

    this._stats.addMetadataLengthBytes(1);
  }

  *_getMetadata() {
    this._stats.currentMetadataBytesRemaining = this._remainingData;
    const metadata = yield* this._getNextValue(this._remainingData);

    this._stats.addMetadataBytes(metadata.length);

    yield* this._sendMetadata(IcyMetadataParser.parseIcyMetadata(this._decoder.decode(metadata)));
  }

}

exports.default = IcyMetadataParser;

},{"./MetadataParser.js":41}],41:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _Stats = _interopRequireDefault(require("./Stats.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    This file is part of icecast-metadata-js.

    icecast-metadata-js free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    icecast-metadata-js distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
const noOp = () => {};
/**
 * @description Passthrough parser
 * @protected
 * @see IcecastMetadataReader
 */


class MetadataParser {
  constructor(params) {
    this._remainingData = 0;
    this._currentPosition = 0;
    this._buffer = new Uint8Array(0);
    this._streamBuffer = [];
    this._streamBufferLength = 0;
    this._stats = new _Stats.default();
    this._onStream = params.onStream || noOp;
    this._onMetadata = params.onMetadata || noOp;
    this._onMetadataFailed = params.onMetadataFailed || noOp;
    this._onError = params.onError || noOp;
    this._enableLogging = params.enableLogging || false;
    this._onStreamPromise = Promise.resolve();
    this._onMetadataPromise = Promise.resolve();
    this._generator = this._passThroughParser();

    this._generator.next();
  }

  *_passThroughParser() {
    this._remainingData = Infinity;

    while (true) {
      this._addStream(yield* this._getNextValue());

      yield* this._sendStream();
    }
  }

  static _concatBuffers(...buffers) {
    const length = buffers.reduce((acc, buf) => acc + buf.length, 0);
    return this._concatBuffersKnownLength(buffers, length);
  }

  static _concatBuffersKnownLength(buffers, length) {
    const buffer = new Uint8Array(length);
    buffers.reduce((offset, buf) => {
      buffer.set(buf, offset);
      return offset + buf.length;
    }, 0);
    return buffer;
  }

  *iterator(chunk) {
    for (let i = this._generator.next(chunk); i.value; i = this._generator.next()) {
      yield i.value;
    }
  }

  readAll(chunk) {
    for (let i = this._generator.next(chunk); i.value; i = this._generator.next()) {}
  }

  async *asyncIterator(chunk) {
    for (let i = this._generator.next(chunk); i.value; i = this._generator.next()) {
      await this._onStreamPromise;
      await this._onMetadataPromise;
      yield i.value;
    }
  }

  async asyncReadAll(chunk) {
    for (let i = this._generator.next(chunk); i.value; i = this._generator.next()) {
      await this._onStreamPromise;
      await this._onMetadataPromise;
    }
  }

  _logError(...messages) {
    if (this._enableLogging) {
      console.warn("icecast-metadata-js", messages.reduce((acc, message) => acc + "\n  " + message, ""));
    }

    this._onError(...messages);
  }

  _addStream(stream) {
    this._streamBuffer.push(stream);

    this._streamBufferLength += stream.length;
  }

  *_sendStream() {
    if (this._streamBuffer.length) {
      const stream = MetadataParser._concatBuffersKnownLength(this._streamBuffer, this._streamBufferLength);

      this._streamBuffer = [];
      this._streamBufferLength = 0;

      this._stats.addStreamBytes(stream.length);

      const streamPayload = {
        stream,
        stats: this._stats.stats
      };
      this._onStreamPromise = this._onStream(streamPayload);
      yield streamPayload;
    }
  }

  *_sendMetadata(metadata) {
    yield* this._sendStream();
    const metadataPayload = {
      metadata,
      stats: this._stats.stats
    };
    this._onMetadataPromise = this._onMetadata(metadataPayload);
    yield metadataPayload;
  }

  *_getNextValue(minLength = 0) {
    if (this._currentPosition === this._buffer.length) {
      this._buffer = yield* this._readData();
      this._currentPosition = 0;
    }

    while (this._buffer.length - this._currentPosition < minLength) {
      this._buffer = MetadataParser._concatBuffers(this._buffer, yield* this._readData());
    }

    const value = this._buffer.subarray(this._currentPosition, (minLength || this._remainingData) + this._currentPosition);

    this._stats.addBytes(value.length);

    this._remainingData = value.length < this._remainingData ? this._remainingData - value.length : 0;
    this._currentPosition += value.length;
    return value;
  }

  *_readData() {
    yield* this._sendStream();
    let data;

    do {
      data = yield; // if out of data, accept new data in the .next() call
    } while (!data || data.length === 0);

    this._stats.addCurrentBytesRemaining(data.length);

    return data;
  }

}

exports.default = MetadataParser;

},{"./Stats.js":43}],42:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _MetadataParser = _interopRequireDefault(require("./MetadataParser.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    This file is part of icecast-metadata-js.

    icecast-metadata-js free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    icecast-metadata-js distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/

/**
 * @description Parses OGG metadata from an Icecast stream
 * @protected
 * @see IcecastMetadataReader
 */
class OggMetadataParser extends _MetadataParser.default {
  constructor(params) {
    super(params);
    this._decoder = new globalThis.TextDecoder("utf-8");
    this._generator = this._oggParser();

    this._generator.next();

    this._isContinuePacket = false;
  }

  *_oggParser() {
    if (yield* this._hasOggPage()) {
      const codecMatcher = yield* this._identifyCodec();

      if (codecMatcher) {
        while (yield* this._hasOggPage()) {
          if (!this._isContinuePacket) yield* this._getMetadata(codecMatcher);
          yield* this._getStream();
        }
      }
    }

    this._remainingData = Infinity;
    yield* this._getStream();
  }

  _getUint32(data, offset = 0) {
    return new DataView(Uint8Array.from([...data.subarray(offset, offset + 4)]).buffer).getUint32(0, true);
  }

  _matchBytes(matchString, bytes) {
    return String.fromCharCode(...bytes).match(matchString);
  }

  *_hasOggPage() {
    // Bytes (1-4 of 28)
    // Frame sync (must equal OggS): `AAAAAAAA|AAAAAAAA|AAAAAAAA|AAAAAAAA`:
    // Byte (5 of 28) stream_structure_version
    // Byte (6 of 28)
    // * `00000...`: All zeros
    // * `.....C..`: (0 no, 1 yes) last page of logical bitstream (eos)
    // * `......D.`: (0 no, 1 yes) first page of logical bitstream (bos)
    // * `.......E`: (0 no, 1 yes) continued packet
    let syncBytes = [];

    while (syncBytes.length <= 65307) {
      // max ogg page size
      const bytes = yield* super._getNextValue(6); // Sync with OGG page without sending stream data

      if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53 && !(bytes[5] & 0b11111000)) {
        this._isContinuePacket = bytes[5] & 0b00000001;
        this._currentPosition -= 6;
        this._remainingData += 6;
        this._stats._totalBytesRead -= 6;
        this._stats._currentBytesRemaining += 6;
        break;
      }

      syncBytes.push(bytes[0]);
      this._currentPosition -= 4;
      this._stats._totalBytesRead -= 4;
      this._stats._currentBytesRemaining += 4;
    }

    if (syncBytes.length) this._addStream(Uint8Array.from(syncBytes));

    if (syncBytes.length > 65307) {
      this._logError("This stream is not an OGG stream. No OGG metadata will be returned.", "See https://github.com/eshaz/icecast-metadata-js for information on OGG metadata.");

      this._onMetadataFailed("ogg");

      return false;
    }

    const baseOggPage = yield* this._getNextValue(27); // Byte (27 of 28)
    // * `JJJJJJJJ`: Number of page segments in the segment table

    const oggPageSegments = yield* this._getNextValue(baseOggPage[26]);
    this._remainingData = oggPageSegments.reduce((acc, octet) => acc + octet, 0);
    return true;
  }

  *_identifyCodec() {
    const data = yield* this._getNextValue(8);
    yield* this._getStream();

    if (this._matchBytes(/\x7fFLAC/, data.subarray(0, 5))) {
      return {
        regex: /^[\x84|\x04]/,
        length: 4
      };
    } else if (this._matchBytes(/OpusHead/, data.subarray(0, 8))) {
      return {
        regex: /OpusTags/,
        length: 8
      };
    } else if (this._matchBytes(/\x01vorbis/, data.subarray(0, 7))) {
      return {
        regex: /\x03vorbis/,
        length: 7
      };
    }
  }

  *_getMetadata({
    regex,
    length
  }) {
    if (this._matchBytes(regex, yield* this._getNextValue(length))) {
      yield* this._sendMetadata(yield* this._readVorbisComment());
    }
  }

  *_getStream() {
    while (this._remainingData) {
      yield* this._getNextValue();
    }
  }

  *_getNextValue(length) {
    const value = yield* super._getNextValue(length);

    this._addStream(value);

    return value;
  }

  *_readData() {
    const data = yield* super._readData();
    this._stats.currentStreamBytesRemaining = data.length;
    return data;
  }

  *_readVorbisComment() {
    /*
    1) [vendor_length] = read an unsigned integer of 32 bits
    2) [vendor_string] = read a UTF-8 vector as [vendor_length] octets
    3) [user_comment_list_length] = read an unsigned integer of 32 bits
    4) iterate [user_comment_list_length] times {
       5) [length] = read an unsigned integer of 32 bits
       6) this iteration's user comment = read a UTF-8 vector as [length] octets
    }
    7) [framing_bit] = read a single bit as boolean
    8) if ( [framing_bit] unset or end of packet ) then ERROR
    9) done.
    */
    const vendorStringLength = this._getUint32(yield* this._getNextValue(4));

    this._stats.addMetadataBytes(4);

    const vendorString = this._decoder.decode(yield* this._getNextValue(vendorStringLength));

    this._stats.addMetadataBytes(vendorStringLength);

    const commentListLength = this._getUint32(yield* this._getNextValue(4));

    this._stats.addMetadataBytes(4);

    const comments = [];

    for (let i = 0; i < commentListLength; i++) {
      const commentLength = yield* this._getNextValue(4);

      this._stats.addMetadataBytes(4);

      comments.push(yield* this._getNextValue(this._getUint32(commentLength)));

      this._stats.addMetadataBytes(comments[comments.length - 1].length);
    }

    this._stats.currentMetadataBytesRemaining = 0;
    return comments.reduce((metadata, comment) => {
      const delimiter = comment.indexOf(0x3d); // prettier-ignore

      const key = String.fromCharCode(...comment.subarray(0, delimiter)).toUpperCase();

      const val = this._decoder.decode(comment.subarray(delimiter + 1));

      metadata[key] = metadata[key] ? `${metadata[key]}; ${val}` : val;
      return metadata;
    }, {
      VENDOR_STRING: vendorString
    });
  }

}

exports.default = OggMetadataParser;

},{"./MetadataParser.js":41}],43:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

/* Copyright 2020-2021 Ethan Halsall
    This file is part of icecast-metadata-js.

    icecast-metadata-js free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    icecast-metadata-js distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
class Stats {
  constructor() {
    this._totalBytesRead = 0;
    this._streamBytesRead = 0;
    this._metadataLengthBytesRead = 0;
    this._metadataBytesRead = 0;
    this._currentBytesRemaining = 0;
    this._currentStreamBytesRemaining = 0;
    this._currentMetadataBytesRemaining = 0;
  }

  get stats() {
    return {
      totalBytesRead: this._totalBytesRead,
      streamBytesRead: this._streamBytesRead,
      metadataLengthBytesRead: this._metadataLengthBytesRead,
      metadataBytesRead: this._metadataBytesRead,
      currentBytesRemaining: this._currentBytesRemaining,
      currentStreamBytesRemaining: this._currentStreamBytesRemaining,
      currentMetadataBytesRemaining: this._currentMetadataBytesRemaining
    };
  }

  set currentStreamBytesRemaining(bytes) {
    this._currentStreamBytesRemaining += bytes;
  }

  set currentMetadataBytesRemaining(bytes) {
    this._currentMetadataBytesRemaining = bytes;
  }

  addBytes(bytes) {
    this._totalBytesRead += bytes;
    this._currentBytesRemaining -= bytes;
  }

  addStreamBytes(bytes) {
    this._streamBytesRead += bytes;
    this._currentStreamBytesRemaining -= bytes;
  }

  addMetadataLengthBytes(bytes) {
    this._metadataLengthBytesRead += bytes;
  }

  addMetadataBytes(bytes) {
    this._metadataBytesRead += bytes;
    this._currentMetadataBytesRemaining -= bytes;
  }

  addCurrentBytesRemaining(bytes) {
    this._currentBytesRemaining += bytes;
  }

}

exports.default = Stats;

},{}],44:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

// support for Safari 13
// https://stackoverflow.com/a/58209729/14911733
class EventTargetPolyfill {
  constructor() {
    this._listeners = [];
  }

  hasEventListener(type, listener) {
    return this._listeners.some(item => item.type === type && item.listener === listener);
  }

  addEventListener(type, listener, options = {}) {
    if (!this.hasEventListener(type, listener)) {
      this._listeners.push({
        type,
        listener,
        options
      });
    } // console.log(`${this}-listeners:`,this._listeners);


    return this;
  }

  removeEventListener(type, listener) {
    const index = this._listeners.findIndex(item => item.type === type && item.listener === listener);

    if (index >= 0) this._listeners.splice(index, 1);
    return this;
  }

  removeEventListeners() {
    this._listeners = [];
    return this;
  }

  dispatchEvent(evt) {
    this._listeners.filter(item => item.type === evt.type).forEach(item => {
      const {
        type,
        listener,
        options: {
          once
        }
      } = item;
      listener.call(this, evt);
      if (once === true) this.removeEventListener(type, listener);
    });

    return this;
  }

}

exports.default = EventTargetPolyfill;

},{}],45:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _global = require("./global.js");

class FrameQueue {
  constructor(icecast) {
    this.CACHE_DURATION = 300000; // milliseconds of burst on connect data

    this._icecast = icecast;
    this.initSync();
    this.initQueue();
  }

  initSync() {
    this._syncQueue = [];
    this._alignIndex = 0;
    this._syncIndex = 0;
  }

  initQueue() {
    this._queue = [];
    this._queueDuration = 0;
  }

  add({
    crc32,
    duration
  }) {
    this._queue.push({
      crc32,
      duration
    });

    this._queueDuration += duration;

    if (this._queueDuration >= this.CACHE_DURATION) {
      const {
        duration
      } = this._queue.shift();

      this._queueDuration -= duration;
    }
  }

  addAll(frames) {
    frames.forEach(frame => this.add(frame));
  }
  /*
  Aligns the queue with a new incoming data by aligning the crc32 hashes 
  and then returning only the frames that do not existing on the queue.
  
                   old data | common data  | new data
  (old connection) ------------------------|
  (new connection)          |------------------>
                             ^^^^^^^^^^^^^^ ^^^^
                              (sync)         (frames to return)
  */

  /**
   *
   * @param {Array<CodecFrame|OggPage>} frames
   * @returns Array with frames as first element, boolean indicating if the sync was successful as the second element
   */


  sync(frames) {
    this._syncQueue.push(...frames); // find the index of the element in the queue that aligns with the sync queue


    align_queues: while (this._alignIndex < this._queue.length) {
      while (this._syncIndex < this._syncQueue.length && this._alignIndex + this._syncIndex < this._queue.length) {
        if (this._syncQueue[this._syncIndex].crc32 !== this._queue[this._alignIndex + this._syncIndex].crc32 // failed to match
        ) {
          this._syncIndex = 0; // reset sync queue index and start over

          this._alignIndex++;
          continue align_queues;
        }

        this._syncIndex++;
      }

      break; // full match, queues are aligned
    } // no matching data (not synced)


    if (this._alignIndex === this._queue.length) {
      // prettier-ignore
      this._icecast[_global.fireEvent](_global.event.WARN, "Reconnected successfully after retry event.", "Found no overlapping frames from previous request.", "Unable to sync old and new request.");

      const syncQueue = this._syncQueue;
      this.initSync();
      this.initQueue(); // clear queue since there is a gap in data

      return [syncQueue, false];
    }

    const sliceIndex = this._queue.length - this._alignIndex; // new frames (synced)

    if (this._syncQueue.length > sliceIndex) {
      // prettier-ignore
      this._icecast[_global.fireEvent](_global.event.WARN, "Reconnected successfully after retry event.", `Found ${sliceIndex} frames (${(this._queue.slice(this._alignIndex).reduce((acc, {
        duration
      }) => acc + duration, 0) / 1000).toFixed(3)} seconds) of overlapping audio data in new request.`, "Synchronized old and new request.");

      const newFrames = this._syncQueue.slice(sliceIndex);

      this.initSync();
      return [newFrames, true];
    } // no new frames yet


    return [[], false];
  }

}

exports.default = FrameQueue;

},{"./global.js":48}],46:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _icecastMetadataJs = require("icecast-metadata-js");

var _global = require("./global.js");

var _EventTargetPolyfill = _interopRequireDefault(require("./EventTargetPolyfill.js"));

var _PlayerFactory = _interopRequireDefault(require("./PlayerFactory.js"));

var _MediaSourcePlayer = _interopRequireDefault(require("./players/MediaSourcePlayer.js"));

var _HTML5Player = _interopRequireDefault(require("./players/HTML5Player.js"));

var _WebAudioPlayer = _interopRequireDefault(require("./players/WebAudioPlayer.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * @license
 * @see https://github.com/eshaz/icecast-metadata-js
 * @copyright 2021-2022 Ethan Halsall
 *  This file is part of icecast-metadata-player.
 *
 *  icecast-metadata-player free software: you can redistribute it and/or modify
 *  it under the terms of the GNU Lesser General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  icecast-metadata-player distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU Lesser General Public License for more details.
 *
 *  You should have received a copy of the GNU Lesser General Public License
 *  along with this program.  If not, see <https://www.gnu.org/licenses/>
 */
let EventClass;

try {
  new EventTarget();
  EventClass = EventTarget;
} catch {
  EventClass = _EventTargetPolyfill.default;
}

const playbackMethod = Symbol();
const playerFactory = Symbol();
const playerResetPromise = Symbol();
const events = Symbol();
const playerState = Symbol();
const onAudioPause = Symbol();
const onAudioPlay = Symbol();
const onPlay = Symbol();
const onAudioError = Symbol();
const onAudioWaiting = Symbol();
const resetPlayback = Symbol();
const retryAttempt = Symbol();
const retryTimeoutId = Symbol();

class IcecastMetadataPlayer extends EventClass {
  /**
   * @constructor
   * @param {string} endpoint Endpoint of the Icecast compatible stream
   * @param {object} options Options object
   * @param {HTMLAudioElement} options.audioElement Audio element to play the stream
   * @param {Array} options.metadataTypes Array of metadata types to parse
   * @param {number} options.bufferLength Seconds of audio to buffer before starting playback
   * @param {number} options.icyMetaInt ICY metadata interval
   * @param {string} options.icyCharacterEncoding Character encoding to use for ICY metadata (defaults to "utf-8")
   * @param {number} options.icyDetectionTimeout ICY metadata detection timeout
   * @param {number} options.retryTimeout Number of seconds to wait before giving up on retries
   * @param {number} options.retryDelayRate Percentage of seconds to increment after each retry (how quickly to increase the back-off)
   * @param {number} options.retryDelayMin Minimum number of seconds between retries (start of the exponential back-off curve)
   * @param {number} options.retryDelayMax Maximum number of seconds between retries (end of the exponential back-off curve)
   * @param {boolean} options.enableLogging Set to `true` to enable warning and error logging to the console
   * @param {string} options.playbackMethod Sets the preferred playback method (mediasource (default), html5, webaudio)
   *
   * @callback options.onMetadata Called with metadata when synchronized with the audio
   * @callback options.onMetadataEnqueue Called with metadata when discovered on the response
   * @callback options.onError Called with message(s) when a fallback or error condition is met
   * @callback options.onWarn Called with message(s) when a warning condition is met
   * @callback options.onPlay Called when the audio element begins playing
   * @callback options.onLoad Called when stream request is started
   * @callback options.onStreamStart Called when stream requests begins to return data
   * @callback options.onBuffer Called when the audio buffer is being filled
   * @callback options.onStream Called when stream data is sent to the audio element
   * @callback options.onStreamEnd Called when the stream request completes
   * @callback options.onStop Called when the stream is completely stopped and all cleanup operations are complete
   * @callback options.onRetry Called when a connection retry is attempted
   * @callback options.onRetryTimeout Called when when connections attempts have timed out
   * @callback options.onCodecUpdate Called when the audio codec information has changed
   */
  constructor(url, options = {}) {
    super();

    _global.p.set(this, {
      // options
      [_global.endpoint]: url,
      [_global.audioElement]: options.audioElement || new Audio(),
      [_global.bufferLength]: options.bufferLength || 1,
      [_global.icyMetaInt]: options.icyMetaInt,
      [_global.icyCharacterEncoding]: options.icyCharacterEncoding,
      [_global.icyDetectionTimeout]: options.icyDetectionTimeout,
      [_global.metadataTypes]: options.metadataTypes || ["icy"],
      [_global.hasIcy]: (options.metadataTypes || ["icy"]).includes("icy"),
      [_global.enableLogging]: options.enableLogging || false,
      [_global.enableCodecUpdate]: Boolean(options.onCodecUpdate) || options.enableCodecUpdate,
      [_global.retryDelayRate]: (options.retryDelayRate || 0.1) + 1,
      [_global.retryDelayMin]: (options.retryDelayMin || 0.5) * 1000,
      [_global.retryDelayMax]: (options.retryDelayMax || 2) * 1000,
      [_global.retryTimeout]: (options.retryTimeout || 30) * 1000,
      [playbackMethod]: options.playbackMethod,
      // callbacks
      [events]: {
        [_global.event.PLAY]: options.onPlay || _global.noOp,
        [_global.event.LOAD]: options.onLoad || _global.noOp,
        [_global.event.STREAM_START]: options.onStreamStart || _global.noOp,
        [_global.event.BUFFER]: options.onBuffer || _global.noOp,
        [_global.event.STREAM]: options.onStream || _global.noOp,
        [_global.event.STREAM_END]: options.onStreamEnd || _global.noOp,
        [_global.event.METADATA]: options.onMetadata || _global.noOp,
        [_global.event.METADATA_ENQUEUE]: options.onMetadataEnqueue || _global.noOp,
        [_global.event.CODEC_UPDATE]: options.onCodecUpdate || _global.noOp,
        [_global.event.STOP]: options.onStop || _global.noOp,
        [_global.event.RETRY]: options.onRetry || _global.noOp,
        [_global.event.RETRY_TIMEOUT]: options.onRetryTimeout || _global.noOp,
        [_global.event.WARN]: (...messages) => {
          this[_global.logError](console.warn, options.onWarn, messages);
        },
        [_global.event.ERROR]: (...messages) => {
          this[_global.logError](console.error, options.onError, messages);
        }
      },
      // variables
      [_global.icecastMetadataQueue]: new _icecastMetadataJs.IcecastMetadataQueue({
        onMetadataUpdate: (...args) => this[_global.fireEvent](_global.event.METADATA, ...args),
        onMetadataEnqueue: (...args) => this[_global.fireEvent](_global.event.METADATA_ENQUEUE, ...args)
      }),
      [_global.codecUpdateQueue]: new _icecastMetadataJs.IcecastMetadataQueue({
        onMetadataUpdate: (...args) => this[_global.fireEvent](_global.event.CODEC_UPDATE, ...args)
      }),
      [resetPlayback]: () => {
        clearTimeout(_global.p.get(this)[retryTimeoutId]);
        this.removeEventListener(_global.event.STREAM_START, _global.p.get(this)[resetPlayback]);

        _global.p.get(this)[_global.audioElement].removeEventListener("waiting", _global.p.get(this)[onAudioWaiting]);

        if (this.state !== _global.state.RETRYING) {
          try {
            _global.p.get(this)[_global.audioElement].pause();
          } catch (e) {
            _global.p.get(this)[onAudioError](e);
          }

          _global.p.get(this)[_global.icecastMetadataQueue].purgeMetadataQueue();

          _global.p.get(this)[_global.codecUpdateQueue].purgeMetadataQueue();

          _global.p.get(this)[playerResetPromise] = _global.p.get(this)[playerFactory].player.reset();
        }
      },
      // audio element event handlers
      [onAudioPlay]: () => {
        this.play();
      },
      [onAudioPause]: () => {
        this.stop();
      },
      [onAudioError]: e => {
        const errors = {
          1: " MEDIA_ERR_ABORTED The fetching of the associated resource was aborted by the user's request.",
          2: " MEDIA_ERR_NETWORK Some kind of network error occurred which prevented the media from being successfully fetched, despite having previously been available.",
          3: " MEDIA_ERR_DECODE Despite having previously been determined to be usable, an error occurred while trying to decode the media resource, resulting in an error.",
          4: " MEDIA_ERR_SRC_NOT_SUPPORTED The associated resource or media provider object (such as a MediaStream) has been found to be unsuitable.",
          5: " MEDIA_ERR_ENCRYPTED"
        };
        const error = e?.target?.error || e;

        if (this.state !== _global.state.RETRYING) {
          this[_global.fireEvent](_global.event.ERROR, "The audio element encountered an error." + (errors[error?.code] || ""), error);

          this.stop();
        } else {
          _global.p.get(this)[resetPlayback]();
        }
      },
      [onPlay]: () => {
        const audio = _global.p.get(this)[_global.audioElement];

        if (this.state === _global.state.LOADING || !audio.loop && this.state !== _global.state.STOPPING && this.state !== _global.state.STOPPED) {
          audio.play().catch(e => {
            _global.p.get(this)[onAudioError](e);
          });
          this[playerState] = _global.state.PLAYING;
        }
      }
    });

    this[_global.attachAudioElement]();

    this[playerState] = _global.state.STOPPED;
    _global.p.get(this)[playerFactory] = new _PlayerFactory.default(this, _global.p.get(this)[playbackMethod], _global.p.get(this)[_global.icyCharacterEncoding]);
  }
  /**
   * @description Checks for MediaSource and HTML5 support for a given codec
   * @param {string} type Codec / mime-type to check
   * @returns {mediasource: string, html5: string} Object indicating if the codec is supported by MediaSource or HTML5 audio
   */


  static canPlayType(type) {
    return {
      mediasource: _MediaSourcePlayer.default.canPlayType(type),
      html5: _HTML5Player.default.canPlayType(type),
      webaudio: _WebAudioPlayer.default.canPlayType(type)
    };
  }
  /**
   * @returns {HTMLAudioElement} The audio element associated with this instance
   */


  get audioElement() {
    return _global.p.get(this)[_global.audioElement];
  }
  /**
   * @returns {number} The ICY metadata interval in number of bytes for this instance
   */


  get icyMetaInt() {
    return _global.p.get(this)[playerFactory].icyMetaInt;
  }
  /**
   * @returns {Array<Metadata>} Array of enqueued metadata objects in FILO order
   */


  get metadataQueue() {
    return _global.p.get(this)[_global.icecastMetadataQueue].metadataQueue;
  }
  /**
   * @returns {string} The current state ("loading", "playing", "stopping", "stopped", "retrying")
   */


  get state() {
    return _global.p.get(this)[playerState];
  }
  /**
   * @returns {string} The playback method ("mediasource", "webaudio", "html5")
   */


  get playbackMethod() {
    return _global.p.get(this)[playerFactory].playbackMethod;
  }

  set [playerState](_state) {
    this.dispatchEvent(new CustomEvent(_state));
    _global.p.get(this)[playerState] = _state;
  }

  [_global.attachAudioElement]() {
    // audio events
    const audio = _global.p.get(this)[_global.audioElement];

    audio.addEventListener("pause", _global.p.get(this)[onAudioPause]);
    audio.addEventListener("play", _global.p.get(this)[onAudioPlay]);
    audio.addEventListener("error", _global.p.get(this)[onAudioError]);
    this.addEventListener("play", _global.p.get(this)[onPlay]);
  }
  /**
   * @description Remove event listeners from the audio element and this instance and stops playback
   */


  async detachAudioElement() {
    const audio = _global.p.get(this)[_global.audioElement];

    audio.removeEventListener("pause", _global.p.get(this)[onAudioPause]);
    audio.removeEventListener("play", _global.p.get(this)[onAudioPlay]);
    audio.removeEventListener("error", _global.p.get(this)[onAudioError]);
    this.removeEventListener("play", _global.p.get(this)[onPlay]);
    await this.stop();
  }
  /**
   * @description Plays the Icecast stream
   * @async Resolves when the audio element is playing
   */


  async play() {
    if (this.state === _global.state.STOPPED) {
      _global.p.get(this)[_global.abortController] = new AbortController();
      this[playerState] = _global.state.LOADING;

      this[_global.fireEvent](_global.event.LOAD); // prettier-ignore


      const tryFetching = async () => _global.p.get(this)[playerFactory].playStream().catch(async e => {
        if (e.name !== "AbortError") {
          if (await this[_global.shouldRetry](e)) {
            this[_global.fireEvent](_global.event.RETRY);

            return tryFetching();
          }

          _global.p.get(this)[_global.abortController].abort(); // stop fetch if is wasn't aborted


          if (_global.p.get(this)[playerState] !== _global.state.STOPPING && _global.p.get(this)[playerState] !== _global.state.STOPPED) {
            this[_global.fireEvent](_global.event.ERROR, e.message.match(/network|fetch|offline|codec/i) ? e : e.stack, e);
          }
        }
      });

      tryFetching().finally(() => {
        _global.p.get(this)[resetPlayback]();

        this[_global.fireEvent](_global.event.STOP);

        this[playerState] = _global.state.STOPPED;
      });
      await new Promise(resolve => {
        this.addEventListener(_global.event.PLAY, resolve, {
          once: true
        });
      });
    }
  }
  /**
   * @description Stops playing the Icecast stream
   * @async Resolves the icecast stream has stopped
   */


  async stop() {
    if (this.state !== _global.state.STOPPED && this.state !== _global.state.STOPPING) {
      this[playerState] = _global.state.STOPPING;

      _global.p.get(this)[_global.abortController].abort();

      await new Promise(resolve => {
        this.addEventListener(_global.event.STOP, resolve, {
          once: true
        });
      });
    }
  }

  async [_global.shouldRetry](error) {
    if (_global.p.get(this)[_global.retryTimeout] === 0) return false;

    if (_global.p.get(this)[playerState] === _global.state.RETRYING) {
      // wait for retry interval
      await new Promise(resolve => {
        this.addEventListener(_global.state.STOPPING, resolve, {
          once: true
        });
        const delay = Math.min(_global.p.get(this)[_global.retryDelayMin] * _global.p.get(this)[_global.retryDelayRate] ** _global.p.get(this)[retryAttempt]++, _global.p.get(this)[_global.retryDelayMax]); // exponential backoff

        setTimeout(() => {
          this.removeEventListener(_global.state.STOPPING, resolve);
          resolve();
        }, delay + delay * 0.3 * Math.random()); // jitter
      }); // ensure the retry hasn't been cancelled while waiting

      return _global.p.get(this)[playerState] === _global.state.RETRYING;
    }

    if (_global.p.get(this)[playerState] !== _global.state.STOPPING && _global.p.get(this)[playerState] !== _global.state.STOPPED && (error.message.match(/network|fetch|offline|Error in body stream/i) || error.name === "HTTP Response Error")) {
      this[_global.fireEvent](_global.event.ERROR, error.name, error);

      this[playerState] = _global.state.RETRYING;
      this.addEventListener(_global.event.STREAM_START, _global.p.get(this)[resetPlayback], {
        once: true
      });

      if (_global.p.get(this)[_global.hasIcy]) {
        this[_global.fireEvent](_global.event.WARN, "This stream was requested with ICY metadata.", 'If there is a CORS preflight failure, try removing "icy" from the metadataTypes option.', "See https://github.com/eshaz/icecast-metadata-js#cors for more details.");
      }

      const audioWaiting = new Promise(resolve => {
        _global.p.get(this)[onAudioWaiting] = resolve;

        _global.p.get(this)[_global.audioElement].addEventListener("waiting", _global.p.get(this)[onAudioWaiting], {
          once: true
        });
      }); // wait for whichever is longer, audio element waiting or retry timeout

      _global.p.get(this)[retryTimeoutId] = setTimeout(() => {
        audioWaiting.then(() => {
          if (_global.p.get(this)[playerState] === _global.state.RETRYING) {
            this[_global.fireEvent](_global.event.RETRY_TIMEOUT);

            this.stop();
          }
        });
      }, _global.p.get(this)[_global.retryTimeout]);
      _global.p.get(this)[retryAttempt] = 0;
      return true;
    }

    return false;
  }

  [_global.fireEvent](event, ...args) {
    this.dispatchEvent(new CustomEvent(event, {
      detail: args
    }));

    _global.p.get(this)[events][event](...args);
  }

  [_global.logError](consoleFunction, callback, messages) {
    if (_global.p.get(this)[_global.enableLogging]) {
      consoleFunction("icecast-metadata-js", messages.reduce((acc, message) => acc + "\n  " + message, ""));
    }

    if (callback) callback(...messages);
  }

}

exports.default = IcecastMetadataPlayer;

},{"./EventTargetPolyfill.js":44,"./PlayerFactory.js":47,"./global.js":48,"./players/HTML5Player.js":49,"./players/MediaSourcePlayer.js":50,"./players/WebAudioPlayer.js":52,"icecast-metadata-js":35}],47:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _icecastMetadataJs = require("icecast-metadata-js");

var _codecParser = _interopRequireDefault(require("codec-parser"));

var _global = require("./global.js");

var _Player = _interopRequireDefault(require("./players/Player.js"));

var _HTML5Player = _interopRequireDefault(require("./players/HTML5Player.js"));

var _MediaSourcePlayer = _interopRequireDefault(require("./players/MediaSourcePlayer.js"));

var _WebAudioPlayer = _interopRequireDefault(require("./players/WebAudioPlayer.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class PlayerFactory {
  constructor(icecast, preferredPlaybackMethod) {
    const instanceVariables = _global.p.get(icecast);

    this._icecast = icecast;
    this._enableLogging = instanceVariables[_global.enableLogging];
    this._enableCodecUpdate = instanceVariables[_global.enableCodecUpdate];
    this._audioElement = instanceVariables[_global.audioElement];
    this._endpoint = instanceVariables[_global.endpoint];
    this._metadataTypes = instanceVariables[_global.metadataTypes];
    this._icyMetaInt = instanceVariables[_global.icyMetaInt];
    this._icyCharacterEncoding = instanceVariables[_global.icyCharacterEncoding];
    this._icyDetectionTimeout = instanceVariables[_global.icyDetectionTimeout];
    this._hasIcy = instanceVariables[_global.hasIcy];
    this._preferredPlaybackMethod = preferredPlaybackMethod || "mediasource";
    this._playbackMethod = "";
    this._player = new _Player.default(this._icecast);
    this._unprocessedFrames = [];
    this._codecParser = undefined;
    this._inputMimeType = "";
    this._codec = "";
  }

  get player() {
    return this._player;
  }

  get playbackMethod() {
    return this._playbackMethod;
  }

  get icyMetaInt() {
    return this._icecastReadableStream && this._icecastReadableStream.icyMetaInt;
  }

  async playStream() {
    return this.fetchStream().then(async res => {
      this._icecast[_global.fireEvent](_global.event.STREAM_START);

      return this.readIcecastResponse(res).finally(() => {
        this._icecast[_global.fireEvent](_global.event.STREAM_END);
      });
    });
  }

  async fetchStream() {
    const res = await fetch(this._endpoint, {
      method: "GET",
      headers: this._hasIcy ? {
        "Icy-MetaData": 1
      } : {},
      signal: _global.p.get(this._icecast)[_global.abortController].signal
    });

    if (!res.ok) {
      const error = new Error(`${res.status} received from ${res.url}`);
      error.name = "HTTP Response Error";
      throw error;
    }

    return res;
  }

  async readIcecastResponse(res) {
    const inputMimeType = res.headers.get("content-type");
    const codecPromise = new Promise(onCodec => {
      this._codecParser = new _codecParser.default(inputMimeType, {
        onCodecUpdate: this._enableCodecUpdate && ((...args) => this._player.onCodecUpdate(...args)),
        onCodec,
        enableLogging: this._enableLogging
      });
    });
    this._icecastReadableStream = new _icecastMetadataJs.IcecastReadableStream(res, {
      onMetadata: async metadata => {
        this._player.onMetadata(metadata);
      },
      onStream: async ({
        stream
      }) => {
        this._icecast[_global.fireEvent](_global.event.STREAM, stream);

        const frames = [...this._codecParser.parseChunk(stream)];

        if (this._player.isAudioPlayer) {
          await this._player.onStream([...this._unprocessedFrames, ...frames]);
          this._unprocessedFrames = [];
        } else {
          this._unprocessedFrames.push(...frames);
        }
      },
      onError: (...args) => this._icecast[_global.fireEvent](_global.event.WARN, ...args),
      metadataTypes: this._metadataTypes,
      icyCharacterEncoding: this._icyCharacterEncoding,
      icyDetectionTimeout: this._icyDetectionTimeout,
      ...(this._icyMetaInt && {
        icyMetaInt: this._icyMetaInt
      })
    });

    const icecastPromise = this._icecastReadableStream.startReading();

    if (!this._player.isAudioPlayer) {
      this._buildPlayer(inputMimeType, await codecPromise);
    }

    await icecastPromise;
  }

  _buildPlayer(inputMimeType, codec) {
    // in order of preference
    const {
      [this._preferredPlaybackMethod]: firstMethod,
      ...rest
    } = {
      mediasource: _MediaSourcePlayer.default,
      webaudio: _WebAudioPlayer.default,
      html5: _HTML5Player.default
    };

    for (const player of Object.values({
      firstMethod,
      ...rest
    })) {
      const support = player.canPlayType(`${inputMimeType};codecs="${codec}"`);

      if (support === "probably" || support === "maybe") {
        this._playbackMethod = player.name;
        this._player = new player(this._icecast, inputMimeType, codec);
        break;
      }
    }

    if (!this._player) {
      throw new Error(`Your browser does not support this audio codec ${inputMimeType}${codec && `;codecs="${codec}"`}`);
    }
  }

}

exports.default = PlayerFactory;

},{"./global.js":48,"./players/HTML5Player.js":49,"./players/MediaSourcePlayer.js":50,"./players/Player.js":51,"./players/WebAudioPlayer.js":52,"codec-parser":6,"icecast-metadata-js":35}],48:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.state = exports.shouldRetry = exports.retryTimeout = exports.retryDelayRate = exports.retryDelayMin = exports.retryDelayMax = exports.p = exports.noOp = exports.metadataTypes = exports.logError = exports.icyMetaInt = exports.icyDetectionTimeout = exports.icyCharacterEncoding = exports.icecastMetadataQueue = exports.hasIcy = exports.fireEvent = exports.event = exports.endpoint = exports.enableLogging = exports.enableCodecUpdate = exports.concatBuffers = exports.codecUpdateQueue = exports.bufferLength = exports.audioElement = exports.attachAudioElement = exports.abortController = exports.SYNCING = exports.SYNCED = exports.NOT_SYNCED = void 0;

const noOp = () => {};

exports.noOp = noOp;
const p = new WeakMap();
exports.p = p;
const state = {
  LOADING: "loading",
  PLAYING: "playing",
  STOPPING: "stopping",
  STOPPED: "stopped",
  RETRYING: "retrying"
};
exports.state = state;
const event = {
  BUFFER: "buffer",
  PLAY: "play",
  LOAD: "load",
  STREAM_START: "streamstart",
  STREAM: "stream",
  STREAM_END: "streamend",
  METADATA: "metadata",
  METADATA_ENQUEUE: "metadataenqueue",
  CODEC_UPDATE: "codecupdate",
  STOP: "stop",
  RETRY: "retry",
  RETRY_TIMEOUT: "retrytimeout",
  WARN: "warn",
  ERROR: "error"
}; // options

exports.event = event;
const endpoint = Symbol();
exports.endpoint = endpoint;
const metadataTypes = Symbol();
exports.metadataTypes = metadataTypes;
const audioElement = Symbol();
exports.audioElement = audioElement;
const bufferLength = Symbol();
exports.bufferLength = bufferLength;
const icyMetaInt = Symbol();
exports.icyMetaInt = icyMetaInt;
const icyCharacterEncoding = Symbol();
exports.icyCharacterEncoding = icyCharacterEncoding;
const icyDetectionTimeout = Symbol();
exports.icyDetectionTimeout = icyDetectionTimeout;
const enableLogging = Symbol();
exports.enableLogging = enableLogging;
const retryDelayRate = Symbol();
exports.retryDelayRate = retryDelayRate;
const retryDelayMin = Symbol();
exports.retryDelayMin = retryDelayMin;
const retryDelayMax = Symbol();
exports.retryDelayMax = retryDelayMax;
const retryTimeout = Symbol();
exports.retryTimeout = retryTimeout;
const enableCodecUpdate = Symbol(); // methods

exports.enableCodecUpdate = enableCodecUpdate;
const fireEvent = Symbol();
exports.fireEvent = fireEvent;
const attachAudioElement = Symbol();
exports.attachAudioElement = attachAudioElement;
const shouldRetry = Symbol();
exports.shouldRetry = shouldRetry;
const logError = Symbol(); // variables

exports.logError = logError;
const hasIcy = Symbol();
exports.hasIcy = hasIcy;
const icecastMetadataQueue = Symbol();
exports.icecastMetadataQueue = icecastMetadataQueue;
const codecUpdateQueue = Symbol();
exports.codecUpdateQueue = codecUpdateQueue;
const abortController = Symbol(); // sync state

exports.abortController = abortController;
const SYNCED = Symbol();
exports.SYNCED = SYNCED;
const SYNCING = Symbol();
exports.SYNCING = SYNCING;
const NOT_SYNCED = Symbol();
exports.NOT_SYNCED = NOT_SYNCED;

const concatBuffers = buffers => {
  const buffer = new Uint8Array(buffers.reduce((acc, buf) => acc + buf.length, 0));
  buffers.reduce((offset, buf) => {
    buffer.set(buf, offset);
    return offset + buf.length;
  }, 0);
  return buffer;
};

exports.concatBuffers = concatBuffers;

},{}],49:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _global = require("../global.js");

var _Player = _interopRequireDefault(require("./Player.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class HTML5Player extends _Player.default {
  constructor(icecast) {
    super(icecast);
    this._audioElement.crossOrigin = "anonymous";
    this._audioElement.loop = false;
    this._audioElement.preload = "none";
    this.reset();
  }

  static canPlayType(mimeType) {
    return super.canPlayType(type => new Audio().canPlayType(type), mimeType);
  }

  static get name() {
    return "html5";
  }

  get isAudioPlayer() {
    return true;
  }

  get metadataTimestamp() {
    return this._frame ? (this._frame.totalDuration + this._metadataTimestampOffset) / 1000 : 0;
  }

  get currentTime() {
    return this._audioLoadedTimestamp && (performance.now() - this._audioLoadedTimestamp) / 1000;
  }

  async reset() {
    this._frame = null;
    this._metadataLoadedTimestamp = performance.now();
    this._audioLoadedTimestamp = 0;
    this._metadataTimestampOffset = 0;
    this._firedPlay = false;

    this._audioElement.removeAttribute("src");

    this._audioElement.src = this._endpoint;

    if (this._icecast.state !== _global.state.STOPPING && this._icecast.state !== _global.state.STOPPED) {
      this._audioElement.addEventListener("playing", () => {
        this._audioLoadedTimestamp = performance.now();
        this._metadataTimestampOffset = performance.now() - this._metadataLoadedTimestamp;
      }, {
        once: true
      });

      if (!this._firedPlay) {
        this._icecast[_global.fireEvent](_global.event.PLAY);

        this._firedPlay = true;
      }
    }
  }

  onStream(frames) {
    this._frame = frames[frames.length - 1] || this._frame;
  }

}

exports.default = HTML5Player;

},{"../global.js":48,"./Player.js":51}],50:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _mseAudioWrapper = _interopRequireDefault(require("mse-audio-wrapper"));

var _global = require("../global.js");

var _Player = _interopRequireDefault(require("./Player.js"));

var _FrameQueue = _interopRequireDefault(require("../FrameQueue.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const BUFFER = 5; // seconds of audio to store in SourceBuffer

const BUFFER_INTERVAL = 5; // seconds before removing from SourceBuffer

class MediaSourcePlayer extends _Player.default {
  constructor(icecast, inputMimeType, codec) {
    super(icecast, inputMimeType, codec);
    this.reset();

    this._icecast.addEventListener(_global.event.RETRY, () => {
      this._syncState = _global.NOT_SYNCED;
    });
  }

  static canPlayType(mimeType) {
    const mapping = {
      mpeg: ['audio/mp4;codecs="mp3"'],
      aac: ['audio/mp4;codecs="mp4a.40.2"'],
      aacp: ['audio/mp4;codecs="mp4a.40.2"'],
      flac: ['audio/mp4;codecs="flac"'],
      ogg: {
        flac: ['audio/mp4;codecs="flac"'],
        opus: ['audio/mp4;codecs="opus"', 'audio/webm;codecs="opus"'],
        vorbis: ['audio/webm;codecs="vorbis"']
      }
    };

    try {
      new MediaSource();
    } catch {
      return "";
    }

    if (MediaSource.isTypeSupported(mimeType)) return "probably";
    return super.canPlayType(MediaSource.isTypeSupported, mimeType, mapping);
  }

  static get name() {
    return "mediasource";
  }

  get isAudioPlayer() {
    return true;
  }

  get metadataTimestamp() {
    return this._mediaSource && this._mediaSource.sourceBuffers.length && Math.max( // work-around for WEBM reporting a negative timestampOffset
    this._mediaSource.sourceBuffers[0].timestampOffset, this._mediaSource.sourceBuffers[0].buffered.length ? this._mediaSource.sourceBuffers[0].buffered.end(0) : 0) || 0;
  }

  get currentTime() {
    return this._audioElement.currentTime;
  }

  async reset() {
    this._syncState = _global.SYNCED;
    this._frameQueue = new _FrameQueue.default(this._icecast);
    this._sourceBufferQueue = [];
    this._firedPlay = false;
    this._mediaSourcePromise = this._prepareMediaSource(this._inputMimeType, this._codec);
    await this._mediaSourcePromise;
  }

  async onStream(frames) {
    frames = frames.flatMap(frame => frame.codecFrames || frame);

    if (frames.length) {
      switch (this._syncState) {
        case _global.NOT_SYNCED:
          this._frameQueue.initSync();

          this._syncState = _global.SYNCING;

        case _global.SYNCING:
          [frames] = this._frameQueue.sync(frames);
          if (frames.length) this._syncState = _global.SYNCED;
      }

      this._frameQueue.addAll(frames); // when frames are present, we should already know the codec and have the mse audio mimetype determined


      await (await this._mediaSourcePromise)(frames); // wait for the source buffer to be created
    }
  }

  async _prepareMediaSource(inputMimeType, codec) {
    if (MediaSource.isTypeSupported(inputMimeType)) {
      // pass the audio directly to MSE
      await this._createMediaSource(inputMimeType);
      return async frames => this._appendSourceBuffer((0, _global.concatBuffers)(frames.map(f => f.data)));
    } else {
      // wrap the audio into fragments before passing to MSE
      const wrapper = new _mseAudioWrapper.default(inputMimeType, {
        codec
      });

      if (!MediaSource.isTypeSupported(wrapper.mimeType)) {
        this._icecast[_global.fireEvent](_global.event.ERROR, `Media Source Extensions API in your browser does not support ${inputMimeType} or ${wrapper.mimeType}.` + "See: https://caniuse.com/mediasource and https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API");

        throw new Error(`Unsupported Media Source Codec ${wrapper.mimeType}`);
      }

      await this._createMediaSource(wrapper.mimeType);
      return async codecFrames => {
        const fragments = (0, _global.concatBuffers)([...wrapper.iterator(codecFrames)]);
        await this._appendSourceBuffer(fragments);
      };
    }
  }

  async _createMediaSource(mimeType) {
    await new Promise(async resolve => {
      this._mediaSource = new MediaSource();
      this._audioElement.loop = false;
      this._audioElement.src = URL.createObjectURL(this._mediaSource);

      this._mediaSource.addEventListener("sourceopen", resolve, {
        once: true
      });
    });
    this._sourceBufferRemoved = 0;
    this._mediaSource.addSourceBuffer(mimeType).mode = "sequence";
  }

  async _waitForSourceBuffer() {
    return new Promise(resolve => {
      this._mediaSource.sourceBuffers[0].addEventListener("updateend", resolve, {
        once: true
      });
    });
  }

  async _appendSourceBuffer(chunk) {
    this._icecast[_global.fireEvent](_global.event.STREAM, chunk);

    if (!this._mediaSource.sourceBuffers.length) {
      this._icecast[_global.fireEvent](_global.event.WARN, "Attempting to append audio, but MediaSource has not been or is no longer initialized", "Please be sure that `detachAudioElement()` was called and awaited before reusing the element with a new IcecastMetadataPlayer instance");
    }

    if (this._icecast.state !== _global.state.STOPPING && this._mediaSource.sourceBuffers.length) {
      this._sourceBufferQueue.push(chunk);

      try {
        do {
          this._mediaSource.sourceBuffers[0].appendBuffer(this._sourceBufferQueue[0]);

          await this._waitForSourceBuffer();

          this._sourceBufferQueue.shift();
        } while (this._sourceBufferQueue.length);
      } catch (e) {
        if (e.name !== "QuotaExceededError") throw e;
      }

      if (!this._firedPlay) {
        if (this._bufferLength <= this.metadataTimestamp) {
          this._icecast[_global.fireEvent](_global.event.PLAY);

          this._firedPlay = true;
        } else {
          this._icecast[_global.fireEvent](_global.event.BUFFER, this.metadataTimestamp);
        }
      }

      if (this._audioElement.currentTime > BUFFER + this._bufferLength && this._sourceBufferRemoved + BUFFER_INTERVAL * 1000 < Date.now()) {
        this._sourceBufferRemoved = Date.now();

        this._mediaSource.sourceBuffers[0].remove(0, this._audioElement.currentTime - BUFFER + this._bufferLength);

        await this._waitForSourceBuffer();
      }
    }
  }

}

exports.default = MediaSourcePlayer;

},{"../FrameQueue.js":45,"../global.js":48,"./Player.js":51,"mse-audio-wrapper":59}],51:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _global = require("../global.js");

class Player {
  constructor(icecast, inputMimeType, codec) {
    const instanceVariables = _global.p.get(icecast);

    this._icecast = icecast;
    this._inputMimeType = inputMimeType;
    this._codec = codec;
    this._audioElement = instanceVariables[_global.audioElement];
    this._icecastMetadataQueue = instanceVariables[_global.icecastMetadataQueue];
    this._codecUpdateQueue = instanceVariables[_global.codecUpdateQueue];
    this._endpoint = instanceVariables[_global.endpoint];
    this._bufferLength = instanceVariables[_global.bufferLength];
    this._codecUpdateTimestamp = 0;
    this._codecUpdateOffset = 0; // set the audio element an empty source to enable the play button

    try {
      this._audioElement.removeAttribute("src");

      this._audioElement.srcObject = null;

      if (window.MediaSource) {
        // MediaSourcePlayer
        this._audioElement.src = URL.createObjectURL(new MediaSource());
      } else {
        // WebAudioPlayer
        this._mediaStream = new MediaStream();
        this._audioElement.srcObject = this._mediaStream;
      }
    } catch {
      // HTML5Player
      // mp3 32kbs silence
      this._audioElement.src = "data:audio/mpeg;base64,//sQxAAABFgC/SCEYACCgB9AAAAAppppVCAHBAEIgBByw9WD5+J8ufwxiDED" + "sMfE+D4fwG/RUGCx6VO4awVxV3qDtQNPiXKnZUNSwKuUDR6IgaeoGg7Fg6pMQU1FMy4xMDCqqqqqqqr/+xL" + "EB4PAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" + "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=";
      this._audioElement.loop = true;
    }
  }

  static parseMimeType(mimeType) {
    return mimeType.match(/^(?:application\/|audio\/|)(?<mime>[a-zA-Z]+)(?:$|;[ ]*codecs=(?:\'|\")(?<codecs>[a-zA-Z,]+)(?:\'|\"))/);
  }

  static canPlayType(codecChecker, mimeType, mapping) {
    const matches = Player.parseMimeType(mimeType);

    const checkCodecs = codecs => codecs.reduce((acc, codec) => {
      if (acc === "") return "";
      const result = codecChecker(codec);
      if (!result) return "";
      if (result === "maybe" || acc === "maybe") return "maybe";
      if (result === true || result === "probably") return "probably";
    }, null);

    if (matches) {
      const {
        mime,
        codecs
      } = matches.groups;
      const mimeMapping = mapping && mapping[mime]; // mapping is a raw codec

      if (!mimeMapping || Array.isArray(mimeMapping)) {
        return checkCodecs(mimeMapping || [mimeType]) || // check with the codec
        checkCodecs([`audio/${mime}`]) // check as a raw mimetype
        ;
      } // mapping ia a container


      if (typeof mimeMapping === "object") {
        if (codecs) {
          const mimeCodecs = codecs.split(","); // multiple codecs are not supported

          if (mimeCodecs.length > 1) return "";
          if (!mimeMapping[mimeCodecs[0]]) return "";
          return checkCodecs(mimeMapping[mimeCodecs[0]]);
        } // container exists in list but no codecs were specified


        return "maybe";
      }
    } // codec not in the list


    return "";
  }
  /**
   * @abstract
   */


  get isAudioPlayer() {
    return false;
  }
  /**
   * @interface
   */


  get metadataTimestamp() {
    return 0;
  }
  /**
   * @interface
   */


  get currentTime() {
    return 0;
  }
  /**
   * @interface
   */


  async reset() {}
  /**
   * @abstract
   */


  onStream(frames) {
    return frames;
  }
  /**
   * @abstract
   */


  onMetadata(metadata) {
    this._icecastMetadataQueue.addMetadata(metadata, this.metadataTimestamp, this.currentTime);
  }
  /**
   * @abstract
   */


  onCodecUpdate(codecData, updateTimestamp) {
    const currentTime = this.currentTime; // add previous offset when reconnecting

    if (updateTimestamp < currentTime) this._codecUpdateOffset += this._codecUpdateTimestamp;
    this._codecUpdateTimestamp = updateTimestamp;

    this._codecUpdateQueue.addMetadata({
      metadata: codecData,
      stats: {}
    }, (updateTimestamp + this._codecUpdateOffset) / 1000, currentTime);
  }

}

exports.default = Player;

},{"../global.js":48}],52:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _opusDecoder = require("opus-decoder");

var _mpg123Decoder = require("mpg123-decoder");

var _FrameQueue = _interopRequireDefault(require("../FrameQueue.js"));

var _global = require("../global.js");

var _Player = _interopRequireDefault(require("./Player.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class WebAudioPlayer extends _Player.default {
  constructor(icecast, inputMimeType, codec) {
    super(icecast, inputMimeType, codec);

    this._icecast.addEventListener(_global.event.RETRY, () => {
      this._syncState = _global.NOT_SYNCED;
    });

    this._icecast.addEventListener(_global.event.STREAM_START, () => {
      if (!this._wasmDecoder) this._getWasmDecoder();
    });

    this._getWasmDecoder(); // set up audio context once
    // audio context needs to be reused for the life of this instance for safari compatibility


    this._getAudioContext();

    this.reset();
  }

  static canPlayType(mimeType) {
    const mapping = {
      mpeg: ["audio/mpeg"],
      ogg: {
        opus: ['audio/ogg;codecs="opus"']
      }
    };
    if (!window.WebAssembly) return "";
    if (!(window.AudioContext || window.webkitAudioContext)) return "";
    if (!window.MediaStream) return "";
    return super.canPlayType(codec => codec === 'audio/ogg;codecs="opus"' || codec === "audio/mpeg", mimeType, mapping);
  }

  static get name() {
    return "webaudio";
  }

  get isAudioPlayer() {
    return true;
  }

  get metadataTimestamp() {
    return this._currentTime / 1000;
  }

  get currentTime() {
    return (Date.now() - this._startTime) / 1000 || 0;
  }

  _getWasmDecoder() {
    switch (this._codec) {
      case "mpeg":
        this._wasmDecoder = new _mpg123Decoder.MPEGDecoderWebWorker();
        break;

      case "opus":
        this._wasmDecoder = new _opusDecoder.OpusDecoderWebWorker();
        break;
    }

    this._wasmReady = this._wasmDecoder.ready;
  }

  _getAudioContext() {
    const audioContextParams = {
      latencyHint: "playback"
    };
    this._audioContext = window.AudioContext ? new AudioContext(audioContextParams) : new window.webkitAudioContext(audioContextParams); // hack for iOS to continue playing while locked

    this._audioContext.createScriptProcessor(2 ** 14, 2, 2).connect(this._audioContext.destination);

    this._audioContext.resume();

    this._audioContext.onstatechange = () => {
      if (this._audioContext !== "running") this._audioContext.resume();
    };
  }

  async reset() {
    this._syncState = _global.SYNCED;
    this._syncSuccessful = false;
    this._frameQueue = new _FrameQueue.default(this._icecast);
    this._currentTime = 0;
    this._decodedSample = 0;
    this._decodedSampleOffset = 0;
    this._sampleRate = 0;
    this._startTime = undefined;
    this._firedPlay = false;

    if (this._icecast.state === _global.state.STOPPING || this._icecast.state === _global.state.STOPPED) {
      if (this._wasmDecoder) {
        const decoder = this._wasmDecoder;

        this._wasmReady.then(() => {
          decoder.free();
        });

        this._wasmDecoder = null;
      }

      if (this._mediaStream) {
        // disconnect the currently playing media stream
        this._mediaStream.disconnect();

        this._mediaStream = null;
      }

      this._audioElement.srcObject = new MediaStream();
    }
  }

  async onStream(oggPages) {
    let frames = oggPages.flatMap(oggPage => oggPage.codecFrames || oggPage);

    switch (this._syncState) {
      case _global.NOT_SYNCED:
        this._frameQueue.initSync();

        this._syncState = _global.SYNCING;

      case _global.SYNCING:
        [frames, this._syncSuccessful] = this._frameQueue.sync(frames);

        if (frames.length) {
          this._syncState = _global.SYNCED;
          if (!this._syncSuccessful) await this.reset();
        }

      case _global.SYNCED:
        if (frames.length) {
          this._currentTime = frames[frames.length - 1].totalDuration;
          await this._wasmReady;

          this._decodeAndPlay(frames);
        }

      default:
        this._frameQueue.addAll(frames);

      // always add frames
    }
  }

  async _decodeAndPlay(frames) {
    const {
      channelData,
      samplesDecoded,
      sampleRate
    } = await this._wasmDecoder.decodeFrames(frames.map(f => f.data));

    if (this._icecast.state !== _global.state.STOPPING && this._icecast.state !== _global.state.STOPPED && samplesDecoded) {
      this._icecast[_global.fireEvent](_global.event.STREAM, {
        channelData,
        samplesDecoded,
        sampleRate
      });

      if (!this._sampleRate) {
        this._sampleRate = sampleRate;
        this._mediaStream = this._audioContext.createMediaStreamDestination();
        this._audioElement.srcObject = this._mediaStream.stream; // triggers canplay event
      }

      const decodeDuration = (this._decodedSample + this._decodedSampleOffset) / this._sampleRate;

      if (decodeDuration < this._audioContext.currentTime) {
        // audio context time starts incrementing immediately when it's created
        // offset needs to be accounted for to prevent overlapping sources
        this._decodedSampleOffset += Math.floor(this._audioContext.currentTime * this._sampleRate);
      }

      const audioBuffer = this._audioContext.createBuffer(channelData.length, samplesDecoded, this._sampleRate);

      channelData.forEach((channel, idx) => audioBuffer.getChannelData(idx).set(channel));

      const source = this._audioContext.createBufferSource();

      source.buffer = audioBuffer;
      source.connect(this._mediaStream);
      source.start(decodeDuration);

      if (!this._firedPlay) {
        if (this._bufferLength <= this.metadataTimestamp) {
          this._icecast[_global.fireEvent](_global.event.PLAY);

          this._startTime = Date.now();
          this._firedPlay = true;
        } else {
          this._icecast[_global.fireEvent](_global.event.BUFFER, this.metadataTimestamp);
        }
      }

      this._decodedSample += samplesDecoded;
    }
  }

}

exports.default = WebAudioPlayer;

},{"../FrameQueue.js":45,"../global.js":48,"./Player.js":51,"mpg123-decoder":55,"opus-decoder":68}],53:[function(require,module,exports){
/*! ieee754. BSD-3-Clause License. Feross Aboukhadijeh <https://feross.org/opensource> */
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = (nBytes * 8) - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = (e * 256) + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = (m * 256) + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = (nBytes * 8) - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = ((value * c) - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],54:[function(require,module,exports){
/*!
 * jQuery JavaScript Library v3.6.0
 * https://jquery.com/
 *
 * Includes Sizzle.js
 * https://sizzlejs.com/
 *
 * Copyright OpenJS Foundation and other contributors
 * Released under the MIT license
 * https://jquery.org/license
 *
 * Date: 2021-03-02T17:08Z
 */
( function( global, factory ) {

	"use strict";

	if ( typeof module === "object" && typeof module.exports === "object" ) {

		// For CommonJS and CommonJS-like environments where a proper `window`
		// is present, execute the factory and get jQuery.
		// For environments that do not have a `window` with a `document`
		// (such as Node.js), expose a factory as module.exports.
		// This accentuates the need for the creation of a real `window`.
		// e.g. var jQuery = require("jquery")(window);
		// See ticket #14549 for more info.
		module.exports = global.document ?
			factory( global, true ) :
			function( w ) {
				if ( !w.document ) {
					throw new Error( "jQuery requires a window with a document" );
				}
				return factory( w );
			};
	} else {
		factory( global );
	}

// Pass this if window is not defined yet
} )( typeof window !== "undefined" ? window : this, function( window, noGlobal ) {

// Edge <= 12 - 13+, Firefox <=18 - 45+, IE 10 - 11, Safari 5.1 - 9+, iOS 6 - 9.1
// throw exceptions when non-strict code (e.g., ASP.NET 4.5) accesses strict mode
// arguments.callee.caller (trac-13335). But as of jQuery 3.0 (2016), strict mode should be common
// enough that all such attempts are guarded in a try block.
"use strict";

var arr = [];

var getProto = Object.getPrototypeOf;

var slice = arr.slice;

var flat = arr.flat ? function( array ) {
	return arr.flat.call( array );
} : function( array ) {
	return arr.concat.apply( [], array );
};


var push = arr.push;

var indexOf = arr.indexOf;

var class2type = {};

var toString = class2type.toString;

var hasOwn = class2type.hasOwnProperty;

var fnToString = hasOwn.toString;

var ObjectFunctionString = fnToString.call( Object );

var support = {};

var isFunction = function isFunction( obj ) {

		// Support: Chrome <=57, Firefox <=52
		// In some browsers, typeof returns "function" for HTML <object> elements
		// (i.e., `typeof document.createElement( "object" ) === "function"`).
		// We don't want to classify *any* DOM node as a function.
		// Support: QtWeb <=3.8.5, WebKit <=534.34, wkhtmltopdf tool <=0.12.5
		// Plus for old WebKit, typeof returns "function" for HTML collections
		// (e.g., `typeof document.getElementsByTagName("div") === "function"`). (gh-4756)
		return typeof obj === "function" && typeof obj.nodeType !== "number" &&
			typeof obj.item !== "function";
	};


var isWindow = function isWindow( obj ) {
		return obj != null && obj === obj.window;
	};


var document = window.document;



	var preservedScriptAttributes = {
		type: true,
		src: true,
		nonce: true,
		noModule: true
	};

	function DOMEval( code, node, doc ) {
		doc = doc || document;

		var i, val,
			script = doc.createElement( "script" );

		script.text = code;
		if ( node ) {
			for ( i in preservedScriptAttributes ) {

				// Support: Firefox 64+, Edge 18+
				// Some browsers don't support the "nonce" property on scripts.
				// On the other hand, just using `getAttribute` is not enough as
				// the `nonce` attribute is reset to an empty string whenever it
				// becomes browsing-context connected.
				// See https://github.com/whatwg/html/issues/2369
				// See https://html.spec.whatwg.org/#nonce-attributes
				// The `node.getAttribute` check was added for the sake of
				// `jQuery.globalEval` so that it can fake a nonce-containing node
				// via an object.
				val = node[ i ] || node.getAttribute && node.getAttribute( i );
				if ( val ) {
					script.setAttribute( i, val );
				}
			}
		}
		doc.head.appendChild( script ).parentNode.removeChild( script );
	}


function toType( obj ) {
	if ( obj == null ) {
		return obj + "";
	}

	// Support: Android <=2.3 only (functionish RegExp)
	return typeof obj === "object" || typeof obj === "function" ?
		class2type[ toString.call( obj ) ] || "object" :
		typeof obj;
}
/* global Symbol */
// Defining this global in .eslintrc.json would create a danger of using the global
// unguarded in another place, it seems safer to define global only for this module



var
	version = "3.6.0",

	// Define a local copy of jQuery
	jQuery = function( selector, context ) {

		// The jQuery object is actually just the init constructor 'enhanced'
		// Need init if jQuery is called (just allow error to be thrown if not included)
		return new jQuery.fn.init( selector, context );
	};

jQuery.fn = jQuery.prototype = {

	// The current version of jQuery being used
	jquery: version,

	constructor: jQuery,

	// The default length of a jQuery object is 0
	length: 0,

	toArray: function() {
		return slice.call( this );
	},

	// Get the Nth element in the matched element set OR
	// Get the whole matched element set as a clean array
	get: function( num ) {

		// Return all the elements in a clean array
		if ( num == null ) {
			return slice.call( this );
		}

		// Return just the one element from the set
		return num < 0 ? this[ num + this.length ] : this[ num ];
	},

	// Take an array of elements and push it onto the stack
	// (returning the new matched element set)
	pushStack: function( elems ) {

		// Build a new jQuery matched element set
		var ret = jQuery.merge( this.constructor(), elems );

		// Add the old object onto the stack (as a reference)
		ret.prevObject = this;

		// Return the newly-formed element set
		return ret;
	},

	// Execute a callback for every element in the matched set.
	each: function( callback ) {
		return jQuery.each( this, callback );
	},

	map: function( callback ) {
		return this.pushStack( jQuery.map( this, function( elem, i ) {
			return callback.call( elem, i, elem );
		} ) );
	},

	slice: function() {
		return this.pushStack( slice.apply( this, arguments ) );
	},

	first: function() {
		return this.eq( 0 );
	},

	last: function() {
		return this.eq( -1 );
	},

	even: function() {
		return this.pushStack( jQuery.grep( this, function( _elem, i ) {
			return ( i + 1 ) % 2;
		} ) );
	},

	odd: function() {
		return this.pushStack( jQuery.grep( this, function( _elem, i ) {
			return i % 2;
		} ) );
	},

	eq: function( i ) {
		var len = this.length,
			j = +i + ( i < 0 ? len : 0 );
		return this.pushStack( j >= 0 && j < len ? [ this[ j ] ] : [] );
	},

	end: function() {
		return this.prevObject || this.constructor();
	},

	// For internal use only.
	// Behaves like an Array's method, not like a jQuery method.
	push: push,
	sort: arr.sort,
	splice: arr.splice
};

jQuery.extend = jQuery.fn.extend = function() {
	var options, name, src, copy, copyIsArray, clone,
		target = arguments[ 0 ] || {},
		i = 1,
		length = arguments.length,
		deep = false;

	// Handle a deep copy situation
	if ( typeof target === "boolean" ) {
		deep = target;

		// Skip the boolean and the target
		target = arguments[ i ] || {};
		i++;
	}

	// Handle case when target is a string or something (possible in deep copy)
	if ( typeof target !== "object" && !isFunction( target ) ) {
		target = {};
	}

	// Extend jQuery itself if only one argument is passed
	if ( i === length ) {
		target = this;
		i--;
	}

	for ( ; i < length; i++ ) {

		// Only deal with non-null/undefined values
		if ( ( options = arguments[ i ] ) != null ) {

			// Extend the base object
			for ( name in options ) {
				copy = options[ name ];

				// Prevent Object.prototype pollution
				// Prevent never-ending loop
				if ( name === "__proto__" || target === copy ) {
					continue;
				}

				// Recurse if we're merging plain objects or arrays
				if ( deep && copy && ( jQuery.isPlainObject( copy ) ||
					( copyIsArray = Array.isArray( copy ) ) ) ) {
					src = target[ name ];

					// Ensure proper type for the source value
					if ( copyIsArray && !Array.isArray( src ) ) {
						clone = [];
					} else if ( !copyIsArray && !jQuery.isPlainObject( src ) ) {
						clone = {};
					} else {
						clone = src;
					}
					copyIsArray = false;

					// Never move original objects, clone them
					target[ name ] = jQuery.extend( deep, clone, copy );

				// Don't bring in undefined values
				} else if ( copy !== undefined ) {
					target[ name ] = copy;
				}
			}
		}
	}

	// Return the modified object
	return target;
};

jQuery.extend( {

	// Unique for each copy of jQuery on the page
	expando: "jQuery" + ( version + Math.random() ).replace( /\D/g, "" ),

	// Assume jQuery is ready without the ready module
	isReady: true,

	error: function( msg ) {
		throw new Error( msg );
	},

	noop: function() {},

	isPlainObject: function( obj ) {
		var proto, Ctor;

		// Detect obvious negatives
		// Use toString instead of jQuery.type to catch host objects
		if ( !obj || toString.call( obj ) !== "[object Object]" ) {
			return false;
		}

		proto = getProto( obj );

		// Objects with no prototype (e.g., `Object.create( null )`) are plain
		if ( !proto ) {
			return true;
		}

		// Objects with prototype are plain iff they were constructed by a global Object function
		Ctor = hasOwn.call( proto, "constructor" ) && proto.constructor;
		return typeof Ctor === "function" && fnToString.call( Ctor ) === ObjectFunctionString;
	},

	isEmptyObject: function( obj ) {
		var name;

		for ( name in obj ) {
			return false;
		}
		return true;
	},

	// Evaluates a script in a provided context; falls back to the global one
	// if not specified.
	globalEval: function( code, options, doc ) {
		DOMEval( code, { nonce: options && options.nonce }, doc );
	},

	each: function( obj, callback ) {
		var length, i = 0;

		if ( isArrayLike( obj ) ) {
			length = obj.length;
			for ( ; i < length; i++ ) {
				if ( callback.call( obj[ i ], i, obj[ i ] ) === false ) {
					break;
				}
			}
		} else {
			for ( i in obj ) {
				if ( callback.call( obj[ i ], i, obj[ i ] ) === false ) {
					break;
				}
			}
		}

		return obj;
	},

	// results is for internal usage only
	makeArray: function( arr, results ) {
		var ret = results || [];

		if ( arr != null ) {
			if ( isArrayLike( Object( arr ) ) ) {
				jQuery.merge( ret,
					typeof arr === "string" ?
						[ arr ] : arr
				);
			} else {
				push.call( ret, arr );
			}
		}

		return ret;
	},

	inArray: function( elem, arr, i ) {
		return arr == null ? -1 : indexOf.call( arr, elem, i );
	},

	// Support: Android <=4.0 only, PhantomJS 1 only
	// push.apply(_, arraylike) throws on ancient WebKit
	merge: function( first, second ) {
		var len = +second.length,
			j = 0,
			i = first.length;

		for ( ; j < len; j++ ) {
			first[ i++ ] = second[ j ];
		}

		first.length = i;

		return first;
	},

	grep: function( elems, callback, invert ) {
		var callbackInverse,
			matches = [],
			i = 0,
			length = elems.length,
			callbackExpect = !invert;

		// Go through the array, only saving the items
		// that pass the validator function
		for ( ; i < length; i++ ) {
			callbackInverse = !callback( elems[ i ], i );
			if ( callbackInverse !== callbackExpect ) {
				matches.push( elems[ i ] );
			}
		}

		return matches;
	},

	// arg is for internal usage only
	map: function( elems, callback, arg ) {
		var length, value,
			i = 0,
			ret = [];

		// Go through the array, translating each of the items to their new values
		if ( isArrayLike( elems ) ) {
			length = elems.length;
			for ( ; i < length; i++ ) {
				value = callback( elems[ i ], i, arg );

				if ( value != null ) {
					ret.push( value );
				}
			}

		// Go through every key on the object,
		} else {
			for ( i in elems ) {
				value = callback( elems[ i ], i, arg );

				if ( value != null ) {
					ret.push( value );
				}
			}
		}

		// Flatten any nested arrays
		return flat( ret );
	},

	// A global GUID counter for objects
	guid: 1,

	// jQuery.support is not used in Core but other projects attach their
	// properties to it so it needs to exist.
	support: support
} );

if ( typeof Symbol === "function" ) {
	jQuery.fn[ Symbol.iterator ] = arr[ Symbol.iterator ];
}

// Populate the class2type map
jQuery.each( "Boolean Number String Function Array Date RegExp Object Error Symbol".split( " " ),
	function( _i, name ) {
		class2type[ "[object " + name + "]" ] = name.toLowerCase();
	} );

function isArrayLike( obj ) {

	// Support: real iOS 8.2 only (not reproducible in simulator)
	// `in` check used to prevent JIT error (gh-2145)
	// hasOwn isn't used here due to false negatives
	// regarding Nodelist length in IE
	var length = !!obj && "length" in obj && obj.length,
		type = toType( obj );

	if ( isFunction( obj ) || isWindow( obj ) ) {
		return false;
	}

	return type === "array" || length === 0 ||
		typeof length === "number" && length > 0 && ( length - 1 ) in obj;
}
var Sizzle =
/*!
 * Sizzle CSS Selector Engine v2.3.6
 * https://sizzlejs.com/
 *
 * Copyright JS Foundation and other contributors
 * Released under the MIT license
 * https://js.foundation/
 *
 * Date: 2021-02-16
 */
( function( window ) {
var i,
	support,
	Expr,
	getText,
	isXML,
	tokenize,
	compile,
	select,
	outermostContext,
	sortInput,
	hasDuplicate,

	// Local document vars
	setDocument,
	document,
	docElem,
	documentIsHTML,
	rbuggyQSA,
	rbuggyMatches,
	matches,
	contains,

	// Instance-specific data
	expando = "sizzle" + 1 * new Date(),
	preferredDoc = window.document,
	dirruns = 0,
	done = 0,
	classCache = createCache(),
	tokenCache = createCache(),
	compilerCache = createCache(),
	nonnativeSelectorCache = createCache(),
	sortOrder = function( a, b ) {
		if ( a === b ) {
			hasDuplicate = true;
		}
		return 0;
	},

	// Instance methods
	hasOwn = ( {} ).hasOwnProperty,
	arr = [],
	pop = arr.pop,
	pushNative = arr.push,
	push = arr.push,
	slice = arr.slice,

	// Use a stripped-down indexOf as it's faster than native
	// https://jsperf.com/thor-indexof-vs-for/5
	indexOf = function( list, elem ) {
		var i = 0,
			len = list.length;
		for ( ; i < len; i++ ) {
			if ( list[ i ] === elem ) {
				return i;
			}
		}
		return -1;
	},

	booleans = "checked|selected|async|autofocus|autoplay|controls|defer|disabled|hidden|" +
		"ismap|loop|multiple|open|readonly|required|scoped",

	// Regular expressions

	// http://www.w3.org/TR/css3-selectors/#whitespace
	whitespace = "[\\x20\\t\\r\\n\\f]",

	// https://www.w3.org/TR/css-syntax-3/#ident-token-diagram
	identifier = "(?:\\\\[\\da-fA-F]{1,6}" + whitespace +
		"?|\\\\[^\\r\\n\\f]|[\\w-]|[^\0-\\x7f])+",

	// Attribute selectors: http://www.w3.org/TR/selectors/#attribute-selectors
	attributes = "\\[" + whitespace + "*(" + identifier + ")(?:" + whitespace +

		// Operator (capture 2)
		"*([*^$|!~]?=)" + whitespace +

		// "Attribute values must be CSS identifiers [capture 5]
		// or strings [capture 3 or capture 4]"
		"*(?:'((?:\\\\.|[^\\\\'])*)'|\"((?:\\\\.|[^\\\\\"])*)\"|(" + identifier + "))|)" +
		whitespace + "*\\]",

	pseudos = ":(" + identifier + ")(?:\\((" +

		// To reduce the number of selectors needing tokenize in the preFilter, prefer arguments:
		// 1. quoted (capture 3; capture 4 or capture 5)
		"('((?:\\\\.|[^\\\\'])*)'|\"((?:\\\\.|[^\\\\\"])*)\")|" +

		// 2. simple (capture 6)
		"((?:\\\\.|[^\\\\()[\\]]|" + attributes + ")*)|" +

		// 3. anything else (capture 2)
		".*" +
		")\\)|)",

	// Leading and non-escaped trailing whitespace, capturing some non-whitespace characters preceding the latter
	rwhitespace = new RegExp( whitespace + "+", "g" ),
	rtrim = new RegExp( "^" + whitespace + "+|((?:^|[^\\\\])(?:\\\\.)*)" +
		whitespace + "+$", "g" ),

	rcomma = new RegExp( "^" + whitespace + "*," + whitespace + "*" ),
	rcombinators = new RegExp( "^" + whitespace + "*([>+~]|" + whitespace + ")" + whitespace +
		"*" ),
	rdescend = new RegExp( whitespace + "|>" ),

	rpseudo = new RegExp( pseudos ),
	ridentifier = new RegExp( "^" + identifier + "$" ),

	matchExpr = {
		"ID": new RegExp( "^#(" + identifier + ")" ),
		"CLASS": new RegExp( "^\\.(" + identifier + ")" ),
		"TAG": new RegExp( "^(" + identifier + "|[*])" ),
		"ATTR": new RegExp( "^" + attributes ),
		"PSEUDO": new RegExp( "^" + pseudos ),
		"CHILD": new RegExp( "^:(only|first|last|nth|nth-last)-(child|of-type)(?:\\(" +
			whitespace + "*(even|odd|(([+-]|)(\\d*)n|)" + whitespace + "*(?:([+-]|)" +
			whitespace + "*(\\d+)|))" + whitespace + "*\\)|)", "i" ),
		"bool": new RegExp( "^(?:" + booleans + ")$", "i" ),

		// For use in libraries implementing .is()
		// We use this for POS matching in `select`
		"needsContext": new RegExp( "^" + whitespace +
			"*[>+~]|:(even|odd|eq|gt|lt|nth|first|last)(?:\\(" + whitespace +
			"*((?:-\\d)?\\d*)" + whitespace + "*\\)|)(?=[^-]|$)", "i" )
	},

	rhtml = /HTML$/i,
	rinputs = /^(?:input|select|textarea|button)$/i,
	rheader = /^h\d$/i,

	rnative = /^[^{]+\{\s*\[native \w/,

	// Easily-parseable/retrievable ID or TAG or CLASS selectors
	rquickExpr = /^(?:#([\w-]+)|(\w+)|\.([\w-]+))$/,

	rsibling = /[+~]/,

	// CSS escapes
	// http://www.w3.org/TR/CSS21/syndata.html#escaped-characters
	runescape = new RegExp( "\\\\[\\da-fA-F]{1,6}" + whitespace + "?|\\\\([^\\r\\n\\f])", "g" ),
	funescape = function( escape, nonHex ) {
		var high = "0x" + escape.slice( 1 ) - 0x10000;

		return nonHex ?

			// Strip the backslash prefix from a non-hex escape sequence
			nonHex :

			// Replace a hexadecimal escape sequence with the encoded Unicode code point
			// Support: IE <=11+
			// For values outside the Basic Multilingual Plane (BMP), manually construct a
			// surrogate pair
			high < 0 ?
				String.fromCharCode( high + 0x10000 ) :
				String.fromCharCode( high >> 10 | 0xD800, high & 0x3FF | 0xDC00 );
	},

	// CSS string/identifier serialization
	// https://drafts.csswg.org/cssom/#common-serializing-idioms
	rcssescape = /([\0-\x1f\x7f]|^-?\d)|^-$|[^\0-\x1f\x7f-\uFFFF\w-]/g,
	fcssescape = function( ch, asCodePoint ) {
		if ( asCodePoint ) {

			// U+0000 NULL becomes U+FFFD REPLACEMENT CHARACTER
			if ( ch === "\0" ) {
				return "\uFFFD";
			}

			// Control characters and (dependent upon position) numbers get escaped as code points
			return ch.slice( 0, -1 ) + "\\" +
				ch.charCodeAt( ch.length - 1 ).toString( 16 ) + " ";
		}

		// Other potentially-special ASCII characters get backslash-escaped
		return "\\" + ch;
	},

	// Used for iframes
	// See setDocument()
	// Removing the function wrapper causes a "Permission Denied"
	// error in IE
	unloadHandler = function() {
		setDocument();
	},

	inDisabledFieldset = addCombinator(
		function( elem ) {
			return elem.disabled === true && elem.nodeName.toLowerCase() === "fieldset";
		},
		{ dir: "parentNode", next: "legend" }
	);

// Optimize for push.apply( _, NodeList )
try {
	push.apply(
		( arr = slice.call( preferredDoc.childNodes ) ),
		preferredDoc.childNodes
	);

	// Support: Android<4.0
	// Detect silently failing push.apply
	// eslint-disable-next-line no-unused-expressions
	arr[ preferredDoc.childNodes.length ].nodeType;
} catch ( e ) {
	push = { apply: arr.length ?

		// Leverage slice if possible
		function( target, els ) {
			pushNative.apply( target, slice.call( els ) );
		} :

		// Support: IE<9
		// Otherwise append directly
		function( target, els ) {
			var j = target.length,
				i = 0;

			// Can't trust NodeList.length
			while ( ( target[ j++ ] = els[ i++ ] ) ) {}
			target.length = j - 1;
		}
	};
}

function Sizzle( selector, context, results, seed ) {
	var m, i, elem, nid, match, groups, newSelector,
		newContext = context && context.ownerDocument,

		// nodeType defaults to 9, since context defaults to document
		nodeType = context ? context.nodeType : 9;

	results = results || [];

	// Return early from calls with invalid selector or context
	if ( typeof selector !== "string" || !selector ||
		nodeType !== 1 && nodeType !== 9 && nodeType !== 11 ) {

		return results;
	}

	// Try to shortcut find operations (as opposed to filters) in HTML documents
	if ( !seed ) {
		setDocument( context );
		context = context || document;

		if ( documentIsHTML ) {

			// If the selector is sufficiently simple, try using a "get*By*" DOM method
			// (excepting DocumentFragment context, where the methods don't exist)
			if ( nodeType !== 11 && ( match = rquickExpr.exec( selector ) ) ) {

				// ID selector
				if ( ( m = match[ 1 ] ) ) {

					// Document context
					if ( nodeType === 9 ) {
						if ( ( elem = context.getElementById( m ) ) ) {

							// Support: IE, Opera, Webkit
							// TODO: identify versions
							// getElementById can match elements by name instead of ID
							if ( elem.id === m ) {
								results.push( elem );
								return results;
							}
						} else {
							return results;
						}

					// Element context
					} else {

						// Support: IE, Opera, Webkit
						// TODO: identify versions
						// getElementById can match elements by name instead of ID
						if ( newContext && ( elem = newContext.getElementById( m ) ) &&
							contains( context, elem ) &&
							elem.id === m ) {

							results.push( elem );
							return results;
						}
					}

				// Type selector
				} else if ( match[ 2 ] ) {
					push.apply( results, context.getElementsByTagName( selector ) );
					return results;

				// Class selector
				} else if ( ( m = match[ 3 ] ) && support.getElementsByClassName &&
					context.getElementsByClassName ) {

					push.apply( results, context.getElementsByClassName( m ) );
					return results;
				}
			}

			// Take advantage of querySelectorAll
			if ( support.qsa &&
				!nonnativeSelectorCache[ selector + " " ] &&
				( !rbuggyQSA || !rbuggyQSA.test( selector ) ) &&

				// Support: IE 8 only
				// Exclude object elements
				( nodeType !== 1 || context.nodeName.toLowerCase() !== "object" ) ) {

				newSelector = selector;
				newContext = context;

				// qSA considers elements outside a scoping root when evaluating child or
				// descendant combinators, which is not what we want.
				// In such cases, we work around the behavior by prefixing every selector in the
				// list with an ID selector referencing the scope context.
				// The technique has to be used as well when a leading combinator is used
				// as such selectors are not recognized by querySelectorAll.
				// Thanks to Andrew Dupont for this technique.
				if ( nodeType === 1 &&
					( rdescend.test( selector ) || rcombinators.test( selector ) ) ) {

					// Expand context for sibling selectors
					newContext = rsibling.test( selector ) && testContext( context.parentNode ) ||
						context;

					// We can use :scope instead of the ID hack if the browser
					// supports it & if we're not changing the context.
					if ( newContext !== context || !support.scope ) {

						// Capture the context ID, setting it first if necessary
						if ( ( nid = context.getAttribute( "id" ) ) ) {
							nid = nid.replace( rcssescape, fcssescape );
						} else {
							context.setAttribute( "id", ( nid = expando ) );
						}
					}

					// Prefix every selector in the list
					groups = tokenize( selector );
					i = groups.length;
					while ( i-- ) {
						groups[ i ] = ( nid ? "#" + nid : ":scope" ) + " " +
							toSelector( groups[ i ] );
					}
					newSelector = groups.join( "," );
				}

				try {
					push.apply( results,
						newContext.querySelectorAll( newSelector )
					);
					return results;
				} catch ( qsaError ) {
					nonnativeSelectorCache( selector, true );
				} finally {
					if ( nid === expando ) {
						context.removeAttribute( "id" );
					}
				}
			}
		}
	}

	// All others
	return select( selector.replace( rtrim, "$1" ), context, results, seed );
}

/**
 * Create key-value caches of limited size
 * @returns {function(string, object)} Returns the Object data after storing it on itself with
 *	property name the (space-suffixed) string and (if the cache is larger than Expr.cacheLength)
 *	deleting the oldest entry
 */
function createCache() {
	var keys = [];

	function cache( key, value ) {

		// Use (key + " ") to avoid collision with native prototype properties (see Issue #157)
		if ( keys.push( key + " " ) > Expr.cacheLength ) {

			// Only keep the most recent entries
			delete cache[ keys.shift() ];
		}
		return ( cache[ key + " " ] = value );
	}
	return cache;
}

/**
 * Mark a function for special use by Sizzle
 * @param {Function} fn The function to mark
 */
function markFunction( fn ) {
	fn[ expando ] = true;
	return fn;
}

/**
 * Support testing using an element
 * @param {Function} fn Passed the created element and returns a boolean result
 */
function assert( fn ) {
	var el = document.createElement( "fieldset" );

	try {
		return !!fn( el );
	} catch ( e ) {
		return false;
	} finally {

		// Remove from its parent by default
		if ( el.parentNode ) {
			el.parentNode.removeChild( el );
		}

		// release memory in IE
		el = null;
	}
}

/**
 * Adds the same handler for all of the specified attrs
 * @param {String} attrs Pipe-separated list of attributes
 * @param {Function} handler The method that will be applied
 */
function addHandle( attrs, handler ) {
	var arr = attrs.split( "|" ),
		i = arr.length;

	while ( i-- ) {
		Expr.attrHandle[ arr[ i ] ] = handler;
	}
}

/**
 * Checks document order of two siblings
 * @param {Element} a
 * @param {Element} b
 * @returns {Number} Returns less than 0 if a precedes b, greater than 0 if a follows b
 */
function siblingCheck( a, b ) {
	var cur = b && a,
		diff = cur && a.nodeType === 1 && b.nodeType === 1 &&
			a.sourceIndex - b.sourceIndex;

	// Use IE sourceIndex if available on both nodes
	if ( diff ) {
		return diff;
	}

	// Check if b follows a
	if ( cur ) {
		while ( ( cur = cur.nextSibling ) ) {
			if ( cur === b ) {
				return -1;
			}
		}
	}

	return a ? 1 : -1;
}

/**
 * Returns a function to use in pseudos for input types
 * @param {String} type
 */
function createInputPseudo( type ) {
	return function( elem ) {
		var name = elem.nodeName.toLowerCase();
		return name === "input" && elem.type === type;
	};
}

/**
 * Returns a function to use in pseudos for buttons
 * @param {String} type
 */
function createButtonPseudo( type ) {
	return function( elem ) {
		var name = elem.nodeName.toLowerCase();
		return ( name === "input" || name === "button" ) && elem.type === type;
	};
}

/**
 * Returns a function to use in pseudos for :enabled/:disabled
 * @param {Boolean} disabled true for :disabled; false for :enabled
 */
function createDisabledPseudo( disabled ) {

	// Known :disabled false positives: fieldset[disabled] > legend:nth-of-type(n+2) :can-disable
	return function( elem ) {

		// Only certain elements can match :enabled or :disabled
		// https://html.spec.whatwg.org/multipage/scripting.html#selector-enabled
		// https://html.spec.whatwg.org/multipage/scripting.html#selector-disabled
		if ( "form" in elem ) {

			// Check for inherited disabledness on relevant non-disabled elements:
			// * listed form-associated elements in a disabled fieldset
			//   https://html.spec.whatwg.org/multipage/forms.html#category-listed
			//   https://html.spec.whatwg.org/multipage/forms.html#concept-fe-disabled
			// * option elements in a disabled optgroup
			//   https://html.spec.whatwg.org/multipage/forms.html#concept-option-disabled
			// All such elements have a "form" property.
			if ( elem.parentNode && elem.disabled === false ) {

				// Option elements defer to a parent optgroup if present
				if ( "label" in elem ) {
					if ( "label" in elem.parentNode ) {
						return elem.parentNode.disabled === disabled;
					} else {
						return elem.disabled === disabled;
					}
				}

				// Support: IE 6 - 11
				// Use the isDisabled shortcut property to check for disabled fieldset ancestors
				return elem.isDisabled === disabled ||

					// Where there is no isDisabled, check manually
					/* jshint -W018 */
					elem.isDisabled !== !disabled &&
					inDisabledFieldset( elem ) === disabled;
			}

			return elem.disabled === disabled;

		// Try to winnow out elements that can't be disabled before trusting the disabled property.
		// Some victims get caught in our net (label, legend, menu, track), but it shouldn't
		// even exist on them, let alone have a boolean value.
		} else if ( "label" in elem ) {
			return elem.disabled === disabled;
		}

		// Remaining elements are neither :enabled nor :disabled
		return false;
	};
}

/**
 * Returns a function to use in pseudos for positionals
 * @param {Function} fn
 */
function createPositionalPseudo( fn ) {
	return markFunction( function( argument ) {
		argument = +argument;
		return markFunction( function( seed, matches ) {
			var j,
				matchIndexes = fn( [], seed.length, argument ),
				i = matchIndexes.length;

			// Match elements found at the specified indexes
			while ( i-- ) {
				if ( seed[ ( j = matchIndexes[ i ] ) ] ) {
					seed[ j ] = !( matches[ j ] = seed[ j ] );
				}
			}
		} );
	} );
}

/**
 * Checks a node for validity as a Sizzle context
 * @param {Element|Object=} context
 * @returns {Element|Object|Boolean} The input node if acceptable, otherwise a falsy value
 */
function testContext( context ) {
	return context && typeof context.getElementsByTagName !== "undefined" && context;
}

// Expose support vars for convenience
support = Sizzle.support = {};

/**
 * Detects XML nodes
 * @param {Element|Object} elem An element or a document
 * @returns {Boolean} True iff elem is a non-HTML XML node
 */
isXML = Sizzle.isXML = function( elem ) {
	var namespace = elem && elem.namespaceURI,
		docElem = elem && ( elem.ownerDocument || elem ).documentElement;

	// Support: IE <=8
	// Assume HTML when documentElement doesn't yet exist, such as inside loading iframes
	// https://bugs.jquery.com/ticket/4833
	return !rhtml.test( namespace || docElem && docElem.nodeName || "HTML" );
};

/**
 * Sets document-related variables once based on the current document
 * @param {Element|Object} [doc] An element or document object to use to set the document
 * @returns {Object} Returns the current document
 */
setDocument = Sizzle.setDocument = function( node ) {
	var hasCompare, subWindow,
		doc = node ? node.ownerDocument || node : preferredDoc;

	// Return early if doc is invalid or already selected
	// Support: IE 11+, Edge 17 - 18+
	// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
	// two documents; shallow comparisons work.
	// eslint-disable-next-line eqeqeq
	if ( doc == document || doc.nodeType !== 9 || !doc.documentElement ) {
		return document;
	}

	// Update global variables
	document = doc;
	docElem = document.documentElement;
	documentIsHTML = !isXML( document );

	// Support: IE 9 - 11+, Edge 12 - 18+
	// Accessing iframe documents after unload throws "permission denied" errors (jQuery #13936)
	// Support: IE 11+, Edge 17 - 18+
	// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
	// two documents; shallow comparisons work.
	// eslint-disable-next-line eqeqeq
	if ( preferredDoc != document &&
		( subWindow = document.defaultView ) && subWindow.top !== subWindow ) {

		// Support: IE 11, Edge
		if ( subWindow.addEventListener ) {
			subWindow.addEventListener( "unload", unloadHandler, false );

		// Support: IE 9 - 10 only
		} else if ( subWindow.attachEvent ) {
			subWindow.attachEvent( "onunload", unloadHandler );
		}
	}

	// Support: IE 8 - 11+, Edge 12 - 18+, Chrome <=16 - 25 only, Firefox <=3.6 - 31 only,
	// Safari 4 - 5 only, Opera <=11.6 - 12.x only
	// IE/Edge & older browsers don't support the :scope pseudo-class.
	// Support: Safari 6.0 only
	// Safari 6.0 supports :scope but it's an alias of :root there.
	support.scope = assert( function( el ) {
		docElem.appendChild( el ).appendChild( document.createElement( "div" ) );
		return typeof el.querySelectorAll !== "undefined" &&
			!el.querySelectorAll( ":scope fieldset div" ).length;
	} );

	/* Attributes
	---------------------------------------------------------------------- */

	// Support: IE<8
	// Verify that getAttribute really returns attributes and not properties
	// (excepting IE8 booleans)
	support.attributes = assert( function( el ) {
		el.className = "i";
		return !el.getAttribute( "className" );
	} );

	/* getElement(s)By*
	---------------------------------------------------------------------- */

	// Check if getElementsByTagName("*") returns only elements
	support.getElementsByTagName = assert( function( el ) {
		el.appendChild( document.createComment( "" ) );
		return !el.getElementsByTagName( "*" ).length;
	} );

	// Support: IE<9
	support.getElementsByClassName = rnative.test( document.getElementsByClassName );

	// Support: IE<10
	// Check if getElementById returns elements by name
	// The broken getElementById methods don't pick up programmatically-set names,
	// so use a roundabout getElementsByName test
	support.getById = assert( function( el ) {
		docElem.appendChild( el ).id = expando;
		return !document.getElementsByName || !document.getElementsByName( expando ).length;
	} );

	// ID filter and find
	if ( support.getById ) {
		Expr.filter[ "ID" ] = function( id ) {
			var attrId = id.replace( runescape, funescape );
			return function( elem ) {
				return elem.getAttribute( "id" ) === attrId;
			};
		};
		Expr.find[ "ID" ] = function( id, context ) {
			if ( typeof context.getElementById !== "undefined" && documentIsHTML ) {
				var elem = context.getElementById( id );
				return elem ? [ elem ] : [];
			}
		};
	} else {
		Expr.filter[ "ID" ] =  function( id ) {
			var attrId = id.replace( runescape, funescape );
			return function( elem ) {
				var node = typeof elem.getAttributeNode !== "undefined" &&
					elem.getAttributeNode( "id" );
				return node && node.value === attrId;
			};
		};

		// Support: IE 6 - 7 only
		// getElementById is not reliable as a find shortcut
		Expr.find[ "ID" ] = function( id, context ) {
			if ( typeof context.getElementById !== "undefined" && documentIsHTML ) {
				var node, i, elems,
					elem = context.getElementById( id );

				if ( elem ) {

					// Verify the id attribute
					node = elem.getAttributeNode( "id" );
					if ( node && node.value === id ) {
						return [ elem ];
					}

					// Fall back on getElementsByName
					elems = context.getElementsByName( id );
					i = 0;
					while ( ( elem = elems[ i++ ] ) ) {
						node = elem.getAttributeNode( "id" );
						if ( node && node.value === id ) {
							return [ elem ];
						}
					}
				}

				return [];
			}
		};
	}

	// Tag
	Expr.find[ "TAG" ] = support.getElementsByTagName ?
		function( tag, context ) {
			if ( typeof context.getElementsByTagName !== "undefined" ) {
				return context.getElementsByTagName( tag );

			// DocumentFragment nodes don't have gEBTN
			} else if ( support.qsa ) {
				return context.querySelectorAll( tag );
			}
		} :

		function( tag, context ) {
			var elem,
				tmp = [],
				i = 0,

				// By happy coincidence, a (broken) gEBTN appears on DocumentFragment nodes too
				results = context.getElementsByTagName( tag );

			// Filter out possible comments
			if ( tag === "*" ) {
				while ( ( elem = results[ i++ ] ) ) {
					if ( elem.nodeType === 1 ) {
						tmp.push( elem );
					}
				}

				return tmp;
			}
			return results;
		};

	// Class
	Expr.find[ "CLASS" ] = support.getElementsByClassName && function( className, context ) {
		if ( typeof context.getElementsByClassName !== "undefined" && documentIsHTML ) {
			return context.getElementsByClassName( className );
		}
	};

	/* QSA/matchesSelector
	---------------------------------------------------------------------- */

	// QSA and matchesSelector support

	// matchesSelector(:active) reports false when true (IE9/Opera 11.5)
	rbuggyMatches = [];

	// qSa(:focus) reports false when true (Chrome 21)
	// We allow this because of a bug in IE8/9 that throws an error
	// whenever `document.activeElement` is accessed on an iframe
	// So, we allow :focus to pass through QSA all the time to avoid the IE error
	// See https://bugs.jquery.com/ticket/13378
	rbuggyQSA = [];

	if ( ( support.qsa = rnative.test( document.querySelectorAll ) ) ) {

		// Build QSA regex
		// Regex strategy adopted from Diego Perini
		assert( function( el ) {

			var input;

			// Select is set to empty string on purpose
			// This is to test IE's treatment of not explicitly
			// setting a boolean content attribute,
			// since its presence should be enough
			// https://bugs.jquery.com/ticket/12359
			docElem.appendChild( el ).innerHTML = "<a id='" + expando + "'></a>" +
				"<select id='" + expando + "-\r\\' msallowcapture=''>" +
				"<option selected=''></option></select>";

			// Support: IE8, Opera 11-12.16
			// Nothing should be selected when empty strings follow ^= or $= or *=
			// The test attribute must be unknown in Opera but "safe" for WinRT
			// https://msdn.microsoft.com/en-us/library/ie/hh465388.aspx#attribute_section
			if ( el.querySelectorAll( "[msallowcapture^='']" ).length ) {
				rbuggyQSA.push( "[*^$]=" + whitespace + "*(?:''|\"\")" );
			}

			// Support: IE8
			// Boolean attributes and "value" are not treated correctly
			if ( !el.querySelectorAll( "[selected]" ).length ) {
				rbuggyQSA.push( "\\[" + whitespace + "*(?:value|" + booleans + ")" );
			}

			// Support: Chrome<29, Android<4.4, Safari<7.0+, iOS<7.0+, PhantomJS<1.9.8+
			if ( !el.querySelectorAll( "[id~=" + expando + "-]" ).length ) {
				rbuggyQSA.push( "~=" );
			}

			// Support: IE 11+, Edge 15 - 18+
			// IE 11/Edge don't find elements on a `[name='']` query in some cases.
			// Adding a temporary attribute to the document before the selection works
			// around the issue.
			// Interestingly, IE 10 & older don't seem to have the issue.
			input = document.createElement( "input" );
			input.setAttribute( "name", "" );
			el.appendChild( input );
			if ( !el.querySelectorAll( "[name='']" ).length ) {
				rbuggyQSA.push( "\\[" + whitespace + "*name" + whitespace + "*=" +
					whitespace + "*(?:''|\"\")" );
			}

			// Webkit/Opera - :checked should return selected option elements
			// http://www.w3.org/TR/2011/REC-css3-selectors-20110929/#checked
			// IE8 throws error here and will not see later tests
			if ( !el.querySelectorAll( ":checked" ).length ) {
				rbuggyQSA.push( ":checked" );
			}

			// Support: Safari 8+, iOS 8+
			// https://bugs.webkit.org/show_bug.cgi?id=136851
			// In-page `selector#id sibling-combinator selector` fails
			if ( !el.querySelectorAll( "a#" + expando + "+*" ).length ) {
				rbuggyQSA.push( ".#.+[+~]" );
			}

			// Support: Firefox <=3.6 - 5 only
			// Old Firefox doesn't throw on a badly-escaped identifier.
			el.querySelectorAll( "\\\f" );
			rbuggyQSA.push( "[\\r\\n\\f]" );
		} );

		assert( function( el ) {
			el.innerHTML = "<a href='' disabled='disabled'></a>" +
				"<select disabled='disabled'><option/></select>";

			// Support: Windows 8 Native Apps
			// The type and name attributes are restricted during .innerHTML assignment
			var input = document.createElement( "input" );
			input.setAttribute( "type", "hidden" );
			el.appendChild( input ).setAttribute( "name", "D" );

			// Support: IE8
			// Enforce case-sensitivity of name attribute
			if ( el.querySelectorAll( "[name=d]" ).length ) {
				rbuggyQSA.push( "name" + whitespace + "*[*^$|!~]?=" );
			}

			// FF 3.5 - :enabled/:disabled and hidden elements (hidden elements are still enabled)
			// IE8 throws error here and will not see later tests
			if ( el.querySelectorAll( ":enabled" ).length !== 2 ) {
				rbuggyQSA.push( ":enabled", ":disabled" );
			}

			// Support: IE9-11+
			// IE's :disabled selector does not pick up the children of disabled fieldsets
			docElem.appendChild( el ).disabled = true;
			if ( el.querySelectorAll( ":disabled" ).length !== 2 ) {
				rbuggyQSA.push( ":enabled", ":disabled" );
			}

			// Support: Opera 10 - 11 only
			// Opera 10-11 does not throw on post-comma invalid pseudos
			el.querySelectorAll( "*,:x" );
			rbuggyQSA.push( ",.*:" );
		} );
	}

	if ( ( support.matchesSelector = rnative.test( ( matches = docElem.matches ||
		docElem.webkitMatchesSelector ||
		docElem.mozMatchesSelector ||
		docElem.oMatchesSelector ||
		docElem.msMatchesSelector ) ) ) ) {

		assert( function( el ) {

			// Check to see if it's possible to do matchesSelector
			// on a disconnected node (IE 9)
			support.disconnectedMatch = matches.call( el, "*" );

			// This should fail with an exception
			// Gecko does not error, returns false instead
			matches.call( el, "[s!='']:x" );
			rbuggyMatches.push( "!=", pseudos );
		} );
	}

	rbuggyQSA = rbuggyQSA.length && new RegExp( rbuggyQSA.join( "|" ) );
	rbuggyMatches = rbuggyMatches.length && new RegExp( rbuggyMatches.join( "|" ) );

	/* Contains
	---------------------------------------------------------------------- */
	hasCompare = rnative.test( docElem.compareDocumentPosition );

	// Element contains another
	// Purposefully self-exclusive
	// As in, an element does not contain itself
	contains = hasCompare || rnative.test( docElem.contains ) ?
		function( a, b ) {
			var adown = a.nodeType === 9 ? a.documentElement : a,
				bup = b && b.parentNode;
			return a === bup || !!( bup && bup.nodeType === 1 && (
				adown.contains ?
					adown.contains( bup ) :
					a.compareDocumentPosition && a.compareDocumentPosition( bup ) & 16
			) );
		} :
		function( a, b ) {
			if ( b ) {
				while ( ( b = b.parentNode ) ) {
					if ( b === a ) {
						return true;
					}
				}
			}
			return false;
		};

	/* Sorting
	---------------------------------------------------------------------- */

	// Document order sorting
	sortOrder = hasCompare ?
	function( a, b ) {

		// Flag for duplicate removal
		if ( a === b ) {
			hasDuplicate = true;
			return 0;
		}

		// Sort on method existence if only one input has compareDocumentPosition
		var compare = !a.compareDocumentPosition - !b.compareDocumentPosition;
		if ( compare ) {
			return compare;
		}

		// Calculate position if both inputs belong to the same document
		// Support: IE 11+, Edge 17 - 18+
		// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
		// two documents; shallow comparisons work.
		// eslint-disable-next-line eqeqeq
		compare = ( a.ownerDocument || a ) == ( b.ownerDocument || b ) ?
			a.compareDocumentPosition( b ) :

			// Otherwise we know they are disconnected
			1;

		// Disconnected nodes
		if ( compare & 1 ||
			( !support.sortDetached && b.compareDocumentPosition( a ) === compare ) ) {

			// Choose the first element that is related to our preferred document
			// Support: IE 11+, Edge 17 - 18+
			// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
			// two documents; shallow comparisons work.
			// eslint-disable-next-line eqeqeq
			if ( a == document || a.ownerDocument == preferredDoc &&
				contains( preferredDoc, a ) ) {
				return -1;
			}

			// Support: IE 11+, Edge 17 - 18+
			// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
			// two documents; shallow comparisons work.
			// eslint-disable-next-line eqeqeq
			if ( b == document || b.ownerDocument == preferredDoc &&
				contains( preferredDoc, b ) ) {
				return 1;
			}

			// Maintain original order
			return sortInput ?
				( indexOf( sortInput, a ) - indexOf( sortInput, b ) ) :
				0;
		}

		return compare & 4 ? -1 : 1;
	} :
	function( a, b ) {

		// Exit early if the nodes are identical
		if ( a === b ) {
			hasDuplicate = true;
			return 0;
		}

		var cur,
			i = 0,
			aup = a.parentNode,
			bup = b.parentNode,
			ap = [ a ],
			bp = [ b ];

		// Parentless nodes are either documents or disconnected
		if ( !aup || !bup ) {

			// Support: IE 11+, Edge 17 - 18+
			// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
			// two documents; shallow comparisons work.
			/* eslint-disable eqeqeq */
			return a == document ? -1 :
				b == document ? 1 :
				/* eslint-enable eqeqeq */
				aup ? -1 :
				bup ? 1 :
				sortInput ?
				( indexOf( sortInput, a ) - indexOf( sortInput, b ) ) :
				0;

		// If the nodes are siblings, we can do a quick check
		} else if ( aup === bup ) {
			return siblingCheck( a, b );
		}

		// Otherwise we need full lists of their ancestors for comparison
		cur = a;
		while ( ( cur = cur.parentNode ) ) {
			ap.unshift( cur );
		}
		cur = b;
		while ( ( cur = cur.parentNode ) ) {
			bp.unshift( cur );
		}

		// Walk down the tree looking for a discrepancy
		while ( ap[ i ] === bp[ i ] ) {
			i++;
		}

		return i ?

			// Do a sibling check if the nodes have a common ancestor
			siblingCheck( ap[ i ], bp[ i ] ) :

			// Otherwise nodes in our document sort first
			// Support: IE 11+, Edge 17 - 18+
			// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
			// two documents; shallow comparisons work.
			/* eslint-disable eqeqeq */
			ap[ i ] == preferredDoc ? -1 :
			bp[ i ] == preferredDoc ? 1 :
			/* eslint-enable eqeqeq */
			0;
	};

	return document;
};

Sizzle.matches = function( expr, elements ) {
	return Sizzle( expr, null, null, elements );
};

Sizzle.matchesSelector = function( elem, expr ) {
	setDocument( elem );

	if ( support.matchesSelector && documentIsHTML &&
		!nonnativeSelectorCache[ expr + " " ] &&
		( !rbuggyMatches || !rbuggyMatches.test( expr ) ) &&
		( !rbuggyQSA     || !rbuggyQSA.test( expr ) ) ) {

		try {
			var ret = matches.call( elem, expr );

			// IE 9's matchesSelector returns false on disconnected nodes
			if ( ret || support.disconnectedMatch ||

				// As well, disconnected nodes are said to be in a document
				// fragment in IE 9
				elem.document && elem.document.nodeType !== 11 ) {
				return ret;
			}
		} catch ( e ) {
			nonnativeSelectorCache( expr, true );
		}
	}

	return Sizzle( expr, document, null, [ elem ] ).length > 0;
};

Sizzle.contains = function( context, elem ) {

	// Set document vars if needed
	// Support: IE 11+, Edge 17 - 18+
	// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
	// two documents; shallow comparisons work.
	// eslint-disable-next-line eqeqeq
	if ( ( context.ownerDocument || context ) != document ) {
		setDocument( context );
	}
	return contains( context, elem );
};

Sizzle.attr = function( elem, name ) {

	// Set document vars if needed
	// Support: IE 11+, Edge 17 - 18+
	// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
	// two documents; shallow comparisons work.
	// eslint-disable-next-line eqeqeq
	if ( ( elem.ownerDocument || elem ) != document ) {
		setDocument( elem );
	}

	var fn = Expr.attrHandle[ name.toLowerCase() ],

		// Don't get fooled by Object.prototype properties (jQuery #13807)
		val = fn && hasOwn.call( Expr.attrHandle, name.toLowerCase() ) ?
			fn( elem, name, !documentIsHTML ) :
			undefined;

	return val !== undefined ?
		val :
		support.attributes || !documentIsHTML ?
			elem.getAttribute( name ) :
			( val = elem.getAttributeNode( name ) ) && val.specified ?
				val.value :
				null;
};

Sizzle.escape = function( sel ) {
	return ( sel + "" ).replace( rcssescape, fcssescape );
};

Sizzle.error = function( msg ) {
	throw new Error( "Syntax error, unrecognized expression: " + msg );
};

/**
 * Document sorting and removing duplicates
 * @param {ArrayLike} results
 */
Sizzle.uniqueSort = function( results ) {
	var elem,
		duplicates = [],
		j = 0,
		i = 0;

	// Unless we *know* we can detect duplicates, assume their presence
	hasDuplicate = !support.detectDuplicates;
	sortInput = !support.sortStable && results.slice( 0 );
	results.sort( sortOrder );

	if ( hasDuplicate ) {
		while ( ( elem = results[ i++ ] ) ) {
			if ( elem === results[ i ] ) {
				j = duplicates.push( i );
			}
		}
		while ( j-- ) {
			results.splice( duplicates[ j ], 1 );
		}
	}

	// Clear input after sorting to release objects
	// See https://github.com/jquery/sizzle/pull/225
	sortInput = null;

	return results;
};

/**
 * Utility function for retrieving the text value of an array of DOM nodes
 * @param {Array|Element} elem
 */
getText = Sizzle.getText = function( elem ) {
	var node,
		ret = "",
		i = 0,
		nodeType = elem.nodeType;

	if ( !nodeType ) {

		// If no nodeType, this is expected to be an array
		while ( ( node = elem[ i++ ] ) ) {

			// Do not traverse comment nodes
			ret += getText( node );
		}
	} else if ( nodeType === 1 || nodeType === 9 || nodeType === 11 ) {

		// Use textContent for elements
		// innerText usage removed for consistency of new lines (jQuery #11153)
		if ( typeof elem.textContent === "string" ) {
			return elem.textContent;
		} else {

			// Traverse its children
			for ( elem = elem.firstChild; elem; elem = elem.nextSibling ) {
				ret += getText( elem );
			}
		}
	} else if ( nodeType === 3 || nodeType === 4 ) {
		return elem.nodeValue;
	}

	// Do not include comment or processing instruction nodes

	return ret;
};

Expr = Sizzle.selectors = {

	// Can be adjusted by the user
	cacheLength: 50,

	createPseudo: markFunction,

	match: matchExpr,

	attrHandle: {},

	find: {},

	relative: {
		">": { dir: "parentNode", first: true },
		" ": { dir: "parentNode" },
		"+": { dir: "previousSibling", first: true },
		"~": { dir: "previousSibling" }
	},

	preFilter: {
		"ATTR": function( match ) {
			match[ 1 ] = match[ 1 ].replace( runescape, funescape );

			// Move the given value to match[3] whether quoted or unquoted
			match[ 3 ] = ( match[ 3 ] || match[ 4 ] ||
				match[ 5 ] || "" ).replace( runescape, funescape );

			if ( match[ 2 ] === "~=" ) {
				match[ 3 ] = " " + match[ 3 ] + " ";
			}

			return match.slice( 0, 4 );
		},

		"CHILD": function( match ) {

			/* matches from matchExpr["CHILD"]
				1 type (only|nth|...)
				2 what (child|of-type)
				3 argument (even|odd|\d*|\d*n([+-]\d+)?|...)
				4 xn-component of xn+y argument ([+-]?\d*n|)
				5 sign of xn-component
				6 x of xn-component
				7 sign of y-component
				8 y of y-component
			*/
			match[ 1 ] = match[ 1 ].toLowerCase();

			if ( match[ 1 ].slice( 0, 3 ) === "nth" ) {

				// nth-* requires argument
				if ( !match[ 3 ] ) {
					Sizzle.error( match[ 0 ] );
				}

				// numeric x and y parameters for Expr.filter.CHILD
				// remember that false/true cast respectively to 0/1
				match[ 4 ] = +( match[ 4 ] ?
					match[ 5 ] + ( match[ 6 ] || 1 ) :
					2 * ( match[ 3 ] === "even" || match[ 3 ] === "odd" ) );
				match[ 5 ] = +( ( match[ 7 ] + match[ 8 ] ) || match[ 3 ] === "odd" );

				// other types prohibit arguments
			} else if ( match[ 3 ] ) {
				Sizzle.error( match[ 0 ] );
			}

			return match;
		},

		"PSEUDO": function( match ) {
			var excess,
				unquoted = !match[ 6 ] && match[ 2 ];

			if ( matchExpr[ "CHILD" ].test( match[ 0 ] ) ) {
				return null;
			}

			// Accept quoted arguments as-is
			if ( match[ 3 ] ) {
				match[ 2 ] = match[ 4 ] || match[ 5 ] || "";

			// Strip excess characters from unquoted arguments
			} else if ( unquoted && rpseudo.test( unquoted ) &&

				// Get excess from tokenize (recursively)
				( excess = tokenize( unquoted, true ) ) &&

				// advance to the next closing parenthesis
				( excess = unquoted.indexOf( ")", unquoted.length - excess ) - unquoted.length ) ) {

				// excess is a negative index
				match[ 0 ] = match[ 0 ].slice( 0, excess );
				match[ 2 ] = unquoted.slice( 0, excess );
			}

			// Return only captures needed by the pseudo filter method (type and argument)
			return match.slice( 0, 3 );
		}
	},

	filter: {

		"TAG": function( nodeNameSelector ) {
			var nodeName = nodeNameSelector.replace( runescape, funescape ).toLowerCase();
			return nodeNameSelector === "*" ?
				function() {
					return true;
				} :
				function( elem ) {
					return elem.nodeName && elem.nodeName.toLowerCase() === nodeName;
				};
		},

		"CLASS": function( className ) {
			var pattern = classCache[ className + " " ];

			return pattern ||
				( pattern = new RegExp( "(^|" + whitespace +
					")" + className + "(" + whitespace + "|$)" ) ) && classCache(
						className, function( elem ) {
							return pattern.test(
								typeof elem.className === "string" && elem.className ||
								typeof elem.getAttribute !== "undefined" &&
									elem.getAttribute( "class" ) ||
								""
							);
				} );
		},

		"ATTR": function( name, operator, check ) {
			return function( elem ) {
				var result = Sizzle.attr( elem, name );

				if ( result == null ) {
					return operator === "!=";
				}
				if ( !operator ) {
					return true;
				}

				result += "";

				/* eslint-disable max-len */

				return operator === "=" ? result === check :
					operator === "!=" ? result !== check :
					operator === "^=" ? check && result.indexOf( check ) === 0 :
					operator === "*=" ? check && result.indexOf( check ) > -1 :
					operator === "$=" ? check && result.slice( -check.length ) === check :
					operator === "~=" ? ( " " + result.replace( rwhitespace, " " ) + " " ).indexOf( check ) > -1 :
					operator === "|=" ? result === check || result.slice( 0, check.length + 1 ) === check + "-" :
					false;
				/* eslint-enable max-len */

			};
		},

		"CHILD": function( type, what, _argument, first, last ) {
			var simple = type.slice( 0, 3 ) !== "nth",
				forward = type.slice( -4 ) !== "last",
				ofType = what === "of-type";

			return first === 1 && last === 0 ?

				// Shortcut for :nth-*(n)
				function( elem ) {
					return !!elem.parentNode;
				} :

				function( elem, _context, xml ) {
					var cache, uniqueCache, outerCache, node, nodeIndex, start,
						dir = simple !== forward ? "nextSibling" : "previousSibling",
						parent = elem.parentNode,
						name = ofType && elem.nodeName.toLowerCase(),
						useCache = !xml && !ofType,
						diff = false;

					if ( parent ) {

						// :(first|last|only)-(child|of-type)
						if ( simple ) {
							while ( dir ) {
								node = elem;
								while ( ( node = node[ dir ] ) ) {
									if ( ofType ?
										node.nodeName.toLowerCase() === name :
										node.nodeType === 1 ) {

										return false;
									}
								}

								// Reverse direction for :only-* (if we haven't yet done so)
								start = dir = type === "only" && !start && "nextSibling";
							}
							return true;
						}

						start = [ forward ? parent.firstChild : parent.lastChild ];

						// non-xml :nth-child(...) stores cache data on `parent`
						if ( forward && useCache ) {

							// Seek `elem` from a previously-cached index

							// ...in a gzip-friendly way
							node = parent;
							outerCache = node[ expando ] || ( node[ expando ] = {} );

							// Support: IE <9 only
							// Defend against cloned attroperties (jQuery gh-1709)
							uniqueCache = outerCache[ node.uniqueID ] ||
								( outerCache[ node.uniqueID ] = {} );

							cache = uniqueCache[ type ] || [];
							nodeIndex = cache[ 0 ] === dirruns && cache[ 1 ];
							diff = nodeIndex && cache[ 2 ];
							node = nodeIndex && parent.childNodes[ nodeIndex ];

							while ( ( node = ++nodeIndex && node && node[ dir ] ||

								// Fallback to seeking `elem` from the start
								( diff = nodeIndex = 0 ) || start.pop() ) ) {

								// When found, cache indexes on `parent` and break
								if ( node.nodeType === 1 && ++diff && node === elem ) {
									uniqueCache[ type ] = [ dirruns, nodeIndex, diff ];
									break;
								}
							}

						} else {

							// Use previously-cached element index if available
							if ( useCache ) {

								// ...in a gzip-friendly way
								node = elem;
								outerCache = node[ expando ] || ( node[ expando ] = {} );

								// Support: IE <9 only
								// Defend against cloned attroperties (jQuery gh-1709)
								uniqueCache = outerCache[ node.uniqueID ] ||
									( outerCache[ node.uniqueID ] = {} );

								cache = uniqueCache[ type ] || [];
								nodeIndex = cache[ 0 ] === dirruns && cache[ 1 ];
								diff = nodeIndex;
							}

							// xml :nth-child(...)
							// or :nth-last-child(...) or :nth(-last)?-of-type(...)
							if ( diff === false ) {

								// Use the same loop as above to seek `elem` from the start
								while ( ( node = ++nodeIndex && node && node[ dir ] ||
									( diff = nodeIndex = 0 ) || start.pop() ) ) {

									if ( ( ofType ?
										node.nodeName.toLowerCase() === name :
										node.nodeType === 1 ) &&
										++diff ) {

										// Cache the index of each encountered element
										if ( useCache ) {
											outerCache = node[ expando ] ||
												( node[ expando ] = {} );

											// Support: IE <9 only
											// Defend against cloned attroperties (jQuery gh-1709)
											uniqueCache = outerCache[ node.uniqueID ] ||
												( outerCache[ node.uniqueID ] = {} );

											uniqueCache[ type ] = [ dirruns, diff ];
										}

										if ( node === elem ) {
											break;
										}
									}
								}
							}
						}

						// Incorporate the offset, then check against cycle size
						diff -= last;
						return diff === first || ( diff % first === 0 && diff / first >= 0 );
					}
				};
		},

		"PSEUDO": function( pseudo, argument ) {

			// pseudo-class names are case-insensitive
			// http://www.w3.org/TR/selectors/#pseudo-classes
			// Prioritize by case sensitivity in case custom pseudos are added with uppercase letters
			// Remember that setFilters inherits from pseudos
			var args,
				fn = Expr.pseudos[ pseudo ] || Expr.setFilters[ pseudo.toLowerCase() ] ||
					Sizzle.error( "unsupported pseudo: " + pseudo );

			// The user may use createPseudo to indicate that
			// arguments are needed to create the filter function
			// just as Sizzle does
			if ( fn[ expando ] ) {
				return fn( argument );
			}

			// But maintain support for old signatures
			if ( fn.length > 1 ) {
				args = [ pseudo, pseudo, "", argument ];
				return Expr.setFilters.hasOwnProperty( pseudo.toLowerCase() ) ?
					markFunction( function( seed, matches ) {
						var idx,
							matched = fn( seed, argument ),
							i = matched.length;
						while ( i-- ) {
							idx = indexOf( seed, matched[ i ] );
							seed[ idx ] = !( matches[ idx ] = matched[ i ] );
						}
					} ) :
					function( elem ) {
						return fn( elem, 0, args );
					};
			}

			return fn;
		}
	},

	pseudos: {

		// Potentially complex pseudos
		"not": markFunction( function( selector ) {

			// Trim the selector passed to compile
			// to avoid treating leading and trailing
			// spaces as combinators
			var input = [],
				results = [],
				matcher = compile( selector.replace( rtrim, "$1" ) );

			return matcher[ expando ] ?
				markFunction( function( seed, matches, _context, xml ) {
					var elem,
						unmatched = matcher( seed, null, xml, [] ),
						i = seed.length;

					// Match elements unmatched by `matcher`
					while ( i-- ) {
						if ( ( elem = unmatched[ i ] ) ) {
							seed[ i ] = !( matches[ i ] = elem );
						}
					}
				} ) :
				function( elem, _context, xml ) {
					input[ 0 ] = elem;
					matcher( input, null, xml, results );

					// Don't keep the element (issue #299)
					input[ 0 ] = null;
					return !results.pop();
				};
		} ),

		"has": markFunction( function( selector ) {
			return function( elem ) {
				return Sizzle( selector, elem ).length > 0;
			};
		} ),

		"contains": markFunction( function( text ) {
			text = text.replace( runescape, funescape );
			return function( elem ) {
				return ( elem.textContent || getText( elem ) ).indexOf( text ) > -1;
			};
		} ),

		// "Whether an element is represented by a :lang() selector
		// is based solely on the element's language value
		// being equal to the identifier C,
		// or beginning with the identifier C immediately followed by "-".
		// The matching of C against the element's language value is performed case-insensitively.
		// The identifier C does not have to be a valid language name."
		// http://www.w3.org/TR/selectors/#lang-pseudo
		"lang": markFunction( function( lang ) {

			// lang value must be a valid identifier
			if ( !ridentifier.test( lang || "" ) ) {
				Sizzle.error( "unsupported lang: " + lang );
			}
			lang = lang.replace( runescape, funescape ).toLowerCase();
			return function( elem ) {
				var elemLang;
				do {
					if ( ( elemLang = documentIsHTML ?
						elem.lang :
						elem.getAttribute( "xml:lang" ) || elem.getAttribute( "lang" ) ) ) {

						elemLang = elemLang.toLowerCase();
						return elemLang === lang || elemLang.indexOf( lang + "-" ) === 0;
					}
				} while ( ( elem = elem.parentNode ) && elem.nodeType === 1 );
				return false;
			};
		} ),

		// Miscellaneous
		"target": function( elem ) {
			var hash = window.location && window.location.hash;
			return hash && hash.slice( 1 ) === elem.id;
		},

		"root": function( elem ) {
			return elem === docElem;
		},

		"focus": function( elem ) {
			return elem === document.activeElement &&
				( !document.hasFocus || document.hasFocus() ) &&
				!!( elem.type || elem.href || ~elem.tabIndex );
		},

		// Boolean properties
		"enabled": createDisabledPseudo( false ),
		"disabled": createDisabledPseudo( true ),

		"checked": function( elem ) {

			// In CSS3, :checked should return both checked and selected elements
			// http://www.w3.org/TR/2011/REC-css3-selectors-20110929/#checked
			var nodeName = elem.nodeName.toLowerCase();
			return ( nodeName === "input" && !!elem.checked ) ||
				( nodeName === "option" && !!elem.selected );
		},

		"selected": function( elem ) {

			// Accessing this property makes selected-by-default
			// options in Safari work properly
			if ( elem.parentNode ) {
				// eslint-disable-next-line no-unused-expressions
				elem.parentNode.selectedIndex;
			}

			return elem.selected === true;
		},

		// Contents
		"empty": function( elem ) {

			// http://www.w3.org/TR/selectors/#empty-pseudo
			// :empty is negated by element (1) or content nodes (text: 3; cdata: 4; entity ref: 5),
			//   but not by others (comment: 8; processing instruction: 7; etc.)
			// nodeType < 6 works because attributes (2) do not appear as children
			for ( elem = elem.firstChild; elem; elem = elem.nextSibling ) {
				if ( elem.nodeType < 6 ) {
					return false;
				}
			}
			return true;
		},

		"parent": function( elem ) {
			return !Expr.pseudos[ "empty" ]( elem );
		},

		// Element/input types
		"header": function( elem ) {
			return rheader.test( elem.nodeName );
		},

		"input": function( elem ) {
			return rinputs.test( elem.nodeName );
		},

		"button": function( elem ) {
			var name = elem.nodeName.toLowerCase();
			return name === "input" && elem.type === "button" || name === "button";
		},

		"text": function( elem ) {
			var attr;
			return elem.nodeName.toLowerCase() === "input" &&
				elem.type === "text" &&

				// Support: IE<8
				// New HTML5 attribute values (e.g., "search") appear with elem.type === "text"
				( ( attr = elem.getAttribute( "type" ) ) == null ||
					attr.toLowerCase() === "text" );
		},

		// Position-in-collection
		"first": createPositionalPseudo( function() {
			return [ 0 ];
		} ),

		"last": createPositionalPseudo( function( _matchIndexes, length ) {
			return [ length - 1 ];
		} ),

		"eq": createPositionalPseudo( function( _matchIndexes, length, argument ) {
			return [ argument < 0 ? argument + length : argument ];
		} ),

		"even": createPositionalPseudo( function( matchIndexes, length ) {
			var i = 0;
			for ( ; i < length; i += 2 ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		} ),

		"odd": createPositionalPseudo( function( matchIndexes, length ) {
			var i = 1;
			for ( ; i < length; i += 2 ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		} ),

		"lt": createPositionalPseudo( function( matchIndexes, length, argument ) {
			var i = argument < 0 ?
				argument + length :
				argument > length ?
					length :
					argument;
			for ( ; --i >= 0; ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		} ),

		"gt": createPositionalPseudo( function( matchIndexes, length, argument ) {
			var i = argument < 0 ? argument + length : argument;
			for ( ; ++i < length; ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		} )
	}
};

Expr.pseudos[ "nth" ] = Expr.pseudos[ "eq" ];

// Add button/input type pseudos
for ( i in { radio: true, checkbox: true, file: true, password: true, image: true } ) {
	Expr.pseudos[ i ] = createInputPseudo( i );
}
for ( i in { submit: true, reset: true } ) {
	Expr.pseudos[ i ] = createButtonPseudo( i );
}

// Easy API for creating new setFilters
function setFilters() {}
setFilters.prototype = Expr.filters = Expr.pseudos;
Expr.setFilters = new setFilters();

tokenize = Sizzle.tokenize = function( selector, parseOnly ) {
	var matched, match, tokens, type,
		soFar, groups, preFilters,
		cached = tokenCache[ selector + " " ];

	if ( cached ) {
		return parseOnly ? 0 : cached.slice( 0 );
	}

	soFar = selector;
	groups = [];
	preFilters = Expr.preFilter;

	while ( soFar ) {

		// Comma and first run
		if ( !matched || ( match = rcomma.exec( soFar ) ) ) {
			if ( match ) {

				// Don't consume trailing commas as valid
				soFar = soFar.slice( match[ 0 ].length ) || soFar;
			}
			groups.push( ( tokens = [] ) );
		}

		matched = false;

		// Combinators
		if ( ( match = rcombinators.exec( soFar ) ) ) {
			matched = match.shift();
			tokens.push( {
				value: matched,

				// Cast descendant combinators to space
				type: match[ 0 ].replace( rtrim, " " )
			} );
			soFar = soFar.slice( matched.length );
		}

		// Filters
		for ( type in Expr.filter ) {
			if ( ( match = matchExpr[ type ].exec( soFar ) ) && ( !preFilters[ type ] ||
				( match = preFilters[ type ]( match ) ) ) ) {
				matched = match.shift();
				tokens.push( {
					value: matched,
					type: type,
					matches: match
				} );
				soFar = soFar.slice( matched.length );
			}
		}

		if ( !matched ) {
			break;
		}
	}

	// Return the length of the invalid excess
	// if we're just parsing
	// Otherwise, throw an error or return tokens
	return parseOnly ?
		soFar.length :
		soFar ?
			Sizzle.error( selector ) :

			// Cache the tokens
			tokenCache( selector, groups ).slice( 0 );
};

function toSelector( tokens ) {
	var i = 0,
		len = tokens.length,
		selector = "";
	for ( ; i < len; i++ ) {
		selector += tokens[ i ].value;
	}
	return selector;
}

function addCombinator( matcher, combinator, base ) {
	var dir = combinator.dir,
		skip = combinator.next,
		key = skip || dir,
		checkNonElements = base && key === "parentNode",
		doneName = done++;

	return combinator.first ?

		// Check against closest ancestor/preceding element
		function( elem, context, xml ) {
			while ( ( elem = elem[ dir ] ) ) {
				if ( elem.nodeType === 1 || checkNonElements ) {
					return matcher( elem, context, xml );
				}
			}
			return false;
		} :

		// Check against all ancestor/preceding elements
		function( elem, context, xml ) {
			var oldCache, uniqueCache, outerCache,
				newCache = [ dirruns, doneName ];

			// We can't set arbitrary data on XML nodes, so they don't benefit from combinator caching
			if ( xml ) {
				while ( ( elem = elem[ dir ] ) ) {
					if ( elem.nodeType === 1 || checkNonElements ) {
						if ( matcher( elem, context, xml ) ) {
							return true;
						}
					}
				}
			} else {
				while ( ( elem = elem[ dir ] ) ) {
					if ( elem.nodeType === 1 || checkNonElements ) {
						outerCache = elem[ expando ] || ( elem[ expando ] = {} );

						// Support: IE <9 only
						// Defend against cloned attroperties (jQuery gh-1709)
						uniqueCache = outerCache[ elem.uniqueID ] ||
							( outerCache[ elem.uniqueID ] = {} );

						if ( skip && skip === elem.nodeName.toLowerCase() ) {
							elem = elem[ dir ] || elem;
						} else if ( ( oldCache = uniqueCache[ key ] ) &&
							oldCache[ 0 ] === dirruns && oldCache[ 1 ] === doneName ) {

							// Assign to newCache so results back-propagate to previous elements
							return ( newCache[ 2 ] = oldCache[ 2 ] );
						} else {

							// Reuse newcache so results back-propagate to previous elements
							uniqueCache[ key ] = newCache;

							// A match means we're done; a fail means we have to keep checking
							if ( ( newCache[ 2 ] = matcher( elem, context, xml ) ) ) {
								return true;
							}
						}
					}
				}
			}
			return false;
		};
}

function elementMatcher( matchers ) {
	return matchers.length > 1 ?
		function( elem, context, xml ) {
			var i = matchers.length;
			while ( i-- ) {
				if ( !matchers[ i ]( elem, context, xml ) ) {
					return false;
				}
			}
			return true;
		} :
		matchers[ 0 ];
}

function multipleContexts( selector, contexts, results ) {
	var i = 0,
		len = contexts.length;
	for ( ; i < len; i++ ) {
		Sizzle( selector, contexts[ i ], results );
	}
	return results;
}

function condense( unmatched, map, filter, context, xml ) {
	var elem,
		newUnmatched = [],
		i = 0,
		len = unmatched.length,
		mapped = map != null;

	for ( ; i < len; i++ ) {
		if ( ( elem = unmatched[ i ] ) ) {
			if ( !filter || filter( elem, context, xml ) ) {
				newUnmatched.push( elem );
				if ( mapped ) {
					map.push( i );
				}
			}
		}
	}

	return newUnmatched;
}

function setMatcher( preFilter, selector, matcher, postFilter, postFinder, postSelector ) {
	if ( postFilter && !postFilter[ expando ] ) {
		postFilter = setMatcher( postFilter );
	}
	if ( postFinder && !postFinder[ expando ] ) {
		postFinder = setMatcher( postFinder, postSelector );
	}
	return markFunction( function( seed, results, context, xml ) {
		var temp, i, elem,
			preMap = [],
			postMap = [],
			preexisting = results.length,

			// Get initial elements from seed or context
			elems = seed || multipleContexts(
				selector || "*",
				context.nodeType ? [ context ] : context,
				[]
			),

			// Prefilter to get matcher input, preserving a map for seed-results synchronization
			matcherIn = preFilter && ( seed || !selector ) ?
				condense( elems, preMap, preFilter, context, xml ) :
				elems,

			matcherOut = matcher ?

				// If we have a postFinder, or filtered seed, or non-seed postFilter or preexisting results,
				postFinder || ( seed ? preFilter : preexisting || postFilter ) ?

					// ...intermediate processing is necessary
					[] :

					// ...otherwise use results directly
					results :
				matcherIn;

		// Find primary matches
		if ( matcher ) {
			matcher( matcherIn, matcherOut, context, xml );
		}

		// Apply postFilter
		if ( postFilter ) {
			temp = condense( matcherOut, postMap );
			postFilter( temp, [], context, xml );

			// Un-match failing elements by moving them back to matcherIn
			i = temp.length;
			while ( i-- ) {
				if ( ( elem = temp[ i ] ) ) {
					matcherOut[ postMap[ i ] ] = !( matcherIn[ postMap[ i ] ] = elem );
				}
			}
		}

		if ( seed ) {
			if ( postFinder || preFilter ) {
				if ( postFinder ) {

					// Get the final matcherOut by condensing this intermediate into postFinder contexts
					temp = [];
					i = matcherOut.length;
					while ( i-- ) {
						if ( ( elem = matcherOut[ i ] ) ) {

							// Restore matcherIn since elem is not yet a final match
							temp.push( ( matcherIn[ i ] = elem ) );
						}
					}
					postFinder( null, ( matcherOut = [] ), temp, xml );
				}

				// Move matched elements from seed to results to keep them synchronized
				i = matcherOut.length;
				while ( i-- ) {
					if ( ( elem = matcherOut[ i ] ) &&
						( temp = postFinder ? indexOf( seed, elem ) : preMap[ i ] ) > -1 ) {

						seed[ temp ] = !( results[ temp ] = elem );
					}
				}
			}

		// Add elements to results, through postFinder if defined
		} else {
			matcherOut = condense(
				matcherOut === results ?
					matcherOut.splice( preexisting, matcherOut.length ) :
					matcherOut
			);
			if ( postFinder ) {
				postFinder( null, results, matcherOut, xml );
			} else {
				push.apply( results, matcherOut );
			}
		}
	} );
}

function matcherFromTokens( tokens ) {
	var checkContext, matcher, j,
		len = tokens.length,
		leadingRelative = Expr.relative[ tokens[ 0 ].type ],
		implicitRelative = leadingRelative || Expr.relative[ " " ],
		i = leadingRelative ? 1 : 0,

		// The foundational matcher ensures that elements are reachable from top-level context(s)
		matchContext = addCombinator( function( elem ) {
			return elem === checkContext;
		}, implicitRelative, true ),
		matchAnyContext = addCombinator( function( elem ) {
			return indexOf( checkContext, elem ) > -1;
		}, implicitRelative, true ),
		matchers = [ function( elem, context, xml ) {
			var ret = ( !leadingRelative && ( xml || context !== outermostContext ) ) || (
				( checkContext = context ).nodeType ?
					matchContext( elem, context, xml ) :
					matchAnyContext( elem, context, xml ) );

			// Avoid hanging onto element (issue #299)
			checkContext = null;
			return ret;
		} ];

	for ( ; i < len; i++ ) {
		if ( ( matcher = Expr.relative[ tokens[ i ].type ] ) ) {
			matchers = [ addCombinator( elementMatcher( matchers ), matcher ) ];
		} else {
			matcher = Expr.filter[ tokens[ i ].type ].apply( null, tokens[ i ].matches );

			// Return special upon seeing a positional matcher
			if ( matcher[ expando ] ) {

				// Find the next relative operator (if any) for proper handling
				j = ++i;
				for ( ; j < len; j++ ) {
					if ( Expr.relative[ tokens[ j ].type ] ) {
						break;
					}
				}
				return setMatcher(
					i > 1 && elementMatcher( matchers ),
					i > 1 && toSelector(

					// If the preceding token was a descendant combinator, insert an implicit any-element `*`
					tokens
						.slice( 0, i - 1 )
						.concat( { value: tokens[ i - 2 ].type === " " ? "*" : "" } )
					).replace( rtrim, "$1" ),
					matcher,
					i < j && matcherFromTokens( tokens.slice( i, j ) ),
					j < len && matcherFromTokens( ( tokens = tokens.slice( j ) ) ),
					j < len && toSelector( tokens )
				);
			}
			matchers.push( matcher );
		}
	}

	return elementMatcher( matchers );
}

function matcherFromGroupMatchers( elementMatchers, setMatchers ) {
	var bySet = setMatchers.length > 0,
		byElement = elementMatchers.length > 0,
		superMatcher = function( seed, context, xml, results, outermost ) {
			var elem, j, matcher,
				matchedCount = 0,
				i = "0",
				unmatched = seed && [],
				setMatched = [],
				contextBackup = outermostContext,

				// We must always have either seed elements or outermost context
				elems = seed || byElement && Expr.find[ "TAG" ]( "*", outermost ),

				// Use integer dirruns iff this is the outermost matcher
				dirrunsUnique = ( dirruns += contextBackup == null ? 1 : Math.random() || 0.1 ),
				len = elems.length;

			if ( outermost ) {

				// Support: IE 11+, Edge 17 - 18+
				// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
				// two documents; shallow comparisons work.
				// eslint-disable-next-line eqeqeq
				outermostContext = context == document || context || outermost;
			}

			// Add elements passing elementMatchers directly to results
			// Support: IE<9, Safari
			// Tolerate NodeList properties (IE: "length"; Safari: <number>) matching elements by id
			for ( ; i !== len && ( elem = elems[ i ] ) != null; i++ ) {
				if ( byElement && elem ) {
					j = 0;

					// Support: IE 11+, Edge 17 - 18+
					// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
					// two documents; shallow comparisons work.
					// eslint-disable-next-line eqeqeq
					if ( !context && elem.ownerDocument != document ) {
						setDocument( elem );
						xml = !documentIsHTML;
					}
					while ( ( matcher = elementMatchers[ j++ ] ) ) {
						if ( matcher( elem, context || document, xml ) ) {
							results.push( elem );
							break;
						}
					}
					if ( outermost ) {
						dirruns = dirrunsUnique;
					}
				}

				// Track unmatched elements for set filters
				if ( bySet ) {

					// They will have gone through all possible matchers
					if ( ( elem = !matcher && elem ) ) {
						matchedCount--;
					}

					// Lengthen the array for every element, matched or not
					if ( seed ) {
						unmatched.push( elem );
					}
				}
			}

			// `i` is now the count of elements visited above, and adding it to `matchedCount`
			// makes the latter nonnegative.
			matchedCount += i;

			// Apply set filters to unmatched elements
			// NOTE: This can be skipped if there are no unmatched elements (i.e., `matchedCount`
			// equals `i`), unless we didn't visit _any_ elements in the above loop because we have
			// no element matchers and no seed.
			// Incrementing an initially-string "0" `i` allows `i` to remain a string only in that
			// case, which will result in a "00" `matchedCount` that differs from `i` but is also
			// numerically zero.
			if ( bySet && i !== matchedCount ) {
				j = 0;
				while ( ( matcher = setMatchers[ j++ ] ) ) {
					matcher( unmatched, setMatched, context, xml );
				}

				if ( seed ) {

					// Reintegrate element matches to eliminate the need for sorting
					if ( matchedCount > 0 ) {
						while ( i-- ) {
							if ( !( unmatched[ i ] || setMatched[ i ] ) ) {
								setMatched[ i ] = pop.call( results );
							}
						}
					}

					// Discard index placeholder values to get only actual matches
					setMatched = condense( setMatched );
				}

				// Add matches to results
				push.apply( results, setMatched );

				// Seedless set matches succeeding multiple successful matchers stipulate sorting
				if ( outermost && !seed && setMatched.length > 0 &&
					( matchedCount + setMatchers.length ) > 1 ) {

					Sizzle.uniqueSort( results );
				}
			}

			// Override manipulation of globals by nested matchers
			if ( outermost ) {
				dirruns = dirrunsUnique;
				outermostContext = contextBackup;
			}

			return unmatched;
		};

	return bySet ?
		markFunction( superMatcher ) :
		superMatcher;
}

compile = Sizzle.compile = function( selector, match /* Internal Use Only */ ) {
	var i,
		setMatchers = [],
		elementMatchers = [],
		cached = compilerCache[ selector + " " ];

	if ( !cached ) {

		// Generate a function of recursive functions that can be used to check each element
		if ( !match ) {
			match = tokenize( selector );
		}
		i = match.length;
		while ( i-- ) {
			cached = matcherFromTokens( match[ i ] );
			if ( cached[ expando ] ) {
				setMatchers.push( cached );
			} else {
				elementMatchers.push( cached );
			}
		}

		// Cache the compiled function
		cached = compilerCache(
			selector,
			matcherFromGroupMatchers( elementMatchers, setMatchers )
		);

		// Save selector and tokenization
		cached.selector = selector;
	}
	return cached;
};

/**
 * A low-level selection function that works with Sizzle's compiled
 *  selector functions
 * @param {String|Function} selector A selector or a pre-compiled
 *  selector function built with Sizzle.compile
 * @param {Element} context
 * @param {Array} [results]
 * @param {Array} [seed] A set of elements to match against
 */
select = Sizzle.select = function( selector, context, results, seed ) {
	var i, tokens, token, type, find,
		compiled = typeof selector === "function" && selector,
		match = !seed && tokenize( ( selector = compiled.selector || selector ) );

	results = results || [];

	// Try to minimize operations if there is only one selector in the list and no seed
	// (the latter of which guarantees us context)
	if ( match.length === 1 ) {

		// Reduce context if the leading compound selector is an ID
		tokens = match[ 0 ] = match[ 0 ].slice( 0 );
		if ( tokens.length > 2 && ( token = tokens[ 0 ] ).type === "ID" &&
			context.nodeType === 9 && documentIsHTML && Expr.relative[ tokens[ 1 ].type ] ) {

			context = ( Expr.find[ "ID" ]( token.matches[ 0 ]
				.replace( runescape, funescape ), context ) || [] )[ 0 ];
			if ( !context ) {
				return results;

			// Precompiled matchers will still verify ancestry, so step up a level
			} else if ( compiled ) {
				context = context.parentNode;
			}

			selector = selector.slice( tokens.shift().value.length );
		}

		// Fetch a seed set for right-to-left matching
		i = matchExpr[ "needsContext" ].test( selector ) ? 0 : tokens.length;
		while ( i-- ) {
			token = tokens[ i ];

			// Abort if we hit a combinator
			if ( Expr.relative[ ( type = token.type ) ] ) {
				break;
			}
			if ( ( find = Expr.find[ type ] ) ) {

				// Search, expanding context for leading sibling combinators
				if ( ( seed = find(
					token.matches[ 0 ].replace( runescape, funescape ),
					rsibling.test( tokens[ 0 ].type ) && testContext( context.parentNode ) ||
						context
				) ) ) {

					// If seed is empty or no tokens remain, we can return early
					tokens.splice( i, 1 );
					selector = seed.length && toSelector( tokens );
					if ( !selector ) {
						push.apply( results, seed );
						return results;
					}

					break;
				}
			}
		}
	}

	// Compile and execute a filtering function if one is not provided
	// Provide `match` to avoid retokenization if we modified the selector above
	( compiled || compile( selector, match ) )(
		seed,
		context,
		!documentIsHTML,
		results,
		!context || rsibling.test( selector ) && testContext( context.parentNode ) || context
	);
	return results;
};

// One-time assignments

// Sort stability
support.sortStable = expando.split( "" ).sort( sortOrder ).join( "" ) === expando;

// Support: Chrome 14-35+
// Always assume duplicates if they aren't passed to the comparison function
support.detectDuplicates = !!hasDuplicate;

// Initialize against the default document
setDocument();

// Support: Webkit<537.32 - Safari 6.0.3/Chrome 25 (fixed in Chrome 27)
// Detached nodes confoundingly follow *each other*
support.sortDetached = assert( function( el ) {

	// Should return 1, but returns 4 (following)
	return el.compareDocumentPosition( document.createElement( "fieldset" ) ) & 1;
} );

// Support: IE<8
// Prevent attribute/property "interpolation"
// https://msdn.microsoft.com/en-us/library/ms536429%28VS.85%29.aspx
if ( !assert( function( el ) {
	el.innerHTML = "<a href='#'></a>";
	return el.firstChild.getAttribute( "href" ) === "#";
} ) ) {
	addHandle( "type|href|height|width", function( elem, name, isXML ) {
		if ( !isXML ) {
			return elem.getAttribute( name, name.toLowerCase() === "type" ? 1 : 2 );
		}
	} );
}

// Support: IE<9
// Use defaultValue in place of getAttribute("value")
if ( !support.attributes || !assert( function( el ) {
	el.innerHTML = "<input/>";
	el.firstChild.setAttribute( "value", "" );
	return el.firstChild.getAttribute( "value" ) === "";
} ) ) {
	addHandle( "value", function( elem, _name, isXML ) {
		if ( !isXML && elem.nodeName.toLowerCase() === "input" ) {
			return elem.defaultValue;
		}
	} );
}

// Support: IE<9
// Use getAttributeNode to fetch booleans when getAttribute lies
if ( !assert( function( el ) {
	return el.getAttribute( "disabled" ) == null;
} ) ) {
	addHandle( booleans, function( elem, name, isXML ) {
		var val;
		if ( !isXML ) {
			return elem[ name ] === true ? name.toLowerCase() :
				( val = elem.getAttributeNode( name ) ) && val.specified ?
					val.value :
					null;
		}
	} );
}

return Sizzle;

} )( window );



jQuery.find = Sizzle;
jQuery.expr = Sizzle.selectors;

// Deprecated
jQuery.expr[ ":" ] = jQuery.expr.pseudos;
jQuery.uniqueSort = jQuery.unique = Sizzle.uniqueSort;
jQuery.text = Sizzle.getText;
jQuery.isXMLDoc = Sizzle.isXML;
jQuery.contains = Sizzle.contains;
jQuery.escapeSelector = Sizzle.escape;




var dir = function( elem, dir, until ) {
	var matched = [],
		truncate = until !== undefined;

	while ( ( elem = elem[ dir ] ) && elem.nodeType !== 9 ) {
		if ( elem.nodeType === 1 ) {
			if ( truncate && jQuery( elem ).is( until ) ) {
				break;
			}
			matched.push( elem );
		}
	}
	return matched;
};


var siblings = function( n, elem ) {
	var matched = [];

	for ( ; n; n = n.nextSibling ) {
		if ( n.nodeType === 1 && n !== elem ) {
			matched.push( n );
		}
	}

	return matched;
};


var rneedsContext = jQuery.expr.match.needsContext;



function nodeName( elem, name ) {

	return elem.nodeName && elem.nodeName.toLowerCase() === name.toLowerCase();

}
var rsingleTag = ( /^<([a-z][^\/\0>:\x20\t\r\n\f]*)[\x20\t\r\n\f]*\/?>(?:<\/\1>|)$/i );



// Implement the identical functionality for filter and not
function winnow( elements, qualifier, not ) {
	if ( isFunction( qualifier ) ) {
		return jQuery.grep( elements, function( elem, i ) {
			return !!qualifier.call( elem, i, elem ) !== not;
		} );
	}

	// Single element
	if ( qualifier.nodeType ) {
		return jQuery.grep( elements, function( elem ) {
			return ( elem === qualifier ) !== not;
		} );
	}

	// Arraylike of elements (jQuery, arguments, Array)
	if ( typeof qualifier !== "string" ) {
		return jQuery.grep( elements, function( elem ) {
			return ( indexOf.call( qualifier, elem ) > -1 ) !== not;
		} );
	}

	// Filtered directly for both simple and complex selectors
	return jQuery.filter( qualifier, elements, not );
}

jQuery.filter = function( expr, elems, not ) {
	var elem = elems[ 0 ];

	if ( not ) {
		expr = ":not(" + expr + ")";
	}

	if ( elems.length === 1 && elem.nodeType === 1 ) {
		return jQuery.find.matchesSelector( elem, expr ) ? [ elem ] : [];
	}

	return jQuery.find.matches( expr, jQuery.grep( elems, function( elem ) {
		return elem.nodeType === 1;
	} ) );
};

jQuery.fn.extend( {
	find: function( selector ) {
		var i, ret,
			len = this.length,
			self = this;

		if ( typeof selector !== "string" ) {
			return this.pushStack( jQuery( selector ).filter( function() {
				for ( i = 0; i < len; i++ ) {
					if ( jQuery.contains( self[ i ], this ) ) {
						return true;
					}
				}
			} ) );
		}

		ret = this.pushStack( [] );

		for ( i = 0; i < len; i++ ) {
			jQuery.find( selector, self[ i ], ret );
		}

		return len > 1 ? jQuery.uniqueSort( ret ) : ret;
	},
	filter: function( selector ) {
		return this.pushStack( winnow( this, selector || [], false ) );
	},
	not: function( selector ) {
		return this.pushStack( winnow( this, selector || [], true ) );
	},
	is: function( selector ) {
		return !!winnow(
			this,

			// If this is a positional/relative selector, check membership in the returned set
			// so $("p:first").is("p:last") won't return true for a doc with two "p".
			typeof selector === "string" && rneedsContext.test( selector ) ?
				jQuery( selector ) :
				selector || [],
			false
		).length;
	}
} );


// Initialize a jQuery object


// A central reference to the root jQuery(document)
var rootjQuery,

	// A simple way to check for HTML strings
	// Prioritize #id over <tag> to avoid XSS via location.hash (#9521)
	// Strict HTML recognition (#11290: must start with <)
	// Shortcut simple #id case for speed
	rquickExpr = /^(?:\s*(<[\w\W]+>)[^>]*|#([\w-]+))$/,

	init = jQuery.fn.init = function( selector, context, root ) {
		var match, elem;

		// HANDLE: $(""), $(null), $(undefined), $(false)
		if ( !selector ) {
			return this;
		}

		// Method init() accepts an alternate rootjQuery
		// so migrate can support jQuery.sub (gh-2101)
		root = root || rootjQuery;

		// Handle HTML strings
		if ( typeof selector === "string" ) {
			if ( selector[ 0 ] === "<" &&
				selector[ selector.length - 1 ] === ">" &&
				selector.length >= 3 ) {

				// Assume that strings that start and end with <> are HTML and skip the regex check
				match = [ null, selector, null ];

			} else {
				match = rquickExpr.exec( selector );
			}

			// Match html or make sure no context is specified for #id
			if ( match && ( match[ 1 ] || !context ) ) {

				// HANDLE: $(html) -> $(array)
				if ( match[ 1 ] ) {
					context = context instanceof jQuery ? context[ 0 ] : context;

					// Option to run scripts is true for back-compat
					// Intentionally let the error be thrown if parseHTML is not present
					jQuery.merge( this, jQuery.parseHTML(
						match[ 1 ],
						context && context.nodeType ? context.ownerDocument || context : document,
						true
					) );

					// HANDLE: $(html, props)
					if ( rsingleTag.test( match[ 1 ] ) && jQuery.isPlainObject( context ) ) {
						for ( match in context ) {

							// Properties of context are called as methods if possible
							if ( isFunction( this[ match ] ) ) {
								this[ match ]( context[ match ] );

							// ...and otherwise set as attributes
							} else {
								this.attr( match, context[ match ] );
							}
						}
					}

					return this;

				// HANDLE: $(#id)
				} else {
					elem = document.getElementById( match[ 2 ] );

					if ( elem ) {

						// Inject the element directly into the jQuery object
						this[ 0 ] = elem;
						this.length = 1;
					}
					return this;
				}

			// HANDLE: $(expr, $(...))
			} else if ( !context || context.jquery ) {
				return ( context || root ).find( selector );

			// HANDLE: $(expr, context)
			// (which is just equivalent to: $(context).find(expr)
			} else {
				return this.constructor( context ).find( selector );
			}

		// HANDLE: $(DOMElement)
		} else if ( selector.nodeType ) {
			this[ 0 ] = selector;
			this.length = 1;
			return this;

		// HANDLE: $(function)
		// Shortcut for document ready
		} else if ( isFunction( selector ) ) {
			return root.ready !== undefined ?
				root.ready( selector ) :

				// Execute immediately if ready is not present
				selector( jQuery );
		}

		return jQuery.makeArray( selector, this );
	};

// Give the init function the jQuery prototype for later instantiation
init.prototype = jQuery.fn;

// Initialize central reference
rootjQuery = jQuery( document );


var rparentsprev = /^(?:parents|prev(?:Until|All))/,

	// Methods guaranteed to produce a unique set when starting from a unique set
	guaranteedUnique = {
		children: true,
		contents: true,
		next: true,
		prev: true
	};

jQuery.fn.extend( {
	has: function( target ) {
		var targets = jQuery( target, this ),
			l = targets.length;

		return this.filter( function() {
			var i = 0;
			for ( ; i < l; i++ ) {
				if ( jQuery.contains( this, targets[ i ] ) ) {
					return true;
				}
			}
		} );
	},

	closest: function( selectors, context ) {
		var cur,
			i = 0,
			l = this.length,
			matched = [],
			targets = typeof selectors !== "string" && jQuery( selectors );

		// Positional selectors never match, since there's no _selection_ context
		if ( !rneedsContext.test( selectors ) ) {
			for ( ; i < l; i++ ) {
				for ( cur = this[ i ]; cur && cur !== context; cur = cur.parentNode ) {

					// Always skip document fragments
					if ( cur.nodeType < 11 && ( targets ?
						targets.index( cur ) > -1 :

						// Don't pass non-elements to Sizzle
						cur.nodeType === 1 &&
							jQuery.find.matchesSelector( cur, selectors ) ) ) {

						matched.push( cur );
						break;
					}
				}
			}
		}

		return this.pushStack( matched.length > 1 ? jQuery.uniqueSort( matched ) : matched );
	},

	// Determine the position of an element within the set
	index: function( elem ) {

		// No argument, return index in parent
		if ( !elem ) {
			return ( this[ 0 ] && this[ 0 ].parentNode ) ? this.first().prevAll().length : -1;
		}

		// Index in selector
		if ( typeof elem === "string" ) {
			return indexOf.call( jQuery( elem ), this[ 0 ] );
		}

		// Locate the position of the desired element
		return indexOf.call( this,

			// If it receives a jQuery object, the first element is used
			elem.jquery ? elem[ 0 ] : elem
		);
	},

	add: function( selector, context ) {
		return this.pushStack(
			jQuery.uniqueSort(
				jQuery.merge( this.get(), jQuery( selector, context ) )
			)
		);
	},

	addBack: function( selector ) {
		return this.add( selector == null ?
			this.prevObject : this.prevObject.filter( selector )
		);
	}
} );

function sibling( cur, dir ) {
	while ( ( cur = cur[ dir ] ) && cur.nodeType !== 1 ) {}
	return cur;
}

jQuery.each( {
	parent: function( elem ) {
		var parent = elem.parentNode;
		return parent && parent.nodeType !== 11 ? parent : null;
	},
	parents: function( elem ) {
		return dir( elem, "parentNode" );
	},
	parentsUntil: function( elem, _i, until ) {
		return dir( elem, "parentNode", until );
	},
	next: function( elem ) {
		return sibling( elem, "nextSibling" );
	},
	prev: function( elem ) {
		return sibling( elem, "previousSibling" );
	},
	nextAll: function( elem ) {
		return dir( elem, "nextSibling" );
	},
	prevAll: function( elem ) {
		return dir( elem, "previousSibling" );
	},
	nextUntil: function( elem, _i, until ) {
		return dir( elem, "nextSibling", until );
	},
	prevUntil: function( elem, _i, until ) {
		return dir( elem, "previousSibling", until );
	},
	siblings: function( elem ) {
		return siblings( ( elem.parentNode || {} ).firstChild, elem );
	},
	children: function( elem ) {
		return siblings( elem.firstChild );
	},
	contents: function( elem ) {
		if ( elem.contentDocument != null &&

			// Support: IE 11+
			// <object> elements with no `data` attribute has an object
			// `contentDocument` with a `null` prototype.
			getProto( elem.contentDocument ) ) {

			return elem.contentDocument;
		}

		// Support: IE 9 - 11 only, iOS 7 only, Android Browser <=4.3 only
		// Treat the template element as a regular one in browsers that
		// don't support it.
		if ( nodeName( elem, "template" ) ) {
			elem = elem.content || elem;
		}

		return jQuery.merge( [], elem.childNodes );
	}
}, function( name, fn ) {
	jQuery.fn[ name ] = function( until, selector ) {
		var matched = jQuery.map( this, fn, until );

		if ( name.slice( -5 ) !== "Until" ) {
			selector = until;
		}

		if ( selector && typeof selector === "string" ) {
			matched = jQuery.filter( selector, matched );
		}

		if ( this.length > 1 ) {

			// Remove duplicates
			if ( !guaranteedUnique[ name ] ) {
				jQuery.uniqueSort( matched );
			}

			// Reverse order for parents* and prev-derivatives
			if ( rparentsprev.test( name ) ) {
				matched.reverse();
			}
		}

		return this.pushStack( matched );
	};
} );
var rnothtmlwhite = ( /[^\x20\t\r\n\f]+/g );



// Convert String-formatted options into Object-formatted ones
function createOptions( options ) {
	var object = {};
	jQuery.each( options.match( rnothtmlwhite ) || [], function( _, flag ) {
		object[ flag ] = true;
	} );
	return object;
}

/*
 * Create a callback list using the following parameters:
 *
 *	options: an optional list of space-separated options that will change how
 *			the callback list behaves or a more traditional option object
 *
 * By default a callback list will act like an event callback list and can be
 * "fired" multiple times.
 *
 * Possible options:
 *
 *	once:			will ensure the callback list can only be fired once (like a Deferred)
 *
 *	memory:			will keep track of previous values and will call any callback added
 *					after the list has been fired right away with the latest "memorized"
 *					values (like a Deferred)
 *
 *	unique:			will ensure a callback can only be added once (no duplicate in the list)
 *
 *	stopOnFalse:	interrupt callings when a callback returns false
 *
 */
jQuery.Callbacks = function( options ) {

	// Convert options from String-formatted to Object-formatted if needed
	// (we check in cache first)
	options = typeof options === "string" ?
		createOptions( options ) :
		jQuery.extend( {}, options );

	var // Flag to know if list is currently firing
		firing,

		// Last fire value for non-forgettable lists
		memory,

		// Flag to know if list was already fired
		fired,

		// Flag to prevent firing
		locked,

		// Actual callback list
		list = [],

		// Queue of execution data for repeatable lists
		queue = [],

		// Index of currently firing callback (modified by add/remove as needed)
		firingIndex = -1,

		// Fire callbacks
		fire = function() {

			// Enforce single-firing
			locked = locked || options.once;

			// Execute callbacks for all pending executions,
			// respecting firingIndex overrides and runtime changes
			fired = firing = true;
			for ( ; queue.length; firingIndex = -1 ) {
				memory = queue.shift();
				while ( ++firingIndex < list.length ) {

					// Run callback and check for early termination
					if ( list[ firingIndex ].apply( memory[ 0 ], memory[ 1 ] ) === false &&
						options.stopOnFalse ) {

						// Jump to end and forget the data so .add doesn't re-fire
						firingIndex = list.length;
						memory = false;
					}
				}
			}

			// Forget the data if we're done with it
			if ( !options.memory ) {
				memory = false;
			}

			firing = false;

			// Clean up if we're done firing for good
			if ( locked ) {

				// Keep an empty list if we have data for future add calls
				if ( memory ) {
					list = [];

				// Otherwise, this object is spent
				} else {
					list = "";
				}
			}
		},

		// Actual Callbacks object
		self = {

			// Add a callback or a collection of callbacks to the list
			add: function() {
				if ( list ) {

					// If we have memory from a past run, we should fire after adding
					if ( memory && !firing ) {
						firingIndex = list.length - 1;
						queue.push( memory );
					}

					( function add( args ) {
						jQuery.each( args, function( _, arg ) {
							if ( isFunction( arg ) ) {
								if ( !options.unique || !self.has( arg ) ) {
									list.push( arg );
								}
							} else if ( arg && arg.length && toType( arg ) !== "string" ) {

								// Inspect recursively
								add( arg );
							}
						} );
					} )( arguments );

					if ( memory && !firing ) {
						fire();
					}
				}
				return this;
			},

			// Remove a callback from the list
			remove: function() {
				jQuery.each( arguments, function( _, arg ) {
					var index;
					while ( ( index = jQuery.inArray( arg, list, index ) ) > -1 ) {
						list.splice( index, 1 );

						// Handle firing indexes
						if ( index <= firingIndex ) {
							firingIndex--;
						}
					}
				} );
				return this;
			},

			// Check if a given callback is in the list.
			// If no argument is given, return whether or not list has callbacks attached.
			has: function( fn ) {
				return fn ?
					jQuery.inArray( fn, list ) > -1 :
					list.length > 0;
			},

			// Remove all callbacks from the list
			empty: function() {
				if ( list ) {
					list = [];
				}
				return this;
			},

			// Disable .fire and .add
			// Abort any current/pending executions
			// Clear all callbacks and values
			disable: function() {
				locked = queue = [];
				list = memory = "";
				return this;
			},
			disabled: function() {
				return !list;
			},

			// Disable .fire
			// Also disable .add unless we have memory (since it would have no effect)
			// Abort any pending executions
			lock: function() {
				locked = queue = [];
				if ( !memory && !firing ) {
					list = memory = "";
				}
				return this;
			},
			locked: function() {
				return !!locked;
			},

			// Call all callbacks with the given context and arguments
			fireWith: function( context, args ) {
				if ( !locked ) {
					args = args || [];
					args = [ context, args.slice ? args.slice() : args ];
					queue.push( args );
					if ( !firing ) {
						fire();
					}
				}
				return this;
			},

			// Call all the callbacks with the given arguments
			fire: function() {
				self.fireWith( this, arguments );
				return this;
			},

			// To know if the callbacks have already been called at least once
			fired: function() {
				return !!fired;
			}
		};

	return self;
};


function Identity( v ) {
	return v;
}
function Thrower( ex ) {
	throw ex;
}

function adoptValue( value, resolve, reject, noValue ) {
	var method;

	try {

		// Check for promise aspect first to privilege synchronous behavior
		if ( value && isFunction( ( method = value.promise ) ) ) {
			method.call( value ).done( resolve ).fail( reject );

		// Other thenables
		} else if ( value && isFunction( ( method = value.then ) ) ) {
			method.call( value, resolve, reject );

		// Other non-thenables
		} else {

			// Control `resolve` arguments by letting Array#slice cast boolean `noValue` to integer:
			// * false: [ value ].slice( 0 ) => resolve( value )
			// * true: [ value ].slice( 1 ) => resolve()
			resolve.apply( undefined, [ value ].slice( noValue ) );
		}

	// For Promises/A+, convert exceptions into rejections
	// Since jQuery.when doesn't unwrap thenables, we can skip the extra checks appearing in
	// Deferred#then to conditionally suppress rejection.
	} catch ( value ) {

		// Support: Android 4.0 only
		// Strict mode functions invoked without .call/.apply get global-object context
		reject.apply( undefined, [ value ] );
	}
}

jQuery.extend( {

	Deferred: function( func ) {
		var tuples = [

				// action, add listener, callbacks,
				// ... .then handlers, argument index, [final state]
				[ "notify", "progress", jQuery.Callbacks( "memory" ),
					jQuery.Callbacks( "memory" ), 2 ],
				[ "resolve", "done", jQuery.Callbacks( "once memory" ),
					jQuery.Callbacks( "once memory" ), 0, "resolved" ],
				[ "reject", "fail", jQuery.Callbacks( "once memory" ),
					jQuery.Callbacks( "once memory" ), 1, "rejected" ]
			],
			state = "pending",
			promise = {
				state: function() {
					return state;
				},
				always: function() {
					deferred.done( arguments ).fail( arguments );
					return this;
				},
				"catch": function( fn ) {
					return promise.then( null, fn );
				},

				// Keep pipe for back-compat
				pipe: function( /* fnDone, fnFail, fnProgress */ ) {
					var fns = arguments;

					return jQuery.Deferred( function( newDefer ) {
						jQuery.each( tuples, function( _i, tuple ) {

							// Map tuples (progress, done, fail) to arguments (done, fail, progress)
							var fn = isFunction( fns[ tuple[ 4 ] ] ) && fns[ tuple[ 4 ] ];

							// deferred.progress(function() { bind to newDefer or newDefer.notify })
							// deferred.done(function() { bind to newDefer or newDefer.resolve })
							// deferred.fail(function() { bind to newDefer or newDefer.reject })
							deferred[ tuple[ 1 ] ]( function() {
								var returned = fn && fn.apply( this, arguments );
								if ( returned && isFunction( returned.promise ) ) {
									returned.promise()
										.progress( newDefer.notify )
										.done( newDefer.resolve )
										.fail( newDefer.reject );
								} else {
									newDefer[ tuple[ 0 ] + "With" ](
										this,
										fn ? [ returned ] : arguments
									);
								}
							} );
						} );
						fns = null;
					} ).promise();
				},
				then: function( onFulfilled, onRejected, onProgress ) {
					var maxDepth = 0;
					function resolve( depth, deferred, handler, special ) {
						return function() {
							var that = this,
								args = arguments,
								mightThrow = function() {
									var returned, then;

									// Support: Promises/A+ section 2.3.3.3.3
									// https://promisesaplus.com/#point-59
									// Ignore double-resolution attempts
									if ( depth < maxDepth ) {
										return;
									}

									returned = handler.apply( that, args );

									// Support: Promises/A+ section 2.3.1
									// https://promisesaplus.com/#point-48
									if ( returned === deferred.promise() ) {
										throw new TypeError( "Thenable self-resolution" );
									}

									// Support: Promises/A+ sections 2.3.3.1, 3.5
									// https://promisesaplus.com/#point-54
									// https://promisesaplus.com/#point-75
									// Retrieve `then` only once
									then = returned &&

										// Support: Promises/A+ section 2.3.4
										// https://promisesaplus.com/#point-64
										// Only check objects and functions for thenability
										( typeof returned === "object" ||
											typeof returned === "function" ) &&
										returned.then;

									// Handle a returned thenable
									if ( isFunction( then ) ) {

										// Special processors (notify) just wait for resolution
										if ( special ) {
											then.call(
												returned,
												resolve( maxDepth, deferred, Identity, special ),
												resolve( maxDepth, deferred, Thrower, special )
											);

										// Normal processors (resolve) also hook into progress
										} else {

											// ...and disregard older resolution values
											maxDepth++;

											then.call(
												returned,
												resolve( maxDepth, deferred, Identity, special ),
												resolve( maxDepth, deferred, Thrower, special ),
												resolve( maxDepth, deferred, Identity,
													deferred.notifyWith )
											);
										}

									// Handle all other returned values
									} else {

										// Only substitute handlers pass on context
										// and multiple values (non-spec behavior)
										if ( handler !== Identity ) {
											that = undefined;
											args = [ returned ];
										}

										// Process the value(s)
										// Default process is resolve
										( special || deferred.resolveWith )( that, args );
									}
								},

								// Only normal processors (resolve) catch and reject exceptions
								process = special ?
									mightThrow :
									function() {
										try {
											mightThrow();
										} catch ( e ) {

											if ( jQuery.Deferred.exceptionHook ) {
												jQuery.Deferred.exceptionHook( e,
													process.stackTrace );
											}

											// Support: Promises/A+ section 2.3.3.3.4.1
											// https://promisesaplus.com/#point-61
											// Ignore post-resolution exceptions
											if ( depth + 1 >= maxDepth ) {

												// Only substitute handlers pass on context
												// and multiple values (non-spec behavior)
												if ( handler !== Thrower ) {
													that = undefined;
													args = [ e ];
												}

												deferred.rejectWith( that, args );
											}
										}
									};

							// Support: Promises/A+ section 2.3.3.3.1
							// https://promisesaplus.com/#point-57
							// Re-resolve promises immediately to dodge false rejection from
							// subsequent errors
							if ( depth ) {
								process();
							} else {

								// Call an optional hook to record the stack, in case of exception
								// since it's otherwise lost when execution goes async
								if ( jQuery.Deferred.getStackHook ) {
									process.stackTrace = jQuery.Deferred.getStackHook();
								}
								window.setTimeout( process );
							}
						};
					}

					return jQuery.Deferred( function( newDefer ) {

						// progress_handlers.add( ... )
						tuples[ 0 ][ 3 ].add(
							resolve(
								0,
								newDefer,
								isFunction( onProgress ) ?
									onProgress :
									Identity,
								newDefer.notifyWith
							)
						);

						// fulfilled_handlers.add( ... )
						tuples[ 1 ][ 3 ].add(
							resolve(
								0,
								newDefer,
								isFunction( onFulfilled ) ?
									onFulfilled :
									Identity
							)
						);

						// rejected_handlers.add( ... )
						tuples[ 2 ][ 3 ].add(
							resolve(
								0,
								newDefer,
								isFunction( onRejected ) ?
									onRejected :
									Thrower
							)
						);
					} ).promise();
				},

				// Get a promise for this deferred
				// If obj is provided, the promise aspect is added to the object
				promise: function( obj ) {
					return obj != null ? jQuery.extend( obj, promise ) : promise;
				}
			},
			deferred = {};

		// Add list-specific methods
		jQuery.each( tuples, function( i, tuple ) {
			var list = tuple[ 2 ],
				stateString = tuple[ 5 ];

			// promise.progress = list.add
			// promise.done = list.add
			// promise.fail = list.add
			promise[ tuple[ 1 ] ] = list.add;

			// Handle state
			if ( stateString ) {
				list.add(
					function() {

						// state = "resolved" (i.e., fulfilled)
						// state = "rejected"
						state = stateString;
					},

					// rejected_callbacks.disable
					// fulfilled_callbacks.disable
					tuples[ 3 - i ][ 2 ].disable,

					// rejected_handlers.disable
					// fulfilled_handlers.disable
					tuples[ 3 - i ][ 3 ].disable,

					// progress_callbacks.lock
					tuples[ 0 ][ 2 ].lock,

					// progress_handlers.lock
					tuples[ 0 ][ 3 ].lock
				);
			}

			// progress_handlers.fire
			// fulfilled_handlers.fire
			// rejected_handlers.fire
			list.add( tuple[ 3 ].fire );

			// deferred.notify = function() { deferred.notifyWith(...) }
			// deferred.resolve = function() { deferred.resolveWith(...) }
			// deferred.reject = function() { deferred.rejectWith(...) }
			deferred[ tuple[ 0 ] ] = function() {
				deferred[ tuple[ 0 ] + "With" ]( this === deferred ? undefined : this, arguments );
				return this;
			};

			// deferred.notifyWith = list.fireWith
			// deferred.resolveWith = list.fireWith
			// deferred.rejectWith = list.fireWith
			deferred[ tuple[ 0 ] + "With" ] = list.fireWith;
		} );

		// Make the deferred a promise
		promise.promise( deferred );

		// Call given func if any
		if ( func ) {
			func.call( deferred, deferred );
		}

		// All done!
		return deferred;
	},

	// Deferred helper
	when: function( singleValue ) {
		var

			// count of uncompleted subordinates
			remaining = arguments.length,

			// count of unprocessed arguments
			i = remaining,

			// subordinate fulfillment data
			resolveContexts = Array( i ),
			resolveValues = slice.call( arguments ),

			// the primary Deferred
			primary = jQuery.Deferred(),

			// subordinate callback factory
			updateFunc = function( i ) {
				return function( value ) {
					resolveContexts[ i ] = this;
					resolveValues[ i ] = arguments.length > 1 ? slice.call( arguments ) : value;
					if ( !( --remaining ) ) {
						primary.resolveWith( resolveContexts, resolveValues );
					}
				};
			};

		// Single- and empty arguments are adopted like Promise.resolve
		if ( remaining <= 1 ) {
			adoptValue( singleValue, primary.done( updateFunc( i ) ).resolve, primary.reject,
				!remaining );

			// Use .then() to unwrap secondary thenables (cf. gh-3000)
			if ( primary.state() === "pending" ||
				isFunction( resolveValues[ i ] && resolveValues[ i ].then ) ) {

				return primary.then();
			}
		}

		// Multiple arguments are aggregated like Promise.all array elements
		while ( i-- ) {
			adoptValue( resolveValues[ i ], updateFunc( i ), primary.reject );
		}

		return primary.promise();
	}
} );


// These usually indicate a programmer mistake during development,
// warn about them ASAP rather than swallowing them by default.
var rerrorNames = /^(Eval|Internal|Range|Reference|Syntax|Type|URI)Error$/;

jQuery.Deferred.exceptionHook = function( error, stack ) {

	// Support: IE 8 - 9 only
	// Console exists when dev tools are open, which can happen at any time
	if ( window.console && window.console.warn && error && rerrorNames.test( error.name ) ) {
		window.console.warn( "jQuery.Deferred exception: " + error.message, error.stack, stack );
	}
};




jQuery.readyException = function( error ) {
	window.setTimeout( function() {
		throw error;
	} );
};




// The deferred used on DOM ready
var readyList = jQuery.Deferred();

jQuery.fn.ready = function( fn ) {

	readyList
		.then( fn )

		// Wrap jQuery.readyException in a function so that the lookup
		// happens at the time of error handling instead of callback
		// registration.
		.catch( function( error ) {
			jQuery.readyException( error );
		} );

	return this;
};

jQuery.extend( {

	// Is the DOM ready to be used? Set to true once it occurs.
	isReady: false,

	// A counter to track how many items to wait for before
	// the ready event fires. See #6781
	readyWait: 1,

	// Handle when the DOM is ready
	ready: function( wait ) {

		// Abort if there are pending holds or we're already ready
		if ( wait === true ? --jQuery.readyWait : jQuery.isReady ) {
			return;
		}

		// Remember that the DOM is ready
		jQuery.isReady = true;

		// If a normal DOM Ready event fired, decrement, and wait if need be
		if ( wait !== true && --jQuery.readyWait > 0 ) {
			return;
		}

		// If there are functions bound, to execute
		readyList.resolveWith( document, [ jQuery ] );
	}
} );

jQuery.ready.then = readyList.then;

// The ready event handler and self cleanup method
function completed() {
	document.removeEventListener( "DOMContentLoaded", completed );
	window.removeEventListener( "load", completed );
	jQuery.ready();
}

// Catch cases where $(document).ready() is called
// after the browser event has already occurred.
// Support: IE <=9 - 10 only
// Older IE sometimes signals "interactive" too soon
if ( document.readyState === "complete" ||
	( document.readyState !== "loading" && !document.documentElement.doScroll ) ) {

	// Handle it asynchronously to allow scripts the opportunity to delay ready
	window.setTimeout( jQuery.ready );

} else {

	// Use the handy event callback
	document.addEventListener( "DOMContentLoaded", completed );

	// A fallback to window.onload, that will always work
	window.addEventListener( "load", completed );
}




// Multifunctional method to get and set values of a collection
// The value/s can optionally be executed if it's a function
var access = function( elems, fn, key, value, chainable, emptyGet, raw ) {
	var i = 0,
		len = elems.length,
		bulk = key == null;

	// Sets many values
	if ( toType( key ) === "object" ) {
		chainable = true;
		for ( i in key ) {
			access( elems, fn, i, key[ i ], true, emptyGet, raw );
		}

	// Sets one value
	} else if ( value !== undefined ) {
		chainable = true;

		if ( !isFunction( value ) ) {
			raw = true;
		}

		if ( bulk ) {

			// Bulk operations run against the entire set
			if ( raw ) {
				fn.call( elems, value );
				fn = null;

			// ...except when executing function values
			} else {
				bulk = fn;
				fn = function( elem, _key, value ) {
					return bulk.call( jQuery( elem ), value );
				};
			}
		}

		if ( fn ) {
			for ( ; i < len; i++ ) {
				fn(
					elems[ i ], key, raw ?
						value :
						value.call( elems[ i ], i, fn( elems[ i ], key ) )
				);
			}
		}
	}

	if ( chainable ) {
		return elems;
	}

	// Gets
	if ( bulk ) {
		return fn.call( elems );
	}

	return len ? fn( elems[ 0 ], key ) : emptyGet;
};


// Matches dashed string for camelizing
var rmsPrefix = /^-ms-/,
	rdashAlpha = /-([a-z])/g;

// Used by camelCase as callback to replace()
function fcamelCase( _all, letter ) {
	return letter.toUpperCase();
}

// Convert dashed to camelCase; used by the css and data modules
// Support: IE <=9 - 11, Edge 12 - 15
// Microsoft forgot to hump their vendor prefix (#9572)
function camelCase( string ) {
	return string.replace( rmsPrefix, "ms-" ).replace( rdashAlpha, fcamelCase );
}
var acceptData = function( owner ) {

	// Accepts only:
	//  - Node
	//    - Node.ELEMENT_NODE
	//    - Node.DOCUMENT_NODE
	//  - Object
	//    - Any
	return owner.nodeType === 1 || owner.nodeType === 9 || !( +owner.nodeType );
};




function Data() {
	this.expando = jQuery.expando + Data.uid++;
}

Data.uid = 1;

Data.prototype = {

	cache: function( owner ) {

		// Check if the owner object already has a cache
		var value = owner[ this.expando ];

		// If not, create one
		if ( !value ) {
			value = {};

			// We can accept data for non-element nodes in modern browsers,
			// but we should not, see #8335.
			// Always return an empty object.
			if ( acceptData( owner ) ) {

				// If it is a node unlikely to be stringify-ed or looped over
				// use plain assignment
				if ( owner.nodeType ) {
					owner[ this.expando ] = value;

				// Otherwise secure it in a non-enumerable property
				// configurable must be true to allow the property to be
				// deleted when data is removed
				} else {
					Object.defineProperty( owner, this.expando, {
						value: value,
						configurable: true
					} );
				}
			}
		}

		return value;
	},
	set: function( owner, data, value ) {
		var prop,
			cache = this.cache( owner );

		// Handle: [ owner, key, value ] args
		// Always use camelCase key (gh-2257)
		if ( typeof data === "string" ) {
			cache[ camelCase( data ) ] = value;

		// Handle: [ owner, { properties } ] args
		} else {

			// Copy the properties one-by-one to the cache object
			for ( prop in data ) {
				cache[ camelCase( prop ) ] = data[ prop ];
			}
		}
		return cache;
	},
	get: function( owner, key ) {
		return key === undefined ?
			this.cache( owner ) :

			// Always use camelCase key (gh-2257)
			owner[ this.expando ] && owner[ this.expando ][ camelCase( key ) ];
	},
	access: function( owner, key, value ) {

		// In cases where either:
		//
		//   1. No key was specified
		//   2. A string key was specified, but no value provided
		//
		// Take the "read" path and allow the get method to determine
		// which value to return, respectively either:
		//
		//   1. The entire cache object
		//   2. The data stored at the key
		//
		if ( key === undefined ||
				( ( key && typeof key === "string" ) && value === undefined ) ) {

			return this.get( owner, key );
		}

		// When the key is not a string, or both a key and value
		// are specified, set or extend (existing objects) with either:
		//
		//   1. An object of properties
		//   2. A key and value
		//
		this.set( owner, key, value );

		// Since the "set" path can have two possible entry points
		// return the expected data based on which path was taken[*]
		return value !== undefined ? value : key;
	},
	remove: function( owner, key ) {
		var i,
			cache = owner[ this.expando ];

		if ( cache === undefined ) {
			return;
		}

		if ( key !== undefined ) {

			// Support array or space separated string of keys
			if ( Array.isArray( key ) ) {

				// If key is an array of keys...
				// We always set camelCase keys, so remove that.
				key = key.map( camelCase );
			} else {
				key = camelCase( key );

				// If a key with the spaces exists, use it.
				// Otherwise, create an array by matching non-whitespace
				key = key in cache ?
					[ key ] :
					( key.match( rnothtmlwhite ) || [] );
			}

			i = key.length;

			while ( i-- ) {
				delete cache[ key[ i ] ];
			}
		}

		// Remove the expando if there's no more data
		if ( key === undefined || jQuery.isEmptyObject( cache ) ) {

			// Support: Chrome <=35 - 45
			// Webkit & Blink performance suffers when deleting properties
			// from DOM nodes, so set to undefined instead
			// https://bugs.chromium.org/p/chromium/issues/detail?id=378607 (bug restricted)
			if ( owner.nodeType ) {
				owner[ this.expando ] = undefined;
			} else {
				delete owner[ this.expando ];
			}
		}
	},
	hasData: function( owner ) {
		var cache = owner[ this.expando ];
		return cache !== undefined && !jQuery.isEmptyObject( cache );
	}
};
var dataPriv = new Data();

var dataUser = new Data();



//	Implementation Summary
//
//	1. Enforce API surface and semantic compatibility with 1.9.x branch
//	2. Improve the module's maintainability by reducing the storage
//		paths to a single mechanism.
//	3. Use the same single mechanism to support "private" and "user" data.
//	4. _Never_ expose "private" data to user code (TODO: Drop _data, _removeData)
//	5. Avoid exposing implementation details on user objects (eg. expando properties)
//	6. Provide a clear path for implementation upgrade to WeakMap in 2014

var rbrace = /^(?:\{[\w\W]*\}|\[[\w\W]*\])$/,
	rmultiDash = /[A-Z]/g;

function getData( data ) {
	if ( data === "true" ) {
		return true;
	}

	if ( data === "false" ) {
		return false;
	}

	if ( data === "null" ) {
		return null;
	}

	// Only convert to a number if it doesn't change the string
	if ( data === +data + "" ) {
		return +data;
	}

	if ( rbrace.test( data ) ) {
		return JSON.parse( data );
	}

	return data;
}

function dataAttr( elem, key, data ) {
	var name;

	// If nothing was found internally, try to fetch any
	// data from the HTML5 data-* attribute
	if ( data === undefined && elem.nodeType === 1 ) {
		name = "data-" + key.replace( rmultiDash, "-$&" ).toLowerCase();
		data = elem.getAttribute( name );

		if ( typeof data === "string" ) {
			try {
				data = getData( data );
			} catch ( e ) {}

			// Make sure we set the data so it isn't changed later
			dataUser.set( elem, key, data );
		} else {
			data = undefined;
		}
	}
	return data;
}

jQuery.extend( {
	hasData: function( elem ) {
		return dataUser.hasData( elem ) || dataPriv.hasData( elem );
	},

	data: function( elem, name, data ) {
		return dataUser.access( elem, name, data );
	},

	removeData: function( elem, name ) {
		dataUser.remove( elem, name );
	},

	// TODO: Now that all calls to _data and _removeData have been replaced
	// with direct calls to dataPriv methods, these can be deprecated.
	_data: function( elem, name, data ) {
		return dataPriv.access( elem, name, data );
	},

	_removeData: function( elem, name ) {
		dataPriv.remove( elem, name );
	}
} );

jQuery.fn.extend( {
	data: function( key, value ) {
		var i, name, data,
			elem = this[ 0 ],
			attrs = elem && elem.attributes;

		// Gets all values
		if ( key === undefined ) {
			if ( this.length ) {
				data = dataUser.get( elem );

				if ( elem.nodeType === 1 && !dataPriv.get( elem, "hasDataAttrs" ) ) {
					i = attrs.length;
					while ( i-- ) {

						// Support: IE 11 only
						// The attrs elements can be null (#14894)
						if ( attrs[ i ] ) {
							name = attrs[ i ].name;
							if ( name.indexOf( "data-" ) === 0 ) {
								name = camelCase( name.slice( 5 ) );
								dataAttr( elem, name, data[ name ] );
							}
						}
					}
					dataPriv.set( elem, "hasDataAttrs", true );
				}
			}

			return data;
		}

		// Sets multiple values
		if ( typeof key === "object" ) {
			return this.each( function() {
				dataUser.set( this, key );
			} );
		}

		return access( this, function( value ) {
			var data;

			// The calling jQuery object (element matches) is not empty
			// (and therefore has an element appears at this[ 0 ]) and the
			// `value` parameter was not undefined. An empty jQuery object
			// will result in `undefined` for elem = this[ 0 ] which will
			// throw an exception if an attempt to read a data cache is made.
			if ( elem && value === undefined ) {

				// Attempt to get data from the cache
				// The key will always be camelCased in Data
				data = dataUser.get( elem, key );
				if ( data !== undefined ) {
					return data;
				}

				// Attempt to "discover" the data in
				// HTML5 custom data-* attrs
				data = dataAttr( elem, key );
				if ( data !== undefined ) {
					return data;
				}

				// We tried really hard, but the data doesn't exist.
				return;
			}

			// Set the data...
			this.each( function() {

				// We always store the camelCased key
				dataUser.set( this, key, value );
			} );
		}, null, value, arguments.length > 1, null, true );
	},

	removeData: function( key ) {
		return this.each( function() {
			dataUser.remove( this, key );
		} );
	}
} );


jQuery.extend( {
	queue: function( elem, type, data ) {
		var queue;

		if ( elem ) {
			type = ( type || "fx" ) + "queue";
			queue = dataPriv.get( elem, type );

			// Speed up dequeue by getting out quickly if this is just a lookup
			if ( data ) {
				if ( !queue || Array.isArray( data ) ) {
					queue = dataPriv.access( elem, type, jQuery.makeArray( data ) );
				} else {
					queue.push( data );
				}
			}
			return queue || [];
		}
	},

	dequeue: function( elem, type ) {
		type = type || "fx";

		var queue = jQuery.queue( elem, type ),
			startLength = queue.length,
			fn = queue.shift(),
			hooks = jQuery._queueHooks( elem, type ),
			next = function() {
				jQuery.dequeue( elem, type );
			};

		// If the fx queue is dequeued, always remove the progress sentinel
		if ( fn === "inprogress" ) {
			fn = queue.shift();
			startLength--;
		}

		if ( fn ) {

			// Add a progress sentinel to prevent the fx queue from being
			// automatically dequeued
			if ( type === "fx" ) {
				queue.unshift( "inprogress" );
			}

			// Clear up the last queue stop function
			delete hooks.stop;
			fn.call( elem, next, hooks );
		}

		if ( !startLength && hooks ) {
			hooks.empty.fire();
		}
	},

	// Not public - generate a queueHooks object, or return the current one
	_queueHooks: function( elem, type ) {
		var key = type + "queueHooks";
		return dataPriv.get( elem, key ) || dataPriv.access( elem, key, {
			empty: jQuery.Callbacks( "once memory" ).add( function() {
				dataPriv.remove( elem, [ type + "queue", key ] );
			} )
		} );
	}
} );

jQuery.fn.extend( {
	queue: function( type, data ) {
		var setter = 2;

		if ( typeof type !== "string" ) {
			data = type;
			type = "fx";
			setter--;
		}

		if ( arguments.length < setter ) {
			return jQuery.queue( this[ 0 ], type );
		}

		return data === undefined ?
			this :
			this.each( function() {
				var queue = jQuery.queue( this, type, data );

				// Ensure a hooks for this queue
				jQuery._queueHooks( this, type );

				if ( type === "fx" && queue[ 0 ] !== "inprogress" ) {
					jQuery.dequeue( this, type );
				}
			} );
	},
	dequeue: function( type ) {
		return this.each( function() {
			jQuery.dequeue( this, type );
		} );
	},
	clearQueue: function( type ) {
		return this.queue( type || "fx", [] );
	},

	// Get a promise resolved when queues of a certain type
	// are emptied (fx is the type by default)
	promise: function( type, obj ) {
		var tmp,
			count = 1,
			defer = jQuery.Deferred(),
			elements = this,
			i = this.length,
			resolve = function() {
				if ( !( --count ) ) {
					defer.resolveWith( elements, [ elements ] );
				}
			};

		if ( typeof type !== "string" ) {
			obj = type;
			type = undefined;
		}
		type = type || "fx";

		while ( i-- ) {
			tmp = dataPriv.get( elements[ i ], type + "queueHooks" );
			if ( tmp && tmp.empty ) {
				count++;
				tmp.empty.add( resolve );
			}
		}
		resolve();
		return defer.promise( obj );
	}
} );
var pnum = ( /[+-]?(?:\d*\.|)\d+(?:[eE][+-]?\d+|)/ ).source;

var rcssNum = new RegExp( "^(?:([+-])=|)(" + pnum + ")([a-z%]*)$", "i" );


var cssExpand = [ "Top", "Right", "Bottom", "Left" ];

var documentElement = document.documentElement;



	var isAttached = function( elem ) {
			return jQuery.contains( elem.ownerDocument, elem );
		},
		composed = { composed: true };

	// Support: IE 9 - 11+, Edge 12 - 18+, iOS 10.0 - 10.2 only
	// Check attachment across shadow DOM boundaries when possible (gh-3504)
	// Support: iOS 10.0-10.2 only
	// Early iOS 10 versions support `attachShadow` but not `getRootNode`,
	// leading to errors. We need to check for `getRootNode`.
	if ( documentElement.getRootNode ) {
		isAttached = function( elem ) {
			return jQuery.contains( elem.ownerDocument, elem ) ||
				elem.getRootNode( composed ) === elem.ownerDocument;
		};
	}
var isHiddenWithinTree = function( elem, el ) {

		// isHiddenWithinTree might be called from jQuery#filter function;
		// in that case, element will be second argument
		elem = el || elem;

		// Inline style trumps all
		return elem.style.display === "none" ||
			elem.style.display === "" &&

			// Otherwise, check computed style
			// Support: Firefox <=43 - 45
			// Disconnected elements can have computed display: none, so first confirm that elem is
			// in the document.
			isAttached( elem ) &&

			jQuery.css( elem, "display" ) === "none";
	};



function adjustCSS( elem, prop, valueParts, tween ) {
	var adjusted, scale,
		maxIterations = 20,
		currentValue = tween ?
			function() {
				return tween.cur();
			} :
			function() {
				return jQuery.css( elem, prop, "" );
			},
		initial = currentValue(),
		unit = valueParts && valueParts[ 3 ] || ( jQuery.cssNumber[ prop ] ? "" : "px" ),

		// Starting value computation is required for potential unit mismatches
		initialInUnit = elem.nodeType &&
			( jQuery.cssNumber[ prop ] || unit !== "px" && +initial ) &&
			rcssNum.exec( jQuery.css( elem, prop ) );

	if ( initialInUnit && initialInUnit[ 3 ] !== unit ) {

		// Support: Firefox <=54
		// Halve the iteration target value to prevent interference from CSS upper bounds (gh-2144)
		initial = initial / 2;

		// Trust units reported by jQuery.css
		unit = unit || initialInUnit[ 3 ];

		// Iteratively approximate from a nonzero starting point
		initialInUnit = +initial || 1;

		while ( maxIterations-- ) {

			// Evaluate and update our best guess (doubling guesses that zero out).
			// Finish if the scale equals or crosses 1 (making the old*new product non-positive).
			jQuery.style( elem, prop, initialInUnit + unit );
			if ( ( 1 - scale ) * ( 1 - ( scale = currentValue() / initial || 0.5 ) ) <= 0 ) {
				maxIterations = 0;
			}
			initialInUnit = initialInUnit / scale;

		}

		initialInUnit = initialInUnit * 2;
		jQuery.style( elem, prop, initialInUnit + unit );

		// Make sure we update the tween properties later on
		valueParts = valueParts || [];
	}

	if ( valueParts ) {
		initialInUnit = +initialInUnit || +initial || 0;

		// Apply relative offset (+=/-=) if specified
		adjusted = valueParts[ 1 ] ?
			initialInUnit + ( valueParts[ 1 ] + 1 ) * valueParts[ 2 ] :
			+valueParts[ 2 ];
		if ( tween ) {
			tween.unit = unit;
			tween.start = initialInUnit;
			tween.end = adjusted;
		}
	}
	return adjusted;
}


var defaultDisplayMap = {};

function getDefaultDisplay( elem ) {
	var temp,
		doc = elem.ownerDocument,
		nodeName = elem.nodeName,
		display = defaultDisplayMap[ nodeName ];

	if ( display ) {
		return display;
	}

	temp = doc.body.appendChild( doc.createElement( nodeName ) );
	display = jQuery.css( temp, "display" );

	temp.parentNode.removeChild( temp );

	if ( display === "none" ) {
		display = "block";
	}
	defaultDisplayMap[ nodeName ] = display;

	return display;
}

function showHide( elements, show ) {
	var display, elem,
		values = [],
		index = 0,
		length = elements.length;

	// Determine new display value for elements that need to change
	for ( ; index < length; index++ ) {
		elem = elements[ index ];
		if ( !elem.style ) {
			continue;
		}

		display = elem.style.display;
		if ( show ) {

			// Since we force visibility upon cascade-hidden elements, an immediate (and slow)
			// check is required in this first loop unless we have a nonempty display value (either
			// inline or about-to-be-restored)
			if ( display === "none" ) {
				values[ index ] = dataPriv.get( elem, "display" ) || null;
				if ( !values[ index ] ) {
					elem.style.display = "";
				}
			}
			if ( elem.style.display === "" && isHiddenWithinTree( elem ) ) {
				values[ index ] = getDefaultDisplay( elem );
			}
		} else {
			if ( display !== "none" ) {
				values[ index ] = "none";

				// Remember what we're overwriting
				dataPriv.set( elem, "display", display );
			}
		}
	}

	// Set the display of the elements in a second loop to avoid constant reflow
	for ( index = 0; index < length; index++ ) {
		if ( values[ index ] != null ) {
			elements[ index ].style.display = values[ index ];
		}
	}

	return elements;
}

jQuery.fn.extend( {
	show: function() {
		return showHide( this, true );
	},
	hide: function() {
		return showHide( this );
	},
	toggle: function( state ) {
		if ( typeof state === "boolean" ) {
			return state ? this.show() : this.hide();
		}

		return this.each( function() {
			if ( isHiddenWithinTree( this ) ) {
				jQuery( this ).show();
			} else {
				jQuery( this ).hide();
			}
		} );
	}
} );
var rcheckableType = ( /^(?:checkbox|radio)$/i );

var rtagName = ( /<([a-z][^\/\0>\x20\t\r\n\f]*)/i );

var rscriptType = ( /^$|^module$|\/(?:java|ecma)script/i );



( function() {
	var fragment = document.createDocumentFragment(),
		div = fragment.appendChild( document.createElement( "div" ) ),
		input = document.createElement( "input" );

	// Support: Android 4.0 - 4.3 only
	// Check state lost if the name is set (#11217)
	// Support: Windows Web Apps (WWA)
	// `name` and `type` must use .setAttribute for WWA (#14901)
	input.setAttribute( "type", "radio" );
	input.setAttribute( "checked", "checked" );
	input.setAttribute( "name", "t" );

	div.appendChild( input );

	// Support: Android <=4.1 only
	// Older WebKit doesn't clone checked state correctly in fragments
	support.checkClone = div.cloneNode( true ).cloneNode( true ).lastChild.checked;

	// Support: IE <=11 only
	// Make sure textarea (and checkbox) defaultValue is properly cloned
	div.innerHTML = "<textarea>x</textarea>";
	support.noCloneChecked = !!div.cloneNode( true ).lastChild.defaultValue;

	// Support: IE <=9 only
	// IE <=9 replaces <option> tags with their contents when inserted outside of
	// the select element.
	div.innerHTML = "<option></option>";
	support.option = !!div.lastChild;
} )();


// We have to close these tags to support XHTML (#13200)
var wrapMap = {

	// XHTML parsers do not magically insert elements in the
	// same way that tag soup parsers do. So we cannot shorten
	// this by omitting <tbody> or other required elements.
	thead: [ 1, "<table>", "</table>" ],
	col: [ 2, "<table><colgroup>", "</colgroup></table>" ],
	tr: [ 2, "<table><tbody>", "</tbody></table>" ],
	td: [ 3, "<table><tbody><tr>", "</tr></tbody></table>" ],

	_default: [ 0, "", "" ]
};

wrapMap.tbody = wrapMap.tfoot = wrapMap.colgroup = wrapMap.caption = wrapMap.thead;
wrapMap.th = wrapMap.td;

// Support: IE <=9 only
if ( !support.option ) {
	wrapMap.optgroup = wrapMap.option = [ 1, "<select multiple='multiple'>", "</select>" ];
}


function getAll( context, tag ) {

	// Support: IE <=9 - 11 only
	// Use typeof to avoid zero-argument method invocation on host objects (#15151)
	var ret;

	if ( typeof context.getElementsByTagName !== "undefined" ) {
		ret = context.getElementsByTagName( tag || "*" );

	} else if ( typeof context.querySelectorAll !== "undefined" ) {
		ret = context.querySelectorAll( tag || "*" );

	} else {
		ret = [];
	}

	if ( tag === undefined || tag && nodeName( context, tag ) ) {
		return jQuery.merge( [ context ], ret );
	}

	return ret;
}


// Mark scripts as having already been evaluated
function setGlobalEval( elems, refElements ) {
	var i = 0,
		l = elems.length;

	for ( ; i < l; i++ ) {
		dataPriv.set(
			elems[ i ],
			"globalEval",
			!refElements || dataPriv.get( refElements[ i ], "globalEval" )
		);
	}
}


var rhtml = /<|&#?\w+;/;

function buildFragment( elems, context, scripts, selection, ignored ) {
	var elem, tmp, tag, wrap, attached, j,
		fragment = context.createDocumentFragment(),
		nodes = [],
		i = 0,
		l = elems.length;

	for ( ; i < l; i++ ) {
		elem = elems[ i ];

		if ( elem || elem === 0 ) {

			// Add nodes directly
			if ( toType( elem ) === "object" ) {

				// Support: Android <=4.0 only, PhantomJS 1 only
				// push.apply(_, arraylike) throws on ancient WebKit
				jQuery.merge( nodes, elem.nodeType ? [ elem ] : elem );

			// Convert non-html into a text node
			} else if ( !rhtml.test( elem ) ) {
				nodes.push( context.createTextNode( elem ) );

			// Convert html into DOM nodes
			} else {
				tmp = tmp || fragment.appendChild( context.createElement( "div" ) );

				// Deserialize a standard representation
				tag = ( rtagName.exec( elem ) || [ "", "" ] )[ 1 ].toLowerCase();
				wrap = wrapMap[ tag ] || wrapMap._default;
				tmp.innerHTML = wrap[ 1 ] + jQuery.htmlPrefilter( elem ) + wrap[ 2 ];

				// Descend through wrappers to the right content
				j = wrap[ 0 ];
				while ( j-- ) {
					tmp = tmp.lastChild;
				}

				// Support: Android <=4.0 only, PhantomJS 1 only
				// push.apply(_, arraylike) throws on ancient WebKit
				jQuery.merge( nodes, tmp.childNodes );

				// Remember the top-level container
				tmp = fragment.firstChild;

				// Ensure the created nodes are orphaned (#12392)
				tmp.textContent = "";
			}
		}
	}

	// Remove wrapper from fragment
	fragment.textContent = "";

	i = 0;
	while ( ( elem = nodes[ i++ ] ) ) {

		// Skip elements already in the context collection (trac-4087)
		if ( selection && jQuery.inArray( elem, selection ) > -1 ) {
			if ( ignored ) {
				ignored.push( elem );
			}
			continue;
		}

		attached = isAttached( elem );

		// Append to fragment
		tmp = getAll( fragment.appendChild( elem ), "script" );

		// Preserve script evaluation history
		if ( attached ) {
			setGlobalEval( tmp );
		}

		// Capture executables
		if ( scripts ) {
			j = 0;
			while ( ( elem = tmp[ j++ ] ) ) {
				if ( rscriptType.test( elem.type || "" ) ) {
					scripts.push( elem );
				}
			}
		}
	}

	return fragment;
}


var rtypenamespace = /^([^.]*)(?:\.(.+)|)/;

function returnTrue() {
	return true;
}

function returnFalse() {
	return false;
}

// Support: IE <=9 - 11+
// focus() and blur() are asynchronous, except when they are no-op.
// So expect focus to be synchronous when the element is already active,
// and blur to be synchronous when the element is not already active.
// (focus and blur are always synchronous in other supported browsers,
// this just defines when we can count on it).
function expectSync( elem, type ) {
	return ( elem === safeActiveElement() ) === ( type === "focus" );
}

// Support: IE <=9 only
// Accessing document.activeElement can throw unexpectedly
// https://bugs.jquery.com/ticket/13393
function safeActiveElement() {
	try {
		return document.activeElement;
	} catch ( err ) { }
}

function on( elem, types, selector, data, fn, one ) {
	var origFn, type;

	// Types can be a map of types/handlers
	if ( typeof types === "object" ) {

		// ( types-Object, selector, data )
		if ( typeof selector !== "string" ) {

			// ( types-Object, data )
			data = data || selector;
			selector = undefined;
		}
		for ( type in types ) {
			on( elem, type, selector, data, types[ type ], one );
		}
		return elem;
	}

	if ( data == null && fn == null ) {

		// ( types, fn )
		fn = selector;
		data = selector = undefined;
	} else if ( fn == null ) {
		if ( typeof selector === "string" ) {

			// ( types, selector, fn )
			fn = data;
			data = undefined;
		} else {

			// ( types, data, fn )
			fn = data;
			data = selector;
			selector = undefined;
		}
	}
	if ( fn === false ) {
		fn = returnFalse;
	} else if ( !fn ) {
		return elem;
	}

	if ( one === 1 ) {
		origFn = fn;
		fn = function( event ) {

			// Can use an empty set, since event contains the info
			jQuery().off( event );
			return origFn.apply( this, arguments );
		};

		// Use same guid so caller can remove using origFn
		fn.guid = origFn.guid || ( origFn.guid = jQuery.guid++ );
	}
	return elem.each( function() {
		jQuery.event.add( this, types, fn, data, selector );
	} );
}

/*
 * Helper functions for managing events -- not part of the public interface.
 * Props to Dean Edwards' addEvent library for many of the ideas.
 */
jQuery.event = {

	global: {},

	add: function( elem, types, handler, data, selector ) {

		var handleObjIn, eventHandle, tmp,
			events, t, handleObj,
			special, handlers, type, namespaces, origType,
			elemData = dataPriv.get( elem );

		// Only attach events to objects that accept data
		if ( !acceptData( elem ) ) {
			return;
		}

		// Caller can pass in an object of custom data in lieu of the handler
		if ( handler.handler ) {
			handleObjIn = handler;
			handler = handleObjIn.handler;
			selector = handleObjIn.selector;
		}

		// Ensure that invalid selectors throw exceptions at attach time
		// Evaluate against documentElement in case elem is a non-element node (e.g., document)
		if ( selector ) {
			jQuery.find.matchesSelector( documentElement, selector );
		}

		// Make sure that the handler has a unique ID, used to find/remove it later
		if ( !handler.guid ) {
			handler.guid = jQuery.guid++;
		}

		// Init the element's event structure and main handler, if this is the first
		if ( !( events = elemData.events ) ) {
			events = elemData.events = Object.create( null );
		}
		if ( !( eventHandle = elemData.handle ) ) {
			eventHandle = elemData.handle = function( e ) {

				// Discard the second event of a jQuery.event.trigger() and
				// when an event is called after a page has unloaded
				return typeof jQuery !== "undefined" && jQuery.event.triggered !== e.type ?
					jQuery.event.dispatch.apply( elem, arguments ) : undefined;
			};
		}

		// Handle multiple events separated by a space
		types = ( types || "" ).match( rnothtmlwhite ) || [ "" ];
		t = types.length;
		while ( t-- ) {
			tmp = rtypenamespace.exec( types[ t ] ) || [];
			type = origType = tmp[ 1 ];
			namespaces = ( tmp[ 2 ] || "" ).split( "." ).sort();

			// There *must* be a type, no attaching namespace-only handlers
			if ( !type ) {
				continue;
			}

			// If event changes its type, use the special event handlers for the changed type
			special = jQuery.event.special[ type ] || {};

			// If selector defined, determine special event api type, otherwise given type
			type = ( selector ? special.delegateType : special.bindType ) || type;

			// Update special based on newly reset type
			special = jQuery.event.special[ type ] || {};

			// handleObj is passed to all event handlers
			handleObj = jQuery.extend( {
				type: type,
				origType: origType,
				data: data,
				handler: handler,
				guid: handler.guid,
				selector: selector,
				needsContext: selector && jQuery.expr.match.needsContext.test( selector ),
				namespace: namespaces.join( "." )
			}, handleObjIn );

			// Init the event handler queue if we're the first
			if ( !( handlers = events[ type ] ) ) {
				handlers = events[ type ] = [];
				handlers.delegateCount = 0;

				// Only use addEventListener if the special events handler returns false
				if ( !special.setup ||
					special.setup.call( elem, data, namespaces, eventHandle ) === false ) {

					if ( elem.addEventListener ) {
						elem.addEventListener( type, eventHandle );
					}
				}
			}

			if ( special.add ) {
				special.add.call( elem, handleObj );

				if ( !handleObj.handler.guid ) {
					handleObj.handler.guid = handler.guid;
				}
			}

			// Add to the element's handler list, delegates in front
			if ( selector ) {
				handlers.splice( handlers.delegateCount++, 0, handleObj );
			} else {
				handlers.push( handleObj );
			}

			// Keep track of which events have ever been used, for event optimization
			jQuery.event.global[ type ] = true;
		}

	},

	// Detach an event or set of events from an element
	remove: function( elem, types, handler, selector, mappedTypes ) {

		var j, origCount, tmp,
			events, t, handleObj,
			special, handlers, type, namespaces, origType,
			elemData = dataPriv.hasData( elem ) && dataPriv.get( elem );

		if ( !elemData || !( events = elemData.events ) ) {
			return;
		}

		// Once for each type.namespace in types; type may be omitted
		types = ( types || "" ).match( rnothtmlwhite ) || [ "" ];
		t = types.length;
		while ( t-- ) {
			tmp = rtypenamespace.exec( types[ t ] ) || [];
			type = origType = tmp[ 1 ];
			namespaces = ( tmp[ 2 ] || "" ).split( "." ).sort();

			// Unbind all events (on this namespace, if provided) for the element
			if ( !type ) {
				for ( type in events ) {
					jQuery.event.remove( elem, type + types[ t ], handler, selector, true );
				}
				continue;
			}

			special = jQuery.event.special[ type ] || {};
			type = ( selector ? special.delegateType : special.bindType ) || type;
			handlers = events[ type ] || [];
			tmp = tmp[ 2 ] &&
				new RegExp( "(^|\\.)" + namespaces.join( "\\.(?:.*\\.|)" ) + "(\\.|$)" );

			// Remove matching events
			origCount = j = handlers.length;
			while ( j-- ) {
				handleObj = handlers[ j ];

				if ( ( mappedTypes || origType === handleObj.origType ) &&
					( !handler || handler.guid === handleObj.guid ) &&
					( !tmp || tmp.test( handleObj.namespace ) ) &&
					( !selector || selector === handleObj.selector ||
						selector === "**" && handleObj.selector ) ) {
					handlers.splice( j, 1 );

					if ( handleObj.selector ) {
						handlers.delegateCount--;
					}
					if ( special.remove ) {
						special.remove.call( elem, handleObj );
					}
				}
			}

			// Remove generic event handler if we removed something and no more handlers exist
			// (avoids potential for endless recursion during removal of special event handlers)
			if ( origCount && !handlers.length ) {
				if ( !special.teardown ||
					special.teardown.call( elem, namespaces, elemData.handle ) === false ) {

					jQuery.removeEvent( elem, type, elemData.handle );
				}

				delete events[ type ];
			}
		}

		// Remove data and the expando if it's no longer used
		if ( jQuery.isEmptyObject( events ) ) {
			dataPriv.remove( elem, "handle events" );
		}
	},

	dispatch: function( nativeEvent ) {

		var i, j, ret, matched, handleObj, handlerQueue,
			args = new Array( arguments.length ),

			// Make a writable jQuery.Event from the native event object
			event = jQuery.event.fix( nativeEvent ),

			handlers = (
				dataPriv.get( this, "events" ) || Object.create( null )
			)[ event.type ] || [],
			special = jQuery.event.special[ event.type ] || {};

		// Use the fix-ed jQuery.Event rather than the (read-only) native event
		args[ 0 ] = event;

		for ( i = 1; i < arguments.length; i++ ) {
			args[ i ] = arguments[ i ];
		}

		event.delegateTarget = this;

		// Call the preDispatch hook for the mapped type, and let it bail if desired
		if ( special.preDispatch && special.preDispatch.call( this, event ) === false ) {
			return;
		}

		// Determine handlers
		handlerQueue = jQuery.event.handlers.call( this, event, handlers );

		// Run delegates first; they may want to stop propagation beneath us
		i = 0;
		while ( ( matched = handlerQueue[ i++ ] ) && !event.isPropagationStopped() ) {
			event.currentTarget = matched.elem;

			j = 0;
			while ( ( handleObj = matched.handlers[ j++ ] ) &&
				!event.isImmediatePropagationStopped() ) {

				// If the event is namespaced, then each handler is only invoked if it is
				// specially universal or its namespaces are a superset of the event's.
				if ( !event.rnamespace || handleObj.namespace === false ||
					event.rnamespace.test( handleObj.namespace ) ) {

					event.handleObj = handleObj;
					event.data = handleObj.data;

					ret = ( ( jQuery.event.special[ handleObj.origType ] || {} ).handle ||
						handleObj.handler ).apply( matched.elem, args );

					if ( ret !== undefined ) {
						if ( ( event.result = ret ) === false ) {
							event.preventDefault();
							event.stopPropagation();
						}
					}
				}
			}
		}

		// Call the postDispatch hook for the mapped type
		if ( special.postDispatch ) {
			special.postDispatch.call( this, event );
		}

		return event.result;
	},

	handlers: function( event, handlers ) {
		var i, handleObj, sel, matchedHandlers, matchedSelectors,
			handlerQueue = [],
			delegateCount = handlers.delegateCount,
			cur = event.target;

		// Find delegate handlers
		if ( delegateCount &&

			// Support: IE <=9
			// Black-hole SVG <use> instance trees (trac-13180)
			cur.nodeType &&

			// Support: Firefox <=42
			// Suppress spec-violating clicks indicating a non-primary pointer button (trac-3861)
			// https://www.w3.org/TR/DOM-Level-3-Events/#event-type-click
			// Support: IE 11 only
			// ...but not arrow key "clicks" of radio inputs, which can have `button` -1 (gh-2343)
			!( event.type === "click" && event.button >= 1 ) ) {

			for ( ; cur !== this; cur = cur.parentNode || this ) {

				// Don't check non-elements (#13208)
				// Don't process clicks on disabled elements (#6911, #8165, #11382, #11764)
				if ( cur.nodeType === 1 && !( event.type === "click" && cur.disabled === true ) ) {
					matchedHandlers = [];
					matchedSelectors = {};
					for ( i = 0; i < delegateCount; i++ ) {
						handleObj = handlers[ i ];

						// Don't conflict with Object.prototype properties (#13203)
						sel = handleObj.selector + " ";

						if ( matchedSelectors[ sel ] === undefined ) {
							matchedSelectors[ sel ] = handleObj.needsContext ?
								jQuery( sel, this ).index( cur ) > -1 :
								jQuery.find( sel, this, null, [ cur ] ).length;
						}
						if ( matchedSelectors[ sel ] ) {
							matchedHandlers.push( handleObj );
						}
					}
					if ( matchedHandlers.length ) {
						handlerQueue.push( { elem: cur, handlers: matchedHandlers } );
					}
				}
			}
		}

		// Add the remaining (directly-bound) handlers
		cur = this;
		if ( delegateCount < handlers.length ) {
			handlerQueue.push( { elem: cur, handlers: handlers.slice( delegateCount ) } );
		}

		return handlerQueue;
	},

	addProp: function( name, hook ) {
		Object.defineProperty( jQuery.Event.prototype, name, {
			enumerable: true,
			configurable: true,

			get: isFunction( hook ) ?
				function() {
					if ( this.originalEvent ) {
						return hook( this.originalEvent );
					}
				} :
				function() {
					if ( this.originalEvent ) {
						return this.originalEvent[ name ];
					}
				},

			set: function( value ) {
				Object.defineProperty( this, name, {
					enumerable: true,
					configurable: true,
					writable: true,
					value: value
				} );
			}
		} );
	},

	fix: function( originalEvent ) {
		return originalEvent[ jQuery.expando ] ?
			originalEvent :
			new jQuery.Event( originalEvent );
	},

	special: {
		load: {

			// Prevent triggered image.load events from bubbling to window.load
			noBubble: true
		},
		click: {

			// Utilize native event to ensure correct state for checkable inputs
			setup: function( data ) {

				// For mutual compressibility with _default, replace `this` access with a local var.
				// `|| data` is dead code meant only to preserve the variable through minification.
				var el = this || data;

				// Claim the first handler
				if ( rcheckableType.test( el.type ) &&
					el.click && nodeName( el, "input" ) ) {

					// dataPriv.set( el, "click", ... )
					leverageNative( el, "click", returnTrue );
				}

				// Return false to allow normal processing in the caller
				return false;
			},
			trigger: function( data ) {

				// For mutual compressibility with _default, replace `this` access with a local var.
				// `|| data` is dead code meant only to preserve the variable through minification.
				var el = this || data;

				// Force setup before triggering a click
				if ( rcheckableType.test( el.type ) &&
					el.click && nodeName( el, "input" ) ) {

					leverageNative( el, "click" );
				}

				// Return non-false to allow normal event-path propagation
				return true;
			},

			// For cross-browser consistency, suppress native .click() on links
			// Also prevent it if we're currently inside a leveraged native-event stack
			_default: function( event ) {
				var target = event.target;
				return rcheckableType.test( target.type ) &&
					target.click && nodeName( target, "input" ) &&
					dataPriv.get( target, "click" ) ||
					nodeName( target, "a" );
			}
		},

		beforeunload: {
			postDispatch: function( event ) {

				// Support: Firefox 20+
				// Firefox doesn't alert if the returnValue field is not set.
				if ( event.result !== undefined && event.originalEvent ) {
					event.originalEvent.returnValue = event.result;
				}
			}
		}
	}
};

// Ensure the presence of an event listener that handles manually-triggered
// synthetic events by interrupting progress until reinvoked in response to
// *native* events that it fires directly, ensuring that state changes have
// already occurred before other listeners are invoked.
function leverageNative( el, type, expectSync ) {

	// Missing expectSync indicates a trigger call, which must force setup through jQuery.event.add
	if ( !expectSync ) {
		if ( dataPriv.get( el, type ) === undefined ) {
			jQuery.event.add( el, type, returnTrue );
		}
		return;
	}

	// Register the controller as a special universal handler for all event namespaces
	dataPriv.set( el, type, false );
	jQuery.event.add( el, type, {
		namespace: false,
		handler: function( event ) {
			var notAsync, result,
				saved = dataPriv.get( this, type );

			if ( ( event.isTrigger & 1 ) && this[ type ] ) {

				// Interrupt processing of the outer synthetic .trigger()ed event
				// Saved data should be false in such cases, but might be a leftover capture object
				// from an async native handler (gh-4350)
				if ( !saved.length ) {

					// Store arguments for use when handling the inner native event
					// There will always be at least one argument (an event object), so this array
					// will not be confused with a leftover capture object.
					saved = slice.call( arguments );
					dataPriv.set( this, type, saved );

					// Trigger the native event and capture its result
					// Support: IE <=9 - 11+
					// focus() and blur() are asynchronous
					notAsync = expectSync( this, type );
					this[ type ]();
					result = dataPriv.get( this, type );
					if ( saved !== result || notAsync ) {
						dataPriv.set( this, type, false );
					} else {
						result = {};
					}
					if ( saved !== result ) {

						// Cancel the outer synthetic event
						event.stopImmediatePropagation();
						event.preventDefault();

						// Support: Chrome 86+
						// In Chrome, if an element having a focusout handler is blurred by
						// clicking outside of it, it invokes the handler synchronously. If
						// that handler calls `.remove()` on the element, the data is cleared,
						// leaving `result` undefined. We need to guard against this.
						return result && result.value;
					}

				// If this is an inner synthetic event for an event with a bubbling surrogate
				// (focus or blur), assume that the surrogate already propagated from triggering the
				// native event and prevent that from happening again here.
				// This technically gets the ordering wrong w.r.t. to `.trigger()` (in which the
				// bubbling surrogate propagates *after* the non-bubbling base), but that seems
				// less bad than duplication.
				} else if ( ( jQuery.event.special[ type ] || {} ).delegateType ) {
					event.stopPropagation();
				}

			// If this is a native event triggered above, everything is now in order
			// Fire an inner synthetic event with the original arguments
			} else if ( saved.length ) {

				// ...and capture the result
				dataPriv.set( this, type, {
					value: jQuery.event.trigger(

						// Support: IE <=9 - 11+
						// Extend with the prototype to reset the above stopImmediatePropagation()
						jQuery.extend( saved[ 0 ], jQuery.Event.prototype ),
						saved.slice( 1 ),
						this
					)
				} );

				// Abort handling of the native event
				event.stopImmediatePropagation();
			}
		}
	} );
}

jQuery.removeEvent = function( elem, type, handle ) {

	// This "if" is needed for plain objects
	if ( elem.removeEventListener ) {
		elem.removeEventListener( type, handle );
	}
};

jQuery.Event = function( src, props ) {

	// Allow instantiation without the 'new' keyword
	if ( !( this instanceof jQuery.Event ) ) {
		return new jQuery.Event( src, props );
	}

	// Event object
	if ( src && src.type ) {
		this.originalEvent = src;
		this.type = src.type;

		// Events bubbling up the document may have been marked as prevented
		// by a handler lower down the tree; reflect the correct value.
		this.isDefaultPrevented = src.defaultPrevented ||
				src.defaultPrevented === undefined &&

				// Support: Android <=2.3 only
				src.returnValue === false ?
			returnTrue :
			returnFalse;

		// Create target properties
		// Support: Safari <=6 - 7 only
		// Target should not be a text node (#504, #13143)
		this.target = ( src.target && src.target.nodeType === 3 ) ?
			src.target.parentNode :
			src.target;

		this.currentTarget = src.currentTarget;
		this.relatedTarget = src.relatedTarget;

	// Event type
	} else {
		this.type = src;
	}

	// Put explicitly provided properties onto the event object
	if ( props ) {
		jQuery.extend( this, props );
	}

	// Create a timestamp if incoming event doesn't have one
	this.timeStamp = src && src.timeStamp || Date.now();

	// Mark it as fixed
	this[ jQuery.expando ] = true;
};

// jQuery.Event is based on DOM3 Events as specified by the ECMAScript Language Binding
// https://www.w3.org/TR/2003/WD-DOM-Level-3-Events-20030331/ecma-script-binding.html
jQuery.Event.prototype = {
	constructor: jQuery.Event,
	isDefaultPrevented: returnFalse,
	isPropagationStopped: returnFalse,
	isImmediatePropagationStopped: returnFalse,
	isSimulated: false,

	preventDefault: function() {
		var e = this.originalEvent;

		this.isDefaultPrevented = returnTrue;

		if ( e && !this.isSimulated ) {
			e.preventDefault();
		}
	},
	stopPropagation: function() {
		var e = this.originalEvent;

		this.isPropagationStopped = returnTrue;

		if ( e && !this.isSimulated ) {
			e.stopPropagation();
		}
	},
	stopImmediatePropagation: function() {
		var e = this.originalEvent;

		this.isImmediatePropagationStopped = returnTrue;

		if ( e && !this.isSimulated ) {
			e.stopImmediatePropagation();
		}

		this.stopPropagation();
	}
};

// Includes all common event props including KeyEvent and MouseEvent specific props
jQuery.each( {
	altKey: true,
	bubbles: true,
	cancelable: true,
	changedTouches: true,
	ctrlKey: true,
	detail: true,
	eventPhase: true,
	metaKey: true,
	pageX: true,
	pageY: true,
	shiftKey: true,
	view: true,
	"char": true,
	code: true,
	charCode: true,
	key: true,
	keyCode: true,
	button: true,
	buttons: true,
	clientX: true,
	clientY: true,
	offsetX: true,
	offsetY: true,
	pointerId: true,
	pointerType: true,
	screenX: true,
	screenY: true,
	targetTouches: true,
	toElement: true,
	touches: true,
	which: true
}, jQuery.event.addProp );

jQuery.each( { focus: "focusin", blur: "focusout" }, function( type, delegateType ) {
	jQuery.event.special[ type ] = {

		// Utilize native event if possible so blur/focus sequence is correct
		setup: function() {

			// Claim the first handler
			// dataPriv.set( this, "focus", ... )
			// dataPriv.set( this, "blur", ... )
			leverageNative( this, type, expectSync );

			// Return false to allow normal processing in the caller
			return false;
		},
		trigger: function() {

			// Force setup before trigger
			leverageNative( this, type );

			// Return non-false to allow normal event-path propagation
			return true;
		},

		// Suppress native focus or blur as it's already being fired
		// in leverageNative.
		_default: function() {
			return true;
		},

		delegateType: delegateType
	};
} );

// Create mouseenter/leave events using mouseover/out and event-time checks
// so that event delegation works in jQuery.
// Do the same for pointerenter/pointerleave and pointerover/pointerout
//
// Support: Safari 7 only
// Safari sends mouseenter too often; see:
// https://bugs.chromium.org/p/chromium/issues/detail?id=470258
// for the description of the bug (it existed in older Chrome versions as well).
jQuery.each( {
	mouseenter: "mouseover",
	mouseleave: "mouseout",
	pointerenter: "pointerover",
	pointerleave: "pointerout"
}, function( orig, fix ) {
	jQuery.event.special[ orig ] = {
		delegateType: fix,
		bindType: fix,

		handle: function( event ) {
			var ret,
				target = this,
				related = event.relatedTarget,
				handleObj = event.handleObj;

			// For mouseenter/leave call the handler if related is outside the target.
			// NB: No relatedTarget if the mouse left/entered the browser window
			if ( !related || ( related !== target && !jQuery.contains( target, related ) ) ) {
				event.type = handleObj.origType;
				ret = handleObj.handler.apply( this, arguments );
				event.type = fix;
			}
			return ret;
		}
	};
} );

jQuery.fn.extend( {

	on: function( types, selector, data, fn ) {
		return on( this, types, selector, data, fn );
	},
	one: function( types, selector, data, fn ) {
		return on( this, types, selector, data, fn, 1 );
	},
	off: function( types, selector, fn ) {
		var handleObj, type;
		if ( types && types.preventDefault && types.handleObj ) {

			// ( event )  dispatched jQuery.Event
			handleObj = types.handleObj;
			jQuery( types.delegateTarget ).off(
				handleObj.namespace ?
					handleObj.origType + "." + handleObj.namespace :
					handleObj.origType,
				handleObj.selector,
				handleObj.handler
			);
			return this;
		}
		if ( typeof types === "object" ) {

			// ( types-object [, selector] )
			for ( type in types ) {
				this.off( type, selector, types[ type ] );
			}
			return this;
		}
		if ( selector === false || typeof selector === "function" ) {

			// ( types [, fn] )
			fn = selector;
			selector = undefined;
		}
		if ( fn === false ) {
			fn = returnFalse;
		}
		return this.each( function() {
			jQuery.event.remove( this, types, fn, selector );
		} );
	}
} );


var

	// Support: IE <=10 - 11, Edge 12 - 13 only
	// In IE/Edge using regex groups here causes severe slowdowns.
	// See https://connect.microsoft.com/IE/feedback/details/1736512/
	rnoInnerhtml = /<script|<style|<link/i,

	// checked="checked" or checked
	rchecked = /checked\s*(?:[^=]|=\s*.checked.)/i,
	rcleanScript = /^\s*<!(?:\[CDATA\[|--)|(?:\]\]|--)>\s*$/g;

// Prefer a tbody over its parent table for containing new rows
function manipulationTarget( elem, content ) {
	if ( nodeName( elem, "table" ) &&
		nodeName( content.nodeType !== 11 ? content : content.firstChild, "tr" ) ) {

		return jQuery( elem ).children( "tbody" )[ 0 ] || elem;
	}

	return elem;
}

// Replace/restore the type attribute of script elements for safe DOM manipulation
function disableScript( elem ) {
	elem.type = ( elem.getAttribute( "type" ) !== null ) + "/" + elem.type;
	return elem;
}
function restoreScript( elem ) {
	if ( ( elem.type || "" ).slice( 0, 5 ) === "true/" ) {
		elem.type = elem.type.slice( 5 );
	} else {
		elem.removeAttribute( "type" );
	}

	return elem;
}

function cloneCopyEvent( src, dest ) {
	var i, l, type, pdataOld, udataOld, udataCur, events;

	if ( dest.nodeType !== 1 ) {
		return;
	}

	// 1. Copy private data: events, handlers, etc.
	if ( dataPriv.hasData( src ) ) {
		pdataOld = dataPriv.get( src );
		events = pdataOld.events;

		if ( events ) {
			dataPriv.remove( dest, "handle events" );

			for ( type in events ) {
				for ( i = 0, l = events[ type ].length; i < l; i++ ) {
					jQuery.event.add( dest, type, events[ type ][ i ] );
				}
			}
		}
	}

	// 2. Copy user data
	if ( dataUser.hasData( src ) ) {
		udataOld = dataUser.access( src );
		udataCur = jQuery.extend( {}, udataOld );

		dataUser.set( dest, udataCur );
	}
}

// Fix IE bugs, see support tests
function fixInput( src, dest ) {
	var nodeName = dest.nodeName.toLowerCase();

	// Fails to persist the checked state of a cloned checkbox or radio button.
	if ( nodeName === "input" && rcheckableType.test( src.type ) ) {
		dest.checked = src.checked;

	// Fails to return the selected option to the default selected state when cloning options
	} else if ( nodeName === "input" || nodeName === "textarea" ) {
		dest.defaultValue = src.defaultValue;
	}
}

function domManip( collection, args, callback, ignored ) {

	// Flatten any nested arrays
	args = flat( args );

	var fragment, first, scripts, hasScripts, node, doc,
		i = 0,
		l = collection.length,
		iNoClone = l - 1,
		value = args[ 0 ],
		valueIsFunction = isFunction( value );

	// We can't cloneNode fragments that contain checked, in WebKit
	if ( valueIsFunction ||
			( l > 1 && typeof value === "string" &&
				!support.checkClone && rchecked.test( value ) ) ) {
		return collection.each( function( index ) {
			var self = collection.eq( index );
			if ( valueIsFunction ) {
				args[ 0 ] = value.call( this, index, self.html() );
			}
			domManip( self, args, callback, ignored );
		} );
	}

	if ( l ) {
		fragment = buildFragment( args, collection[ 0 ].ownerDocument, false, collection, ignored );
		first = fragment.firstChild;

		if ( fragment.childNodes.length === 1 ) {
			fragment = first;
		}

		// Require either new content or an interest in ignored elements to invoke the callback
		if ( first || ignored ) {
			scripts = jQuery.map( getAll( fragment, "script" ), disableScript );
			hasScripts = scripts.length;

			// Use the original fragment for the last item
			// instead of the first because it can end up
			// being emptied incorrectly in certain situations (#8070).
			for ( ; i < l; i++ ) {
				node = fragment;

				if ( i !== iNoClone ) {
					node = jQuery.clone( node, true, true );

					// Keep references to cloned scripts for later restoration
					if ( hasScripts ) {

						// Support: Android <=4.0 only, PhantomJS 1 only
						// push.apply(_, arraylike) throws on ancient WebKit
						jQuery.merge( scripts, getAll( node, "script" ) );
					}
				}

				callback.call( collection[ i ], node, i );
			}

			if ( hasScripts ) {
				doc = scripts[ scripts.length - 1 ].ownerDocument;

				// Reenable scripts
				jQuery.map( scripts, restoreScript );

				// Evaluate executable scripts on first document insertion
				for ( i = 0; i < hasScripts; i++ ) {
					node = scripts[ i ];
					if ( rscriptType.test( node.type || "" ) &&
						!dataPriv.access( node, "globalEval" ) &&
						jQuery.contains( doc, node ) ) {

						if ( node.src && ( node.type || "" ).toLowerCase()  !== "module" ) {

							// Optional AJAX dependency, but won't run scripts if not present
							if ( jQuery._evalUrl && !node.noModule ) {
								jQuery._evalUrl( node.src, {
									nonce: node.nonce || node.getAttribute( "nonce" )
								}, doc );
							}
						} else {
							DOMEval( node.textContent.replace( rcleanScript, "" ), node, doc );
						}
					}
				}
			}
		}
	}

	return collection;
}

function remove( elem, selector, keepData ) {
	var node,
		nodes = selector ? jQuery.filter( selector, elem ) : elem,
		i = 0;

	for ( ; ( node = nodes[ i ] ) != null; i++ ) {
		if ( !keepData && node.nodeType === 1 ) {
			jQuery.cleanData( getAll( node ) );
		}

		if ( node.parentNode ) {
			if ( keepData && isAttached( node ) ) {
				setGlobalEval( getAll( node, "script" ) );
			}
			node.parentNode.removeChild( node );
		}
	}

	return elem;
}

jQuery.extend( {
	htmlPrefilter: function( html ) {
		return html;
	},

	clone: function( elem, dataAndEvents, deepDataAndEvents ) {
		var i, l, srcElements, destElements,
			clone = elem.cloneNode( true ),
			inPage = isAttached( elem );

		// Fix IE cloning issues
		if ( !support.noCloneChecked && ( elem.nodeType === 1 || elem.nodeType === 11 ) &&
				!jQuery.isXMLDoc( elem ) ) {

			// We eschew Sizzle here for performance reasons: https://jsperf.com/getall-vs-sizzle/2
			destElements = getAll( clone );
			srcElements = getAll( elem );

			for ( i = 0, l = srcElements.length; i < l; i++ ) {
				fixInput( srcElements[ i ], destElements[ i ] );
			}
		}

		// Copy the events from the original to the clone
		if ( dataAndEvents ) {
			if ( deepDataAndEvents ) {
				srcElements = srcElements || getAll( elem );
				destElements = destElements || getAll( clone );

				for ( i = 0, l = srcElements.length; i < l; i++ ) {
					cloneCopyEvent( srcElements[ i ], destElements[ i ] );
				}
			} else {
				cloneCopyEvent( elem, clone );
			}
		}

		// Preserve script evaluation history
		destElements = getAll( clone, "script" );
		if ( destElements.length > 0 ) {
			setGlobalEval( destElements, !inPage && getAll( elem, "script" ) );
		}

		// Return the cloned set
		return clone;
	},

	cleanData: function( elems ) {
		var data, elem, type,
			special = jQuery.event.special,
			i = 0;

		for ( ; ( elem = elems[ i ] ) !== undefined; i++ ) {
			if ( acceptData( elem ) ) {
				if ( ( data = elem[ dataPriv.expando ] ) ) {
					if ( data.events ) {
						for ( type in data.events ) {
							if ( special[ type ] ) {
								jQuery.event.remove( elem, type );

							// This is a shortcut to avoid jQuery.event.remove's overhead
							} else {
								jQuery.removeEvent( elem, type, data.handle );
							}
						}
					}

					// Support: Chrome <=35 - 45+
					// Assign undefined instead of using delete, see Data#remove
					elem[ dataPriv.expando ] = undefined;
				}
				if ( elem[ dataUser.expando ] ) {

					// Support: Chrome <=35 - 45+
					// Assign undefined instead of using delete, see Data#remove
					elem[ dataUser.expando ] = undefined;
				}
			}
		}
	}
} );

jQuery.fn.extend( {
	detach: function( selector ) {
		return remove( this, selector, true );
	},

	remove: function( selector ) {
		return remove( this, selector );
	},

	text: function( value ) {
		return access( this, function( value ) {
			return value === undefined ?
				jQuery.text( this ) :
				this.empty().each( function() {
					if ( this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9 ) {
						this.textContent = value;
					}
				} );
		}, null, value, arguments.length );
	},

	append: function() {
		return domManip( this, arguments, function( elem ) {
			if ( this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9 ) {
				var target = manipulationTarget( this, elem );
				target.appendChild( elem );
			}
		} );
	},

	prepend: function() {
		return domManip( this, arguments, function( elem ) {
			if ( this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9 ) {
				var target = manipulationTarget( this, elem );
				target.insertBefore( elem, target.firstChild );
			}
		} );
	},

	before: function() {
		return domManip( this, arguments, function( elem ) {
			if ( this.parentNode ) {
				this.parentNode.insertBefore( elem, this );
			}
		} );
	},

	after: function() {
		return domManip( this, arguments, function( elem ) {
			if ( this.parentNode ) {
				this.parentNode.insertBefore( elem, this.nextSibling );
			}
		} );
	},

	empty: function() {
		var elem,
			i = 0;

		for ( ; ( elem = this[ i ] ) != null; i++ ) {
			if ( elem.nodeType === 1 ) {

				// Prevent memory leaks
				jQuery.cleanData( getAll( elem, false ) );

				// Remove any remaining nodes
				elem.textContent = "";
			}
		}

		return this;
	},

	clone: function( dataAndEvents, deepDataAndEvents ) {
		dataAndEvents = dataAndEvents == null ? false : dataAndEvents;
		deepDataAndEvents = deepDataAndEvents == null ? dataAndEvents : deepDataAndEvents;

		return this.map( function() {
			return jQuery.clone( this, dataAndEvents, deepDataAndEvents );
		} );
	},

	html: function( value ) {
		return access( this, function( value ) {
			var elem = this[ 0 ] || {},
				i = 0,
				l = this.length;

			if ( value === undefined && elem.nodeType === 1 ) {
				return elem.innerHTML;
			}

			// See if we can take a shortcut and just use innerHTML
			if ( typeof value === "string" && !rnoInnerhtml.test( value ) &&
				!wrapMap[ ( rtagName.exec( value ) || [ "", "" ] )[ 1 ].toLowerCase() ] ) {

				value = jQuery.htmlPrefilter( value );

				try {
					for ( ; i < l; i++ ) {
						elem = this[ i ] || {};

						// Remove element nodes and prevent memory leaks
						if ( elem.nodeType === 1 ) {
							jQuery.cleanData( getAll( elem, false ) );
							elem.innerHTML = value;
						}
					}

					elem = 0;

				// If using innerHTML throws an exception, use the fallback method
				} catch ( e ) {}
			}

			if ( elem ) {
				this.empty().append( value );
			}
		}, null, value, arguments.length );
	},

	replaceWith: function() {
		var ignored = [];

		// Make the changes, replacing each non-ignored context element with the new content
		return domManip( this, arguments, function( elem ) {
			var parent = this.parentNode;

			if ( jQuery.inArray( this, ignored ) < 0 ) {
				jQuery.cleanData( getAll( this ) );
				if ( parent ) {
					parent.replaceChild( elem, this );
				}
			}

		// Force callback invocation
		}, ignored );
	}
} );

jQuery.each( {
	appendTo: "append",
	prependTo: "prepend",
	insertBefore: "before",
	insertAfter: "after",
	replaceAll: "replaceWith"
}, function( name, original ) {
	jQuery.fn[ name ] = function( selector ) {
		var elems,
			ret = [],
			insert = jQuery( selector ),
			last = insert.length - 1,
			i = 0;

		for ( ; i <= last; i++ ) {
			elems = i === last ? this : this.clone( true );
			jQuery( insert[ i ] )[ original ]( elems );

			// Support: Android <=4.0 only, PhantomJS 1 only
			// .get() because push.apply(_, arraylike) throws on ancient WebKit
			push.apply( ret, elems.get() );
		}

		return this.pushStack( ret );
	};
} );
var rnumnonpx = new RegExp( "^(" + pnum + ")(?!px)[a-z%]+$", "i" );

var getStyles = function( elem ) {

		// Support: IE <=11 only, Firefox <=30 (#15098, #14150)
		// IE throws on elements created in popups
		// FF meanwhile throws on frame elements through "defaultView.getComputedStyle"
		var view = elem.ownerDocument.defaultView;

		if ( !view || !view.opener ) {
			view = window;
		}

		return view.getComputedStyle( elem );
	};

var swap = function( elem, options, callback ) {
	var ret, name,
		old = {};

	// Remember the old values, and insert the new ones
	for ( name in options ) {
		old[ name ] = elem.style[ name ];
		elem.style[ name ] = options[ name ];
	}

	ret = callback.call( elem );

	// Revert the old values
	for ( name in options ) {
		elem.style[ name ] = old[ name ];
	}

	return ret;
};


var rboxStyle = new RegExp( cssExpand.join( "|" ), "i" );



( function() {

	// Executing both pixelPosition & boxSizingReliable tests require only one layout
	// so they're executed at the same time to save the second computation.
	function computeStyleTests() {

		// This is a singleton, we need to execute it only once
		if ( !div ) {
			return;
		}

		container.style.cssText = "position:absolute;left:-11111px;width:60px;" +
			"margin-top:1px;padding:0;border:0";
		div.style.cssText =
			"position:relative;display:block;box-sizing:border-box;overflow:scroll;" +
			"margin:auto;border:1px;padding:1px;" +
			"width:60%;top:1%";
		documentElement.appendChild( container ).appendChild( div );

		var divStyle = window.getComputedStyle( div );
		pixelPositionVal = divStyle.top !== "1%";

		// Support: Android 4.0 - 4.3 only, Firefox <=3 - 44
		reliableMarginLeftVal = roundPixelMeasures( divStyle.marginLeft ) === 12;

		// Support: Android 4.0 - 4.3 only, Safari <=9.1 - 10.1, iOS <=7.0 - 9.3
		// Some styles come back with percentage values, even though they shouldn't
		div.style.right = "60%";
		pixelBoxStylesVal = roundPixelMeasures( divStyle.right ) === 36;

		// Support: IE 9 - 11 only
		// Detect misreporting of content dimensions for box-sizing:border-box elements
		boxSizingReliableVal = roundPixelMeasures( divStyle.width ) === 36;

		// Support: IE 9 only
		// Detect overflow:scroll screwiness (gh-3699)
		// Support: Chrome <=64
		// Don't get tricked when zoom affects offsetWidth (gh-4029)
		div.style.position = "absolute";
		scrollboxSizeVal = roundPixelMeasures( div.offsetWidth / 3 ) === 12;

		documentElement.removeChild( container );

		// Nullify the div so it wouldn't be stored in the memory and
		// it will also be a sign that checks already performed
		div = null;
	}

	function roundPixelMeasures( measure ) {
		return Math.round( parseFloat( measure ) );
	}

	var pixelPositionVal, boxSizingReliableVal, scrollboxSizeVal, pixelBoxStylesVal,
		reliableTrDimensionsVal, reliableMarginLeftVal,
		container = document.createElement( "div" ),
		div = document.createElement( "div" );

	// Finish early in limited (non-browser) environments
	if ( !div.style ) {
		return;
	}

	// Support: IE <=9 - 11 only
	// Style of cloned element affects source element cloned (#8908)
	div.style.backgroundClip = "content-box";
	div.cloneNode( true ).style.backgroundClip = "";
	support.clearCloneStyle = div.style.backgroundClip === "content-box";

	jQuery.extend( support, {
		boxSizingReliable: function() {
			computeStyleTests();
			return boxSizingReliableVal;
		},
		pixelBoxStyles: function() {
			computeStyleTests();
			return pixelBoxStylesVal;
		},
		pixelPosition: function() {
			computeStyleTests();
			return pixelPositionVal;
		},
		reliableMarginLeft: function() {
			computeStyleTests();
			return reliableMarginLeftVal;
		},
		scrollboxSize: function() {
			computeStyleTests();
			return scrollboxSizeVal;
		},

		// Support: IE 9 - 11+, Edge 15 - 18+
		// IE/Edge misreport `getComputedStyle` of table rows with width/height
		// set in CSS while `offset*` properties report correct values.
		// Behavior in IE 9 is more subtle than in newer versions & it passes
		// some versions of this test; make sure not to make it pass there!
		//
		// Support: Firefox 70+
		// Only Firefox includes border widths
		// in computed dimensions. (gh-4529)
		reliableTrDimensions: function() {
			var table, tr, trChild, trStyle;
			if ( reliableTrDimensionsVal == null ) {
				table = document.createElement( "table" );
				tr = document.createElement( "tr" );
				trChild = document.createElement( "div" );

				table.style.cssText = "position:absolute;left:-11111px;border-collapse:separate";
				tr.style.cssText = "border:1px solid";

				// Support: Chrome 86+
				// Height set through cssText does not get applied.
				// Computed height then comes back as 0.
				tr.style.height = "1px";
				trChild.style.height = "9px";

				// Support: Android 8 Chrome 86+
				// In our bodyBackground.html iframe,
				// display for all div elements is set to "inline",
				// which causes a problem only in Android 8 Chrome 86.
				// Ensuring the div is display: block
				// gets around this issue.
				trChild.style.display = "block";

				documentElement
					.appendChild( table )
					.appendChild( tr )
					.appendChild( trChild );

				trStyle = window.getComputedStyle( tr );
				reliableTrDimensionsVal = ( parseInt( trStyle.height, 10 ) +
					parseInt( trStyle.borderTopWidth, 10 ) +
					parseInt( trStyle.borderBottomWidth, 10 ) ) === tr.offsetHeight;

				documentElement.removeChild( table );
			}
			return reliableTrDimensionsVal;
		}
	} );
} )();


function curCSS( elem, name, computed ) {
	var width, minWidth, maxWidth, ret,

		// Support: Firefox 51+
		// Retrieving style before computed somehow
		// fixes an issue with getting wrong values
		// on detached elements
		style = elem.style;

	computed = computed || getStyles( elem );

	// getPropertyValue is needed for:
	//   .css('filter') (IE 9 only, #12537)
	//   .css('--customProperty) (#3144)
	if ( computed ) {
		ret = computed.getPropertyValue( name ) || computed[ name ];

		if ( ret === "" && !isAttached( elem ) ) {
			ret = jQuery.style( elem, name );
		}

		// A tribute to the "awesome hack by Dean Edwards"
		// Android Browser returns percentage for some values,
		// but width seems to be reliably pixels.
		// This is against the CSSOM draft spec:
		// https://drafts.csswg.org/cssom/#resolved-values
		if ( !support.pixelBoxStyles() && rnumnonpx.test( ret ) && rboxStyle.test( name ) ) {

			// Remember the original values
			width = style.width;
			minWidth = style.minWidth;
			maxWidth = style.maxWidth;

			// Put in the new values to get a computed value out
			style.minWidth = style.maxWidth = style.width = ret;
			ret = computed.width;

			// Revert the changed values
			style.width = width;
			style.minWidth = minWidth;
			style.maxWidth = maxWidth;
		}
	}

	return ret !== undefined ?

		// Support: IE <=9 - 11 only
		// IE returns zIndex value as an integer.
		ret + "" :
		ret;
}


function addGetHookIf( conditionFn, hookFn ) {

	// Define the hook, we'll check on the first run if it's really needed.
	return {
		get: function() {
			if ( conditionFn() ) {

				// Hook not needed (or it's not possible to use it due
				// to missing dependency), remove it.
				delete this.get;
				return;
			}

			// Hook needed; redefine it so that the support test is not executed again.
			return ( this.get = hookFn ).apply( this, arguments );
		}
	};
}


var cssPrefixes = [ "Webkit", "Moz", "ms" ],
	emptyStyle = document.createElement( "div" ).style,
	vendorProps = {};

// Return a vendor-prefixed property or undefined
function vendorPropName( name ) {

	// Check for vendor prefixed names
	var capName = name[ 0 ].toUpperCase() + name.slice( 1 ),
		i = cssPrefixes.length;

	while ( i-- ) {
		name = cssPrefixes[ i ] + capName;
		if ( name in emptyStyle ) {
			return name;
		}
	}
}

// Return a potentially-mapped jQuery.cssProps or vendor prefixed property
function finalPropName( name ) {
	var final = jQuery.cssProps[ name ] || vendorProps[ name ];

	if ( final ) {
		return final;
	}
	if ( name in emptyStyle ) {
		return name;
	}
	return vendorProps[ name ] = vendorPropName( name ) || name;
}


var

	// Swappable if display is none or starts with table
	// except "table", "table-cell", or "table-caption"
	// See here for display values: https://developer.mozilla.org/en-US/docs/CSS/display
	rdisplayswap = /^(none|table(?!-c[ea]).+)/,
	rcustomProp = /^--/,
	cssShow = { position: "absolute", visibility: "hidden", display: "block" },
	cssNormalTransform = {
		letterSpacing: "0",
		fontWeight: "400"
	};

function setPositiveNumber( _elem, value, subtract ) {

	// Any relative (+/-) values have already been
	// normalized at this point
	var matches = rcssNum.exec( value );
	return matches ?

		// Guard against undefined "subtract", e.g., when used as in cssHooks
		Math.max( 0, matches[ 2 ] - ( subtract || 0 ) ) + ( matches[ 3 ] || "px" ) :
		value;
}

function boxModelAdjustment( elem, dimension, box, isBorderBox, styles, computedVal ) {
	var i = dimension === "width" ? 1 : 0,
		extra = 0,
		delta = 0;

	// Adjustment may not be necessary
	if ( box === ( isBorderBox ? "border" : "content" ) ) {
		return 0;
	}

	for ( ; i < 4; i += 2 ) {

		// Both box models exclude margin
		if ( box === "margin" ) {
			delta += jQuery.css( elem, box + cssExpand[ i ], true, styles );
		}

		// If we get here with a content-box, we're seeking "padding" or "border" or "margin"
		if ( !isBorderBox ) {

			// Add padding
			delta += jQuery.css( elem, "padding" + cssExpand[ i ], true, styles );

			// For "border" or "margin", add border
			if ( box !== "padding" ) {
				delta += jQuery.css( elem, "border" + cssExpand[ i ] + "Width", true, styles );

			// But still keep track of it otherwise
			} else {
				extra += jQuery.css( elem, "border" + cssExpand[ i ] + "Width", true, styles );
			}

		// If we get here with a border-box (content + padding + border), we're seeking "content" or
		// "padding" or "margin"
		} else {

			// For "content", subtract padding
			if ( box === "content" ) {
				delta -= jQuery.css( elem, "padding" + cssExpand[ i ], true, styles );
			}

			// For "content" or "padding", subtract border
			if ( box !== "margin" ) {
				delta -= jQuery.css( elem, "border" + cssExpand[ i ] + "Width", true, styles );
			}
		}
	}

	// Account for positive content-box scroll gutter when requested by providing computedVal
	if ( !isBorderBox && computedVal >= 0 ) {

		// offsetWidth/offsetHeight is a rounded sum of content, padding, scroll gutter, and border
		// Assuming integer scroll gutter, subtract the rest and round down
		delta += Math.max( 0, Math.ceil(
			elem[ "offset" + dimension[ 0 ].toUpperCase() + dimension.slice( 1 ) ] -
			computedVal -
			delta -
			extra -
			0.5

		// If offsetWidth/offsetHeight is unknown, then we can't determine content-box scroll gutter
		// Use an explicit zero to avoid NaN (gh-3964)
		) ) || 0;
	}

	return delta;
}

function getWidthOrHeight( elem, dimension, extra ) {

	// Start with computed style
	var styles = getStyles( elem ),

		// To avoid forcing a reflow, only fetch boxSizing if we need it (gh-4322).
		// Fake content-box until we know it's needed to know the true value.
		boxSizingNeeded = !support.boxSizingReliable() || extra,
		isBorderBox = boxSizingNeeded &&
			jQuery.css( elem, "boxSizing", false, styles ) === "border-box",
		valueIsBorderBox = isBorderBox,

		val = curCSS( elem, dimension, styles ),
		offsetProp = "offset" + dimension[ 0 ].toUpperCase() + dimension.slice( 1 );

	// Support: Firefox <=54
	// Return a confounding non-pixel value or feign ignorance, as appropriate.
	if ( rnumnonpx.test( val ) ) {
		if ( !extra ) {
			return val;
		}
		val = "auto";
	}


	// Support: IE 9 - 11 only
	// Use offsetWidth/offsetHeight for when box sizing is unreliable.
	// In those cases, the computed value can be trusted to be border-box.
	if ( ( !support.boxSizingReliable() && isBorderBox ||

		// Support: IE 10 - 11+, Edge 15 - 18+
		// IE/Edge misreport `getComputedStyle` of table rows with width/height
		// set in CSS while `offset*` properties report correct values.
		// Interestingly, in some cases IE 9 doesn't suffer from this issue.
		!support.reliableTrDimensions() && nodeName( elem, "tr" ) ||

		// Fall back to offsetWidth/offsetHeight when value is "auto"
		// This happens for inline elements with no explicit setting (gh-3571)
		val === "auto" ||

		// Support: Android <=4.1 - 4.3 only
		// Also use offsetWidth/offsetHeight for misreported inline dimensions (gh-3602)
		!parseFloat( val ) && jQuery.css( elem, "display", false, styles ) === "inline" ) &&

		// Make sure the element is visible & connected
		elem.getClientRects().length ) {

		isBorderBox = jQuery.css( elem, "boxSizing", false, styles ) === "border-box";

		// Where available, offsetWidth/offsetHeight approximate border box dimensions.
		// Where not available (e.g., SVG), assume unreliable box-sizing and interpret the
		// retrieved value as a content box dimension.
		valueIsBorderBox = offsetProp in elem;
		if ( valueIsBorderBox ) {
			val = elem[ offsetProp ];
		}
	}

	// Normalize "" and auto
	val = parseFloat( val ) || 0;

	// Adjust for the element's box model
	return ( val +
		boxModelAdjustment(
			elem,
			dimension,
			extra || ( isBorderBox ? "border" : "content" ),
			valueIsBorderBox,
			styles,

			// Provide the current computed size to request scroll gutter calculation (gh-3589)
			val
		)
	) + "px";
}

jQuery.extend( {

	// Add in style property hooks for overriding the default
	// behavior of getting and setting a style property
	cssHooks: {
		opacity: {
			get: function( elem, computed ) {
				if ( computed ) {

					// We should always get a number back from opacity
					var ret = curCSS( elem, "opacity" );
					return ret === "" ? "1" : ret;
				}
			}
		}
	},

	// Don't automatically add "px" to these possibly-unitless properties
	cssNumber: {
		"animationIterationCount": true,
		"columnCount": true,
		"fillOpacity": true,
		"flexGrow": true,
		"flexShrink": true,
		"fontWeight": true,
		"gridArea": true,
		"gridColumn": true,
		"gridColumnEnd": true,
		"gridColumnStart": true,
		"gridRow": true,
		"gridRowEnd": true,
		"gridRowStart": true,
		"lineHeight": true,
		"opacity": true,
		"order": true,
		"orphans": true,
		"widows": true,
		"zIndex": true,
		"zoom": true
	},

	// Add in properties whose names you wish to fix before
	// setting or getting the value
	cssProps: {},

	// Get and set the style property on a DOM Node
	style: function( elem, name, value, extra ) {

		// Don't set styles on text and comment nodes
		if ( !elem || elem.nodeType === 3 || elem.nodeType === 8 || !elem.style ) {
			return;
		}

		// Make sure that we're working with the right name
		var ret, type, hooks,
			origName = camelCase( name ),
			isCustomProp = rcustomProp.test( name ),
			style = elem.style;

		// Make sure that we're working with the right name. We don't
		// want to query the value if it is a CSS custom property
		// since they are user-defined.
		if ( !isCustomProp ) {
			name = finalPropName( origName );
		}

		// Gets hook for the prefixed version, then unprefixed version
		hooks = jQuery.cssHooks[ name ] || jQuery.cssHooks[ origName ];

		// Check if we're setting a value
		if ( value !== undefined ) {
			type = typeof value;

			// Convert "+=" or "-=" to relative numbers (#7345)
			if ( type === "string" && ( ret = rcssNum.exec( value ) ) && ret[ 1 ] ) {
				value = adjustCSS( elem, name, ret );

				// Fixes bug #9237
				type = "number";
			}

			// Make sure that null and NaN values aren't set (#7116)
			if ( value == null || value !== value ) {
				return;
			}

			// If a number was passed in, add the unit (except for certain CSS properties)
			// The isCustomProp check can be removed in jQuery 4.0 when we only auto-append
			// "px" to a few hardcoded values.
			if ( type === "number" && !isCustomProp ) {
				value += ret && ret[ 3 ] || ( jQuery.cssNumber[ origName ] ? "" : "px" );
			}

			// background-* props affect original clone's values
			if ( !support.clearCloneStyle && value === "" && name.indexOf( "background" ) === 0 ) {
				style[ name ] = "inherit";
			}

			// If a hook was provided, use that value, otherwise just set the specified value
			if ( !hooks || !( "set" in hooks ) ||
				( value = hooks.set( elem, value, extra ) ) !== undefined ) {

				if ( isCustomProp ) {
					style.setProperty( name, value );
				} else {
					style[ name ] = value;
				}
			}

		} else {

			// If a hook was provided get the non-computed value from there
			if ( hooks && "get" in hooks &&
				( ret = hooks.get( elem, false, extra ) ) !== undefined ) {

				return ret;
			}

			// Otherwise just get the value from the style object
			return style[ name ];
		}
	},

	css: function( elem, name, extra, styles ) {
		var val, num, hooks,
			origName = camelCase( name ),
			isCustomProp = rcustomProp.test( name );

		// Make sure that we're working with the right name. We don't
		// want to modify the value if it is a CSS custom property
		// since they are user-defined.
		if ( !isCustomProp ) {
			name = finalPropName( origName );
		}

		// Try prefixed name followed by the unprefixed name
		hooks = jQuery.cssHooks[ name ] || jQuery.cssHooks[ origName ];

		// If a hook was provided get the computed value from there
		if ( hooks && "get" in hooks ) {
			val = hooks.get( elem, true, extra );
		}

		// Otherwise, if a way to get the computed value exists, use that
		if ( val === undefined ) {
			val = curCSS( elem, name, styles );
		}

		// Convert "normal" to computed value
		if ( val === "normal" && name in cssNormalTransform ) {
			val = cssNormalTransform[ name ];
		}

		// Make numeric if forced or a qualifier was provided and val looks numeric
		if ( extra === "" || extra ) {
			num = parseFloat( val );
			return extra === true || isFinite( num ) ? num || 0 : val;
		}

		return val;
	}
} );

jQuery.each( [ "height", "width" ], function( _i, dimension ) {
	jQuery.cssHooks[ dimension ] = {
		get: function( elem, computed, extra ) {
			if ( computed ) {

				// Certain elements can have dimension info if we invisibly show them
				// but it must have a current display style that would benefit
				return rdisplayswap.test( jQuery.css( elem, "display" ) ) &&

					// Support: Safari 8+
					// Table columns in Safari have non-zero offsetWidth & zero
					// getBoundingClientRect().width unless display is changed.
					// Support: IE <=11 only
					// Running getBoundingClientRect on a disconnected node
					// in IE throws an error.
					( !elem.getClientRects().length || !elem.getBoundingClientRect().width ) ?
					swap( elem, cssShow, function() {
						return getWidthOrHeight( elem, dimension, extra );
					} ) :
					getWidthOrHeight( elem, dimension, extra );
			}
		},

		set: function( elem, value, extra ) {
			var matches,
				styles = getStyles( elem ),

				// Only read styles.position if the test has a chance to fail
				// to avoid forcing a reflow.
				scrollboxSizeBuggy = !support.scrollboxSize() &&
					styles.position === "absolute",

				// To avoid forcing a reflow, only fetch boxSizing if we need it (gh-3991)
				boxSizingNeeded = scrollboxSizeBuggy || extra,
				isBorderBox = boxSizingNeeded &&
					jQuery.css( elem, "boxSizing", false, styles ) === "border-box",
				subtract = extra ?
					boxModelAdjustment(
						elem,
						dimension,
						extra,
						isBorderBox,
						styles
					) :
					0;

			// Account for unreliable border-box dimensions by comparing offset* to computed and
			// faking a content-box to get border and padding (gh-3699)
			if ( isBorderBox && scrollboxSizeBuggy ) {
				subtract -= Math.ceil(
					elem[ "offset" + dimension[ 0 ].toUpperCase() + dimension.slice( 1 ) ] -
					parseFloat( styles[ dimension ] ) -
					boxModelAdjustment( elem, dimension, "border", false, styles ) -
					0.5
				);
			}

			// Convert to pixels if value adjustment is needed
			if ( subtract && ( matches = rcssNum.exec( value ) ) &&
				( matches[ 3 ] || "px" ) !== "px" ) {

				elem.style[ dimension ] = value;
				value = jQuery.css( elem, dimension );
			}

			return setPositiveNumber( elem, value, subtract );
		}
	};
} );

jQuery.cssHooks.marginLeft = addGetHookIf( support.reliableMarginLeft,
	function( elem, computed ) {
		if ( computed ) {
			return ( parseFloat( curCSS( elem, "marginLeft" ) ) ||
				elem.getBoundingClientRect().left -
					swap( elem, { marginLeft: 0 }, function() {
						return elem.getBoundingClientRect().left;
					} )
			) + "px";
		}
	}
);

// These hooks are used by animate to expand properties
jQuery.each( {
	margin: "",
	padding: "",
	border: "Width"
}, function( prefix, suffix ) {
	jQuery.cssHooks[ prefix + suffix ] = {
		expand: function( value ) {
			var i = 0,
				expanded = {},

				// Assumes a single number if not a string
				parts = typeof value === "string" ? value.split( " " ) : [ value ];

			for ( ; i < 4; i++ ) {
				expanded[ prefix + cssExpand[ i ] + suffix ] =
					parts[ i ] || parts[ i - 2 ] || parts[ 0 ];
			}

			return expanded;
		}
	};

	if ( prefix !== "margin" ) {
		jQuery.cssHooks[ prefix + suffix ].set = setPositiveNumber;
	}
} );

jQuery.fn.extend( {
	css: function( name, value ) {
		return access( this, function( elem, name, value ) {
			var styles, len,
				map = {},
				i = 0;

			if ( Array.isArray( name ) ) {
				styles = getStyles( elem );
				len = name.length;

				for ( ; i < len; i++ ) {
					map[ name[ i ] ] = jQuery.css( elem, name[ i ], false, styles );
				}

				return map;
			}

			return value !== undefined ?
				jQuery.style( elem, name, value ) :
				jQuery.css( elem, name );
		}, name, value, arguments.length > 1 );
	}
} );


function Tween( elem, options, prop, end, easing ) {
	return new Tween.prototype.init( elem, options, prop, end, easing );
}
jQuery.Tween = Tween;

Tween.prototype = {
	constructor: Tween,
	init: function( elem, options, prop, end, easing, unit ) {
		this.elem = elem;
		this.prop = prop;
		this.easing = easing || jQuery.easing._default;
		this.options = options;
		this.start = this.now = this.cur();
		this.end = end;
		this.unit = unit || ( jQuery.cssNumber[ prop ] ? "" : "px" );
	},
	cur: function() {
		var hooks = Tween.propHooks[ this.prop ];

		return hooks && hooks.get ?
			hooks.get( this ) :
			Tween.propHooks._default.get( this );
	},
	run: function( percent ) {
		var eased,
			hooks = Tween.propHooks[ this.prop ];

		if ( this.options.duration ) {
			this.pos = eased = jQuery.easing[ this.easing ](
				percent, this.options.duration * percent, 0, 1, this.options.duration
			);
		} else {
			this.pos = eased = percent;
		}
		this.now = ( this.end - this.start ) * eased + this.start;

		if ( this.options.step ) {
			this.options.step.call( this.elem, this.now, this );
		}

		if ( hooks && hooks.set ) {
			hooks.set( this );
		} else {
			Tween.propHooks._default.set( this );
		}
		return this;
	}
};

Tween.prototype.init.prototype = Tween.prototype;

Tween.propHooks = {
	_default: {
		get: function( tween ) {
			var result;

			// Use a property on the element directly when it is not a DOM element,
			// or when there is no matching style property that exists.
			if ( tween.elem.nodeType !== 1 ||
				tween.elem[ tween.prop ] != null && tween.elem.style[ tween.prop ] == null ) {
				return tween.elem[ tween.prop ];
			}

			// Passing an empty string as a 3rd parameter to .css will automatically
			// attempt a parseFloat and fallback to a string if the parse fails.
			// Simple values such as "10px" are parsed to Float;
			// complex values such as "rotate(1rad)" are returned as-is.
			result = jQuery.css( tween.elem, tween.prop, "" );

			// Empty strings, null, undefined and "auto" are converted to 0.
			return !result || result === "auto" ? 0 : result;
		},
		set: function( tween ) {

			// Use step hook for back compat.
			// Use cssHook if its there.
			// Use .style if available and use plain properties where available.
			if ( jQuery.fx.step[ tween.prop ] ) {
				jQuery.fx.step[ tween.prop ]( tween );
			} else if ( tween.elem.nodeType === 1 && (
				jQuery.cssHooks[ tween.prop ] ||
					tween.elem.style[ finalPropName( tween.prop ) ] != null ) ) {
				jQuery.style( tween.elem, tween.prop, tween.now + tween.unit );
			} else {
				tween.elem[ tween.prop ] = tween.now;
			}
		}
	}
};

// Support: IE <=9 only
// Panic based approach to setting things on disconnected nodes
Tween.propHooks.scrollTop = Tween.propHooks.scrollLeft = {
	set: function( tween ) {
		if ( tween.elem.nodeType && tween.elem.parentNode ) {
			tween.elem[ tween.prop ] = tween.now;
		}
	}
};

jQuery.easing = {
	linear: function( p ) {
		return p;
	},
	swing: function( p ) {
		return 0.5 - Math.cos( p * Math.PI ) / 2;
	},
	_default: "swing"
};

jQuery.fx = Tween.prototype.init;

// Back compat <1.8 extension point
jQuery.fx.step = {};




var
	fxNow, inProgress,
	rfxtypes = /^(?:toggle|show|hide)$/,
	rrun = /queueHooks$/;

function schedule() {
	if ( inProgress ) {
		if ( document.hidden === false && window.requestAnimationFrame ) {
			window.requestAnimationFrame( schedule );
		} else {
			window.setTimeout( schedule, jQuery.fx.interval );
		}

		jQuery.fx.tick();
	}
}

// Animations created synchronously will run synchronously
function createFxNow() {
	window.setTimeout( function() {
		fxNow = undefined;
	} );
	return ( fxNow = Date.now() );
}

// Generate parameters to create a standard animation
function genFx( type, includeWidth ) {
	var which,
		i = 0,
		attrs = { height: type };

	// If we include width, step value is 1 to do all cssExpand values,
	// otherwise step value is 2 to skip over Left and Right
	includeWidth = includeWidth ? 1 : 0;
	for ( ; i < 4; i += 2 - includeWidth ) {
		which = cssExpand[ i ];
		attrs[ "margin" + which ] = attrs[ "padding" + which ] = type;
	}

	if ( includeWidth ) {
		attrs.opacity = attrs.width = type;
	}

	return attrs;
}

function createTween( value, prop, animation ) {
	var tween,
		collection = ( Animation.tweeners[ prop ] || [] ).concat( Animation.tweeners[ "*" ] ),
		index = 0,
		length = collection.length;
	for ( ; index < length; index++ ) {
		if ( ( tween = collection[ index ].call( animation, prop, value ) ) ) {

			// We're done with this property
			return tween;
		}
	}
}

function defaultPrefilter( elem, props, opts ) {
	var prop, value, toggle, hooks, oldfire, propTween, restoreDisplay, display,
		isBox = "width" in props || "height" in props,
		anim = this,
		orig = {},
		style = elem.style,
		hidden = elem.nodeType && isHiddenWithinTree( elem ),
		dataShow = dataPriv.get( elem, "fxshow" );

	// Queue-skipping animations hijack the fx hooks
	if ( !opts.queue ) {
		hooks = jQuery._queueHooks( elem, "fx" );
		if ( hooks.unqueued == null ) {
			hooks.unqueued = 0;
			oldfire = hooks.empty.fire;
			hooks.empty.fire = function() {
				if ( !hooks.unqueued ) {
					oldfire();
				}
			};
		}
		hooks.unqueued++;

		anim.always( function() {

			// Ensure the complete handler is called before this completes
			anim.always( function() {
				hooks.unqueued--;
				if ( !jQuery.queue( elem, "fx" ).length ) {
					hooks.empty.fire();
				}
			} );
		} );
	}

	// Detect show/hide animations
	for ( prop in props ) {
		value = props[ prop ];
		if ( rfxtypes.test( value ) ) {
			delete props[ prop ];
			toggle = toggle || value === "toggle";
			if ( value === ( hidden ? "hide" : "show" ) ) {

				// Pretend to be hidden if this is a "show" and
				// there is still data from a stopped show/hide
				if ( value === "show" && dataShow && dataShow[ prop ] !== undefined ) {
					hidden = true;

				// Ignore all other no-op show/hide data
				} else {
					continue;
				}
			}
			orig[ prop ] = dataShow && dataShow[ prop ] || jQuery.style( elem, prop );
		}
	}

	// Bail out if this is a no-op like .hide().hide()
	propTween = !jQuery.isEmptyObject( props );
	if ( !propTween && jQuery.isEmptyObject( orig ) ) {
		return;
	}

	// Restrict "overflow" and "display" styles during box animations
	if ( isBox && elem.nodeType === 1 ) {

		// Support: IE <=9 - 11, Edge 12 - 15
		// Record all 3 overflow attributes because IE does not infer the shorthand
		// from identically-valued overflowX and overflowY and Edge just mirrors
		// the overflowX value there.
		opts.overflow = [ style.overflow, style.overflowX, style.overflowY ];

		// Identify a display type, preferring old show/hide data over the CSS cascade
		restoreDisplay = dataShow && dataShow.display;
		if ( restoreDisplay == null ) {
			restoreDisplay = dataPriv.get( elem, "display" );
		}
		display = jQuery.css( elem, "display" );
		if ( display === "none" ) {
			if ( restoreDisplay ) {
				display = restoreDisplay;
			} else {

				// Get nonempty value(s) by temporarily forcing visibility
				showHide( [ elem ], true );
				restoreDisplay = elem.style.display || restoreDisplay;
				display = jQuery.css( elem, "display" );
				showHide( [ elem ] );
			}
		}

		// Animate inline elements as inline-block
		if ( display === "inline" || display === "inline-block" && restoreDisplay != null ) {
			if ( jQuery.css( elem, "float" ) === "none" ) {

				// Restore the original display value at the end of pure show/hide animations
				if ( !propTween ) {
					anim.done( function() {
						style.display = restoreDisplay;
					} );
					if ( restoreDisplay == null ) {
						display = style.display;
						restoreDisplay = display === "none" ? "" : display;
					}
				}
				style.display = "inline-block";
			}
		}
	}

	if ( opts.overflow ) {
		style.overflow = "hidden";
		anim.always( function() {
			style.overflow = opts.overflow[ 0 ];
			style.overflowX = opts.overflow[ 1 ];
			style.overflowY = opts.overflow[ 2 ];
		} );
	}

	// Implement show/hide animations
	propTween = false;
	for ( prop in orig ) {

		// General show/hide setup for this element animation
		if ( !propTween ) {
			if ( dataShow ) {
				if ( "hidden" in dataShow ) {
					hidden = dataShow.hidden;
				}
			} else {
				dataShow = dataPriv.access( elem, "fxshow", { display: restoreDisplay } );
			}

			// Store hidden/visible for toggle so `.stop().toggle()` "reverses"
			if ( toggle ) {
				dataShow.hidden = !hidden;
			}

			// Show elements before animating them
			if ( hidden ) {
				showHide( [ elem ], true );
			}

			/* eslint-disable no-loop-func */

			anim.done( function() {

				/* eslint-enable no-loop-func */

				// The final step of a "hide" animation is actually hiding the element
				if ( !hidden ) {
					showHide( [ elem ] );
				}
				dataPriv.remove( elem, "fxshow" );
				for ( prop in orig ) {
					jQuery.style( elem, prop, orig[ prop ] );
				}
			} );
		}

		// Per-property setup
		propTween = createTween( hidden ? dataShow[ prop ] : 0, prop, anim );
		if ( !( prop in dataShow ) ) {
			dataShow[ prop ] = propTween.start;
			if ( hidden ) {
				propTween.end = propTween.start;
				propTween.start = 0;
			}
		}
	}
}

function propFilter( props, specialEasing ) {
	var index, name, easing, value, hooks;

	// camelCase, specialEasing and expand cssHook pass
	for ( index in props ) {
		name = camelCase( index );
		easing = specialEasing[ name ];
		value = props[ index ];
		if ( Array.isArray( value ) ) {
			easing = value[ 1 ];
			value = props[ index ] = value[ 0 ];
		}

		if ( index !== name ) {
			props[ name ] = value;
			delete props[ index ];
		}

		hooks = jQuery.cssHooks[ name ];
		if ( hooks && "expand" in hooks ) {
			value = hooks.expand( value );
			delete props[ name ];

			// Not quite $.extend, this won't overwrite existing keys.
			// Reusing 'index' because we have the correct "name"
			for ( index in value ) {
				if ( !( index in props ) ) {
					props[ index ] = value[ index ];
					specialEasing[ index ] = easing;
				}
			}
		} else {
			specialEasing[ name ] = easing;
		}
	}
}

function Animation( elem, properties, options ) {
	var result,
		stopped,
		index = 0,
		length = Animation.prefilters.length,
		deferred = jQuery.Deferred().always( function() {

			// Don't match elem in the :animated selector
			delete tick.elem;
		} ),
		tick = function() {
			if ( stopped ) {
				return false;
			}
			var currentTime = fxNow || createFxNow(),
				remaining = Math.max( 0, animation.startTime + animation.duration - currentTime ),

				// Support: Android 2.3 only
				// Archaic crash bug won't allow us to use `1 - ( 0.5 || 0 )` (#12497)
				temp = remaining / animation.duration || 0,
				percent = 1 - temp,
				index = 0,
				length = animation.tweens.length;

			for ( ; index < length; index++ ) {
				animation.tweens[ index ].run( percent );
			}

			deferred.notifyWith( elem, [ animation, percent, remaining ] );

			// If there's more to do, yield
			if ( percent < 1 && length ) {
				return remaining;
			}

			// If this was an empty animation, synthesize a final progress notification
			if ( !length ) {
				deferred.notifyWith( elem, [ animation, 1, 0 ] );
			}

			// Resolve the animation and report its conclusion
			deferred.resolveWith( elem, [ animation ] );
			return false;
		},
		animation = deferred.promise( {
			elem: elem,
			props: jQuery.extend( {}, properties ),
			opts: jQuery.extend( true, {
				specialEasing: {},
				easing: jQuery.easing._default
			}, options ),
			originalProperties: properties,
			originalOptions: options,
			startTime: fxNow || createFxNow(),
			duration: options.duration,
			tweens: [],
			createTween: function( prop, end ) {
				var tween = jQuery.Tween( elem, animation.opts, prop, end,
					animation.opts.specialEasing[ prop ] || animation.opts.easing );
				animation.tweens.push( tween );
				return tween;
			},
			stop: function( gotoEnd ) {
				var index = 0,

					// If we are going to the end, we want to run all the tweens
					// otherwise we skip this part
					length = gotoEnd ? animation.tweens.length : 0;
				if ( stopped ) {
					return this;
				}
				stopped = true;
				for ( ; index < length; index++ ) {
					animation.tweens[ index ].run( 1 );
				}

				// Resolve when we played the last frame; otherwise, reject
				if ( gotoEnd ) {
					deferred.notifyWith( elem, [ animation, 1, 0 ] );
					deferred.resolveWith( elem, [ animation, gotoEnd ] );
				} else {
					deferred.rejectWith( elem, [ animation, gotoEnd ] );
				}
				return this;
			}
		} ),
		props = animation.props;

	propFilter( props, animation.opts.specialEasing );

	for ( ; index < length; index++ ) {
		result = Animation.prefilters[ index ].call( animation, elem, props, animation.opts );
		if ( result ) {
			if ( isFunction( result.stop ) ) {
				jQuery._queueHooks( animation.elem, animation.opts.queue ).stop =
					result.stop.bind( result );
			}
			return result;
		}
	}

	jQuery.map( props, createTween, animation );

	if ( isFunction( animation.opts.start ) ) {
		animation.opts.start.call( elem, animation );
	}

	// Attach callbacks from options
	animation
		.progress( animation.opts.progress )
		.done( animation.opts.done, animation.opts.complete )
		.fail( animation.opts.fail )
		.always( animation.opts.always );

	jQuery.fx.timer(
		jQuery.extend( tick, {
			elem: elem,
			anim: animation,
			queue: animation.opts.queue
		} )
	);

	return animation;
}

jQuery.Animation = jQuery.extend( Animation, {

	tweeners: {
		"*": [ function( prop, value ) {
			var tween = this.createTween( prop, value );
			adjustCSS( tween.elem, prop, rcssNum.exec( value ), tween );
			return tween;
		} ]
	},

	tweener: function( props, callback ) {
		if ( isFunction( props ) ) {
			callback = props;
			props = [ "*" ];
		} else {
			props = props.match( rnothtmlwhite );
		}

		var prop,
			index = 0,
			length = props.length;

		for ( ; index < length; index++ ) {
			prop = props[ index ];
			Animation.tweeners[ prop ] = Animation.tweeners[ prop ] || [];
			Animation.tweeners[ prop ].unshift( callback );
		}
	},

	prefilters: [ defaultPrefilter ],

	prefilter: function( callback, prepend ) {
		if ( prepend ) {
			Animation.prefilters.unshift( callback );
		} else {
			Animation.prefilters.push( callback );
		}
	}
} );

jQuery.speed = function( speed, easing, fn ) {
	var opt = speed && typeof speed === "object" ? jQuery.extend( {}, speed ) : {
		complete: fn || !fn && easing ||
			isFunction( speed ) && speed,
		duration: speed,
		easing: fn && easing || easing && !isFunction( easing ) && easing
	};

	// Go to the end state if fx are off
	if ( jQuery.fx.off ) {
		opt.duration = 0;

	} else {
		if ( typeof opt.duration !== "number" ) {
			if ( opt.duration in jQuery.fx.speeds ) {
				opt.duration = jQuery.fx.speeds[ opt.duration ];

			} else {
				opt.duration = jQuery.fx.speeds._default;
			}
		}
	}

	// Normalize opt.queue - true/undefined/null -> "fx"
	if ( opt.queue == null || opt.queue === true ) {
		opt.queue = "fx";
	}

	// Queueing
	opt.old = opt.complete;

	opt.complete = function() {
		if ( isFunction( opt.old ) ) {
			opt.old.call( this );
		}

		if ( opt.queue ) {
			jQuery.dequeue( this, opt.queue );
		}
	};

	return opt;
};

jQuery.fn.extend( {
	fadeTo: function( speed, to, easing, callback ) {

		// Show any hidden elements after setting opacity to 0
		return this.filter( isHiddenWithinTree ).css( "opacity", 0 ).show()

			// Animate to the value specified
			.end().animate( { opacity: to }, speed, easing, callback );
	},
	animate: function( prop, speed, easing, callback ) {
		var empty = jQuery.isEmptyObject( prop ),
			optall = jQuery.speed( speed, easing, callback ),
			doAnimation = function() {

				// Operate on a copy of prop so per-property easing won't be lost
				var anim = Animation( this, jQuery.extend( {}, prop ), optall );

				// Empty animations, or finishing resolves immediately
				if ( empty || dataPriv.get( this, "finish" ) ) {
					anim.stop( true );
				}
			};

		doAnimation.finish = doAnimation;

		return empty || optall.queue === false ?
			this.each( doAnimation ) :
			this.queue( optall.queue, doAnimation );
	},
	stop: function( type, clearQueue, gotoEnd ) {
		var stopQueue = function( hooks ) {
			var stop = hooks.stop;
			delete hooks.stop;
			stop( gotoEnd );
		};

		if ( typeof type !== "string" ) {
			gotoEnd = clearQueue;
			clearQueue = type;
			type = undefined;
		}
		if ( clearQueue ) {
			this.queue( type || "fx", [] );
		}

		return this.each( function() {
			var dequeue = true,
				index = type != null && type + "queueHooks",
				timers = jQuery.timers,
				data = dataPriv.get( this );

			if ( index ) {
				if ( data[ index ] && data[ index ].stop ) {
					stopQueue( data[ index ] );
				}
			} else {
				for ( index in data ) {
					if ( data[ index ] && data[ index ].stop && rrun.test( index ) ) {
						stopQueue( data[ index ] );
					}
				}
			}

			for ( index = timers.length; index--; ) {
				if ( timers[ index ].elem === this &&
					( type == null || timers[ index ].queue === type ) ) {

					timers[ index ].anim.stop( gotoEnd );
					dequeue = false;
					timers.splice( index, 1 );
				}
			}

			// Start the next in the queue if the last step wasn't forced.
			// Timers currently will call their complete callbacks, which
			// will dequeue but only if they were gotoEnd.
			if ( dequeue || !gotoEnd ) {
				jQuery.dequeue( this, type );
			}
		} );
	},
	finish: function( type ) {
		if ( type !== false ) {
			type = type || "fx";
		}
		return this.each( function() {
			var index,
				data = dataPriv.get( this ),
				queue = data[ type + "queue" ],
				hooks = data[ type + "queueHooks" ],
				timers = jQuery.timers,
				length = queue ? queue.length : 0;

			// Enable finishing flag on private data
			data.finish = true;

			// Empty the queue first
			jQuery.queue( this, type, [] );

			if ( hooks && hooks.stop ) {
				hooks.stop.call( this, true );
			}

			// Look for any active animations, and finish them
			for ( index = timers.length; index--; ) {
				if ( timers[ index ].elem === this && timers[ index ].queue === type ) {
					timers[ index ].anim.stop( true );
					timers.splice( index, 1 );
				}
			}

			// Look for any animations in the old queue and finish them
			for ( index = 0; index < length; index++ ) {
				if ( queue[ index ] && queue[ index ].finish ) {
					queue[ index ].finish.call( this );
				}
			}

			// Turn off finishing flag
			delete data.finish;
		} );
	}
} );

jQuery.each( [ "toggle", "show", "hide" ], function( _i, name ) {
	var cssFn = jQuery.fn[ name ];
	jQuery.fn[ name ] = function( speed, easing, callback ) {
		return speed == null || typeof speed === "boolean" ?
			cssFn.apply( this, arguments ) :
			this.animate( genFx( name, true ), speed, easing, callback );
	};
} );

// Generate shortcuts for custom animations
jQuery.each( {
	slideDown: genFx( "show" ),
	slideUp: genFx( "hide" ),
	slideToggle: genFx( "toggle" ),
	fadeIn: { opacity: "show" },
	fadeOut: { opacity: "hide" },
	fadeToggle: { opacity: "toggle" }
}, function( name, props ) {
	jQuery.fn[ name ] = function( speed, easing, callback ) {
		return this.animate( props, speed, easing, callback );
	};
} );

jQuery.timers = [];
jQuery.fx.tick = function() {
	var timer,
		i = 0,
		timers = jQuery.timers;

	fxNow = Date.now();

	for ( ; i < timers.length; i++ ) {
		timer = timers[ i ];

		// Run the timer and safely remove it when done (allowing for external removal)
		if ( !timer() && timers[ i ] === timer ) {
			timers.splice( i--, 1 );
		}
	}

	if ( !timers.length ) {
		jQuery.fx.stop();
	}
	fxNow = undefined;
};

jQuery.fx.timer = function( timer ) {
	jQuery.timers.push( timer );
	jQuery.fx.start();
};

jQuery.fx.interval = 13;
jQuery.fx.start = function() {
	if ( inProgress ) {
		return;
	}

	inProgress = true;
	schedule();
};

jQuery.fx.stop = function() {
	inProgress = null;
};

jQuery.fx.speeds = {
	slow: 600,
	fast: 200,

	// Default speed
	_default: 400
};


// Based off of the plugin by Clint Helfers, with permission.
// https://web.archive.org/web/20100324014747/http://blindsignals.com/index.php/2009/07/jquery-delay/
jQuery.fn.delay = function( time, type ) {
	time = jQuery.fx ? jQuery.fx.speeds[ time ] || time : time;
	type = type || "fx";

	return this.queue( type, function( next, hooks ) {
		var timeout = window.setTimeout( next, time );
		hooks.stop = function() {
			window.clearTimeout( timeout );
		};
	} );
};


( function() {
	var input = document.createElement( "input" ),
		select = document.createElement( "select" ),
		opt = select.appendChild( document.createElement( "option" ) );

	input.type = "checkbox";

	// Support: Android <=4.3 only
	// Default value for a checkbox should be "on"
	support.checkOn = input.value !== "";

	// Support: IE <=11 only
	// Must access selectedIndex to make default options select
	support.optSelected = opt.selected;

	// Support: IE <=11 only
	// An input loses its value after becoming a radio
	input = document.createElement( "input" );
	input.value = "t";
	input.type = "radio";
	support.radioValue = input.value === "t";
} )();


var boolHook,
	attrHandle = jQuery.expr.attrHandle;

jQuery.fn.extend( {
	attr: function( name, value ) {
		return access( this, jQuery.attr, name, value, arguments.length > 1 );
	},

	removeAttr: function( name ) {
		return this.each( function() {
			jQuery.removeAttr( this, name );
		} );
	}
} );

jQuery.extend( {
	attr: function( elem, name, value ) {
		var ret, hooks,
			nType = elem.nodeType;

		// Don't get/set attributes on text, comment and attribute nodes
		if ( nType === 3 || nType === 8 || nType === 2 ) {
			return;
		}

		// Fallback to prop when attributes are not supported
		if ( typeof elem.getAttribute === "undefined" ) {
			return jQuery.prop( elem, name, value );
		}

		// Attribute hooks are determined by the lowercase version
		// Grab necessary hook if one is defined
		if ( nType !== 1 || !jQuery.isXMLDoc( elem ) ) {
			hooks = jQuery.attrHooks[ name.toLowerCase() ] ||
				( jQuery.expr.match.bool.test( name ) ? boolHook : undefined );
		}

		if ( value !== undefined ) {
			if ( value === null ) {
				jQuery.removeAttr( elem, name );
				return;
			}

			if ( hooks && "set" in hooks &&
				( ret = hooks.set( elem, value, name ) ) !== undefined ) {
				return ret;
			}

			elem.setAttribute( name, value + "" );
			return value;
		}

		if ( hooks && "get" in hooks && ( ret = hooks.get( elem, name ) ) !== null ) {
			return ret;
		}

		ret = jQuery.find.attr( elem, name );

		// Non-existent attributes return null, we normalize to undefined
		return ret == null ? undefined : ret;
	},

	attrHooks: {
		type: {
			set: function( elem, value ) {
				if ( !support.radioValue && value === "radio" &&
					nodeName( elem, "input" ) ) {
					var val = elem.value;
					elem.setAttribute( "type", value );
					if ( val ) {
						elem.value = val;
					}
					return value;
				}
			}
		}
	},

	removeAttr: function( elem, value ) {
		var name,
			i = 0,

			// Attribute names can contain non-HTML whitespace characters
			// https://html.spec.whatwg.org/multipage/syntax.html#attributes-2
			attrNames = value && value.match( rnothtmlwhite );

		if ( attrNames && elem.nodeType === 1 ) {
			while ( ( name = attrNames[ i++ ] ) ) {
				elem.removeAttribute( name );
			}
		}
	}
} );

// Hooks for boolean attributes
boolHook = {
	set: function( elem, value, name ) {
		if ( value === false ) {

			// Remove boolean attributes when set to false
			jQuery.removeAttr( elem, name );
		} else {
			elem.setAttribute( name, name );
		}
		return name;
	}
};

jQuery.each( jQuery.expr.match.bool.source.match( /\w+/g ), function( _i, name ) {
	var getter = attrHandle[ name ] || jQuery.find.attr;

	attrHandle[ name ] = function( elem, name, isXML ) {
		var ret, handle,
			lowercaseName = name.toLowerCase();

		if ( !isXML ) {

			// Avoid an infinite loop by temporarily removing this function from the getter
			handle = attrHandle[ lowercaseName ];
			attrHandle[ lowercaseName ] = ret;
			ret = getter( elem, name, isXML ) != null ?
				lowercaseName :
				null;
			attrHandle[ lowercaseName ] = handle;
		}
		return ret;
	};
} );




var rfocusable = /^(?:input|select|textarea|button)$/i,
	rclickable = /^(?:a|area)$/i;

jQuery.fn.extend( {
	prop: function( name, value ) {
		return access( this, jQuery.prop, name, value, arguments.length > 1 );
	},

	removeProp: function( name ) {
		return this.each( function() {
			delete this[ jQuery.propFix[ name ] || name ];
		} );
	}
} );

jQuery.extend( {
	prop: function( elem, name, value ) {
		var ret, hooks,
			nType = elem.nodeType;

		// Don't get/set properties on text, comment and attribute nodes
		if ( nType === 3 || nType === 8 || nType === 2 ) {
			return;
		}

		if ( nType !== 1 || !jQuery.isXMLDoc( elem ) ) {

			// Fix name and attach hooks
			name = jQuery.propFix[ name ] || name;
			hooks = jQuery.propHooks[ name ];
		}

		if ( value !== undefined ) {
			if ( hooks && "set" in hooks &&
				( ret = hooks.set( elem, value, name ) ) !== undefined ) {
				return ret;
			}

			return ( elem[ name ] = value );
		}

		if ( hooks && "get" in hooks && ( ret = hooks.get( elem, name ) ) !== null ) {
			return ret;
		}

		return elem[ name ];
	},

	propHooks: {
		tabIndex: {
			get: function( elem ) {

				// Support: IE <=9 - 11 only
				// elem.tabIndex doesn't always return the
				// correct value when it hasn't been explicitly set
				// https://web.archive.org/web/20141116233347/http://fluidproject.org/blog/2008/01/09/getting-setting-and-removing-tabindex-values-with-javascript/
				// Use proper attribute retrieval(#12072)
				var tabindex = jQuery.find.attr( elem, "tabindex" );

				if ( tabindex ) {
					return parseInt( tabindex, 10 );
				}

				if (
					rfocusable.test( elem.nodeName ) ||
					rclickable.test( elem.nodeName ) &&
					elem.href
				) {
					return 0;
				}

				return -1;
			}
		}
	},

	propFix: {
		"for": "htmlFor",
		"class": "className"
	}
} );

// Support: IE <=11 only
// Accessing the selectedIndex property
// forces the browser to respect setting selected
// on the option
// The getter ensures a default option is selected
// when in an optgroup
// eslint rule "no-unused-expressions" is disabled for this code
// since it considers such accessions noop
if ( !support.optSelected ) {
	jQuery.propHooks.selected = {
		get: function( elem ) {

			/* eslint no-unused-expressions: "off" */

			var parent = elem.parentNode;
			if ( parent && parent.parentNode ) {
				parent.parentNode.selectedIndex;
			}
			return null;
		},
		set: function( elem ) {

			/* eslint no-unused-expressions: "off" */

			var parent = elem.parentNode;
			if ( parent ) {
				parent.selectedIndex;

				if ( parent.parentNode ) {
					parent.parentNode.selectedIndex;
				}
			}
		}
	};
}

jQuery.each( [
	"tabIndex",
	"readOnly",
	"maxLength",
	"cellSpacing",
	"cellPadding",
	"rowSpan",
	"colSpan",
	"useMap",
	"frameBorder",
	"contentEditable"
], function() {
	jQuery.propFix[ this.toLowerCase() ] = this;
} );




	// Strip and collapse whitespace according to HTML spec
	// https://infra.spec.whatwg.org/#strip-and-collapse-ascii-whitespace
	function stripAndCollapse( value ) {
		var tokens = value.match( rnothtmlwhite ) || [];
		return tokens.join( " " );
	}


function getClass( elem ) {
	return elem.getAttribute && elem.getAttribute( "class" ) || "";
}

function classesToArray( value ) {
	if ( Array.isArray( value ) ) {
		return value;
	}
	if ( typeof value === "string" ) {
		return value.match( rnothtmlwhite ) || [];
	}
	return [];
}

jQuery.fn.extend( {
	addClass: function( value ) {
		var classes, elem, cur, curValue, clazz, j, finalValue,
			i = 0;

		if ( isFunction( value ) ) {
			return this.each( function( j ) {
				jQuery( this ).addClass( value.call( this, j, getClass( this ) ) );
			} );
		}

		classes = classesToArray( value );

		if ( classes.length ) {
			while ( ( elem = this[ i++ ] ) ) {
				curValue = getClass( elem );
				cur = elem.nodeType === 1 && ( " " + stripAndCollapse( curValue ) + " " );

				if ( cur ) {
					j = 0;
					while ( ( clazz = classes[ j++ ] ) ) {
						if ( cur.indexOf( " " + clazz + " " ) < 0 ) {
							cur += clazz + " ";
						}
					}

					// Only assign if different to avoid unneeded rendering.
					finalValue = stripAndCollapse( cur );
					if ( curValue !== finalValue ) {
						elem.setAttribute( "class", finalValue );
					}
				}
			}
		}

		return this;
	},

	removeClass: function( value ) {
		var classes, elem, cur, curValue, clazz, j, finalValue,
			i = 0;

		if ( isFunction( value ) ) {
			return this.each( function( j ) {
				jQuery( this ).removeClass( value.call( this, j, getClass( this ) ) );
			} );
		}

		if ( !arguments.length ) {
			return this.attr( "class", "" );
		}

		classes = classesToArray( value );

		if ( classes.length ) {
			while ( ( elem = this[ i++ ] ) ) {
				curValue = getClass( elem );

				// This expression is here for better compressibility (see addClass)
				cur = elem.nodeType === 1 && ( " " + stripAndCollapse( curValue ) + " " );

				if ( cur ) {
					j = 0;
					while ( ( clazz = classes[ j++ ] ) ) {

						// Remove *all* instances
						while ( cur.indexOf( " " + clazz + " " ) > -1 ) {
							cur = cur.replace( " " + clazz + " ", " " );
						}
					}

					// Only assign if different to avoid unneeded rendering.
					finalValue = stripAndCollapse( cur );
					if ( curValue !== finalValue ) {
						elem.setAttribute( "class", finalValue );
					}
				}
			}
		}

		return this;
	},

	toggleClass: function( value, stateVal ) {
		var type = typeof value,
			isValidValue = type === "string" || Array.isArray( value );

		if ( typeof stateVal === "boolean" && isValidValue ) {
			return stateVal ? this.addClass( value ) : this.removeClass( value );
		}

		if ( isFunction( value ) ) {
			return this.each( function( i ) {
				jQuery( this ).toggleClass(
					value.call( this, i, getClass( this ), stateVal ),
					stateVal
				);
			} );
		}

		return this.each( function() {
			var className, i, self, classNames;

			if ( isValidValue ) {

				// Toggle individual class names
				i = 0;
				self = jQuery( this );
				classNames = classesToArray( value );

				while ( ( className = classNames[ i++ ] ) ) {

					// Check each className given, space separated list
					if ( self.hasClass( className ) ) {
						self.removeClass( className );
					} else {
						self.addClass( className );
					}
				}

			// Toggle whole class name
			} else if ( value === undefined || type === "boolean" ) {
				className = getClass( this );
				if ( className ) {

					// Store className if set
					dataPriv.set( this, "__className__", className );
				}

				// If the element has a class name or if we're passed `false`,
				// then remove the whole classname (if there was one, the above saved it).
				// Otherwise bring back whatever was previously saved (if anything),
				// falling back to the empty string if nothing was stored.
				if ( this.setAttribute ) {
					this.setAttribute( "class",
						className || value === false ?
							"" :
							dataPriv.get( this, "__className__" ) || ""
					);
				}
			}
		} );
	},

	hasClass: function( selector ) {
		var className, elem,
			i = 0;

		className = " " + selector + " ";
		while ( ( elem = this[ i++ ] ) ) {
			if ( elem.nodeType === 1 &&
				( " " + stripAndCollapse( getClass( elem ) ) + " " ).indexOf( className ) > -1 ) {
				return true;
			}
		}

		return false;
	}
} );




var rreturn = /\r/g;

jQuery.fn.extend( {
	val: function( value ) {
		var hooks, ret, valueIsFunction,
			elem = this[ 0 ];

		if ( !arguments.length ) {
			if ( elem ) {
				hooks = jQuery.valHooks[ elem.type ] ||
					jQuery.valHooks[ elem.nodeName.toLowerCase() ];

				if ( hooks &&
					"get" in hooks &&
					( ret = hooks.get( elem, "value" ) ) !== undefined
				) {
					return ret;
				}

				ret = elem.value;

				// Handle most common string cases
				if ( typeof ret === "string" ) {
					return ret.replace( rreturn, "" );
				}

				// Handle cases where value is null/undef or number
				return ret == null ? "" : ret;
			}

			return;
		}

		valueIsFunction = isFunction( value );

		return this.each( function( i ) {
			var val;

			if ( this.nodeType !== 1 ) {
				return;
			}

			if ( valueIsFunction ) {
				val = value.call( this, i, jQuery( this ).val() );
			} else {
				val = value;
			}

			// Treat null/undefined as ""; convert numbers to string
			if ( val == null ) {
				val = "";

			} else if ( typeof val === "number" ) {
				val += "";

			} else if ( Array.isArray( val ) ) {
				val = jQuery.map( val, function( value ) {
					return value == null ? "" : value + "";
				} );
			}

			hooks = jQuery.valHooks[ this.type ] || jQuery.valHooks[ this.nodeName.toLowerCase() ];

			// If set returns undefined, fall back to normal setting
			if ( !hooks || !( "set" in hooks ) || hooks.set( this, val, "value" ) === undefined ) {
				this.value = val;
			}
		} );
	}
} );

jQuery.extend( {
	valHooks: {
		option: {
			get: function( elem ) {

				var val = jQuery.find.attr( elem, "value" );
				return val != null ?
					val :

					// Support: IE <=10 - 11 only
					// option.text throws exceptions (#14686, #14858)
					// Strip and collapse whitespace
					// https://html.spec.whatwg.org/#strip-and-collapse-whitespace
					stripAndCollapse( jQuery.text( elem ) );
			}
		},
		select: {
			get: function( elem ) {
				var value, option, i,
					options = elem.options,
					index = elem.selectedIndex,
					one = elem.type === "select-one",
					values = one ? null : [],
					max = one ? index + 1 : options.length;

				if ( index < 0 ) {
					i = max;

				} else {
					i = one ? index : 0;
				}

				// Loop through all the selected options
				for ( ; i < max; i++ ) {
					option = options[ i ];

					// Support: IE <=9 only
					// IE8-9 doesn't update selected after form reset (#2551)
					if ( ( option.selected || i === index ) &&

							// Don't return options that are disabled or in a disabled optgroup
							!option.disabled &&
							( !option.parentNode.disabled ||
								!nodeName( option.parentNode, "optgroup" ) ) ) {

						// Get the specific value for the option
						value = jQuery( option ).val();

						// We don't need an array for one selects
						if ( one ) {
							return value;
						}

						// Multi-Selects return an array
						values.push( value );
					}
				}

				return values;
			},

			set: function( elem, value ) {
				var optionSet, option,
					options = elem.options,
					values = jQuery.makeArray( value ),
					i = options.length;

				while ( i-- ) {
					option = options[ i ];

					/* eslint-disable no-cond-assign */

					if ( option.selected =
						jQuery.inArray( jQuery.valHooks.option.get( option ), values ) > -1
					) {
						optionSet = true;
					}

					/* eslint-enable no-cond-assign */
				}

				// Force browsers to behave consistently when non-matching value is set
				if ( !optionSet ) {
					elem.selectedIndex = -1;
				}
				return values;
			}
		}
	}
} );

// Radios and checkboxes getter/setter
jQuery.each( [ "radio", "checkbox" ], function() {
	jQuery.valHooks[ this ] = {
		set: function( elem, value ) {
			if ( Array.isArray( value ) ) {
				return ( elem.checked = jQuery.inArray( jQuery( elem ).val(), value ) > -1 );
			}
		}
	};
	if ( !support.checkOn ) {
		jQuery.valHooks[ this ].get = function( elem ) {
			return elem.getAttribute( "value" ) === null ? "on" : elem.value;
		};
	}
} );




// Return jQuery for attributes-only inclusion


support.focusin = "onfocusin" in window;


var rfocusMorph = /^(?:focusinfocus|focusoutblur)$/,
	stopPropagationCallback = function( e ) {
		e.stopPropagation();
	};

jQuery.extend( jQuery.event, {

	trigger: function( event, data, elem, onlyHandlers ) {

		var i, cur, tmp, bubbleType, ontype, handle, special, lastElement,
			eventPath = [ elem || document ],
			type = hasOwn.call( event, "type" ) ? event.type : event,
			namespaces = hasOwn.call( event, "namespace" ) ? event.namespace.split( "." ) : [];

		cur = lastElement = tmp = elem = elem || document;

		// Don't do events on text and comment nodes
		if ( elem.nodeType === 3 || elem.nodeType === 8 ) {
			return;
		}

		// focus/blur morphs to focusin/out; ensure we're not firing them right now
		if ( rfocusMorph.test( type + jQuery.event.triggered ) ) {
			return;
		}

		if ( type.indexOf( "." ) > -1 ) {

			// Namespaced trigger; create a regexp to match event type in handle()
			namespaces = type.split( "." );
			type = namespaces.shift();
			namespaces.sort();
		}
		ontype = type.indexOf( ":" ) < 0 && "on" + type;

		// Caller can pass in a jQuery.Event object, Object, or just an event type string
		event = event[ jQuery.expando ] ?
			event :
			new jQuery.Event( type, typeof event === "object" && event );

		// Trigger bitmask: & 1 for native handlers; & 2 for jQuery (always true)
		event.isTrigger = onlyHandlers ? 2 : 3;
		event.namespace = namespaces.join( "." );
		event.rnamespace = event.namespace ?
			new RegExp( "(^|\\.)" + namespaces.join( "\\.(?:.*\\.|)" ) + "(\\.|$)" ) :
			null;

		// Clean up the event in case it is being reused
		event.result = undefined;
		if ( !event.target ) {
			event.target = elem;
		}

		// Clone any incoming data and prepend the event, creating the handler arg list
		data = data == null ?
			[ event ] :
			jQuery.makeArray( data, [ event ] );

		// Allow special events to draw outside the lines
		special = jQuery.event.special[ type ] || {};
		if ( !onlyHandlers && special.trigger && special.trigger.apply( elem, data ) === false ) {
			return;
		}

		// Determine event propagation path in advance, per W3C events spec (#9951)
		// Bubble up to document, then to window; watch for a global ownerDocument var (#9724)
		if ( !onlyHandlers && !special.noBubble && !isWindow( elem ) ) {

			bubbleType = special.delegateType || type;
			if ( !rfocusMorph.test( bubbleType + type ) ) {
				cur = cur.parentNode;
			}
			for ( ; cur; cur = cur.parentNode ) {
				eventPath.push( cur );
				tmp = cur;
			}

			// Only add window if we got to document (e.g., not plain obj or detached DOM)
			if ( tmp === ( elem.ownerDocument || document ) ) {
				eventPath.push( tmp.defaultView || tmp.parentWindow || window );
			}
		}

		// Fire handlers on the event path
		i = 0;
		while ( ( cur = eventPath[ i++ ] ) && !event.isPropagationStopped() ) {
			lastElement = cur;
			event.type = i > 1 ?
				bubbleType :
				special.bindType || type;

			// jQuery handler
			handle = ( dataPriv.get( cur, "events" ) || Object.create( null ) )[ event.type ] &&
				dataPriv.get( cur, "handle" );
			if ( handle ) {
				handle.apply( cur, data );
			}

			// Native handler
			handle = ontype && cur[ ontype ];
			if ( handle && handle.apply && acceptData( cur ) ) {
				event.result = handle.apply( cur, data );
				if ( event.result === false ) {
					event.preventDefault();
				}
			}
		}
		event.type = type;

		// If nobody prevented the default action, do it now
		if ( !onlyHandlers && !event.isDefaultPrevented() ) {

			if ( ( !special._default ||
				special._default.apply( eventPath.pop(), data ) === false ) &&
				acceptData( elem ) ) {

				// Call a native DOM method on the target with the same name as the event.
				// Don't do default actions on window, that's where global variables be (#6170)
				if ( ontype && isFunction( elem[ type ] ) && !isWindow( elem ) ) {

					// Don't re-trigger an onFOO event when we call its FOO() method
					tmp = elem[ ontype ];

					if ( tmp ) {
						elem[ ontype ] = null;
					}

					// Prevent re-triggering of the same event, since we already bubbled it above
					jQuery.event.triggered = type;

					if ( event.isPropagationStopped() ) {
						lastElement.addEventListener( type, stopPropagationCallback );
					}

					elem[ type ]();

					if ( event.isPropagationStopped() ) {
						lastElement.removeEventListener( type, stopPropagationCallback );
					}

					jQuery.event.triggered = undefined;

					if ( tmp ) {
						elem[ ontype ] = tmp;
					}
				}
			}
		}

		return event.result;
	},

	// Piggyback on a donor event to simulate a different one
	// Used only for `focus(in | out)` events
	simulate: function( type, elem, event ) {
		var e = jQuery.extend(
			new jQuery.Event(),
			event,
			{
				type: type,
				isSimulated: true
			}
		);

		jQuery.event.trigger( e, null, elem );
	}

} );

jQuery.fn.extend( {

	trigger: function( type, data ) {
		return this.each( function() {
			jQuery.event.trigger( type, data, this );
		} );
	},
	triggerHandler: function( type, data ) {
		var elem = this[ 0 ];
		if ( elem ) {
			return jQuery.event.trigger( type, data, elem, true );
		}
	}
} );


// Support: Firefox <=44
// Firefox doesn't have focus(in | out) events
// Related ticket - https://bugzilla.mozilla.org/show_bug.cgi?id=687787
//
// Support: Chrome <=48 - 49, Safari <=9.0 - 9.1
// focus(in | out) events fire after focus & blur events,
// which is spec violation - http://www.w3.org/TR/DOM-Level-3-Events/#events-focusevent-event-order
// Related ticket - https://bugs.chromium.org/p/chromium/issues/detail?id=449857
if ( !support.focusin ) {
	jQuery.each( { focus: "focusin", blur: "focusout" }, function( orig, fix ) {

		// Attach a single capturing handler on the document while someone wants focusin/focusout
		var handler = function( event ) {
			jQuery.event.simulate( fix, event.target, jQuery.event.fix( event ) );
		};

		jQuery.event.special[ fix ] = {
			setup: function() {

				// Handle: regular nodes (via `this.ownerDocument`), window
				// (via `this.document`) & document (via `this`).
				var doc = this.ownerDocument || this.document || this,
					attaches = dataPriv.access( doc, fix );

				if ( !attaches ) {
					doc.addEventListener( orig, handler, true );
				}
				dataPriv.access( doc, fix, ( attaches || 0 ) + 1 );
			},
			teardown: function() {
				var doc = this.ownerDocument || this.document || this,
					attaches = dataPriv.access( doc, fix ) - 1;

				if ( !attaches ) {
					doc.removeEventListener( orig, handler, true );
					dataPriv.remove( doc, fix );

				} else {
					dataPriv.access( doc, fix, attaches );
				}
			}
		};
	} );
}
var location = window.location;

var nonce = { guid: Date.now() };

var rquery = ( /\?/ );



// Cross-browser xml parsing
jQuery.parseXML = function( data ) {
	var xml, parserErrorElem;
	if ( !data || typeof data !== "string" ) {
		return null;
	}

	// Support: IE 9 - 11 only
	// IE throws on parseFromString with invalid input.
	try {
		xml = ( new window.DOMParser() ).parseFromString( data, "text/xml" );
	} catch ( e ) {}

	parserErrorElem = xml && xml.getElementsByTagName( "parsererror" )[ 0 ];
	if ( !xml || parserErrorElem ) {
		jQuery.error( "Invalid XML: " + (
			parserErrorElem ?
				jQuery.map( parserErrorElem.childNodes, function( el ) {
					return el.textContent;
				} ).join( "\n" ) :
				data
		) );
	}
	return xml;
};


var
	rbracket = /\[\]$/,
	rCRLF = /\r?\n/g,
	rsubmitterTypes = /^(?:submit|button|image|reset|file)$/i,
	rsubmittable = /^(?:input|select|textarea|keygen)/i;

function buildParams( prefix, obj, traditional, add ) {
	var name;

	if ( Array.isArray( obj ) ) {

		// Serialize array item.
		jQuery.each( obj, function( i, v ) {
			if ( traditional || rbracket.test( prefix ) ) {

				// Treat each array item as a scalar.
				add( prefix, v );

			} else {

				// Item is non-scalar (array or object), encode its numeric index.
				buildParams(
					prefix + "[" + ( typeof v === "object" && v != null ? i : "" ) + "]",
					v,
					traditional,
					add
				);
			}
		} );

	} else if ( !traditional && toType( obj ) === "object" ) {

		// Serialize object item.
		for ( name in obj ) {
			buildParams( prefix + "[" + name + "]", obj[ name ], traditional, add );
		}

	} else {

		// Serialize scalar item.
		add( prefix, obj );
	}
}

// Serialize an array of form elements or a set of
// key/values into a query string
jQuery.param = function( a, traditional ) {
	var prefix,
		s = [],
		add = function( key, valueOrFunction ) {

			// If value is a function, invoke it and use its return value
			var value = isFunction( valueOrFunction ) ?
				valueOrFunction() :
				valueOrFunction;

			s[ s.length ] = encodeURIComponent( key ) + "=" +
				encodeURIComponent( value == null ? "" : value );
		};

	if ( a == null ) {
		return "";
	}

	// If an array was passed in, assume that it is an array of form elements.
	if ( Array.isArray( a ) || ( a.jquery && !jQuery.isPlainObject( a ) ) ) {

		// Serialize the form elements
		jQuery.each( a, function() {
			add( this.name, this.value );
		} );

	} else {

		// If traditional, encode the "old" way (the way 1.3.2 or older
		// did it), otherwise encode params recursively.
		for ( prefix in a ) {
			buildParams( prefix, a[ prefix ], traditional, add );
		}
	}

	// Return the resulting serialization
	return s.join( "&" );
};

jQuery.fn.extend( {
	serialize: function() {
		return jQuery.param( this.serializeArray() );
	},
	serializeArray: function() {
		return this.map( function() {

			// Can add propHook for "elements" to filter or add form elements
			var elements = jQuery.prop( this, "elements" );
			return elements ? jQuery.makeArray( elements ) : this;
		} ).filter( function() {
			var type = this.type;

			// Use .is( ":disabled" ) so that fieldset[disabled] works
			return this.name && !jQuery( this ).is( ":disabled" ) &&
				rsubmittable.test( this.nodeName ) && !rsubmitterTypes.test( type ) &&
				( this.checked || !rcheckableType.test( type ) );
		} ).map( function( _i, elem ) {
			var val = jQuery( this ).val();

			if ( val == null ) {
				return null;
			}

			if ( Array.isArray( val ) ) {
				return jQuery.map( val, function( val ) {
					return { name: elem.name, value: val.replace( rCRLF, "\r\n" ) };
				} );
			}

			return { name: elem.name, value: val.replace( rCRLF, "\r\n" ) };
		} ).get();
	}
} );


var
	r20 = /%20/g,
	rhash = /#.*$/,
	rantiCache = /([?&])_=[^&]*/,
	rheaders = /^(.*?):[ \t]*([^\r\n]*)$/mg,

	// #7653, #8125, #8152: local protocol detection
	rlocalProtocol = /^(?:about|app|app-storage|.+-extension|file|res|widget):$/,
	rnoContent = /^(?:GET|HEAD)$/,
	rprotocol = /^\/\//,

	/* Prefilters
	 * 1) They are useful to introduce custom dataTypes (see ajax/jsonp.js for an example)
	 * 2) These are called:
	 *    - BEFORE asking for a transport
	 *    - AFTER param serialization (s.data is a string if s.processData is true)
	 * 3) key is the dataType
	 * 4) the catchall symbol "*" can be used
	 * 5) execution will start with transport dataType and THEN continue down to "*" if needed
	 */
	prefilters = {},

	/* Transports bindings
	 * 1) key is the dataType
	 * 2) the catchall symbol "*" can be used
	 * 3) selection will start with transport dataType and THEN go to "*" if needed
	 */
	transports = {},

	// Avoid comment-prolog char sequence (#10098); must appease lint and evade compression
	allTypes = "*/".concat( "*" ),

	// Anchor tag for parsing the document origin
	originAnchor = document.createElement( "a" );

originAnchor.href = location.href;

// Base "constructor" for jQuery.ajaxPrefilter and jQuery.ajaxTransport
function addToPrefiltersOrTransports( structure ) {

	// dataTypeExpression is optional and defaults to "*"
	return function( dataTypeExpression, func ) {

		if ( typeof dataTypeExpression !== "string" ) {
			func = dataTypeExpression;
			dataTypeExpression = "*";
		}

		var dataType,
			i = 0,
			dataTypes = dataTypeExpression.toLowerCase().match( rnothtmlwhite ) || [];

		if ( isFunction( func ) ) {

			// For each dataType in the dataTypeExpression
			while ( ( dataType = dataTypes[ i++ ] ) ) {

				// Prepend if requested
				if ( dataType[ 0 ] === "+" ) {
					dataType = dataType.slice( 1 ) || "*";
					( structure[ dataType ] = structure[ dataType ] || [] ).unshift( func );

				// Otherwise append
				} else {
					( structure[ dataType ] = structure[ dataType ] || [] ).push( func );
				}
			}
		}
	};
}

// Base inspection function for prefilters and transports
function inspectPrefiltersOrTransports( structure, options, originalOptions, jqXHR ) {

	var inspected = {},
		seekingTransport = ( structure === transports );

	function inspect( dataType ) {
		var selected;
		inspected[ dataType ] = true;
		jQuery.each( structure[ dataType ] || [], function( _, prefilterOrFactory ) {
			var dataTypeOrTransport = prefilterOrFactory( options, originalOptions, jqXHR );
			if ( typeof dataTypeOrTransport === "string" &&
				!seekingTransport && !inspected[ dataTypeOrTransport ] ) {

				options.dataTypes.unshift( dataTypeOrTransport );
				inspect( dataTypeOrTransport );
				return false;
			} else if ( seekingTransport ) {
				return !( selected = dataTypeOrTransport );
			}
		} );
		return selected;
	}

	return inspect( options.dataTypes[ 0 ] ) || !inspected[ "*" ] && inspect( "*" );
}

// A special extend for ajax options
// that takes "flat" options (not to be deep extended)
// Fixes #9887
function ajaxExtend( target, src ) {
	var key, deep,
		flatOptions = jQuery.ajaxSettings.flatOptions || {};

	for ( key in src ) {
		if ( src[ key ] !== undefined ) {
			( flatOptions[ key ] ? target : ( deep || ( deep = {} ) ) )[ key ] = src[ key ];
		}
	}
	if ( deep ) {
		jQuery.extend( true, target, deep );
	}

	return target;
}

/* Handles responses to an ajax request:
 * - finds the right dataType (mediates between content-type and expected dataType)
 * - returns the corresponding response
 */
function ajaxHandleResponses( s, jqXHR, responses ) {

	var ct, type, finalDataType, firstDataType,
		contents = s.contents,
		dataTypes = s.dataTypes;

	// Remove auto dataType and get content-type in the process
	while ( dataTypes[ 0 ] === "*" ) {
		dataTypes.shift();
		if ( ct === undefined ) {
			ct = s.mimeType || jqXHR.getResponseHeader( "Content-Type" );
		}
	}

	// Check if we're dealing with a known content-type
	if ( ct ) {
		for ( type in contents ) {
			if ( contents[ type ] && contents[ type ].test( ct ) ) {
				dataTypes.unshift( type );
				break;
			}
		}
	}

	// Check to see if we have a response for the expected dataType
	if ( dataTypes[ 0 ] in responses ) {
		finalDataType = dataTypes[ 0 ];
	} else {

		// Try convertible dataTypes
		for ( type in responses ) {
			if ( !dataTypes[ 0 ] || s.converters[ type + " " + dataTypes[ 0 ] ] ) {
				finalDataType = type;
				break;
			}
			if ( !firstDataType ) {
				firstDataType = type;
			}
		}

		// Or just use first one
		finalDataType = finalDataType || firstDataType;
	}

	// If we found a dataType
	// We add the dataType to the list if needed
	// and return the corresponding response
	if ( finalDataType ) {
		if ( finalDataType !== dataTypes[ 0 ] ) {
			dataTypes.unshift( finalDataType );
		}
		return responses[ finalDataType ];
	}
}

/* Chain conversions given the request and the original response
 * Also sets the responseXXX fields on the jqXHR instance
 */
function ajaxConvert( s, response, jqXHR, isSuccess ) {
	var conv2, current, conv, tmp, prev,
		converters = {},

		// Work with a copy of dataTypes in case we need to modify it for conversion
		dataTypes = s.dataTypes.slice();

	// Create converters map with lowercased keys
	if ( dataTypes[ 1 ] ) {
		for ( conv in s.converters ) {
			converters[ conv.toLowerCase() ] = s.converters[ conv ];
		}
	}

	current = dataTypes.shift();

	// Convert to each sequential dataType
	while ( current ) {

		if ( s.responseFields[ current ] ) {
			jqXHR[ s.responseFields[ current ] ] = response;
		}

		// Apply the dataFilter if provided
		if ( !prev && isSuccess && s.dataFilter ) {
			response = s.dataFilter( response, s.dataType );
		}

		prev = current;
		current = dataTypes.shift();

		if ( current ) {

			// There's only work to do if current dataType is non-auto
			if ( current === "*" ) {

				current = prev;

			// Convert response if prev dataType is non-auto and differs from current
			} else if ( prev !== "*" && prev !== current ) {

				// Seek a direct converter
				conv = converters[ prev + " " + current ] || converters[ "* " + current ];

				// If none found, seek a pair
				if ( !conv ) {
					for ( conv2 in converters ) {

						// If conv2 outputs current
						tmp = conv2.split( " " );
						if ( tmp[ 1 ] === current ) {

							// If prev can be converted to accepted input
							conv = converters[ prev + " " + tmp[ 0 ] ] ||
								converters[ "* " + tmp[ 0 ] ];
							if ( conv ) {

								// Condense equivalence converters
								if ( conv === true ) {
									conv = converters[ conv2 ];

								// Otherwise, insert the intermediate dataType
								} else if ( converters[ conv2 ] !== true ) {
									current = tmp[ 0 ];
									dataTypes.unshift( tmp[ 1 ] );
								}
								break;
							}
						}
					}
				}

				// Apply converter (if not an equivalence)
				if ( conv !== true ) {

					// Unless errors are allowed to bubble, catch and return them
					if ( conv && s.throws ) {
						response = conv( response );
					} else {
						try {
							response = conv( response );
						} catch ( e ) {
							return {
								state: "parsererror",
								error: conv ? e : "No conversion from " + prev + " to " + current
							};
						}
					}
				}
			}
		}
	}

	return { state: "success", data: response };
}

jQuery.extend( {

	// Counter for holding the number of active queries
	active: 0,

	// Last-Modified header cache for next request
	lastModified: {},
	etag: {},

	ajaxSettings: {
		url: location.href,
		type: "GET",
		isLocal: rlocalProtocol.test( location.protocol ),
		global: true,
		processData: true,
		async: true,
		contentType: "application/x-www-form-urlencoded; charset=UTF-8",

		/*
		timeout: 0,
		data: null,
		dataType: null,
		username: null,
		password: null,
		cache: null,
		throws: false,
		traditional: false,
		headers: {},
		*/

		accepts: {
			"*": allTypes,
			text: "text/plain",
			html: "text/html",
			xml: "application/xml, text/xml",
			json: "application/json, text/javascript"
		},

		contents: {
			xml: /\bxml\b/,
			html: /\bhtml/,
			json: /\bjson\b/
		},

		responseFields: {
			xml: "responseXML",
			text: "responseText",
			json: "responseJSON"
		},

		// Data converters
		// Keys separate source (or catchall "*") and destination types with a single space
		converters: {

			// Convert anything to text
			"* text": String,

			// Text to html (true = no transformation)
			"text html": true,

			// Evaluate text as a json expression
			"text json": JSON.parse,

			// Parse text as xml
			"text xml": jQuery.parseXML
		},

		// For options that shouldn't be deep extended:
		// you can add your own custom options here if
		// and when you create one that shouldn't be
		// deep extended (see ajaxExtend)
		flatOptions: {
			url: true,
			context: true
		}
	},

	// Creates a full fledged settings object into target
	// with both ajaxSettings and settings fields.
	// If target is omitted, writes into ajaxSettings.
	ajaxSetup: function( target, settings ) {
		return settings ?

			// Building a settings object
			ajaxExtend( ajaxExtend( target, jQuery.ajaxSettings ), settings ) :

			// Extending ajaxSettings
			ajaxExtend( jQuery.ajaxSettings, target );
	},

	ajaxPrefilter: addToPrefiltersOrTransports( prefilters ),
	ajaxTransport: addToPrefiltersOrTransports( transports ),

	// Main method
	ajax: function( url, options ) {

		// If url is an object, simulate pre-1.5 signature
		if ( typeof url === "object" ) {
			options = url;
			url = undefined;
		}

		// Force options to be an object
		options = options || {};

		var transport,

			// URL without anti-cache param
			cacheURL,

			// Response headers
			responseHeadersString,
			responseHeaders,

			// timeout handle
			timeoutTimer,

			// Url cleanup var
			urlAnchor,

			// Request state (becomes false upon send and true upon completion)
			completed,

			// To know if global events are to be dispatched
			fireGlobals,

			// Loop variable
			i,

			// uncached part of the url
			uncached,

			// Create the final options object
			s = jQuery.ajaxSetup( {}, options ),

			// Callbacks context
			callbackContext = s.context || s,

			// Context for global events is callbackContext if it is a DOM node or jQuery collection
			globalEventContext = s.context &&
				( callbackContext.nodeType || callbackContext.jquery ) ?
				jQuery( callbackContext ) :
				jQuery.event,

			// Deferreds
			deferred = jQuery.Deferred(),
			completeDeferred = jQuery.Callbacks( "once memory" ),

			// Status-dependent callbacks
			statusCode = s.statusCode || {},

			// Headers (they are sent all at once)
			requestHeaders = {},
			requestHeadersNames = {},

			// Default abort message
			strAbort = "canceled",

			// Fake xhr
			jqXHR = {
				readyState: 0,

				// Builds headers hashtable if needed
				getResponseHeader: function( key ) {
					var match;
					if ( completed ) {
						if ( !responseHeaders ) {
							responseHeaders = {};
							while ( ( match = rheaders.exec( responseHeadersString ) ) ) {
								responseHeaders[ match[ 1 ].toLowerCase() + " " ] =
									( responseHeaders[ match[ 1 ].toLowerCase() + " " ] || [] )
										.concat( match[ 2 ] );
							}
						}
						match = responseHeaders[ key.toLowerCase() + " " ];
					}
					return match == null ? null : match.join( ", " );
				},

				// Raw string
				getAllResponseHeaders: function() {
					return completed ? responseHeadersString : null;
				},

				// Caches the header
				setRequestHeader: function( name, value ) {
					if ( completed == null ) {
						name = requestHeadersNames[ name.toLowerCase() ] =
							requestHeadersNames[ name.toLowerCase() ] || name;
						requestHeaders[ name ] = value;
					}
					return this;
				},

				// Overrides response content-type header
				overrideMimeType: function( type ) {
					if ( completed == null ) {
						s.mimeType = type;
					}
					return this;
				},

				// Status-dependent callbacks
				statusCode: function( map ) {
					var code;
					if ( map ) {
						if ( completed ) {

							// Execute the appropriate callbacks
							jqXHR.always( map[ jqXHR.status ] );
						} else {

							// Lazy-add the new callbacks in a way that preserves old ones
							for ( code in map ) {
								statusCode[ code ] = [ statusCode[ code ], map[ code ] ];
							}
						}
					}
					return this;
				},

				// Cancel the request
				abort: function( statusText ) {
					var finalText = statusText || strAbort;
					if ( transport ) {
						transport.abort( finalText );
					}
					done( 0, finalText );
					return this;
				}
			};

		// Attach deferreds
		deferred.promise( jqXHR );

		// Add protocol if not provided (prefilters might expect it)
		// Handle falsy url in the settings object (#10093: consistency with old signature)
		// We also use the url parameter if available
		s.url = ( ( url || s.url || location.href ) + "" )
			.replace( rprotocol, location.protocol + "//" );

		// Alias method option to type as per ticket #12004
		s.type = options.method || options.type || s.method || s.type;

		// Extract dataTypes list
		s.dataTypes = ( s.dataType || "*" ).toLowerCase().match( rnothtmlwhite ) || [ "" ];

		// A cross-domain request is in order when the origin doesn't match the current origin.
		if ( s.crossDomain == null ) {
			urlAnchor = document.createElement( "a" );

			// Support: IE <=8 - 11, Edge 12 - 15
			// IE throws exception on accessing the href property if url is malformed,
			// e.g. http://example.com:80x/
			try {
				urlAnchor.href = s.url;

				// Support: IE <=8 - 11 only
				// Anchor's host property isn't correctly set when s.url is relative
				urlAnchor.href = urlAnchor.href;
				s.crossDomain = originAnchor.protocol + "//" + originAnchor.host !==
					urlAnchor.protocol + "//" + urlAnchor.host;
			} catch ( e ) {

				// If there is an error parsing the URL, assume it is crossDomain,
				// it can be rejected by the transport if it is invalid
				s.crossDomain = true;
			}
		}

		// Convert data if not already a string
		if ( s.data && s.processData && typeof s.data !== "string" ) {
			s.data = jQuery.param( s.data, s.traditional );
		}

		// Apply prefilters
		inspectPrefiltersOrTransports( prefilters, s, options, jqXHR );

		// If request was aborted inside a prefilter, stop there
		if ( completed ) {
			return jqXHR;
		}

		// We can fire global events as of now if asked to
		// Don't fire events if jQuery.event is undefined in an AMD-usage scenario (#15118)
		fireGlobals = jQuery.event && s.global;

		// Watch for a new set of requests
		if ( fireGlobals && jQuery.active++ === 0 ) {
			jQuery.event.trigger( "ajaxStart" );
		}

		// Uppercase the type
		s.type = s.type.toUpperCase();

		// Determine if request has content
		s.hasContent = !rnoContent.test( s.type );

		// Save the URL in case we're toying with the If-Modified-Since
		// and/or If-None-Match header later on
		// Remove hash to simplify url manipulation
		cacheURL = s.url.replace( rhash, "" );

		// More options handling for requests with no content
		if ( !s.hasContent ) {

			// Remember the hash so we can put it back
			uncached = s.url.slice( cacheURL.length );

			// If data is available and should be processed, append data to url
			if ( s.data && ( s.processData || typeof s.data === "string" ) ) {
				cacheURL += ( rquery.test( cacheURL ) ? "&" : "?" ) + s.data;

				// #9682: remove data so that it's not used in an eventual retry
				delete s.data;
			}

			// Add or update anti-cache param if needed
			if ( s.cache === false ) {
				cacheURL = cacheURL.replace( rantiCache, "$1" );
				uncached = ( rquery.test( cacheURL ) ? "&" : "?" ) + "_=" + ( nonce.guid++ ) +
					uncached;
			}

			// Put hash and anti-cache on the URL that will be requested (gh-1732)
			s.url = cacheURL + uncached;

		// Change '%20' to '+' if this is encoded form body content (gh-2658)
		} else if ( s.data && s.processData &&
			( s.contentType || "" ).indexOf( "application/x-www-form-urlencoded" ) === 0 ) {
			s.data = s.data.replace( r20, "+" );
		}

		// Set the If-Modified-Since and/or If-None-Match header, if in ifModified mode.
		if ( s.ifModified ) {
			if ( jQuery.lastModified[ cacheURL ] ) {
				jqXHR.setRequestHeader( "If-Modified-Since", jQuery.lastModified[ cacheURL ] );
			}
			if ( jQuery.etag[ cacheURL ] ) {
				jqXHR.setRequestHeader( "If-None-Match", jQuery.etag[ cacheURL ] );
			}
		}

		// Set the correct header, if data is being sent
		if ( s.data && s.hasContent && s.contentType !== false || options.contentType ) {
			jqXHR.setRequestHeader( "Content-Type", s.contentType );
		}

		// Set the Accepts header for the server, depending on the dataType
		jqXHR.setRequestHeader(
			"Accept",
			s.dataTypes[ 0 ] && s.accepts[ s.dataTypes[ 0 ] ] ?
				s.accepts[ s.dataTypes[ 0 ] ] +
					( s.dataTypes[ 0 ] !== "*" ? ", " + allTypes + "; q=0.01" : "" ) :
				s.accepts[ "*" ]
		);

		// Check for headers option
		for ( i in s.headers ) {
			jqXHR.setRequestHeader( i, s.headers[ i ] );
		}

		// Allow custom headers/mimetypes and early abort
		if ( s.beforeSend &&
			( s.beforeSend.call( callbackContext, jqXHR, s ) === false || completed ) ) {

			// Abort if not done already and return
			return jqXHR.abort();
		}

		// Aborting is no longer a cancellation
		strAbort = "abort";

		// Install callbacks on deferreds
		completeDeferred.add( s.complete );
		jqXHR.done( s.success );
		jqXHR.fail( s.error );

		// Get transport
		transport = inspectPrefiltersOrTransports( transports, s, options, jqXHR );

		// If no transport, we auto-abort
		if ( !transport ) {
			done( -1, "No Transport" );
		} else {
			jqXHR.readyState = 1;

			// Send global event
			if ( fireGlobals ) {
				globalEventContext.trigger( "ajaxSend", [ jqXHR, s ] );
			}

			// If request was aborted inside ajaxSend, stop there
			if ( completed ) {
				return jqXHR;
			}

			// Timeout
			if ( s.async && s.timeout > 0 ) {
				timeoutTimer = window.setTimeout( function() {
					jqXHR.abort( "timeout" );
				}, s.timeout );
			}

			try {
				completed = false;
				transport.send( requestHeaders, done );
			} catch ( e ) {

				// Rethrow post-completion exceptions
				if ( completed ) {
					throw e;
				}

				// Propagate others as results
				done( -1, e );
			}
		}

		// Callback for when everything is done
		function done( status, nativeStatusText, responses, headers ) {
			var isSuccess, success, error, response, modified,
				statusText = nativeStatusText;

			// Ignore repeat invocations
			if ( completed ) {
				return;
			}

			completed = true;

			// Clear timeout if it exists
			if ( timeoutTimer ) {
				window.clearTimeout( timeoutTimer );
			}

			// Dereference transport for early garbage collection
			// (no matter how long the jqXHR object will be used)
			transport = undefined;

			// Cache response headers
			responseHeadersString = headers || "";

			// Set readyState
			jqXHR.readyState = status > 0 ? 4 : 0;

			// Determine if successful
			isSuccess = status >= 200 && status < 300 || status === 304;

			// Get response data
			if ( responses ) {
				response = ajaxHandleResponses( s, jqXHR, responses );
			}

			// Use a noop converter for missing script but not if jsonp
			if ( !isSuccess &&
				jQuery.inArray( "script", s.dataTypes ) > -1 &&
				jQuery.inArray( "json", s.dataTypes ) < 0 ) {
				s.converters[ "text script" ] = function() {};
			}

			// Convert no matter what (that way responseXXX fields are always set)
			response = ajaxConvert( s, response, jqXHR, isSuccess );

			// If successful, handle type chaining
			if ( isSuccess ) {

				// Set the If-Modified-Since and/or If-None-Match header, if in ifModified mode.
				if ( s.ifModified ) {
					modified = jqXHR.getResponseHeader( "Last-Modified" );
					if ( modified ) {
						jQuery.lastModified[ cacheURL ] = modified;
					}
					modified = jqXHR.getResponseHeader( "etag" );
					if ( modified ) {
						jQuery.etag[ cacheURL ] = modified;
					}
				}

				// if no content
				if ( status === 204 || s.type === "HEAD" ) {
					statusText = "nocontent";

				// if not modified
				} else if ( status === 304 ) {
					statusText = "notmodified";

				// If we have data, let's convert it
				} else {
					statusText = response.state;
					success = response.data;
					error = response.error;
					isSuccess = !error;
				}
			} else {

				// Extract error from statusText and normalize for non-aborts
				error = statusText;
				if ( status || !statusText ) {
					statusText = "error";
					if ( status < 0 ) {
						status = 0;
					}
				}
			}

			// Set data for the fake xhr object
			jqXHR.status = status;
			jqXHR.statusText = ( nativeStatusText || statusText ) + "";

			// Success/Error
			if ( isSuccess ) {
				deferred.resolveWith( callbackContext, [ success, statusText, jqXHR ] );
			} else {
				deferred.rejectWith( callbackContext, [ jqXHR, statusText, error ] );
			}

			// Status-dependent callbacks
			jqXHR.statusCode( statusCode );
			statusCode = undefined;

			if ( fireGlobals ) {
				globalEventContext.trigger( isSuccess ? "ajaxSuccess" : "ajaxError",
					[ jqXHR, s, isSuccess ? success : error ] );
			}

			// Complete
			completeDeferred.fireWith( callbackContext, [ jqXHR, statusText ] );

			if ( fireGlobals ) {
				globalEventContext.trigger( "ajaxComplete", [ jqXHR, s ] );

				// Handle the global AJAX counter
				if ( !( --jQuery.active ) ) {
					jQuery.event.trigger( "ajaxStop" );
				}
			}
		}

		return jqXHR;
	},

	getJSON: function( url, data, callback ) {
		return jQuery.get( url, data, callback, "json" );
	},

	getScript: function( url, callback ) {
		return jQuery.get( url, undefined, callback, "script" );
	}
} );

jQuery.each( [ "get", "post" ], function( _i, method ) {
	jQuery[ method ] = function( url, data, callback, type ) {

		// Shift arguments if data argument was omitted
		if ( isFunction( data ) ) {
			type = type || callback;
			callback = data;
			data = undefined;
		}

		// The url can be an options object (which then must have .url)
		return jQuery.ajax( jQuery.extend( {
			url: url,
			type: method,
			dataType: type,
			data: data,
			success: callback
		}, jQuery.isPlainObject( url ) && url ) );
	};
} );

jQuery.ajaxPrefilter( function( s ) {
	var i;
	for ( i in s.headers ) {
		if ( i.toLowerCase() === "content-type" ) {
			s.contentType = s.headers[ i ] || "";
		}
	}
} );


jQuery._evalUrl = function( url, options, doc ) {
	return jQuery.ajax( {
		url: url,

		// Make this explicit, since user can override this through ajaxSetup (#11264)
		type: "GET",
		dataType: "script",
		cache: true,
		async: false,
		global: false,

		// Only evaluate the response if it is successful (gh-4126)
		// dataFilter is not invoked for failure responses, so using it instead
		// of the default converter is kludgy but it works.
		converters: {
			"text script": function() {}
		},
		dataFilter: function( response ) {
			jQuery.globalEval( response, options, doc );
		}
	} );
};


jQuery.fn.extend( {
	wrapAll: function( html ) {
		var wrap;

		if ( this[ 0 ] ) {
			if ( isFunction( html ) ) {
				html = html.call( this[ 0 ] );
			}

			// The elements to wrap the target around
			wrap = jQuery( html, this[ 0 ].ownerDocument ).eq( 0 ).clone( true );

			if ( this[ 0 ].parentNode ) {
				wrap.insertBefore( this[ 0 ] );
			}

			wrap.map( function() {
				var elem = this;

				while ( elem.firstElementChild ) {
					elem = elem.firstElementChild;
				}

				return elem;
			} ).append( this );
		}

		return this;
	},

	wrapInner: function( html ) {
		if ( isFunction( html ) ) {
			return this.each( function( i ) {
				jQuery( this ).wrapInner( html.call( this, i ) );
			} );
		}

		return this.each( function() {
			var self = jQuery( this ),
				contents = self.contents();

			if ( contents.length ) {
				contents.wrapAll( html );

			} else {
				self.append( html );
			}
		} );
	},

	wrap: function( html ) {
		var htmlIsFunction = isFunction( html );

		return this.each( function( i ) {
			jQuery( this ).wrapAll( htmlIsFunction ? html.call( this, i ) : html );
		} );
	},

	unwrap: function( selector ) {
		this.parent( selector ).not( "body" ).each( function() {
			jQuery( this ).replaceWith( this.childNodes );
		} );
		return this;
	}
} );


jQuery.expr.pseudos.hidden = function( elem ) {
	return !jQuery.expr.pseudos.visible( elem );
};
jQuery.expr.pseudos.visible = function( elem ) {
	return !!( elem.offsetWidth || elem.offsetHeight || elem.getClientRects().length );
};




jQuery.ajaxSettings.xhr = function() {
	try {
		return new window.XMLHttpRequest();
	} catch ( e ) {}
};

var xhrSuccessStatus = {

		// File protocol always yields status code 0, assume 200
		0: 200,

		// Support: IE <=9 only
		// #1450: sometimes IE returns 1223 when it should be 204
		1223: 204
	},
	xhrSupported = jQuery.ajaxSettings.xhr();

support.cors = !!xhrSupported && ( "withCredentials" in xhrSupported );
support.ajax = xhrSupported = !!xhrSupported;

jQuery.ajaxTransport( function( options ) {
	var callback, errorCallback;

	// Cross domain only allowed if supported through XMLHttpRequest
	if ( support.cors || xhrSupported && !options.crossDomain ) {
		return {
			send: function( headers, complete ) {
				var i,
					xhr = options.xhr();

				xhr.open(
					options.type,
					options.url,
					options.async,
					options.username,
					options.password
				);

				// Apply custom fields if provided
				if ( options.xhrFields ) {
					for ( i in options.xhrFields ) {
						xhr[ i ] = options.xhrFields[ i ];
					}
				}

				// Override mime type if needed
				if ( options.mimeType && xhr.overrideMimeType ) {
					xhr.overrideMimeType( options.mimeType );
				}

				// X-Requested-With header
				// For cross-domain requests, seeing as conditions for a preflight are
				// akin to a jigsaw puzzle, we simply never set it to be sure.
				// (it can always be set on a per-request basis or even using ajaxSetup)
				// For same-domain requests, won't change header if already provided.
				if ( !options.crossDomain && !headers[ "X-Requested-With" ] ) {
					headers[ "X-Requested-With" ] = "XMLHttpRequest";
				}

				// Set headers
				for ( i in headers ) {
					xhr.setRequestHeader( i, headers[ i ] );
				}

				// Callback
				callback = function( type ) {
					return function() {
						if ( callback ) {
							callback = errorCallback = xhr.onload =
								xhr.onerror = xhr.onabort = xhr.ontimeout =
									xhr.onreadystatechange = null;

							if ( type === "abort" ) {
								xhr.abort();
							} else if ( type === "error" ) {

								// Support: IE <=9 only
								// On a manual native abort, IE9 throws
								// errors on any property access that is not readyState
								if ( typeof xhr.status !== "number" ) {
									complete( 0, "error" );
								} else {
									complete(

										// File: protocol always yields status 0; see #8605, #14207
										xhr.status,
										xhr.statusText
									);
								}
							} else {
								complete(
									xhrSuccessStatus[ xhr.status ] || xhr.status,
									xhr.statusText,

									// Support: IE <=9 only
									// IE9 has no XHR2 but throws on binary (trac-11426)
									// For XHR2 non-text, let the caller handle it (gh-2498)
									( xhr.responseType || "text" ) !== "text"  ||
									typeof xhr.responseText !== "string" ?
										{ binary: xhr.response } :
										{ text: xhr.responseText },
									xhr.getAllResponseHeaders()
								);
							}
						}
					};
				};

				// Listen to events
				xhr.onload = callback();
				errorCallback = xhr.onerror = xhr.ontimeout = callback( "error" );

				// Support: IE 9 only
				// Use onreadystatechange to replace onabort
				// to handle uncaught aborts
				if ( xhr.onabort !== undefined ) {
					xhr.onabort = errorCallback;
				} else {
					xhr.onreadystatechange = function() {

						// Check readyState before timeout as it changes
						if ( xhr.readyState === 4 ) {

							// Allow onerror to be called first,
							// but that will not handle a native abort
							// Also, save errorCallback to a variable
							// as xhr.onerror cannot be accessed
							window.setTimeout( function() {
								if ( callback ) {
									errorCallback();
								}
							} );
						}
					};
				}

				// Create the abort callback
				callback = callback( "abort" );

				try {

					// Do send the request (this may raise an exception)
					xhr.send( options.hasContent && options.data || null );
				} catch ( e ) {

					// #14683: Only rethrow if this hasn't been notified as an error yet
					if ( callback ) {
						throw e;
					}
				}
			},

			abort: function() {
				if ( callback ) {
					callback();
				}
			}
		};
	}
} );




// Prevent auto-execution of scripts when no explicit dataType was provided (See gh-2432)
jQuery.ajaxPrefilter( function( s ) {
	if ( s.crossDomain ) {
		s.contents.script = false;
	}
} );

// Install script dataType
jQuery.ajaxSetup( {
	accepts: {
		script: "text/javascript, application/javascript, " +
			"application/ecmascript, application/x-ecmascript"
	},
	contents: {
		script: /\b(?:java|ecma)script\b/
	},
	converters: {
		"text script": function( text ) {
			jQuery.globalEval( text );
			return text;
		}
	}
} );

// Handle cache's special case and crossDomain
jQuery.ajaxPrefilter( "script", function( s ) {
	if ( s.cache === undefined ) {
		s.cache = false;
	}
	if ( s.crossDomain ) {
		s.type = "GET";
	}
} );

// Bind script tag hack transport
jQuery.ajaxTransport( "script", function( s ) {

	// This transport only deals with cross domain or forced-by-attrs requests
	if ( s.crossDomain || s.scriptAttrs ) {
		var script, callback;
		return {
			send: function( _, complete ) {
				script = jQuery( "<script>" )
					.attr( s.scriptAttrs || {} )
					.prop( { charset: s.scriptCharset, src: s.url } )
					.on( "load error", callback = function( evt ) {
						script.remove();
						callback = null;
						if ( evt ) {
							complete( evt.type === "error" ? 404 : 200, evt.type );
						}
					} );

				// Use native DOM manipulation to avoid our domManip AJAX trickery
				document.head.appendChild( script[ 0 ] );
			},
			abort: function() {
				if ( callback ) {
					callback();
				}
			}
		};
	}
} );




var oldCallbacks = [],
	rjsonp = /(=)\?(?=&|$)|\?\?/;

// Default jsonp settings
jQuery.ajaxSetup( {
	jsonp: "callback",
	jsonpCallback: function() {
		var callback = oldCallbacks.pop() || ( jQuery.expando + "_" + ( nonce.guid++ ) );
		this[ callback ] = true;
		return callback;
	}
} );

// Detect, normalize options and install callbacks for jsonp requests
jQuery.ajaxPrefilter( "json jsonp", function( s, originalSettings, jqXHR ) {

	var callbackName, overwritten, responseContainer,
		jsonProp = s.jsonp !== false && ( rjsonp.test( s.url ) ?
			"url" :
			typeof s.data === "string" &&
				( s.contentType || "" )
					.indexOf( "application/x-www-form-urlencoded" ) === 0 &&
				rjsonp.test( s.data ) && "data"
		);

	// Handle iff the expected data type is "jsonp" or we have a parameter to set
	if ( jsonProp || s.dataTypes[ 0 ] === "jsonp" ) {

		// Get callback name, remembering preexisting value associated with it
		callbackName = s.jsonpCallback = isFunction( s.jsonpCallback ) ?
			s.jsonpCallback() :
			s.jsonpCallback;

		// Insert callback into url or form data
		if ( jsonProp ) {
			s[ jsonProp ] = s[ jsonProp ].replace( rjsonp, "$1" + callbackName );
		} else if ( s.jsonp !== false ) {
			s.url += ( rquery.test( s.url ) ? "&" : "?" ) + s.jsonp + "=" + callbackName;
		}

		// Use data converter to retrieve json after script execution
		s.converters[ "script json" ] = function() {
			if ( !responseContainer ) {
				jQuery.error( callbackName + " was not called" );
			}
			return responseContainer[ 0 ];
		};

		// Force json dataType
		s.dataTypes[ 0 ] = "json";

		// Install callback
		overwritten = window[ callbackName ];
		window[ callbackName ] = function() {
			responseContainer = arguments;
		};

		// Clean-up function (fires after converters)
		jqXHR.always( function() {

			// If previous value didn't exist - remove it
			if ( overwritten === undefined ) {
				jQuery( window ).removeProp( callbackName );

			// Otherwise restore preexisting value
			} else {
				window[ callbackName ] = overwritten;
			}

			// Save back as free
			if ( s[ callbackName ] ) {

				// Make sure that re-using the options doesn't screw things around
				s.jsonpCallback = originalSettings.jsonpCallback;

				// Save the callback name for future use
				oldCallbacks.push( callbackName );
			}

			// Call if it was a function and we have a response
			if ( responseContainer && isFunction( overwritten ) ) {
				overwritten( responseContainer[ 0 ] );
			}

			responseContainer = overwritten = undefined;
		} );

		// Delegate to script
		return "script";
	}
} );




// Support: Safari 8 only
// In Safari 8 documents created via document.implementation.createHTMLDocument
// collapse sibling forms: the second one becomes a child of the first one.
// Because of that, this security measure has to be disabled in Safari 8.
// https://bugs.webkit.org/show_bug.cgi?id=137337
support.createHTMLDocument = ( function() {
	var body = document.implementation.createHTMLDocument( "" ).body;
	body.innerHTML = "<form></form><form></form>";
	return body.childNodes.length === 2;
} )();


// Argument "data" should be string of html
// context (optional): If specified, the fragment will be created in this context,
// defaults to document
// keepScripts (optional): If true, will include scripts passed in the html string
jQuery.parseHTML = function( data, context, keepScripts ) {
	if ( typeof data !== "string" ) {
		return [];
	}
	if ( typeof context === "boolean" ) {
		keepScripts = context;
		context = false;
	}

	var base, parsed, scripts;

	if ( !context ) {

		// Stop scripts or inline event handlers from being executed immediately
		// by using document.implementation
		if ( support.createHTMLDocument ) {
			context = document.implementation.createHTMLDocument( "" );

			// Set the base href for the created document
			// so any parsed elements with URLs
			// are based on the document's URL (gh-2965)
			base = context.createElement( "base" );
			base.href = document.location.href;
			context.head.appendChild( base );
		} else {
			context = document;
		}
	}

	parsed = rsingleTag.exec( data );
	scripts = !keepScripts && [];

	// Single tag
	if ( parsed ) {
		return [ context.createElement( parsed[ 1 ] ) ];
	}

	parsed = buildFragment( [ data ], context, scripts );

	if ( scripts && scripts.length ) {
		jQuery( scripts ).remove();
	}

	return jQuery.merge( [], parsed.childNodes );
};


/**
 * Load a url into a page
 */
jQuery.fn.load = function( url, params, callback ) {
	var selector, type, response,
		self = this,
		off = url.indexOf( " " );

	if ( off > -1 ) {
		selector = stripAndCollapse( url.slice( off ) );
		url = url.slice( 0, off );
	}

	// If it's a function
	if ( isFunction( params ) ) {

		// We assume that it's the callback
		callback = params;
		params = undefined;

	// Otherwise, build a param string
	} else if ( params && typeof params === "object" ) {
		type = "POST";
	}

	// If we have elements to modify, make the request
	if ( self.length > 0 ) {
		jQuery.ajax( {
			url: url,

			// If "type" variable is undefined, then "GET" method will be used.
			// Make value of this field explicit since
			// user can override it through ajaxSetup method
			type: type || "GET",
			dataType: "html",
			data: params
		} ).done( function( responseText ) {

			// Save response for use in complete callback
			response = arguments;

			self.html( selector ?

				// If a selector was specified, locate the right elements in a dummy div
				// Exclude scripts to avoid IE 'Permission Denied' errors
				jQuery( "<div>" ).append( jQuery.parseHTML( responseText ) ).find( selector ) :

				// Otherwise use the full result
				responseText );

		// If the request succeeds, this function gets "data", "status", "jqXHR"
		// but they are ignored because response was set above.
		// If it fails, this function gets "jqXHR", "status", "error"
		} ).always( callback && function( jqXHR, status ) {
			self.each( function() {
				callback.apply( this, response || [ jqXHR.responseText, status, jqXHR ] );
			} );
		} );
	}

	return this;
};




jQuery.expr.pseudos.animated = function( elem ) {
	return jQuery.grep( jQuery.timers, function( fn ) {
		return elem === fn.elem;
	} ).length;
};




jQuery.offset = {
	setOffset: function( elem, options, i ) {
		var curPosition, curLeft, curCSSTop, curTop, curOffset, curCSSLeft, calculatePosition,
			position = jQuery.css( elem, "position" ),
			curElem = jQuery( elem ),
			props = {};

		// Set position first, in-case top/left are set even on static elem
		if ( position === "static" ) {
			elem.style.position = "relative";
		}

		curOffset = curElem.offset();
		curCSSTop = jQuery.css( elem, "top" );
		curCSSLeft = jQuery.css( elem, "left" );
		calculatePosition = ( position === "absolute" || position === "fixed" ) &&
			( curCSSTop + curCSSLeft ).indexOf( "auto" ) > -1;

		// Need to be able to calculate position if either
		// top or left is auto and position is either absolute or fixed
		if ( calculatePosition ) {
			curPosition = curElem.position();
			curTop = curPosition.top;
			curLeft = curPosition.left;

		} else {
			curTop = parseFloat( curCSSTop ) || 0;
			curLeft = parseFloat( curCSSLeft ) || 0;
		}

		if ( isFunction( options ) ) {

			// Use jQuery.extend here to allow modification of coordinates argument (gh-1848)
			options = options.call( elem, i, jQuery.extend( {}, curOffset ) );
		}

		if ( options.top != null ) {
			props.top = ( options.top - curOffset.top ) + curTop;
		}
		if ( options.left != null ) {
			props.left = ( options.left - curOffset.left ) + curLeft;
		}

		if ( "using" in options ) {
			options.using.call( elem, props );

		} else {
			curElem.css( props );
		}
	}
};

jQuery.fn.extend( {

	// offset() relates an element's border box to the document origin
	offset: function( options ) {

		// Preserve chaining for setter
		if ( arguments.length ) {
			return options === undefined ?
				this :
				this.each( function( i ) {
					jQuery.offset.setOffset( this, options, i );
				} );
		}

		var rect, win,
			elem = this[ 0 ];

		if ( !elem ) {
			return;
		}

		// Return zeros for disconnected and hidden (display: none) elements (gh-2310)
		// Support: IE <=11 only
		// Running getBoundingClientRect on a
		// disconnected node in IE throws an error
		if ( !elem.getClientRects().length ) {
			return { top: 0, left: 0 };
		}

		// Get document-relative position by adding viewport scroll to viewport-relative gBCR
		rect = elem.getBoundingClientRect();
		win = elem.ownerDocument.defaultView;
		return {
			top: rect.top + win.pageYOffset,
			left: rect.left + win.pageXOffset
		};
	},

	// position() relates an element's margin box to its offset parent's padding box
	// This corresponds to the behavior of CSS absolute positioning
	position: function() {
		if ( !this[ 0 ] ) {
			return;
		}

		var offsetParent, offset, doc,
			elem = this[ 0 ],
			parentOffset = { top: 0, left: 0 };

		// position:fixed elements are offset from the viewport, which itself always has zero offset
		if ( jQuery.css( elem, "position" ) === "fixed" ) {

			// Assume position:fixed implies availability of getBoundingClientRect
			offset = elem.getBoundingClientRect();

		} else {
			offset = this.offset();

			// Account for the *real* offset parent, which can be the document or its root element
			// when a statically positioned element is identified
			doc = elem.ownerDocument;
			offsetParent = elem.offsetParent || doc.documentElement;
			while ( offsetParent &&
				( offsetParent === doc.body || offsetParent === doc.documentElement ) &&
				jQuery.css( offsetParent, "position" ) === "static" ) {

				offsetParent = offsetParent.parentNode;
			}
			if ( offsetParent && offsetParent !== elem && offsetParent.nodeType === 1 ) {

				// Incorporate borders into its offset, since they are outside its content origin
				parentOffset = jQuery( offsetParent ).offset();
				parentOffset.top += jQuery.css( offsetParent, "borderTopWidth", true );
				parentOffset.left += jQuery.css( offsetParent, "borderLeftWidth", true );
			}
		}

		// Subtract parent offsets and element margins
		return {
			top: offset.top - parentOffset.top - jQuery.css( elem, "marginTop", true ),
			left: offset.left - parentOffset.left - jQuery.css( elem, "marginLeft", true )
		};
	},

	// This method will return documentElement in the following cases:
	// 1) For the element inside the iframe without offsetParent, this method will return
	//    documentElement of the parent window
	// 2) For the hidden or detached element
	// 3) For body or html element, i.e. in case of the html node - it will return itself
	//
	// but those exceptions were never presented as a real life use-cases
	// and might be considered as more preferable results.
	//
	// This logic, however, is not guaranteed and can change at any point in the future
	offsetParent: function() {
		return this.map( function() {
			var offsetParent = this.offsetParent;

			while ( offsetParent && jQuery.css( offsetParent, "position" ) === "static" ) {
				offsetParent = offsetParent.offsetParent;
			}

			return offsetParent || documentElement;
		} );
	}
} );

// Create scrollLeft and scrollTop methods
jQuery.each( { scrollLeft: "pageXOffset", scrollTop: "pageYOffset" }, function( method, prop ) {
	var top = "pageYOffset" === prop;

	jQuery.fn[ method ] = function( val ) {
		return access( this, function( elem, method, val ) {

			// Coalesce documents and windows
			var win;
			if ( isWindow( elem ) ) {
				win = elem;
			} else if ( elem.nodeType === 9 ) {
				win = elem.defaultView;
			}

			if ( val === undefined ) {
				return win ? win[ prop ] : elem[ method ];
			}

			if ( win ) {
				win.scrollTo(
					!top ? val : win.pageXOffset,
					top ? val : win.pageYOffset
				);

			} else {
				elem[ method ] = val;
			}
		}, method, val, arguments.length );
	};
} );

// Support: Safari <=7 - 9.1, Chrome <=37 - 49
// Add the top/left cssHooks using jQuery.fn.position
// Webkit bug: https://bugs.webkit.org/show_bug.cgi?id=29084
// Blink bug: https://bugs.chromium.org/p/chromium/issues/detail?id=589347
// getComputedStyle returns percent when specified for top/left/bottom/right;
// rather than make the css module depend on the offset module, just check for it here
jQuery.each( [ "top", "left" ], function( _i, prop ) {
	jQuery.cssHooks[ prop ] = addGetHookIf( support.pixelPosition,
		function( elem, computed ) {
			if ( computed ) {
				computed = curCSS( elem, prop );

				// If curCSS returns percentage, fallback to offset
				return rnumnonpx.test( computed ) ?
					jQuery( elem ).position()[ prop ] + "px" :
					computed;
			}
		}
	);
} );


// Create innerHeight, innerWidth, height, width, outerHeight and outerWidth methods
jQuery.each( { Height: "height", Width: "width" }, function( name, type ) {
	jQuery.each( {
		padding: "inner" + name,
		content: type,
		"": "outer" + name
	}, function( defaultExtra, funcName ) {

		// Margin is only for outerHeight, outerWidth
		jQuery.fn[ funcName ] = function( margin, value ) {
			var chainable = arguments.length && ( defaultExtra || typeof margin !== "boolean" ),
				extra = defaultExtra || ( margin === true || value === true ? "margin" : "border" );

			return access( this, function( elem, type, value ) {
				var doc;

				if ( isWindow( elem ) ) {

					// $( window ).outerWidth/Height return w/h including scrollbars (gh-1729)
					return funcName.indexOf( "outer" ) === 0 ?
						elem[ "inner" + name ] :
						elem.document.documentElement[ "client" + name ];
				}

				// Get document width or height
				if ( elem.nodeType === 9 ) {
					doc = elem.documentElement;

					// Either scroll[Width/Height] or offset[Width/Height] or client[Width/Height],
					// whichever is greatest
					return Math.max(
						elem.body[ "scroll" + name ], doc[ "scroll" + name ],
						elem.body[ "offset" + name ], doc[ "offset" + name ],
						doc[ "client" + name ]
					);
				}

				return value === undefined ?

					// Get width or height on the element, requesting but not forcing parseFloat
					jQuery.css( elem, type, extra ) :

					// Set width or height on the element
					jQuery.style( elem, type, value, extra );
			}, type, chainable ? margin : undefined, chainable );
		};
	} );
} );


jQuery.each( [
	"ajaxStart",
	"ajaxStop",
	"ajaxComplete",
	"ajaxError",
	"ajaxSuccess",
	"ajaxSend"
], function( _i, type ) {
	jQuery.fn[ type ] = function( fn ) {
		return this.on( type, fn );
	};
} );




jQuery.fn.extend( {

	bind: function( types, data, fn ) {
		return this.on( types, null, data, fn );
	},
	unbind: function( types, fn ) {
		return this.off( types, null, fn );
	},

	delegate: function( selector, types, data, fn ) {
		return this.on( types, selector, data, fn );
	},
	undelegate: function( selector, types, fn ) {

		// ( namespace ) or ( selector, types [, fn] )
		return arguments.length === 1 ?
			this.off( selector, "**" ) :
			this.off( types, selector || "**", fn );
	},

	hover: function( fnOver, fnOut ) {
		return this.mouseenter( fnOver ).mouseleave( fnOut || fnOver );
	}
} );

jQuery.each(
	( "blur focus focusin focusout resize scroll click dblclick " +
	"mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave " +
	"change select submit keydown keypress keyup contextmenu" ).split( " " ),
	function( _i, name ) {

		// Handle event binding
		jQuery.fn[ name ] = function( data, fn ) {
			return arguments.length > 0 ?
				this.on( name, null, data, fn ) :
				this.trigger( name );
		};
	}
);




// Support: Android <=4.0 only
// Make sure we trim BOM and NBSP
var rtrim = /^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g;

// Bind a function to a context, optionally partially applying any
// arguments.
// jQuery.proxy is deprecated to promote standards (specifically Function#bind)
// However, it is not slated for removal any time soon
jQuery.proxy = function( fn, context ) {
	var tmp, args, proxy;

	if ( typeof context === "string" ) {
		tmp = fn[ context ];
		context = fn;
		fn = tmp;
	}

	// Quick check to determine if target is callable, in the spec
	// this throws a TypeError, but we will just return undefined.
	if ( !isFunction( fn ) ) {
		return undefined;
	}

	// Simulated bind
	args = slice.call( arguments, 2 );
	proxy = function() {
		return fn.apply( context || this, args.concat( slice.call( arguments ) ) );
	};

	// Set the guid of unique handler to the same of original handler, so it can be removed
	proxy.guid = fn.guid = fn.guid || jQuery.guid++;

	return proxy;
};

jQuery.holdReady = function( hold ) {
	if ( hold ) {
		jQuery.readyWait++;
	} else {
		jQuery.ready( true );
	}
};
jQuery.isArray = Array.isArray;
jQuery.parseJSON = JSON.parse;
jQuery.nodeName = nodeName;
jQuery.isFunction = isFunction;
jQuery.isWindow = isWindow;
jQuery.camelCase = camelCase;
jQuery.type = toType;

jQuery.now = Date.now;

jQuery.isNumeric = function( obj ) {

	// As of jQuery 3.0, isNumeric is limited to
	// strings and numbers (primitives or objects)
	// that can be coerced to finite numbers (gh-2662)
	var type = jQuery.type( obj );
	return ( type === "number" || type === "string" ) &&

		// parseFloat NaNs numeric-cast false positives ("")
		// ...but misinterprets leading-number strings, particularly hex literals ("0x...")
		// subtraction forces infinities to NaN
		!isNaN( obj - parseFloat( obj ) );
};

jQuery.trim = function( text ) {
	return text == null ?
		"" :
		( text + "" ).replace( rtrim, "" );
};



// Register as a named AMD module, since jQuery can be concatenated with other
// files that may use define, but not via a proper concatenation script that
// understands anonymous AMD modules. A named AMD is safest and most robust
// way to register. Lowercase jquery is used because AMD module names are
// derived from file names, and jQuery is normally delivered in a lowercase
// file name. Do this after creating the global so that if an AMD module wants
// to call noConflict to hide this version of jQuery, it will work.

// Note that for maximum portability, libraries that are not jQuery should
// declare themselves as anonymous modules, and avoid setting a global if an
// AMD loader is present. jQuery is a special case. For more information, see
// https://github.com/jrburke/requirejs/wiki/Updating-existing-libraries#wiki-anon

if ( typeof define === "function" && define.amd ) {
	define( "jquery", [], function() {
		return jQuery;
	} );
}




var

	// Map over jQuery in case of overwrite
	_jQuery = window.jQuery,

	// Map over the $ in case of overwrite
	_$ = window.$;

jQuery.noConflict = function( deep ) {
	if ( window.$ === jQuery ) {
		window.$ = _$;
	}

	if ( deep && window.jQuery === jQuery ) {
		window.jQuery = _jQuery;
	}

	return jQuery;
};

// Expose jQuery and $ identifiers, even in AMD
// (#7102#comment:10, https://github.com/jquery/jquery/pull/557)
// and CommonJS for browser emulators (#13566)
if ( typeof noGlobal === "undefined" ) {
	window.jQuery = window.$ = jQuery;
}




return jQuery;
} );

},{}],55:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "MPEGDecoder", {
  enumerable: true,
  get: function () {
    return _MPEGDecoder.default;
  }
});
Object.defineProperty(exports, "MPEGDecoderWebWorker", {
  enumerable: true,
  get: function () {
    return _MPEGDecoderWebWorker.default;
  }
});

var _MPEGDecoder = _interopRequireDefault(require("./src/MPEGDecoder.js"));

var _MPEGDecoderWebWorker = _interopRequireDefault(require("./src/MPEGDecoderWebWorker.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

},{"./src/MPEGDecoder.js":57,"./src/MPEGDecoderWebWorker.js":58}],56:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

/* **************************************************
 * This file is auto-generated during the build process.
 * Any edits to this file will be overwritten.
 ****************************************************/
class EmscriptenWASM {
  constructor(WASMAudioDecoderCommon) {
    var Module = Module;

    function out(text) {
      console.log(text);
    }

    function err(text) {
      console.error(text);
    }

    function ready() {}

    Module = {};

    function abort(what) {
      throw what;
    }

    for (var base64ReverseLookup = new Uint8Array(123), i = 25; i >= 0; --i) {
      base64ReverseLookup[48 + i] = 52 + i;
      base64ReverseLookup[65 + i] = i;
      base64ReverseLookup[97 + i] = 26 + i;
    }

    base64ReverseLookup[43] = 62;
    base64ReverseLookup[47] = 63;

    function base64Decode(b64) {
      var b1,
          b2,
          i = 0,
          j = 0,
          bLength = b64.length,
          output = new Uint8Array((bLength * 3 >> 2) - (b64[bLength - 2] == "=") - (b64[bLength - 1] == "="));

      for (; i < bLength; i += 4, j += 3) {
        b1 = base64ReverseLookup[b64.charCodeAt(i + 1)];
        b2 = base64ReverseLookup[b64.charCodeAt(i + 2)];
        output[j] = base64ReverseLookup[b64.charCodeAt(i)] << 2 | b1 >> 4;
        output[j + 1] = b1 << 4 | b2 >> 2;
        output[j + 2] = b2 << 6 | base64ReverseLookup[b64.charCodeAt(i + 3)];
      }

      return output;
    }

    Module["wasm"] = WASMAudioDecoderCommon.inflateDynEncodeString(String.raw`dynEncode008diJ)ëò
t
ë{dÆYi Ùó³&­tËÍÝ'Ñ×Ú[ÏÞÎbû,£:âÇ º Ï£D &Nú+"ôóÝ~@õÌ~>ñX4âG­¦DA;jÚèBåé(7âgßb{ïÒ?llG[ÊÙM:fMit)xJ<HÄl½}øîàÉÂÂ¢Ûj¡füuË´jtqÚ²E¡ 	"4³414³"ÏÒ1()qÞãÿ+nký|Ú¢=}Ï´³3O´gÒÛwÿetbYrÚJÄ"á.K7Qõ<ïw.a÷	Âä,náÞº	 s­oºÎÌLLÕ8l©KbÏ¶
(KÊ5} ÝÞº ç0«dw-fyæá§JmÝa@?8ÈÙãRÞÝ0-ÅçêG7Bµ;B­Û/Å»Î©ßñ¡^æÊ¼P@Xç²
.oß¶o¿Lî¥ê]Î²åë;Ód¢ÑN?Åú"Wnºnr×¥ÛÔ= Þ2[ýq´Kõ!á\6L©nõ=}¾©kªÈ±	Ô}nÈî¸N<ñwèO­ |OVJ° ï\úHº	Ü8êüIÿTv}W¸;%pzD{§Lq#ìtÈûr(lCnv;<JD	ä4Þáï%0:^cÁÅÄK²¸ìVëüÜXü/¼ë§qZ>¹é qà:%ñàöx8?ß«22ê$ä2Ng5ìÌ8<ãc)B3¼ã²k¥:ÛíàiáÍc_Eß32ÉjB¾/uÓÕÏÒ;= \^¹g¥bnÞ¯b}{yhûß1îkÈ'×"ß«ëÎõEËuúRþZ^ÂÎ§tNøib	 ËbXxg5a_Ím<÷¦ES8_½ºèÔ3{)UW	ÓðLÖÞçË¿'ÝÓ§§Ec¸[P^´ÃRD´öÑ¼ñBëîöoØ­Öpq¼H/á|±j¯¥X·=Mâ§ÆöCyXGÔ|×pyüßØv[volaKãä§º±ÚÓ_:ógÊ_-bôPá§fýmÕñÅ+b5Ê{ñ²Æguñ'þZBzO¤yX§K7K;ÜÈL;¨cUÔË±jlw÷ÑAqgÃm;=M¯¸-X¢Ýwµ­è.¤âtøâÞ§xvPÜkw§Õ\Í13¥£¹7 RÝã1¡öAAE= ¡r.>'
6­@Þ¨¶J¬ÓV-ÙÖ'é("l"#W{0 Ô?ÿkÈcyV(ö9âÛ¸tSü¹ÓøèYMÅkUÝá:ðÁ.hG<Z7¡âÒâ:µsîÆy×hÎäÀÚh'BtÚ¥§iVë±6Â¸ÚóX|Èík­iL  ¡kbwÖ ¯u³@A!Ãé#£nj6ß<Wrd¬²ò3ÜÝ^X·xS0öüg_96u«¢QñÛH1
ãí,úcôr»4Qùýn72^AÉW1uÌÚyAüïG´@.AÃÖê'-¢X_xHoS0 Á®¦=MèÇ)GùÆ½ÒvÖ0AÔÖÈbÈ]3¸vÚ:ß}Ò»4X4§kØv|6_³ÙÙÝªb8¹zòR¡,¦C¹çòn=}ñXãO§|ï9C½ó²+	Náp0¢øË~?ì 19âç×Æj1 õ¡NÂ2:­J¥¸Ç	*,9Y{×;9ÀãÑs´^9Y¹7qvõã¢ëÖjô ýØàøK±:åJ*¨üÕxtSB°NxwÀbÜ ­9+#¢VÝ§É'çF=MV_^zô&f÷L#óüoô*Æ1×àÌÙñ®ÊX·áäº×SïÃyðúV"îìÐhÐE¶c]BU·-âý
Oå>ºöúP¡ñY#.DÚ-ñe8|@õ
^µ«.Ó	Z§@éì±Cåëªl5ÜúÈ¹YC^W-2IC(ú{kB¸:yóIÛãT®·hP]±V¬Ôî&'ù|¸ò>úþç9ª´<vH)ÜD
æhÑ)?´ÑyÖùÑÉ÷gyÙÐzù¢0'¦áÉ'fÖÁ«2ýËù(Þã93²ò2ßXÛíìòÐ)¥Ü°òqÂaã(Óùá²E?=M¶§ÈkP3î(ýã§IÊ0övã¿ÒHT|=MÖøA´Øa}ÉßùÕyLôc£¯CéÆ)ñþëgZ~L¶^
Ânûzõ|vñz{pl@Ìóe]¬JøÌ0)±ÓòÇ;öÎ¼2Î¢8qêîÒqþ¢(~ç&ùâ&hÏãæú_.Q××o·ü æj4(=}þ= _1}qæ÷c"µºxä@¸­$Ø<½_B.U±ÍQ=}sèÔkr«(]$q¶õãïJ ¹Tg/4GHÁ·z¶©ÞÖ_½)ÿaâí°c½´õkQ¢¶ Y#-¯¯b¨qäéjªÑèðÕlìæÒqÙ[Q%¥\Ç<êÊ ¨= ¾rÜð§ªÊâBËp:öÂ:X9ÿ-â¾Í7öQð¨òZâÓÌ@&[÷÷ûU×jbÁ #ZæÊÆèC
ÞA¡=}ÆÙËJ¾êóæ'°n'bÆþru6üIÀV7­A{M âÍ!,£âkñReþ¸1¸×dÄw	¨=MîÍ@0XHN»K¾-ÝGã69¦&ÝSl¥iIÕ¦=}dÔ­vÉr¡n9ñ@õS¥ä¦àMâãa°±EÝ¢ÚSjQ&õV§3öK±÷;þ³¢;t>ÓÿUÏÍ+³	EFï¢ÀbßÜÔZÒ¶PV¶éÑ1øü'Á,5ÀØ¯ó,ëÏY§ÚUD%Uy_Cä1QÔ´øÂÿz«&G;Úìª°rKiã.ÚaSÒër/!¯éÈg_ziÎ<ìúX!÷R+KÚ£òxÇ/ºÆ>@õ°ÐÈUÛæ§lF!9´¦Qð8Á¯yP8	Þú±>Öcòºþg$&¡DÜ(äçgtÝaB'ÈAº@qDà²1föïÌdÐî£^ûÃjìyfÇì×eO..â0Ôh´?çúÈ¹0ÎÞ*¢ÎýÀR~E6"ÏåÍÈ¾Z¢·'Z×4°¶3ÇÉ/4Vó1Á!Ûö±£¶À¤*ç_µ¶ÅÞ=}Â8þô8¨Q¡ ¯·4ùÿâÇ÷¢)Å*8.Zaì/SÀîª£ÜÕÓµ¦¾ÒÝçÉòqeíÑç¸Õ2øL%Ë/Ó*&8N¨ù/JÍ]"#÷Æküã4åÍø<.ÓSêá(b:LRÊ ÄõÌ«E@Nçåw«neµ²?5= B
)ýB¥Þh£.nUÈÞ¯æÒ5«ß¶ô{WFD­×ÈéDM¤{M/8ÑC7;Ô.À:Ôªº7«B¢nwUÚÎ]$ªªvõØGæJ~À¼Ë=},0Ö÷Ùw0)Ã%^A5G@÷ô§þ½¶¦±2zç6Oª©a¨¹è©ò?nBezL²ÔÏËú±q³Çµ'W¬ÊÝº¹ª4êe	pØ±5ÑiÁ	t7qä0¥[VOÛµáÒ4ÏÀXüZ×üxµ8Ë[U±/JzP*LóÎ´]'·þªÄÀÇ±W°ÍõÍ$A4«ã>úA¾¦ÒNë²ÙÎur~"ÑSa¦;
Ã{íqâ$ÝïÈ©UÇnosr~EÛhB*qIúôóÈÁ©®ËÃ÷=MÏ¡é?iû¨<FEG= ÒÔYw¯nWO®u3õ÷C@Dlgü8/aõê¦!4·ÄÉÇÿjg)1ÔÒßDÏhïvÛÕÊ'{.6XÐP*ßà"þCl  xOýÏôP&ÕùHpt¨ÌÇ\ªkT"ÜüÆ!hÓ»¶R¨ûº6° {$<[f¬I}C$L1VYly]nÐ,×;°ì¯ªcÜP!ýñÜ¬	\¬vìÎý«vB<ùz¬KJZKÈC©k¼{dlýP|¸¯ÅÑælÁª´gyGõü§ÉY)=}ÐÅz@	y¬ðµPXíCvv¼½ÌÏUL'ÓÌÇD×ÓÊË1ðßZÉ¾êoEFúõCxe7\¤¼/d42ÐZC²Fà=}rÝ }ôçG8qØlÅ}«8±WÜÉþy[ä£r<¹W«/Dþx"à ìæÃÜW°¯5ª5·ª¬þcB|fwxM¯Ê© :Ã¼ó»QYç}Yþhé»}-W?dN (tºV²pñq¶^ì9\MêÆªùGCDH ¥×^U2¦Ü--ÿ¼*=}¶K,Æ¦9$¿ëÕöÅ%1­ U¥$í®#°üdcþÆìÙn9ì±	P¦ë5ªõtmÀmïÐÈC&¦×ÁÉÏªè´¬EtiÞð[FZÈÑÒZfð¾§Bj]èvëCÈ?eèÊúyt®/ç)hÍðèÿ©QÎèp¯-r(±unÕ2éoiRV¼oj"ît0HÅ·EÐôþW=}DîJÂßy:ìÅSkyúBa#ûßCóðASJ:j¥:üxÃO3CD¨0{zo^R{úSõ@Hð¶ºhÇ3#CÎýÑÙÕ¥jÏÐ]F½ 5Âë?ÕÕTUGIrÏDÐºzÖÀÁüünJN%£{ëáØÚÙ4¨ú§È½Ì«wENÃâ ú9ïw=}º J´á>ß$³^-éÆ)Ìd8±çíªDì2ªY´úæ"lº² âm=}»Öý¤Ù;«[,zÂ#ÎÝªÊÇÿ~êT´èù´{è©44ÂSÖÉSLê!ØÔñW¨·¦n,©ÐEÔ'¿y§'¼:Ûkga-¥êÞo¹*ÌýÛö@(*Þ_9º@ùìÀùµïªFm[Ì y©²G> ArsýIê´Óã^íBp5q ã¿@Ð@Ôôì¢):÷ã$°ñ¬þ-Ò ñ¾tÐÍç¦ôÇæÀ0-2~æQEÀøÏøyÇnâM"æ¢Ï©Û/ìÆI*¨b_¨ªJ>~;3ù~ä4b½è§J0LªPæJ#Þ¶·àÕ)äÔQ!@ñý Wâù¿½Äh¾Ù¨õ¬Þdµ3.;a¬R8¥*t+¹ýI´ÏùÔd6ÑÞO¼8ùw@ÇkàÆ\ÝH}½ê¿«4ãòVÔ-WjñÕoDFV]å9(¯ñÅgìÑhÿÓCÝðº1DØÖÜ_]î)&cª:¶Gòi3»>RÆw¿}Hn¨þEÒÇÖqÒÜÚôrÊ¹¿Ûµ¨ßz¬üaÓÒÄWÔ?U}\¦rê|¿f@à9Ö$×÷úq¸æ+½Fªo5­8Æ·¥ÁgCx°¬i0ò,Ut»Zìgïñè÷]ôØhp¸kJ@ËÕ't;@ËüÏ(Þ^CÌ©M>l
XËOì4+ÊjÙëX7¨Ì"94»5.~ÉEÏÉ? ´´<«ä]éÌäe^= Ðä´Ì/ý¯ë¥¾gPyâ+{h¤@2­FÑþCùóý·u-FÑ(ÐÁ$KËÇÕ7q>ßª°-Ã.bÖ.¬·Éâàab³J	ê»øÞê+#gwWB7£U¸8Kêä´BãaBÝ"°L)ecÈu½Ûv=}Uu¹ä0JHãf¨¤/¯ÊÂÑUß³ÎÇ¯ñJô¤1åFGûû´ ÔÞÆ£ ü¢åqu?©qf\ëf<p	»wÔ¦Q«ûèÝQ'ßU*S _&DÄ¶ßj5=}¨	·¸®"ðJ§á­¡ÂqþIÑp&%°ë3jü)~E<X½=}Ap!Ð!ó°IàÍ§)¤ú,Sp_ùfÙãkùðMtóEªÉ»[Gó?góU£j=METG¹&V7(®ý¹úc8T'9¾ âÃÐæõTwùÙcD¦/VÏ\~u\['Vë?¦ú:¢»?9Ô°¨)VÃ?c?@µò¸ô?â(²´Å[yÿ¯H= ¢ÀÕwÀ¦üCC¿êË ºhù?ÇeFôÓÚ5ükÏËP7dãùµà_Q&ÙÃØNînwAÓzxf¤n9Mãû#;vfÀ¦R±(2h=Mq+xj©Âp¬»A@¼E$$sF$Â0{r)	kJI¹eJIÉ]J9Z,øösl¼8ÜG5 ¦Frý	Kö,æ»Q@_Kõ³Ìîö@FyI¦ÏW@ÄêUméÙC»
ÖOòøYò~:'V,ÿ¶_FùJ©@= »-Â$ê½À êÅ tå³°&Ö¶	19¶Â<%î_{f!»¯¸uÿ«1¼ôßWéVè
Ã2=}!ucYé#Zñ<Ùp/* w= µB(ÕR= ï71PöÃ(¸Å*(f©Ú@ú·ï:>=}GÏ¹°[;?]ó_.fF9ü#ÖbÍõé&Öä~ÊÉ(òvF#ä²\*Ö o·@ÙnóSÙgX¤b¦u7FÑThTèåz-å*óö£>¶N8!7å¸7Tãk¹On¿À$"ôãìKñ#¶â0ht?gùC ;Ú_×eÚ|[òj@=}Bß3b÷mw²-ËÀX'= ZþëA¨å9=}(¥ÿÞPÃñÍÍ¿¶ï*ù*SÅ¸ÊÃº@M= 5S/£­¼{/æã0åÜ8á	Èv¡ð¬ÌT!µLL0o8.¯ÃEÄå%Ûã
D)ö]$K6ãî6Ý	òÓtÒ !50
I3¸~WÍÎÒ~ûÒNáQRp~=}=}û¶n½öaÆA/[Õ_µØ½ªß%çÊ¬·-Þq­Eî2fÙQó¯hùîÝÔvàø¾Ç×k<¼º×K#ÌâÆDØ;æ¶o1 þ6¸ß ×\=}ÙÆ
6®45ñx¬K^©]h²$9¡ðFêVèºÙápGÏ2ÈÈ
Ògw=M-×kã!IþPµÍO)/qÍ2}ú;múãýì?Ò0/?Ód¯­D ËTÑ*Ûº{óØC·gôõ»yV4,z\;êV´Ïh91ÿò¿4öo+½R&r^¼ÖénÁ6Å:Ë½Üu¶5Ñ¤e$ÙPxåÁ	â}¦¹*cÓ ×&ËóÑ	wH±úê¿·ù ®Vpj3¨i^ªâ37 c77±	¥ÖÎB¦àî¥]¯ðÅ)vÝ ~fw"S§DÑ¡§TpÕP&kQÎýRìn<Ð,µêº«(°Q]=}aNÊÝ16>¨z¾ß4'pg/ä]yôÙöMbÔÏV¹©éÇí;å!ãÕ-2¸/R «¹K= Mþg®¢pÄ¨t)s[L±ÁïÎ7¬òÛ;v/³çß=MY"èHÔU&¹P:GxÈõGAðHaÖc<%4Ýí­,)÷DÕH= ù­/«A¬úå¯B÷Åc7´½Âú©+Á£á¶<´Ü]õxò,¸Tti¼ìÄ©{+ L³÷¹r+qä¶Z·*VXû4Ã[æ6ÜvÎd"Yê(,Q8ôsót»vÜÉù	Ø¤DõîË)ÜlÁÚ5Z[÷ßçä\Ê¹G2ò£H0iÌd>Ó×múìÚsMû¨se¼N<^l¬+>MW,LÑýèÑ'=MP'¿ÈÛ¦éäe!	íË©bk\a·t«ñ7|¹¨($ mt?«újÇ0p¸êª?Sö¯Ê»r¸7Ô0=} csó2~Ò®ùÁ(è¤È[)Ñ §Âx½lò°l
P8t»Hn¢Èv9XW¬ÊédêvÉ.TËEÿXªe}*Í"Ó¢ö³z&*²B^{ê#
aHÿçLìGZCXò}_m©!]ãO­ô_uDÈ8!oÔZ3ê@@ßÊº³x(§¶¿) «m¹½¼ó¿ÝÚTØÙ[J²á>ù|¸x?ØÌ>"À_K'ÕÃèë8~î÷	"v~´Aø@L§÷!²úx¦*« (È'±t>ÊGá®Æ»¾íû<__».'_e+ÙõaEuPS{ÒùÏÝKHº:Ì¿8»"-BûùóÞê1;D©	qeÜöÝeyòÐÄÐðºî´¦AfÂêWFXÌPPø(IÆfçÂ&à¸÷Ó5®(²ÙYZÝs¼2ÌY«iºv#§«)½¯èðÍ·a)¥ÁëYÔ+µ ÓC¸ÑÕ¿;¬ÒïÉ×üPV®{%¿S0·/×CüßÙTëICÒ®UrÔÔèíªa;U7ª
ñ[J± -6A»dðyHX±X5fúÎ /'Ö9ðÂ;¢³ÖküÃ*ä3¹N¢´ÔcÃ~ZzPVè^­ÚI¼Üf¤/3-BC
æAYcftÙìi
2Msäüê,eÌ°U.	=Mß-Cª³hgµ1©ß°^÷¸Ð%ÛÐ & ¼õa±íýGàSáÏª§qVõÈÅÛÿÞ4ÀÂÛÒ+yïòÃÃvY%vÎ8Í³û4Ç*ö]¾ß½Ô2Î1·hgûº*Æ3´ù²%s¥Ü£³a]5¤íRöAn%an)ï'¾êÈîßà&.ò1!1Áç½î_ã<·.ëâÈYa8QEwâ±wâ²a8¡¢Ò7ò±1ëòwÕÞèòÛµiásaÉ´Q-È0u%R· ò4¿t2èÛ¯øcN³£¡ÞVK:°9øÚ~¨¾G0Óöÿ&ÃæsRÆ^r$²~ÇC½ ­àAUo³]]0QFw3Ñ¯6Ôö ³[n¤ O_Ð(á²bE~;6ûA*bÙ/Ê/åuj!ñlïg_Aþúë-cÑ$Ûÿ^i~Ç!3ðö:$Õ\ñ0ø*S&Y'ßk!±ÙÁ= N¯9DÇH= \Ülg)Í{í ßD% ® Ëy¶ 1ûÛ4( ª·3Ó¦Ctes ¤e*åPBo÷!/QÔG´Ïÿ´dÅæY­Qòv× ·ã=MáYÐàGøÑ.PÉÛf³ :0ï$9QõÙææú­°íéÒÞÆíÝòr¾P6ÛëuÏmcä¨= jÚ·²u¿"í154½ O½£7]&#*×?wáá,·Bäbøeá<Ù= àÔ¦ë¦ðÓçx#Lv'}NþT&·â©ç¨0ø­OÄO;7s(Ôîa%-6êÿÍ×ùB4ÊðýÞ¤Âjw~Twgu'¹V±ÕX·oÈ¾Ãt9ïG9:= #ÆÔ!Éìï°? lÍÀ%Zd$xö#b åõ=}T¸öï a}¥
´òJ=}Hø>$Î<¡ýx"~ð¤h"!<
.½ØG¹2«ÖBöRTÂA¤úJ!93±÷5Í¹MZÚ5C(mÞÖÈ ¶×í%âÂ'ñH-¼:÷,ÌÒe&ãç1æUu²HÉ=}=M*(·WC:A"S7=}dÉõGØ@K#ßö:ò# *½¹a®¥$..ö*Ô6Xj=}_=}òbTyóRªü¢°Öô;¾w'7eÍP¿-æ·J'nW¼]ÅÔ5^^)×v»(ówkµ¶@= rG­/Gêp·Ø¨4!çªwQCÒ= ÁÐ	= =Mi!v¤DTg¯*d£gÓUÚû,ßUãÚgú:rA"Z9,.\Ì[\8;{ãøù:à¡ »\¼fÆ'¬5âvÙ÷aèÈøÿúdBXHî6Õìèû¼ú©Ú&= ³®qÀkÊ/g¡üÂÏzÿb¯p¥CGs\¸ÕÆHH&'fêp1N'âãt¨~nãu{uÇ¹à'ëN¡nòç\)y\d;Á÷= y¤SúxvªÌq¯êQ¿É¥xö"ãÊ¸¸ÊÊÊ¸·W~¢¢n¢²°±ÏÝÜBôÒ?ÁCÖÖ=}JHku4@^£ù'°kÎ¬­å»ñ]à q0Áé; îºNÊg8-I£Ëã£¬Y¨Õ´jdÜÎð=}Íc¥uYAïÞ³-vÏËVlbPº<z/p+µóÃ]§1Ç?¦}÷kU×TÅÜ«ÞªUSÇ:%9ûý1Ó#Q­¶q:¨Ë§E£Zó¬u6>ïÁHÀc_ÖÁÁüØu!ÞÜawûÍ ¼ma7>?ýoNNwÙÎáÖ©ç";Ã½îé³g®ºÞEq	ðÓë;õ4ÇÇ=}Ä¨íOÁÁôyÅ+ÜÄft¹qlµ±:Ñ7{«Û%äö@&B9?= Á¶8½VHGÂQ^×§­îÊ=}zÇÑÇ Ä^AÍ í¨¸ãUWÿÙôÖ×^êéqdïí÷Ú:ªo5Â1ÜëZû\(uÉQbÄ>U ½?l0ùnôÕ°z­Qeü¾Ñ"ÂMÂ"ð5#=MÍµ¢
ï".º
n½ÅjÁPM½®MÝ38KWá­ìFêÃeáÒ½Éb¯åÙ5Ø×G
ËEB¶+¾-A¨)&UËºu ¬Î'
XñäN_ÚLÁeQÕ2¸µëñò¢Hz"OCÁÚ?±9S«ç$= òÙÕÖdÓ1ÌU.ïÁ÷pmÅ¯10Öm×Òô7¶çµ	B÷hÒ¨CÜAªÑIÝ¯07âw	|s1-èÖéÙØd:X¥j=M±z¿rûªI}A\A³õ*°àÄêj=M\[x²'úí±/Ñ©¸ºÞç±?;ÂÂ0ócÃjVd/6UxÃÆl¯M|fýÃEúlð,Tì³ßÿ´l	f.ozB5û½ªÝUBÏ0vÅ=}z¤l?wZ,ùëUnÐ<oÅ¿}NÏ´ÒªÞÛNb	+@ ¡®ÔxÊ=}»1=MÆEy/-¸%:ûç}çÝÇ ·æÉ#JBÝÈvVüÓ8ryÕP³.ÊÂZæ®ò6ÿË|% ©0üúÔ6]ÀÙ^R(4|Â7,Ûaü¯C©ÐìÿGÝ¢!ÜÒ!ö67ë¾ëçþIBêl6óÖ/
	È¢8÷uä¡÷ºq=}Ç= 8JÆÀÛGf=Mw3_zóïmxé,q¤/E²ßÇ±©=M9©ÐÛç= Úú F¶f=M×ïø]Äyç[ÜQ÷Ã# M=MÉYDIýÃEaÌ®Aõð#	Çø´¹w\ _[owº*t	Pa[Òwñ7&fÈ1>µXnd+ÇÛ&Ð=M_;Üld§µC:ø?^õ¤î<Tåî¤ü R2JH¤}âöß×¶ê(³ê*Bz¶¤©e±ðê"Óg,íCIÚé	}B^ÛS*ÚÜzjù}Ï= 9^#¤÷M<î6c¹áÅó1Z¾.5FPÏ¤Î:Û¼ÑÇÕòÑÝµ«á^ßý1-Û°Ù¥L·8ôÚ¥C*éB" = Xgß»§ÑpÍaÏ¨mZCÀ7þùSóðFaû1¬ì_w»_îqNcÞv¿BÛ=}P@¹) UW/F¶»Ä] 6B1þÇhÇ¨÷¢ñ¾Z8U#A V?÷Áµªx}øÖ{ìÎuÀÐè§!Ì¸ð'GRUlóóM;Ì_W/Ü»:t&S¿ñ­§·+¢öQüÐò3$VO5ä'Pç"Ò¿RõÁ9z* æÊe°Ð¦KÁ1?rÀÞJüâÛNwÃ¨	+ QÐ0S­:®×ý8TH¹Ùvr-|Å¢0/vôù~Íà;õ!w½§]¾4g/R©=}WÄ_*8Y¿ÈX»µÜÿÂ©Àjµßgq Nþ¹*Ú)hq<'ÞZAÛ\J¬ÊÙ^+Î[SuQäí&+Á(ÐPänÖy|>8¶ÉJ[Õ*oøÛ= ÁÊd ÷¦*gÅ~ø0|­=}©
b®4&ÌÍ§po*ß·îGûÀz¸= Hù×w¡{Á7Sf÷å),Ið,#Ò) ¿ÙjÖ9ßù= ;ÀÚîÇwÛ¨ çmÝÉtÜ°ÜÛq;ÿóò¦tÃ4\#ÔØ¥¨BE¤q.8tÀ[>]_6²ÅHÉ¯ÅÌh¹½W2áTìjàÉUfÐÍ£/= zÜ3(&×àx= ìOÉÁ!Ô¢>DVn Ç«9Ø4ðÇvc$«÷û 4[õ°Ñ´ØMô"Uò\,>°¿x¤³BªÚjø_¹"ÝÿôÃe5á2¢z.Òû(
¨Y·C¨¢vØóñ}®Êò~{udÊ¨0¼eHg¾xjÁõñ§ÚPh{´wHM5¾!ÇiqÕÖÊ4£IøÂTÐ"äl,ÙÛKÇÇò(¾z±P?]ÑÒÄ¤º?ÔYÛîà{jx"ù]	GzW«%+ïË^¡´çÆÄÇÜE¶GìZ®n©×C(óÀñ=}= yqÊ%+¶¼öwYA°½ÚVæíðîX¶Så;Äã"¨F6±Ý¥¾"L¼ pñ:?tÅ?àÍò[&ÛÆTÄµæy=M®ùü,i®ñU­1ÞSÇâIö¤PÒ§Z33!ëÇß«Ú©5¡Pû+¦@2d«E+{l¬~LEH ,oë
EÆ¤U%èwEK*{-åª§e	ÄýÉÙø£máÝÚæ¨Êô©ðéÍ¶Æ®#kS¨ë¡	ÍïÀ:v´Á,]Õq= ¤ÅµgRxÒw°oð 7AFj7¥®{W4´*ç?µÁk?Æ=}NEM¦=MtÊfÔ º¡r(¾¨=}°ô¿èI6OÛÀg¬ZtÇ¥JÝÛ.Sò|CBêÓ æéo4r8e½ÁúÎùÏ$8?Úý"ÉÚL¼6qìF×70?K×ÅÛñF­rðÜU=M¥Ï
Xö±ºÍð«Ã£"« ¨?©Ëð&Ã}ÎdÎº sÇÙ	ý¼)îr(<KùØÀ_îá#¼»øÊÓ7Í´Ã÷zqªK÷¥ã[&G:aZ°RäO*9ðÑL Âò±£1Ëês×³²èÐ²Ú.sxR0¸ïê²mêù×Ãÿ¯Æ'½µ´½÷)ÃÒjs¨'¤:ÿ	=MM~)Î-êìÌÄÃ®ü!ð%AÖÙÚßê¾$aN¸ ³ô3Å¹ÕºÃÖ}ÈòÊS§h5Ô÷$õWh84­¡¶Pïp÷Øý$|~Ït ÃN0{D²ðQ¸ÿòí©oçÕ)3Ì!ð¥4Üq2ñ·D¿óh-Ûw³_êÃþõ¯=M© Ç:éð¾3è1@>!9«§üNr§®ÙnXêNÏ(×µµf$ ±ðÛ»ÍôÓþ¿
ÃÕZî£× >¹ÞCÎ»ïX7»´¤¦4jëó¼\qôTgÊüîóC·ÀTÙæÄ¿"²{uYÚWeY¡ ¢n=Ma	¢®f/Mî0÷:ñºPm<94«ÿéÌ	1:µÝ [´Qïg^J§¡üúê1é= äÛ=}§AùLyâçØÁ=MËè'¢c±&#&vOÚÁ%yï~3Æé'Ì43sZ$¾þÎ»= u@zy\´Ð}ÚÛL(ë»ît÷D±¾à·r.ñF1ðPæ^á<½$.HÚ[³Güßí"%Z0Ò'©9ñs[1½øÙåýãY Ê¨jz_²5ÄìsµÆ¾"ðz¼ÀV)µX+jâHü;Sèé¢&4*Æ ôjúPÐËPZæ$büÛzàÏY?Æd= ñ°ùuù$[tç_CÎgâdGí)Õ1âcÉn10u­2²ÚMgâ= Ð¹ï|ÐÝYâÏÔÐdGoäÞnÑ«D}ýÍc?aä	ø±dé÷°¹âÈfäÆ´ÀòÇ82"ÇJ®»¡ 55jWÝ²üüýªjûÅ£LïÉX¶%©Éý£rer=M~»íááKôÙ_½ÊªX$¨u?ßÔì~ÞjòÀïî½üòòxÝUäqþWØN<@}*0l³ò<: ;1oÅ¯®êfóó)°TUþQºyÒVP#øhæ&á²S( §¢¾#y¤÷_ìø	Ò÷*Mey)Õ3ZºÝx{5ò#Dó´éëxÒ %0ÝÀJcÖä= ì±¾Za3?ãVä&S@°¯dG*ù¦=}a±_U×DÇòx= é$íD¬ÛrÚÏ¶¹Èbq	V6x1w¦s3VF9-×tWÍ§¶UK¶ k5Çbü×[,Ü´7øB}®CÜJØªÏ'|T2®îËÐU+ÒküÇLÛþ'= ÜfHm?@¯tV~Ákªrç8= 0ð<CvkÒ»Ö,TÆñÒúØ*ÕÔ¬DPJ¨UÀ¢l= v£_>~°öøn*IvieáÄÃ}tË£¾ÉtÆ¼~TVq\t¡È>sWV6+m[[mèL¬}¹­à)¹£{Ò@õ<ùÐu!-ô[ûX;e1ûö&}º°aJªn©îÕ¶ºÏ(aD¾Q2¦Xæ'4² ølOÜUëôk4Zzn/IT\¤BjR,'ÀqBtèdX¼äßÒHºHF[yõÔ©àû¯éÏÙá)uU.Î¹VìqQÑÞ¬U¤ð½Taþ;­Vßxð+Íùgþ@³í­gÝùögÍ'UÔKá=}Äx Ç¹ÇÓûrUfú*2Vc7¡Ú¾¢a01jÕr@lIé³K6Ú"&;m¤d!÷ûàö´´]íçÎ9¼= Íñ86ú4z°!ñýÅ\Î	ï £&\®s »	&	úCåÃ
æÇU´#\É>hPÎ4F2¶É*ôÛC.¹mQ=MKTç¯eÉ·Pz)]]+úLs-à{Ãr\KçócÒPvØ) [î¤gTUÖÁÁ0iÃZ´e<GöÒGWq_@1Gá¥ÍÅ+§y.ö
<áT;klçv5«QB¬n"Ô»GX	ÐzÂÏÔ!x.¨ÓV?Å¸mlía¶rÐõdÉ¼nYßX^É»ÖúZ$B.09(¥sæÊ·¸Qî8µZíÁþ¡4[Ç4ÐÝs´á#Qø=MÎÄW>ï¶Öj±ý·õ|(Qµ½)µdßKÄëïÁöóðs¹ÖkÑqè¡ °YFÑñ]­,õêÍö^mw½z_7h3J9ÅB ä³pò<µÜËàm>áJð%[HùAI×3Çn£ôu"3²S©Fùõ$ìÄYÔ±Ä.¿3ßCãhíÔÍðWxvþ&tÓdé{é¤ßXáå6rÑWæupäãëøV·ôá ö¼
lnÏ.d^ÞTZìkv)Jë+è*S0=  ÃÖ)çcX×ßeC®ª¯mÿØ= fÉÓñ>D	tÑi=}qaÎ*#Á¬sÅ^	4Å4Õ¹ªL= AÁjZ= Î©DÚLe^®úU^Ð{%F²Wª^m 8ÒðÉ5~ÅR&#ä)^]ÒòbÖx/Å)M6Å3TtTÜpëÂùô±0oU¢ fÆJìªP.~N3~ôôRpÐÏ²q ²fÇR×TC;1ÖæË¿ á
×£W½vîc£â~¶ØfpfhrkÆ´h¿+üf×®f«Éye
G}Ë 3Å¼7lÞØxÐpH0Ë|^°FHA<vå¿.Ù¼Ç½AíBC7ß@poQñ8Ûý´|ô?&"9¿ åiÓ>vuîbW{qÿÛÌa=}[Ç+bî(28q·Ý>BIu±4}*¡Ö= á¤B¡g ôËkY84!ö¯û,:*PÄHù?sÔZSU Ì¤~úÛÙöÁmÍæ)zTÒÇ'5õ.$$~IqëP=}E¹ÕñZöt·pFZórìÓ3æj9ñ¢f¹¯¨@Ay¿pé¸PöïµÖKj{düF	ðNÀ®2æ@=M/-b¡AG%g9>CEù£ÅÅ9WãÊ<6þæ&OLjÑÁÂØÅdÓ¡²óàÂM¼qMÁ¹§ N²Í<¥¶ÇÝ-k?|ÏE¸óy'qéôVð0NÙ¿é©Ò !È4I²å@(c´£_|wìúJOªHÇPÂ_lÍÀ4£CN¢#Î«9êxhùrH¸Û£l9«5¶È÷X>
W=MlËdf4yDzßË½ßdÑçQ
ÿ±íÃ[Sj[äêÝ÷³v~þ:7E53¦B5èé!Û~	ú½@ ¬BPÒ&ùeÙS
aZ»×£Ï	:Â(ü¬ ×ÞsqkÃ0ú¬H_~*<Zóz0Cæ!êß.6tªPßIb4í¤.¤º<FKµc/:Ó¬BHS/»ÃÅ
aÂÒ ¹7î:ÞÈèaÇx ¬ Òæa÷xÖ¬dødVIì·º¡¦ÂÐ{Iì´?ø¾ëQÌÃ\Qî©¦ÃÝ9QØ!ÚùI¶ 8¯atÐÛd=Mã½¤Ëªï=MüÔzPÖ[¿°YÒ#d°pÈ^Ð±V÷¬Õa¯ªw È}&)%­³Tæ) HËld>ÀÌË¼6VvR´^6NmßµÆ²N®WUa3¥ëLùÛ¼?JÎ)r/]ºÕn5Káqª|üaÝF6%µ|àìþ¼~Ë±Ëû³WI=}ro0
ä^J¬}|¼óü®¡©
dID=M¦P
äOÀ#KýùÏNÏSÍTHøÒz9Áç~-ñDQÉâÉº0HÙ Kä.¸Ú7iÎ6´êJ(oèölt(ö3ÐFNóùLôÃaÁë  ¦Å ºðgmÂ³à= Q	³Î(×«8JJCØ_h®´|¨Ï¸fÈ-/¬¢Å­Çl¼ßÐÁì° ò®ÿe@Óûø'OîË ]~"èFÖH¾kýx§ChT* %«im:óNúFþ¾ù<C {O|àñkÉ^ïî[ÂÔäÒ6\BZÉ-7d¹bm­2béæåì¾ÿ"¯þÆíü+?FÚNï©*O:Ît	)ä«(RßNÇ¤Ã!^HHý«ñ|¨£sÉU£ûàwyw»>FJåý(ïî[0Qs(6R¯L«úlÁªëÑÃã$ÇÔÒÃ¤àÆÔ_Y_Í¨³
-Ãó]Àßð ±é/;CpÙõFFÏ>ä4]Q-P¥¥»°ÞæzÞ4¸3vIcE®ÞëµjÁ.ðXùRIW]~éÅöö,|þø5ß¸"è¤<À´¼µPGcâæ=Mä30.þ!Kj^/ðIèÂkV=MiÆý°êøý¢õk8¤>Ü¾bÏ¬P$E]Á[g³³é¶ëôôëòªI[GâZCK|4ZJJü0²Mï7a«'¼ÜÏEÛ=M9|®èÓ0FéÓÒ¢êüy:£ñªìjÈÛÿ9®I'=MÝØ&as¹-ï+ìqÕØEuC¬H©_º;lV0Wyê¡)
5lÒf£çT ØpjFÅ'^2AÛde2y;æ¢
$ø©Òd×uÈIýÁ½¢v}Oî<$,ÇVF¾µÅØvòèD®olòÙçá}DNÞõnKÀõ¡RÐ8¾ÅSY¯õ\Aù9¸.|®sªù³Tâ¦¯Nk¡¥ÛöêTúÚCQß÷ªxÐ>ßDqÑFß{6x5$» ¥UÅûnf(/>çRÃ2ùß*2]b®§Ó)¶RÅ.õ~Ðy®òLS[ÁFiÖïkj®°#p,|?g*ëÃCÊÔí»ZãfÜ×ºr ­ÁØÇ7Ã@ÌëäÕÀ-~òZ6M~Ee74ª=MZwOìîA3Ó ÚÄücÁI:Èû$H*ì(»1ö?1ÃñMfÞ°ÈqvU Û½æ+pôgòÉVTÚ"°Ï=}«<ª¡Àº¢Aï±NþTèq¤-[/Õ1"	aÕ=}= 0,S®¶u¥Óö0ÿÛf%¥3îà*^\Wj{[=}G®ØÑ´¤3ê9h»¸?@í^¹Ê±· ÎUO£Ê)ð= r<xgwû4ØMY¾Zó¨O/0B÷ã48gfe¬¤ÂàÓ¨SN/ºwóQGí:ýãÁöÄÆá´-Ö4ï|8k¾íYÑÀX"t®røU"¿ê²pdRúJ½!YoSàgxÀÁQøi´è$Ïgôkc´É
÷ÂõÇüoµ eaDwúº g%åUeF¼Úóú
¿®Q8Âõ¿#ÇDi¾â?ÎsºàvlÀ~%§ìaX½¸7¬æAÚs»ÓSù= 3ÇzwèGåAgØ5|Òº®<;²a¯#Ú»ÕícUMtË
%Ë×+´æík!,®^ËÚà$Ã=MÒÚþ;ø×ÃR#Ù ¡!}Ç=}ÈLYÆ¸ÊOï#>åÓBÜjw= 3¹B£:Ä¢ï¼é5£×Æ49ÇºÃi.æ¢r0S]YlÜÌ>®´ Ù$¯ªq~±?gÚaa¡K÷ñn{ÂþaôuU_y0*xLôîð'yYÜ=}=}YAjrÜ£H©ÇgNA ¢He=MÆûÌü¤ ë§áÙ¤zñÁx¼º/^Ûyñµ¿Op.ò§ò-°}]¦¶^åCÔVÑfÐdní-JJ-¡Ih!,û8ßÂ(zzÖ9à@ìç?¥§B
MðMQy=}¦>ÌB\Áê'Ø43sJ(»Z¤ÂêýhÞÙ¤û.v¯,wûiý*NbëB(4ï0U£AÝA5çá5%¿«æ8±úo¼¹*û'ô©èé,IËêí2KEÐåa®'\;Ð7\l®Zï½~áQÓQÒÜ½Û%ÐS'qªgN÷úÓvæ©"õcOj;¿Ò¸»%¡Mlð÷ÈÚKAÛzÀóìÅ?"R0ºpú{kW²"ÕPI0«= ¯·sH2¾F_Z²YáÝ!{¡qRûÂ4ÊOÿÓ{ëtyK'©ÑÒ]{0ùÍ[	À4ÌmlZ*+@!ÿT7	¦ÿ¸;/#óÂÃÈòuÉâvuyHÔ¡¢ºÌ[Å\sRÿóÞiV
+ß) º±ÓÛ)Ê:ºÜKØ±¹Gµv¥àmÊö
äWòBÊ¿÷ÞþkÌ#¤Y¢ëéWªe'ïKèI³BÂ8óvËMSqVzuÿ*½"Çí·È%ñò®¼ÖÓêsx£RR½v7C³¦í£½.a÷½ânÉÕ½îüoíÿ´[O@à0ï÷øz\á¯é»öÈ$ðêY:õL= °N²Éf!vùàÚQ»l&ä»{æ¸u×ÉsBÎ[â¬®*¡ÝDõå±¡[ÉÊªºÓUçiÅpµÕ3uèù"ÜÈÀv^ôm!âß4ÁÏÉ)jô@HÛi&¥)V´9Næ¤ócJ¥[¤Ì#Yw[¦aÆ8ì&SönyÖM (vô=MàSµ5ªû;XÞP?zÝ©]ÅS?©²³µ,ÖÂê~û( LPQIo&ë ìÐ¸"­{oÇü~½CüGðâ(£ª9ABnªÕQ= ]ÛvÖy¾Ë6¾Àc¾=}0;*VÑå(ªTõoHCnzÁp¬¶õQY Düü¡%»IC	NsÀVâg»<Óõû66no= {ÒàEtaæ¿®¾G¶èm X»rç¥²q3^³ª%áÃµêH_´«Yvovóþ$5°¥ÛÀ^&&ëo	&l= öf¼ÓÝU?°Ê27Æu:ó=}½ÖÑ7"Ù"¦5@ 
!jéRR´<¦FV×K½Ñ§B º7òQV__gXN0Ô'*xVvôbêHN¨\û ÓabIôÄ0CwÌL^»u=Mnj)Þ;þ ÃWh7È 6C%ß½Ì*7&êÕ¢º
«j×IxÁÇô5ÅgKL<ûñX_gK°R2.¿;ÛjfÍ=M|a*ü)GÈKú]B¾±±K½uvM{}3 )RôH )R¾%ª/@¸=M³a×zéAg²ðóáÎ±u¤»@ýZ=}HÖlBþöU­3Æ±+*êíû%8nñO{î¼{÷&DHmZ,¯= XZýæ1klÆDÒ2]ütÁÎv-õ+á,ÖowÑfêX±2Ø±)l«ZCh6T÷LÓÔgÎú©T)¤=  e¨Ubï©KÅè
ñ?ª,G/b½,
gÚç^U@HÅÚÔp®Þt	å%jËÍÝÏÚP ;ú¿õ|Ugó{sô~Ü{}oª\ktTÚFM(þù#³^änK¢¤üõ£³xcòëkHáºzË²H×ñ½4 â*¢8qÁåeÖ©qØæ@yÀçëúÞê;3n¯h{·»ÛâÈ82w;9g.wl|û±üPÖtë&z1	jüPÌ@ØkÚ
8þòq÷
År»÷Ø~;Q¹e	X.CWzÁIÜ$Z¬[×,¾òèª®ý âb´6úÊ±~¥dÜF|WcPB DPµsËÿj¥­xÈ:wÿÝ»úck<J7B ,TÂd¼Ê~Ff8{Ð»=}gPf|3j1ddIy
djíäïúÈ(LQ4k~ëpäwlÄfâãÆa= ;³1&;£8Z¬×8jÔÏH×DÇ= tF;µtgjå©jlC¬R$	B|L@Ò¤%Ð\Üé÷	6¸RÞnÕËvyºôM/7'Ùbz2r_
 ¬cb_w0Ðò z»ý­@s(Ú²t}XëT-äÅÓh+LRé7ÈOOk·ÌyuÆ w¦Ú]	klhìÈ´¬®ûüéËØØÿPûEdF<â-Ã6 Ú  i´½6GÑºpªC>~Bþ?é¹âXk<ßzWôfpJõæA;ØS)+cÃs}úöZûËì£«îôt0+þ ?KÒÔ§Ïcf<TtÓ¡Sßb[Äk ¶ª,RùsªhßDCªe°H= hEëHðô«?{øtcu
'¸@,ñítôlSj?hë
Ë.ò;âØþ]ÔÚ¼L¬n·}®­öl(þ²7ø9¬¡òÊmyãþÂ²kzúÛ_'j	ùNº^nïêÊJÒ/f^D¾²AP¤]¹y8}hµO
NVUöµË÷KçIsFs$³È^èr\ö8pW		2zÉoâÛôD¼ÅÄM>6Ã;§ë= ròØùqàÂ	)¼×ÔänyhPóyÌ3ÙÞejo¢sXJØª«>©¸¶:ÙÓM]ãµãr"Þõ%%*êVë-DhY¤C7Hjãòd= .¤¢¬V ÉaàK6ÉmÌþR6iôÒ,/,4
è(Ìxø7xàqÀÕèÉZU3üäZÏ#´Ê7o´3×mÃ Á@8Þ\!Aùÿ»ÌÒò!Å
H+Ò¸kC´ö_¶ÐPê©PéW¨] 	G¾òÍtWR&nîÔgæ«vA <~FIL÷[<*QFS;za¾ïËºÁóÞÀû¡V $"ä*3B)ÐV@%4IÚû:_9ÞÚèú
MK8Êdê	péPZÿ~d¤1ró<°íø^Æ,^÷/dd}¤{ýj²dwRyñ3Ë1 ÊPA°ªÆvû e-ôËiöË"Uíé0´Ûô±/w¹eÄè¸&, !¾h¢ýKy5M¥µô;íkâ½$}ðÛàÎö<BÇjb¾W7F/Ñ{Û~¢s©ì%säËæÅ)V.F't£;ß¹à= HÉíü´Eû^à.L.+xà$Yô¨]Í¤Ò;~¾¼ÑÑ9unª'{ó(¬åfá
¿)uÝLþÇ¿iÎ$ R±½éÈçº¤2hu[Ã¢Øt@Â¾|6ÒHôÚø´}ÏNû Ä¯¸=MÏ.t*s³/«À2HÕh°tYV+  Á<0¼dÕßmâ&[°?ÈÆ&Ou$*1ÜØdÂ¸©XÂÖ@B°NÌ@ ¡@Q	22ø>é	 !²!]6|=Mc§ÔðÿÕy¢^ù= ×çuw±êîn#FÌÆ¡EMy.YÀ3¨w¼ÖíÝ(¥÷;¾7HauÏ P/ÂÐ÷{;ðe= lG'1=}:Zt4"æ\µn+ýÈ¨~w·~SÙf8ª&ì)4Zr÷>)@»÷5q~q*¬:ÅTÆ×»,JóªüÂð)«ëkIÍf%-8t¸RMùàËù=}ÁüÎ/£§ÞCI?¤àWvrÿ­= JÂ¸ý@nýEâ$($þãjËTOfrs(üÒ¯6êà7K¶3wðÄÈÄdEz=MüsFMù{Î0ûgé¢2.B±tKüt VhlÉøci·B±$YºO[LrmÉFFßaÛ¼q8:ò ²w¶nsHéq¦D.EiD%÷x	üÆì~' TùcÆ¾LGýæt±tvÛzõÆ(ÏÀ_N&ù>ípÿ=Mfu%ÙÉwIgjÚ¤*@i#,³Ð9¿ZÜr¸(X*°:0¤z@L3boý'#ã¾ÖY+/#jÛUj¢s8ä,äÈgùìi_®.ðk|º6ãðàJÏ»»{/SiùÔ~¤dFè8NôbW÷@¢>rç°¼7; ÈÔOûº¡>'#ê|û$ìÈßÏl	µ9ó%ÑÚ{Ú²r,w}úTì¸®Ê~È@¢Bv.ä÷"¼Ö±¼SZ.p«ÁêL2D%ÜÃs8A¥ÒçÆÚ|aìYÒèÇb8òÛ¡rxA-qÄaåÝ?H6wt1äºï¤5Í9}Ì6¯b¸Xluß5(oVFØ>Ô^ð%ÝnJ<¼·!Ñ2J*= ÊÄÖñlnKfm x= )úuÕõ(^Çê®8_âRôÂ0nþ
%KA-»æ(ÿHµ\'­	HzPKE[Zná VÍ ýþÎPº=}3ëûðÿµnr°;àdªÿ
G=}Îÿ;Ãoa"+;R@B}r¥«úÊw¢
ö¡GiÈ8A®aôSìBèÆRkËë'O©$^*"Æ¬ûÄSkC ¾ØÔ´T§E¥ÒïKzzP
+4(0£ K;úµ¡Ð[Ï{¿»|öt+üÊxIE¥K°ê´9/Übå@xüá¨eÃHì(VøI\û:®necðxO¸®zÖ õ¼K¹nîÅ=MÆ¶]È×®ÏÀ2æ-FzOÑAòA{ysRcÒÙAH¾t:=  5Ý1+ûË¢N
wöãIÎ÷ÅuFÌ<[7¶zÿ´ºtû_Ñ(N¹e·BÒ=}E)"âûE]I|%§ÛZEvÔô*T"qtýôdÅ= 8êÉ@XsDEÅÈ;AýkÞ!<}äaE!W×úÒÔOYÔ8èMèÝÄqt=Mw³U>8CØB+Ç¥Ã\bÃ	px [Ñ»cÍ4öPÙ8Gð!<$·Y,kMúªyá²v¨lj	}ÞôgñÆgÐ/²Õpîá\½#(|ÌÎ5øVÐô¤¬¼TçØ$u¨þ»?ë+;*½(½²ËÄ
kxù¬uyZ 0×Iô¨Ë!ûÕÄ¹ekDÃA8¤9+ûâ%ùöwÉ{ÂìEî>ÐcB,tÀ}Ôe6ÊÍ%l0+Pð°Zl)¤X(ERMgNÇÞçþK|]Zÿ= =Mü¦uââ¿þ=} Ã°<¤ É.ÃÕC¨©öhJ%N¾*PÀ¼Ü3îhxÖè¦øõÔYX.â5\±Í½tÇíÒxg²NÀwf}i=M]4âÂ¯¬î)FwG©xM]ÔbE8>æÌdü:Ð( F$*·ÎHme%gÞøì|	CÃ3#Û¢å>óËHùf£wÉ½¸¹FM×/G\Ù©[<!-N-Ú|Üw
LGk^æÐÂX	o=}ìÄQdý|Z¢-ª9¼;¾²Ò=MôNÈÄ[HÄïpvB¾Gë Lr°æ\ 2;Ãßs+/âtd®NÅÔØRûº©N'/ÔDÜÂ#$<iòO[UÁYå1Îª~s5°8¶O{= ²ÿÉûCxzâÖÛÃñã·Z§Ä*ßføVs¹X:ØrªfóÞúyÁSìGï/Bk©Çâ³Ö"(ICªõtÆv´Ä=MV"À$VtùôQë¹=Ms(Ñ0ûK×æz»GâÖ¨íGÈ$Yò;Yú©-«vukøE=M]êPrv3áYq[±ªðLÈùëÊ¹
¾vre¸çâÒSsT$2PSO%Qá¶7eáI0ÓÂ\ÜáAÝb¦bÒòÇE0ü~%f=MÏÀ$êÎÓd1MéÐÛáAÂã·l8¢×ñ³mbJÚ$!G<áwoì9,»KjÊêù6¡!Wê.Øå¹¿o§¤êM2úÝo ÅÛáÃ6xnýö½ÈÉâ±=Mu]h[ò°èE)fgrüj¼iÏêÙ8BW°r)´ãÜè?Um«zKßYZLîè<IBTâ±ò:uòEçlæÌ3Ø¨F	CCFgæj¹fEâ9øqgwÑ0&¸)(Z¬k_Ö(Ä6u6^H=}8"ðÃyÙjd´òºI!±¢= nñeö¦ÄÎ01u	ÄíD=}ÈS}Âa	ü:"É\«\ jbÔ:¢~JÛg~GäHM*q*ZéxÝê:QÐ«,Êsø¥tÜ;/|«Ú¦ÑËlHÕ ùqëÌ¦A+<åë-í %ÿeTcwÃÄÚºTÏ<Ú}LuÿÙN¾íÚ²Äs[ÉÍ;7WB#w{á2I»v¹Íû ¤­ÝÑ£ÄéýG¥¯±öñ©aomõYmÏ)Î__¹¯¦¢Å=M-¯ÔñX|ÊtKä<Ç*%½YÜÙdHüFÊi@	þ'= =Mq0å±åò±n?XN÷þì:£Ì8^5ëÐºQ=Mèº·qôÝé[9_%òweF	'\ÿ¼_b)ÀpÏiÅ³* ØÀ>«]²[¼öTCÅ¿»	Q ®Q;¾ÁÿkécÖÂÜéîI|OC/Ò;"ì¦ Ï8ºèþÌ/âqÆ«7ÈÈpIéÒJÿýp&ñæ1²R4áVY5U	¯|e= ÏGÐ7Ân¨²w>3~pâkd=M¹ïè¨PñätÙ 1"x sèÕ)¥6;Úï>âHD@êüº%s$§,ß#r0æ)Wà5aä·âMðÙ¤.#ZÞzøî!Ò;TÁT-Pø\ðªÄgºVGQÂ§0íowvlwR=M7ãÕ?Çk¯¸"Î;\Mçô8{yRÿ¶kéê= jFaì}ðK§³h\ô¶©D!Q'VrcãE; Cîç4[½ÜTôÝ¾q¨ZÍlßí £¢Æ´ÂÕ_ gÅ® *¢EÍ92õøå
_êòøò»²çIú2Û×*v«MÇ£¡»óE/.³: ÇBÌ?ügÝn^]üdÍ¤ËD·MljA(eáÖaÙAk×°Òxø¢Ê¦û$j:Ø*/Í<®W= §¯Øh-c³bcèã¾;Gâ¨ ¢Ï÷.iµ×HÚød§Ú­.ÇýR$_=M­jÕ*\>¯Mí¦óFp#?PKöã_ª <è>­ïá±HÁÛ(ÝA ÆÚé/Ñx\§ó¡Zâ-³ZYoR[&cI/Ã<=MÜeô/_TUËV cÕ­­Èãx£;>Y)æiYVæ¢£Éôâ0Þ*æÜÑinsÛ!!Í£WEn'_ÐáV.,Moð 6ìA*EÚ"[ÚçïnårcËá#z9×*z8Òõ]2ò!ÇÞ5Ò
ü¬výqp¨ËßÐ3ã2#¶ô¿>òG,G(
ïÑêdãkªÝèø= N~Ø v³YßXùà%ûvñ}V³IßX µ­(ù\Þ§»Àp0f%~= ²0¾K»×Äóþ?«ÏÇô#ýÈø6ñ)ÖÛìÌ^öqX?JAJåÙèIÝdÇûÎé½ë¡íÜª¹P4ÊÈ%Ö3ìÿäCB6ß»AðÒtêmV¬I¤4nSOW!4-}QQ±dûßèbe?|$h>ÕQØ"½ómÕU±jpA"õÖC´½GWSöR=MVüë(s¥U:¦ý§noiËÙ>¡X§¸´ßÃF#Á= aª=M/ïIsÓ6#0ÃnyìõO[ÈL8úÇåàVÖH/x#²cçÈuÙ°¥sÃñT«À¿IüL"s*ófÙ¨ö*v¤*ÈyO Õ=}7Í0UM/+¹Ð(ÑZÒ/)wç]ÿ¿fÝÀN/Ü´U?Oïº|=}¥0CD@á§B= ³£ÉÛÕç¡qn¨:;¯è7¹;&rKg¥JV~W= cÒÀQÛÍÔhíÊÄúCEâ?ÕstòÊ_ zEfïS\]Oñ=}ÒxrõD=}ÿÑ¦DæMwr­²f Ù¾ðU«<ñZLy!@ÿ¨Ø2ôX¡Ç³û>ÍÅ\&úG¨ËÀ;Bmi ïgPð±Ô:~¥Ø¾¼ºü21¯ÎAÍ÷*<jèÌ°ÖÓEé|"§<¡ßP.ÖP
5;ÞT]¶Ó$øæqç#i±Xq7 ÑÿBéç¢b¼Æ½³j¾ÃïZ²qdå±×¢ê¢¨·Àw9íÖ'Nó'\â×ÚhæÇÒùè¶åÒh:©<1(	=}§÷<OêbÓ3KÀ6<OC4K©Ïì¢K·j0·vÀ®pú!X[6¨O&ÍØ³JnTSØõ9-b­©²¹óC7r= yå750?ÄÔ¸KZ³bÁJ@èáÅõZ+0FÑuÕ°@Ñ¦äp¡fÊÓìªÝwdT	o'Ö¢~òAoKR	e3v>ÚÔÿY©SÀ}îêÝT£
ø*nÅíR= ¤Û½×ÊN3wÚbÃÞfÚLøvZ©ò3*ªÚ"*&Û_.µ}óEîw cË)5¬&£ J³pçÚÉñGµ«ªösÏÁzåkãé¶Ù(Ö²öAdýs|?&YZ%\¸ø½¹@Aòêòü½C»Ó¡+EoS¼±ñ*²è¼(5(í âíâîSúNz® ó½þ  <ãèÓülq¬ß}àh½Á= }¶øé'^|.¿§(5ÙÃií&Ç¥ ÖÔÄÌâÅõÙ¼©'G·e*ú×ÓrrM=M3@bætûw°Éé÷ Þ}1JbjbT»Sí(ú'ÙPCYÁqG"ÖEõ'Õ/cVáNçh³h+Õö6ÜÔX©¡Í]\ºC(¦¾­K¿éÎJ:K6~IL®°t.ÉO6×S3üÉíÁsCâjÃXã9ÆÐè,R@ÁµVïòNÃ+Úr½F©Ãø§7@ºè%ôOS(e°øùNuhiCÃ$ÇHÑÓ=MÜ+íÀ¾-ÄÌPàA4Ì³¼x£Å»=Mk\ßËÞÛ®ÝUñèlÁ\CR±Tf}m·¬SQXDïÃ £þHVk
 B[ñáUÙçó(5u}Y×+æõ1Ã×sÂí&³4Z®\ù+°qf¬ñx¿Õ·ÒyEçxÔUí¦Õ´yÕp94­ O(41ÚkÎ1>$Ó	¦¹(ç(vÍ8*J6öMhIÎZyµ6çC'ÙèyËæÕãÓVÉiÙ\2"üB[ÑnPÝªªçYFÙ¶ó%ÁÏJT&I*ilÞÇ&ðtá]geAg
l¢¨U=M×È%'ÒCì7ðÅ°öWõ°ÁËTlèÔé%jÖejxß-xÉÜPxFHíS ÑØÛÿØ±×ð¬ew8\ëVìRì8­ÑÉKCû%¥ÙØ¯®·¼ym¿f¯?ÃY	óQïÙIè¬_kò>{yRèjÑäoäÔh¹¼ÿ¼$I+¤Â^c-ú»ØNú´ÙíæÙ®?¬xó©øTÇÇßt@ý;x êÂfÛ+o»4ê°(ëR[Mp65A×4è{ðO9~í³Ïaz) 9za
?ª88=}ÐùÞG«= â8ÄÙF 9^¬rdº%ÿÎ¿Äs*úá´ \/«%.ïTDr3·{)7peÇ²Ë×3ûN%NÇ<¥ô+}rtT¤²lôN_~îÉ%\¿F­?ì)´Íãfüåöpry5î×}®%§åzó+ñ÷·îîiéÀ?o:úÑ2Íl£âGv_ãaïÐð ý½z~,]×ÊóA²1t¡ÜQ.µähptÅq÷ ±3ïfdM¶@çþu_Ä;p¹QLÓfá7©Ð«ÀÂYë¸u­F¶òà9Å]Ò{pãUgÓ§R§= ÕHµú×ãØsÀÙç2ºÈv~©©[B#¢S$~¶3ç^>y ÷îm7i3à©)#Y¤8Úh9Z[\bÍ÷¼$N35ùR%/RÑ Ò*ÎþußÞï:ÖNÃ·j^ºÖö Åó^3Ó,%rvÕ¶ë@ßó'´w*ãU1­·÷7= ØyÑbßZáóÈfjgÁ¤èG°6÷±§ê·Èã¶¯²Ù,
¬ÌÊ.ñ~µs¨Ä)ãm­¤~äKhÔÐ=}¨5æ¡ò9x)rÔº7W90ãwé²Ýå[[gr)ò®Yçýâà3IX0ã/¯µ:ðçÈQø¹àn)ïÉ!Ã¦ÊQà-Ý¥æO¾éKHïÁ(uÕHËçbð:vÁÿ#×ù-ù@ª/;õcW·_aCÀò
¨ñÓÁ d®àD}Jñõwèò^q6hÙèÂöþi­ÌH©6Ýs&¼'°EÄ©kò#¬UÒ:´Gfø5ÜVèkç[fu5"ÞF^&Ò¡ÊpÇav»¯kI#ãàünÃnHañ3È÷­P;:âÓeÂ'3:Áx	YDyðt°AÔ.l{s/&l[îÚXúÌÞd¨nÒÅEV-¨=Mî´üÏHùC&V[ÅÁüøÕi¿!èþÑ63éºNpÀïÎfÈZ´HZ®Q(é®n^jýdDÞ2ÁxyBºÿ/®À­5	ò'£õ.?¶\eW¤ MVä(#.,&5½~a¹Ù= æ¼ÂtÓ½öH@þ´æ´ab)o9f§\Èµ¶Eãgü¾ÿ·ÝÇÍÂóªl«|ÉÅ*ïÇ½ÇRJ{öï¦yòN³©VÙóoîc¦¶FMm¼¦Å>&ùLËùeßúeHÀPCñe×uW£ ×ò´læÒÂßìHþó'©WÎ«ÁÖó0;maè= {Â,|ð7íÙôT½6Ùßï¿¼¸"¿×¾on²âÍ¯<JêP7:Èø®Kq¼Ã9C"B,¤¨ã(~Æ¼e®
ÌFÞ®òA:»¿z¼vVUcePHù#ákîê°µ/Pð>Óîí.Îf%}"óþÄcfÛ£¸Ù18#ÿyîsÉ8Ujgð·bÃpå3n±èøòO	ñ(Ì¦ªÐ?ÏÆÈã×ñ{´±ÈM!YNØÏÇR:ä¯Ù¢È?p×íÅ¹âoüµËíÉÑ½uswÅV5þ¿õÉq<óHl¹°àºík³)ì¨°(Ó~ÍZ;oÂú±E÷¡ È¡P¯ÕH+@nºÓÒé°3.©lBÆkìHý@1(ü§ 1ÄQ¼ÍXfØMø4+NGÁû_sö­³
À¡$Aª^ÅT.¿ëÆºÚ­ÀHÜ8s²ù6f#Â2í)õÀy8ÜJÞ°Ñ²²ù_/_ÏÀÉRÈ%=MÀÉ½þô¢$?E[ÙqØª7¦F>Áh¢kÀ'T¤¼Ñp	º£"ñv£)Í#ýp?¢.£ãº9ðÚòCR'eÝéG×	+ÆÎ ±$*ZcÀg¿¥Ûab~%	²¡þ'®dõª@q?
p¡oqÇWY«>²¯áÅ+úxUÁàº¾ü´ö	®&Ø+÷¿Ã§4pIQ§KgµÑ-þkfó.:[ÃeF%]=MY³)>
°ß+YN´*niÐñöeõaºbõÿ&/Ýv8Cbü©=M¶ZÀìÛOiÞÔVOc¦=M¶þN¹D~T!fµegó½
OyE8}á+0¦ÿy¿4y.*<X%§d¦+ð7©U^RÐ= pØò»ÔsUù^ÔÃÝíÉè;Ì%àu£ eHåhûêº¥óÿ=Meà°$%R[ÙSþr_®1ä6~J?KÓlx!¦ñ¬¬Ó]&ÊCÖòµ«ÑbØ¸Þó¡ÓîÙÏ¢Ô.ÆãùDùÞ]~$3=M
¢Ù&2ãÃB¿èãþô·µ¹æxîÚ\>VUØ^£Åý<¹ÌX$Ç:ÒJ$èËÿ b2ÇÁÓA°÷Ò"ÒîCÑ©B±ÜéuI{}|FôÝYÎ£AqJbb¼4Ñ	zº)è fªÃÈ÷®ÏnsÄ¡tSdL/t¿Éjoìuû±üÈ:æ= Æfk¶»jÞÙÄb®g¾Ä mË³A7Ö¥Á£É¶9:çHÔ8ØpµP*ÖYÁcÐcy]LL5ð[p¶Ú%<Y¬Øî^´Ò£äî¿ ­Imò'm!rZ ²ý0Èyð7ÏuûKülu,KÙßÏc]&¢ê°øRmà)%d¦Ü±{ßåwsñ»ØAÑå¹· ¯kBÈµ¨ÁÒotr^F·´eª#´ ÅRW9¥u1¨+ZC]ËêÄ::-äL¿ÌüåPcÑÀûGSÉBiÔ	n÷Eÿµ/Ö÷[=M{õ¡ü"·V^¿
Ægù0R¯roÓH¤Ûw}«'ìL×JdZ@¸ïº³ÒFÆÿÓ!ÇgÜÒÖ¹ëaËÂ¡QëôèíØÍWÒ=}½ÓÅ	öÑrØ¶TÄ¹OZÉÆ]aÚ°OÂb	ny ³ÚQgÙì]ô= ~*N4õ¨LÈ(ò²°t,ìê	¬8£{§4ÆQ/&ü·á¢=}·c)>{gVØ* Í ÚM	mîrÈ7#sWÆm­?T-ùucDb

¸³ß÷cJkÝÃ2dª}ÉÒDeÜÝ) ~À¤¨;Ü=}>{ª¢y½4Þã85ýÿymeï6#,\¤>NÇÈL/=}OîÇÃ¿(ð×#¼$Aph;à:q:²¼!Uí^AútqåE÷Bd@/eðjy,võúóÕJx<»Ì(´'i(ÁüÃoÈÕ&õÄ=Mú||ïuÑn4$ë BEcá¹½0è6÷õ¥áM³¶Ê= x\´êT q¤íÔ:rF®WùúwêDmMûæÐFÉ[ÇÀ¸Ï¼ÝÎ3ôóéÜzé¾t½(«±lU0A¦WÈËÖ95õs¼eò©Þ<.ýFó­¨Ü·m§}w s3ÒH"¯Ä×¦UË-rÚfè÷êrQ­Aò¡gQg+:0ÆfõD½j¾¿ óR'ng' §D£ú]»°íÔ@É»
_Ak
óÕºAÑÒu²ï¯¶GçÜÉJàcØ~ÉÊGÐ*ØXÕü§PË¬mG·¨Áâa©X6w8²mÆT#¥qx17½ÁÜDR-srÀEæ QçûÌB#hcÑÊ6ºâì_ÿ)|º:|þ3NlÚ*¤?¥RcìBë \¢Jt¡ñ+= àt&ú;LwFßuÆÂ!F<Ö4X³ÌéøØl-Fó$Ôc>ª£¦»j½¯QöøÊSÑ>]hk%X¢ÞqõÏLt¹éáuVQ Î~rNÜGùA_Üûê ÊËréÝ&w©Ùl-">0Ä}{ê»%r5£¹ª~=  A¨Ò=}XoC·Ï@Õñ~Rxü_
 Wª¼ÿ@¤Yêî>~ºÜ(IKRtúEÇ/ïÐZÃDÑ·ÓUCP²ßä7¸-ª ÇÔÓãÏ¬1­nY¨ïð[©NV³yûª27µdúªaýÃr?ï%2Q[©
ñÛÉ´0DszA9í|7÷ïá é}þ¾ò8O<uOZ¨YúºT×Ý»>B9Ì/Å\P¿×P¤:t<Áºíü5@	t,£p·]lðÈo$D§íøºLFúg!EgeØlWaDQcf"
iÐ·~xúT}ýwVKÚiõ ®H!Á6vüV4I;m-pæM°ÖèdkO¹#ÝDÃ0ü­ð{5õÒ§F]iN°6]=}îUË(pÀ2]ûÛë}szzËÇísW&qÔ<8AúòeæËU«b_-<îf´;$ñ=  ¡yå°ÕhrZGhQûñ;{k06ðÛ¥©½G1Ã2SÊçm-þIý¤YêÞp9ÖÞÆM®ÉÃk{ôUp]WûFZî~üä2Éy¸ÄZYfEÏþ-*qESËxÀD'5=M6µ~¯wLêB!f½Fï²þëÿ~âX oF}ÈfY¢ÉVe9át6B
gQá_M+µYo&çãÉr>dK3sO¹= É÷Kùîæ8mÛÉåº»ÅÝàê#·2G5ôé{[T´ÄC©órOÉã<[¤íO¡Ùö¨O£æÏâCYÈ|#Ûþwr¸£Gcqë0= @züïº27û)±Ã¢G&èµÏcÌ«±<å2sßN®2¡MdÁV	Ç,Äÿvìì	ÐkñË¡íëëµg(zP±(Áì'o·o±º[q¯"	ÉÆ#W°r£ßXcZìbýº"Ip§Ý¼»ï¢0E>m=}ÁçIõ½aâvn¨%®èeðü_T	[ô[ø£Bw aQ&unôRùÖy´â/È,²ÀÐ:?= ¬¡Ò[Ýa¿­¹p7Ðí dõ7Ã@KkI¯LÒ\ÝNýÎml÷0¾^O¼BÜ÷l%= ÍSGé¿HoÝª¼$R¸âÆçAi­Bê=}	IÝý!:m½ýÆÞá~Ê_U"ÛP	Ó{í«~¿¤ °F¿W¯]Ñ¶ oµØÞÇåäÖæîcO ª(~ÍÊIòH{)pùÀþ»¸¹°éµé­ÙX*2A9u­®jf §«-&2W9?(<9·dó¨á»ÊâPvñÜbi=}|CÕ¦½\l+_×a<gaí1u±BÇ´Å"-ÃÎëiÓ"ù¢âÜ ºK};)2·T}|UÿD£C#ïq ¨OêPÏM;öu»}Ã7XRnGe´öx3ÔÔ
VDåðoÇtìsà=}½kzX2±#Å,§ïcÊåwgúnxÙ
dxp³Ju·ÝÝK7¹M$:W®9å!¤ãº0N/ßÊ±"U"L&\Ä·KDC^K¹=Mð¿ÎIeb¼ÁÂîC"yêN/ÁG3eTXS®= ¥Ý%©";ðÓpÎ{Ô¥Êo­P»S5¾ùWK£F)WõÖ<OC}ò;3= 7èBrFUs÷jVú¤Ôìøý9kØQÉÙý6"ìÀIã>h)nïµL/ÿ½¥%ð³þY:Ã£V]ì'øÍ>LZÐ-Zåt×ÜõÐ³ETËÄµÇìàþ@×fl^«£U½:§¦t¨7Çå²êpdÕo©ªßµ¾GVPÎ|ÐÈ"ª+ÜXþ±$èWðAHÊìÂ³Ãì/á+ê¡±	ò-QCqFÇóñ´Vdµy¾{=M<íÂ5­p:z-¿T©ÁBV9ÛÈG=M6¦>°û×~cÓÚÄâ¨;;Ã²¾EÌµÞVDÒ&ÿwKéÊ3XTÿÔ *UlÆ÷®,Ä1Æ©;©§cd,2WË¯y4³ÙÑ¸îz±ï¡cÌºiÅª¹ø<ÄÅÓf)B Ã9ý³7;³õ^F)ÝJåt^móD:¤üçÀ¹«¸ð-åÖ0sð­MñõÇæwLóÑÝÚüÄÅ«~¯»ÉUo#:5ÐùéíñBVÑrù?3*Ò}ÛÊ8)±ÛOÓAúßæ&Ìµ!D6çä©Øâ Õ©ßZ¹¾¹mÐ0Oªr¦Këb¶ÝçQ¯c¿Ë;0	XEóNx}eÖd=}|¸lAvP)®(¯-ºlòCï¿Úú;IùIè¬ú´üÆñ{¯W¿Ý%ÆOqÓ=MO±z¹¢ë¨Þ#%lµÈl5èÖl8ÔÏ= }ñ©(ø.+û'þÝÀCªË¼
>¹Ï8O= Ö*¹4ß®G_[ã!ÌÙ¨ixâ)þ³bôN¼	4!ÖLZÔÌV¨òe´Ô.¾= y®ð<mÏÝ}&£û>.vÍE	fÖ= DÞ5WhÈeÁÚ-S6^ÞË·6ÁA4föPý¯]ô2k× r°-!\¯>n=}¤y (y*2V¸ÂÐ¢üp38'Ü@sÐ¨:ZzÐEä»ÌßQëÜÙýÙtS?xqn»->kÕ+Ô(= ÔunËN#´­
Qèüÿ¬*13¹JEÝ&N®[E÷	º|·:ï<_
jãçRInË'*1ºF
E6aj-õË¨©¦I ®äE=M¦!3J@C.7¢,ìC.§¼N÷¿ÔÀ}tS\eÍhÈ§º8ó2H:m%tidÁ¿ÇÄc-x:µNpr4}])EãBÑ©pMúOiCWNVSÅhÏOUÅa>©E/tÅäÝë ´ÅÜPÁpSs'©å53î «Ýú pßÁÛRuVR)á§>Y½Ò5ºÖ-ÔÑ¤àqµF-SNZQÀÊK6<¾ÏßÚÞh®æE÷-ñAÙN{<çàôíS
Óï½áFIörG*ª¶Äµ®s#.z= êx¹ÐXË1ÈJrbÚïFîZØÀF9¶îÙAî¹qïSî|:d·§Ö JïJ«m}ü#dÓÒÕ^<ÁÚ?è½6«Þ¯äÆiÒ¥ÍáAÉùyífD¤yøZù×FðJhBÌÑ·Øôå9c²9KÙdÙ¨9Kádý^~
õË@Ì';4
mpp4xGlTÀÌ¬i
epaê¬oHjJ¿¶w>50«pá8MzöÂ§yðÈI6fsò(!úÓCwfwó8%á8ã¢*üOD4F:@R·«R	¹?á¤¶mJ%-£>gRjâpcýtÛ²iÆ½JÀËi&(k&©{YÖ|ÙG_ÈÞEÀÊJðä3yúîÕ4¹Ônï49á= ÈãÀf 3929çv*¿õ¾jV1î¿'ÓBÁæì¹ÈÞ¤ÍIsVoÝ8D&ÆÓqoKqÒ{ñùÀ}ðmqöýÔ.=Mû2ðÇ(Ôrà[èjÀcèRÎnÙÃlÿ+¡[Çä!©¦®3:·ÎfI÷ºÓ
öõ7·ã	;õsVÊÐTÖOéàªK¦jTÚÔê%æpË®Jîï­hÄ¦îDyî«îZ3-!õÜÜkJúZâA{Ï¢÷ú|ò|ù> 2$»rOü0.³ûZL9¶= Éê+~p\ùªÑ0Zò¶­Õ÷4âÇWÄ%jÐÆiâhÜþ'CÕçKü|Ok8h½aí¨AÞÏA²Ï/f²©RÍÊáéî»e®yÁ$×f&ä"[C:¡iõÞöPP-Ç½¸ö¾³=}xrQÚé?åª³Íæâq@ÉDö¿:5½äU©4QRhÊ.[¤÷ã¬	.D¨ðÈ×èRïmq"ÐèqÒ®m¿ÞóêÉ{4î­é0Ù²´!½ÇKÌÒÒfÚDªÞc=}UúG.íùùy%ufy;?Î@[-~£*ZøÏT%Ð#WÿP(µ¶%ú¤º4ÊÓôxùÐÍçØ7¢'©¥ÝÌ®e{H"@îèªÿSÞêùX° !u6ðî¦²àówr´ÁO-Ê:E 0Æn-Àk´:î4WÒ<\Ì¡ÍÁÐ=}Ù³íÌao'e^Èñò:qÌaôÿ|A(*ÀØ=M.¼£0¡BHöìVQç.pZL8âo,±²§0ÏÐÁö×Ô$ñtâòªS6'µ®ÅµÜ¡æê³ÀÙ°v7¨ÚDÛoX¼DÙÔòØ¢Í{Ú&¢M©¢Òq:àº0ÅF¶¢sÒ*efp	-Q.ó*ÂBIU<j '1#uÃÛÛBÖjÚíZ¹~ã.£fùm³èì0c¥Tòþÿy²§$pq!a%VSúµ%ø»\qÿ-cý@ÚW6µEX.FTº¼wíÎ%·ðþé>ÜeÃA8úYEnbé3Tµ¨§õÀªïõ}ëÛu@Læé	hmRCE=}¿_1MJvC £¨Sô÷_oÂ¦pÂ¾åTÍ©dj@Â®Uã3³Hô÷¿h#p<]úEúH'à47êXUu1ñ^öXBÝ]ÏÖÑ$9gÍ6!Å9o÷{Õ¼¡?ÐÃlAølØ²Ø'EÞå'Öû ÛªáÅOëO<I¦<QÙ´NOxÚë¿LXyWÁÀ+6,e%(eÞþ&O\³jf/kd±Ùh)»NzåQ4cæÇ@øÚÕo hGVó,O4ê'óDZ+â²¦ß#Ç·Í8òQ¯Ï@OÏ±2û.¿aðÁTÀXÁZÙ3{CÇ¦õ§"æ*cp{ñ¹/î**@à¦j]Ü× 	¨zKÂ ºÖÉæ= ÓPu M!63}@xý{pWæ³ÿ'®-axÖÀ¿!Bgq1M)¯Þït³ïUò
Ôp	­²«Oúu¥ªãÕq¹
æK6#0µH
&¦ÙF_ß!ò."UKxªM ÈË)ùL³|¥É|w&py© Ç¯7¿Äæ(G¥0ÃðiÉ¾'Ga%#2*HNÊ
¢Ë&õw¹Ó3Y±¾qðå»= /ÊAR{.;Ç[%¹ÏÛèÄx>90Qæ©6¬W?>-½oÏóÞËQCÓ¨M¯8£¤Ø¨"pÞE^3µiRl±ä0û¥óÊ>ç1<9¥iÊmêå¿c"_XÁÂ¶Ñ'HÃÍöTÉÓ¼ãxLÉ µY®¸E
áMûôyïr°n	Æò4îÞt©3£&Iüú0G»p¯Ch$w·Àë{=}óßçp¥·Ü¸åÛX)Ò®h|ìr{éz!JËé¸´|Áúü£m	[HÙÄ«kò-g;= R+þ4kªì*_dÆª<¥Áz/=}û¦mý3PèPKQ:ÁFDÏ¦tù#¸'ç^ëgõ½=MÇ±)Ø!²ÝzaìSÌÏôæ¶ãíä_¤JM	ßäÀòUx÷¡üGØ¾g	fè|Y#´5ª´}Cá¥:4?#À4h T.32õçÚo¡Â¡&éÓ2n¡÷L÷CH#w}÷ÎK8ä¸×8â³y5çY¢7wãj¢*ð½s¿; ¡ZNY¹¬÷ÁbQ©µÚ;°ÍG½ZÃpäT·ö:Azd>'ÉßÇØP.O¨#A ëÐ5çk¯ FBÓ!wèÑ:xÈç^¡r*î7ÀNÌ= §0ô¨°|ÀZÜÌ<ÜÎd÷q»Â0=M§ï@øqÕ©&Ã±ÑÕ4Ê
¥ºc§¯®ýús<Éz=}ïz¼ð~å9û¹[1»5/wxïÑéüÝ$ó<Ø ç¤gw¯ÏB(þÅáÔS)ø·((&:\(h,à¾zRÉC	n8o±¥39ºêSÈ>$3"ÌÓÙC·bwê@*õ(-= 19¿ß£¤wó ß-5ÐÐÿ!gbÈ%­&nûæT4õ<¾iqE!Àä$Üq¯êv8?ºæ±5&ÓR(KéwùdDÆûb'¸Í³ \ð0£À/K§!bÞNÕ?b	BóË0¦dÓ#8³?ZAÕCNäêÝÄ,uõÉüÕÛz¨¹ËR
8ÍR@ceÈÐx7GOf¯¾¹WåìwiOÛÀñ!K©¼¢'YïI«eW%w÷5Låh>Þù¤+Õ¾
"°l#yäDf#~P à5¦½ò2ÇWGf4J¸Elê)ð:5¸áa(Éx_ýÌàmMÄÐQµ¦>ÍDf0¶ ÷7¨F¿¤0¿RèAóGB qOn·ecG/Þul>ÙíÈSøI¢^U]ålå}0 ¦v£(_oF:îÏgU±Up*ØÐmÞ;Y{ÖQ*´~o²eÄÆI¶iOú@»pÉ£«
7J*â¸ñjfP¨ÂçýµÖ7rºªÖ8×6ðþ<]¼NæÊ±÷DXeÇ.°®á 0(q¸ÙéT=MXØpÝhÇÍä(õÖåï;mXºÜfú-¹!¾#UVüµý>'îoG©Wå mòY¥Ämæ¡ÈB}M¦ëào²kâj$ÿ{¨ç-_Ç¸ÝO¸BÕC¹ò|6»þÐ%$ÊÏÁÐ~n
lfÁñ¿¯©~Zeà]Ü=}µª3ÿ¿6Át¿åötaàï5éBÒ¡{ùbGÐCG¨×÷Dè3?=}«²0]x¯I^É 7 SÊÞòWzÓ¤buÆÄ @qª~p.óxÀø&¶ÿxÞ÷7Ý
ÂæÛÄ#g?Ùúg9= o8= 1©Y×¤§ÀÔõ7& }±8Wé=MzUæ »mzØá)*z÷º¯.£ îù¿ ùgK©B9»MG£-Îi^ëîª+:
ã×àì _5:BüþµözJcoÅùpZù«E¦krû4¬5îVM¹Ö¸ùÈênðfpi­²Ö£´rÆ&¦Hëã?çÿ¶u]*	AVÔO=Mµ ]h¡-¬2ªaÅoÞ£y¿ïA9×ígøjRoYXïd8¢ÃÃÀh¼gþé¥ÒD'oøwjùl{ ZÔBÂÄheê»ea÷~åvñìõB½ëçµw-ö}bíªæé§öÙ®·=})¿9]µÄì
Ér ÙsHÚPÄQºù -¨ðpã>KC>wÝáåûo$Ôÿß5o=}gædÀîÐ;fÎ¯Ø(?¶§eBRgPÛzû]Í¹TÖa0õþ£)ÚÔU~Ç¯'=}ä'M2Qõùº¤Q£âWóå%¬|¾-ÿÏ\uMSÎò¡Tx}(Öïðñ¶½MAå´6)mVºÊ¸|á4×,t8ª¹¸xV^¡êo±4)ù7n>Ëz³xßY3g2ÚêÃõFö¢»õG%s$E¥¼óç¤}ö@a=}*XøêøñH%Ä¦/2iÑ4V·eIäÐü/ÇÔ-<h³Aa¬æz3ÝªÕ©'FÊ·iãeú¨!úBÊ È¨VÏÚ¥´Þ¶®Æ9Ô_SÌä3Øh<9õø.%¢I-¡A\%*J0~[Fb«jðßÄÛÞ°½kuïòÉ®5ííWIsù4¢«º¾XB;¼Ë ËU××ù³W³qÔSË:^®«òÇ×= §¾õµVsîÒQzàO³jÀQ&ù7°x´(7\ÅëíówJk:Ù^yª7+J*:V©qOtíøú3= ûÊIcu~¢%®ÀDÃx±\YGÞJËfç VTÉÄê5Â¶i2= ´j¹hÑO³*±f/®ÌXSf+=M=Md!Õ¹PO@ÝÎÁç5Aûò×Z%þ&¦ U÷ ·ÒrYÄÓÔÖ=}gsQÄgüVa=} ìµ%­J* úgb*>Ëú-NZÇ~Ú¹Ì½>½âNÛ	ÄSÜÊ@!]Î¾§ô½ÌwQ¤9´ÌÛ\ë%t6áeïÌ^-ºNj¶©6Ù¥@×![è¨£BdåW@s¬¸¥!»'Ñ_Ô>!42¡ÿùø3@ÙXCÙH|ûÉþ:¢~÷ã©ì<-¡3Î?à<= ègÁþ>àk\Ð¾Þ°ÅfÆ)D¾O;1Ñ¢ý9n>òÚ³=M9vN¨°\ñ~ø!µÇdª¶?÷
ù ¿Ó:ì_Kl'â 6ÊÂÃ0BÛÐÃvKb¬¶©DMÁ×HÝé:½eACìéã²¼Ö%aÈvfÕýÁÆvDîjÝWa8B{ñR ô×!ØJgxx= $c8J®¨wb¿ÏÄ1ô·{Ì;¬Bê÷[9?{Ö8±­sîgY7"ÜQ¶1¯³R3LBv+'Úa*ÅVV[¦Ëf"d;¢ä¸Ößgh¼gþéaQ¦ÔQ¦:¿éÜàÿ¯PìNBÏ¸33HhW¤ªÒµaq}!ç(÷Í C½M%Ë²Í½)Ã øÍf§cP²oísÒªy
W=M¨o-¶»fë%¾¿jl=}vEbE+?áYIÿ
B&öBXX¿XðíqÀ\¹:&4½¤óê*Bß¥wÐ*WR°ùÌ¨¾y×*í}Öá5ÐÍ3BÇxÌ§Oêh¦Qf6në×Ä·õ²½ªÚ¶ªÏì'ôÇÿV·5 3ÎRÎ>ðµÁx»gÑ
N]ÌÈ×ÞSµþ¯kmÂQcÊxÓóZ?{Xå(ÀùýaX.ø­õ3º_<¾!5°±û«GA^k¥*PCÀ"9µ°·?^¥ÅyîøíIì= sS*x)1À=}ò ÷Uë¿Ò¼ê|a¾áÉÅUvÇk¶ïßwYùºhI¹~29 ã.ðgeL0Æó¶/èaÆ®ö)ýÖ#E gbWAciÙ¨/8È´c5Ëà^Ñ ½iâVlÃ4P lâ¬±³ñÁ#öä¥#Z ìÀPZ¡= ·ñü
 aæßDú?Ò­ ÃðÒÙkë¶_R½â¶ªÛ¿= Ö¸­:Î!ÐYÝ¶q¿aÕT¶ÚSÛÅîÅªÒõÈÊ»®®Ê;èÊ{¿§"~;k#Ù{cVôêO#4 Z$9q!ÿ´Þ%³|Ú-UWÅø*o;¯Æ¢¿r2PüzÂ¨°¥2#q:1éS"CkÏH@é´!©Z:2â­NÅ%þ["R8keDGÈ´n¯µ@$Àô¼¶JW¨Tâû~·áÿrH³âÌþpÁz£s£Äk-JÚ $¾µªýWø?»$÷8?¯ç±?$ù¸ABD_õaYûÉ:vÂxÓÖ¾Ø5A	=MÎc6Í8Ãhw95Æþ¹ß4-"¨#³AY¾*¶03ÔÏ&Y¦aã@E½Ãù=}#]ùPjãá(,o= dÙgåå}gkV®2XdËý°{ä?~Ú5ðZbmQoeâ½ëÜ¤BýDÒ&Z^»Ãå*oË-%öSÄ[nÝ"L/'¬y)ÏÆV¼Y+ôn§) ü%ðkÉb¾ªIËsÕÒ;)¬ÚVM 45®éLbÃ·ÙÉù~!vc:ôº6.	ê^«	l)ÌôÚBeÿÛì ­w]QR×8w¯5[[au£1²+= èLébcá6 NJ7Ë*°Pbÿâéilå)®Þ´özb 
G@ÜG¢Q|cäRä |*ºE¼vøòEöN.ý£¦T¹Qµú;4êãoX½J[rËï{ÜlÃÌE?Zá= Sweý"Jn|dóh ÑÁ5/³Õí¨t·Wû¦~hÚÓ´9ÞrØ	äF>; uÄ*àöNGËÄ÷"µ'×ñ2Ø6 uä§Ì4aþÃeðñ¶¯ ]é=M­K£ÀÊp£ÜA®h.=}6gµÙ­âQâ£ª9"Á;'íõÁûPáS1àp#= #1Ç3éRLZº¡eBNÍ7£6=}¯¥aïWÚÙðW*NHëÓS¯8 T£gõ_õoïàÀÏ']ð¦³WÀá=}ÊÂGøÃ´½úÑf0tM?]g°êá¢øË×C:nÃ~õAùÓ9â7¯ìb)«ad´ûæÜ¶p "Ä¹Y>Qö ªBEç£Z×eÿc¼ª
ËãBA%Øuª¾ñ®Ð=}8qOè<b Àª&æU¥á4â:+~3ÊÇ¢Ñl4£°Øoî  WóÎÒC0ý Ý£ÄÔ¢©ª¢Ìë*¥¢¤èÑ^^t9ËßF§¤$mú+$G|¤sÞT~È÷ÖÃ\r	Ã§Ë	Á+*	lPPØT¼LQÐD¸qåVYùxq¸ît<PÂ.BEÄ¦ÑV\*þ4ÊÃÁé d²V_
h2K5\ÆT%=MÓÀÅ=}!k×@züDëSD)ÀB¨¾É#À°óª0>ÑVmø1>g#7Rêw@/òï¾Æ+YFbäÛ¼Ø§M&àTÝSæT¹>Fg¼ËE³U ×êÄÅÄiuàóÜ³Ä±¢/7C¨´l«ÇjwjU1À>ÊaP#n1eùÑ ãØ½ØE-,åE­VeríÏ}W£ºÛðXÎ"æxÆÃHLa±ð+zI4
Ùóó·âÁÝ1§óÂ²ï|Äÿê]ïB>\YyïXö4OöÐ£>fE5ÎÛIÜÉèÆ»w}ÄT.
¶84Ç8¾ñÂyë+jÄY1Ýù_´¸çB+d
R=}=M¦>;öæ×µg=M«¡Õ!B.ßBNygï­g%8Lldñ@Ueu¥IÄ\íóYiÝÎõ±ÂpIñØ= YS ÌQ%¼svÞ8­¥rò7NÁ?¿CvHçfëÙÀa#ÇUìó;¯l X:ðQgÑBE[£ÆÎß#¡W5"¦ls*nã|MÌ7<Iømñ_çü3ºjbK?¾33nm0Í²|ç\^%>5fh²7Æz×få= ¤øq(p>J¾Ï(pù_MMÂHztéWøîçx8ÏRÜêSùèãÐñæ§é3% ðc¥õçÁL ¿:&© t<h¹×6ÞÅUèÁ7Â]ÅdqÏk³ì²Ä!òC>ÔÕ¹F^¯.v9úÌvÏÖÈ£Õ ½Åáþè§uÙÖIÇWsýbexNëæ=}$3 .Ã±öÂ9Áåc¨*
~x5P«6éæJßÓ³æC³ýó§¹3ùìÎMV:×üÊ¡ÕSµpeABºëú¹ÕÝ¬!mûZ]ÍT¬¿¾Az0ìí@÷)RÇO¯Ä­s¹ P]&.f¸!5£ÞÎ=}ùæ¹ .)¿öÞÕÞ:ý T!<XõÒc<	¥vÿe§qMÒÏ¢ðLV"Áä×L,j5a«¬OÝÀH°~-Ì©!nrº= Y©äEFÚÚ8¹È¸=}zÎÎ+¯Ú:}ÜXrè0ÚPíH!÷ Np¼ÆRâ¾èº2¡´Õ[%þ&ËÙºÁn¿Ñ=}ÈÈfé^ïA ?7ÒÑ.»Ï®^)×üáà&öº_De>íõ÷PÊÏ7û¦©Å¿üïFG:ÆÆÂTHHúæ¿í1"vu©<½[¼bzéÕÕû,#Q pï³ý>{àíôêËõ,Åk(Òã/Äç/¬LyÍAçÇmü«MðrZ£«TÿÔkó$hvwöm¼Í½Ý¡´­·ýÇ»ì¤Bé¤ÚçFg÷9aÇtåKÙ*ð.ìNÆãd©[= à$ottÑ:Uð±Bm×QãÏân9W²Mw¾o	ýcC-æMGè´~áS	ïérqÃ£ØQÎ¶mùËKeÏ¿ó6<<J7ßÖS;Wù!a5V#¼Ê¹¼0pïºúü+¯¸Ýäêm°êÆëÆ½ò±{9ùCsí5T®zeË®øÃò»ífw±JzùcÒ sº÷¡Â¶Þ[)Xº«FIý:ýzúúí@Ô1z´·§ï-â,÷Eõ/±«ÿX£ èþ¹¯Y=}¬=}T­?½ù-úÏ%x2Q)¥¬¾4B9y@5Ø"6ùº*MÕÁ,øÄGMðzdpF=Må×Àíø=}.ñîrýÉ2bz¡4}ØZ	£eæ¶^Pö÷&wk­²7æJ¯Ð>VwD×GR´T÷ïÞ"ñ]>ÕÆæÉË×ó]´*uS[³ËÜC®Oe}¤ªR±#äugöò%-èwÖrÐô:=}*\¾!¡ÅNàº%\²eÖ5M!ÓÄþÎÏiÌT¬%!¶4ðYÛé!(A¹¦=M3gê3FSÞiýÚ#ò²QGÿ×N¼@4¼ùZ¡ø?î.I©éNzó{ë)K¸	É{æ·Ø«O­0'n&ÃPÙ0|+C/Ä«wóUl$©<¯H³ÛFE9l[5bºzËÈT!L?äþ¡Ãh@p¹aúÓMQDs³îêO<4R~>VófÕ~Õ-}/5}Mt6Cõáoç¯åT¡3B÷àÄK¿= ÀÄüÃò/º(Æ×wÕ³N|©ñ¹4	¥}eQÐïNô·÷½ º*yÉ/#Í= Åf"!æÙáÊ9µä;QS2ZP÷÷§NÃP¯§ÕgFÐÇ95}E&¸îåÌUfxÐy/J¥¡Ë'FTfÍiø1uY@TxüËïËÔ)ßôX	XZLWq¼béï_×Êâm¤×kÙoäÜ\+
¶KxDJñTÖo7È,ÊØ4ÕIÿPM#'QP¨CøèÕiPC´\ EWØ÷]b5|9§úü'Áÿ«Zë¶ªã_íLh½"[&þQÃ!®ìùJúmÄ ¬ðºBð.ÏNd?}&­c?2Ù¸N6pjú¼%ð¥êILÅ×ö¢B¹@*?[R¼B;WßdÚIx"JóþÉ­øA»µ±¡hø­7*t-ÃI»=}Öê1ì2sM'û4ËÃ°ÒâÉ28Ãý"AËWÛµ¶EÒSë½Û·¨o²GíæÍÿðÚHúx.M	ìØðhëkF#Çh¿m)Dlbö	[Ýq¯ö67ÖXß6¥]nBßzFT22W¿M×j)hvßØþxï[é(9c¤£TxLz;±Ûñ_ÁkÓ EÃäÑ ¿9§£MÒXoW¦Þ;£Ùô*î6ròR%éXâ@!-Oùó«Ça©ÜëCY]¨ì£DWk¹jíß¿u\ê=}ßâEFúå¼¥Ã.W<¸»= º#§+cTë/D÷¿Fµþ|-]]ú.5s<3¸~ââR§¥ëâ:Tú8×$ñ7g)áB=}*7zí5·ÐP'öà	37Üâ¬Mjÿuä¦O Z§8U©Q!ôÆ¸]m÷@³ùÂ8×Í2¥Ã×§igÍ
UJ¶÷aÕyJ]¼Êî#Qé+ÅmnLsg¼¿Ü0= t¶]K7Õ"¾¹Ý­ÓÄãhàg¨û±Öí-?gIS1Iåä£_Õ»ëâz­:û5IÚ3<}x)2¿¨2¹¸Ù òC»O{çáÝ1òë$êFAûþXd±bõècýn2ê<b(E=}â¬g'.ÿnÂôYK*°¹yÃ¢¶TÉøã®CÖ°l:´Hd\Üül¨Wkè<~«Ì\åf=MªiedëW¢Æß¼´B?z/¤:¡Ì^<åo»+¥FHG×ném@z'$xgëÿØNæbÈ(aiuhn¥70Ã·ñ0rpÂ¼£º7L?JÔ[Ù¾¯$Êê^"gÌ+è_¨0û#¦äe$¬wäÇqdèR!Ã÷ìµÝ,¤WÖ_7akV¡~T»ùCÔ¬Gr	¸oK[ã*me.q¯=}¯3±ÒÙ¦FxÀÌßpX3aùõfaÇ+ú#²ÍÈp+(÷NÓjéªê(yb8úÂÁÏ#3ÂêÓdóïz³ÚÌi[EÚÛääeyïP#Ð·0nÜ{ UD¾:¸jéè&Á@6ÎËQeO(Jin(µ<ÜæØ¢¿¿øF-Sçct¸8ÜÇç
²VSf¨6·´ñÆáßn'¸~PV&ªYBv8zY
ðØÙwpt"ÏÒ±ô¤Ùs_ïzµ?Qyõ´!ßzZpf°+ÉóhòÏéÏÂÙx´HC^_- B¢ð= ÌÈ·³LàRL²Rñ¹ò	#ªÜK¹EbÖ9*<líq«ôö»Wî~7d1u,¤{1@yÍAr¬Þt;ÌhlcIWyú\ÉC
(¶D)úÄ#ì¼ïl<|>zä¬ZÝ=}úyÆ&-&d@]0^B½'ø÷ª.ÒØeî8¸x-CÍ[Þ¤:âOþÌÕ´¦;ºéOÖE±Yóæ¯@æ%­CS8ì"h?V< F¶ÖóLÎaý,=M&ÉÏE Þ®<[=Máår±TÀdF|%¶NÂcõ©Å¾¼&Ô3ýÓÅië0RS«ªáÛíÞ<®íÞS Ðy P[¿-O¸QÌ©¥Ü°ÔB"Ö%<¤ýXT9Uå÷= O.ÎTSEbr¥¡¦!NQ(¶øön.FöæËº ?\)05¦Åd6/tèÐ×¤Ýw@l¯ÌÛiåªæ­bÀñÙ£ ÈÏ×c\§ùê­HU©wùT»ÝMKtòË¡<c]ëeÙ¯æf]²%Qf&Sa?ÊGÔ?æ %ÅÔÒí¹ª ê¦®
D0 Ròþ+CÒý{¿áQlÉg'1)£«aÏÐåÕiD3^O=MÛ³¦D¢­ÀrÊ~Õj´ÓI¬j×FÉ=}æYÈl= 0~Dùbê+°³*~oxÐÇÍ8#\¥È¡_ôk?Ô«ÕzkÀ wH<Á
pðKØ!1ÄûIm?DRcíLN8°XÓÌ¦W(À+wÊÏõéÜP\NôvF+ý[Ì¼GïëÉÄÊLmè|x0ksï\/= Kjv43¦ItdüH[Ê?¾DhiÁ1¬xËÀÜL·Öþp6(#D)j+¬©ýxi¬üÚ+<vËu:¬uJ¼1«ÉyE,¬i²r¤,GËéÕLðmþªüÉöÓv6}Êà(
j
p u+"Kv¸¤z¢_Ð*(£iA(vÚÀý+4«¢_"0Ã+Ö\LÊ1Ü:x²ÔémTÏLx«I= Öû}t«I ®jÌø½À<fò¨éÈøN ddÊ¼Ûr¨¡_lì] {nÌ%E\ yÈ3ÁLD Õ¬¬Ã*Æn¸lÃK84
Ûd3äLöE¶pÐ PmìcD|¢_i
YÜ{ê}N®ªÚw[r|(JîÞÕtçOêÌÈoê®>JÇÌ>ÔÏ= Î@dÌ@¯ÌÌ+ìÙ_!§|ËfÂ®
Z®¤úÊ~ZÄì¬_|
\¶\ë&Ø{vP>à#¿vìe>¶¬	·¶üßÜnF3\LR1 kQ[Õx|PkÌ¨K}TLlÊ1ÄDYe%4<)¨_Yw\5Ìê_è3ëFd¨<¼+©_4#S
m\ª^K}+øLÄidËª_^%+\|x<ÐÕÂi4Ü{çÕü%ÆEn <|	ï
Õ,ËHt)tp#Kh ÊejÌ0]:LÕ_ì
lHK4Ïí[mÔ,8Ú¼~ ûY3ÌK^¢ºv= T©Èº¨c«_ÔJFtV0û)ýkOËqNÐlQt$KÀ1 $f&¬ì©_(Ó©k$7{Ô\|¼v._í>~7FxÆ¶<ú}°,EoSZ¨Ï-:ôx:TyÜÕ<¶	o7tûHÔÐYÊÄy8àû|qò}dT||÷	Çl%NZ´)U"àÏ Ft&JmA
tºúgKü\vÚz ë~Y0ÛvI.tô(kK|@¬vWaN¨ûJ}/ü)rv°l¾M 8ÜïKõwm0Iz<vi\GävnuS1I	\Ò Üh\ÏÇg_Ê)éÁ1Ü
;=}ü,ÿWtÏ-þýpÒÚTy= T]K#+¤|÷+
ïÔÕü+½tg'ÌHìÕzcàé||ÇÉÌl VÂ¼ÊÉª®*A7lm6r tRNp[vQTÐcNàD»\$Ïu{|yÝ~Dlv:j*u¼\ÞÕ;U|t,xI~#ö¬R ®
ûÜìþcìÆ1TÜ©	|¶
¬ªÙu<ÿ\ äOJÐlsI&ªýåÕ9BtnV
vFº¬Èz0= l}n[Ê>~Äj_èË1ìõ§iSÌv¼v\ú	÷m'BÚÕü/~H\Km(ÏwQ+C
î,ÒÌvpiÊVøLÕ\ÖEJ&¤ÐG&~= KÇÜîKE~ÄªÉ<ó
*>ÒÌÊÁ1 lw+qTÜæ	Õüp¸ÔévÌ_¬0<;r9kïôG4¤«E±1ÜJp¤K[:døýY¼»Êu®Jõpw²ì)
hGd"Nô)bm|OP,®<@hzVÃKxR6r+JRëó\Q+Á}ÀPS9ÀP{R,p¢ ÏÌl
%
|ÌÅtSã
6ø|ÈM7Ecl:­ã¡yGÒ6Þfµ·Cµ«0¨f­¨1eÓðd5^5¾#5>¨^åD/eØ9¢ÄS;>¾êÀø   [JÉflY	8ø
ú"¦[ÒeÀÙoØfG
sÿ÷êä[ò(æË5íËQÊ·¿PÈ³Îo"éÙKX ¸,«¯~D¬,(ß¯9ël:-°ìe3Ø	­ù0+{È¡Éì4üLÇrt{ì.täk¢hò0QIkË®ÓupÁ4*ÿú#å¨zÙôa6å|9QLkQ6wLë$w_32¸».Q|q>ÊÇ&FÃÛhÔ¢\r
¹vþÝ{[TÒ²ìë	?wÏÆüÂy¬(óÈÎPÉ¶CÉÍoaÔ
ä	âÐìF ¡ul&îÎ3	íÄf&»4x=}±ßoFÚÒgg)µ~= ë3hóÆÊé¼l[RqÖ<³Õ	é¦èñgêÉóÖÞ= ?P~H¼#@O3xðËô:QxÁBuô"úLÞVa5dY÷±ûYôèL2e= ÜJ«qlíP´D<ÕÉzëÝmFDûú«Õ	7Nõmuê<±Ë=}AzVnpwfÌ^}¦K3ÿXcgn¹þ<®¦P3Â¼¼~'"Ú¢ç!ÞæoL$ÁjÃ4å×ÍÖ(ô>Ül!"Eì»à;2xèaãoZgcá;lô,Õ)\eÂØõQ¤¾¢GßCóNZl¡ibX0²+ãYsDúçWcöÌèasF²K[NÁDmU8±ËaZãp°Ãxz¾J·Â-[}JÜºùÈ$xS_\Ûw¤Aÿµrò¨,úÌãÂRgì²ËHZú):RVäÇ
;Ã¬ògÌb}=MwÃ4üÝJ%4ëÛ=}úË= úÏ¦lYZCu{(8×	CHº?Q­¬¼ô	
Ê¿IFQþþ.= {z±~@Cºp»ºÄà*"ø¼x´~ëÓàóÿF«°ib£c»{HÖL\#«i<<±+eeóé@sòÄÇ%óçjÆï0QàÚÜ#¤ÚÚd~Îûä¬ÁKéohCbûFQÉÙÔOWéÛâoØ(f³ì*´BQ¼fCº× ³º= Y7¼¸q "ÅtÐÚ'ÅK6µ~ëÒúS¢ú[Ê$y3èÓdêìoªáÿIF$Ð%+RPVò¬xE Z¢ò¬"7@Z0SQUELoôÏ];SÕI<º\gvä<[E¾L¶~a&ÔË²k3)Z=}Æ{k=}|';	4¤Bâlâ	 UÜÇ=  cì!Ï¢= $8[J<dìS#Xë<×'þ»h|íÉCuI8Q~JC| $EÐ= =}*·d!æè6b¼+êøµ~Sbú¤óÅA1:Q'&ïiZÕu²~"Ù$IÄÁ$DàNÊd»$¢üèæ4*´xâABßÉªK#<:Ù+ª'òqê2Dü\ô$L¶?âÜ|ôÿ÷_TÎ¬}=}b,¿ô÷uæbQbES²CQ¨!CªG^EQ (ÃìyLr7j6üÉÙ»¼kþÅ³d<±~p»Ck²Xóa]þôè^°Â(ÁwJz<4ù\i_ÛoJIù@÷Á½éo&Ùà7ÈylbÜoSgCn¸ç+{Åß\¸5llÌ(·~kÃúîã>ÿ«	î.Ã¬)Õ(¤:Æ2ZK#åv¼+\vÄ^µÁë@0Ðg÷±½é= 8»(Áo³rY= ÔpÄ|©û¡ê´UÞæï6ÛÆ	÷¤ð¯OÂóÉ®"=}S||~|LµXõ°XÖ?ÑÆ¹°ñA#dxì\¬?ÔsÔ3WIxk\¬¿G?àº¾â­!Aäú]Wfàfö×.¼<øI'îh½< hbÐ5Õ-ÕòC<·$/:^cuqÎ}:Y|¬~¨ìL»"G}fdüíòLÓF4áÜþÜbù¢Æ£®Ú^É9çAÒâæàïðJ£,ù6øÜ>åsÅ^ÊÃG¾¿ÇÃÃg§òÙÖ½Û{PM¡píØïI²þ~þ¯­,Yjx§2%ðf½0¶ôá øñ	êð/2L^îP þ~9{®h¦ ZV£Þ]¬7¬!ùÖ =}g9ý:1ÝøüãUõùVõ6¯ º£ðñ	ï)Ææ+¡Êå2ìÜ¤*!±NÊÏ8d¥úÂÔ´ -±ØïuÑÊHhù?ïð²c9ÕÊðÆ¯Ï¡²½ÊêÑIöd¶ÑxpµÀYÖéB#¹G'­TeTïcWÙCÛCÑñ§òÜ¡Rq?"n#ks!±¾Ë_e7ÚàwÂÃü§cGêõ\ªgA÷¦§cAÐ@¤-pLåghzY^~S3_uä07ñÑPÌú ±BÆêK[sÑ8Ç)00J%:Þ©©Nö^ÖVÓ<ãúÏ(§è /p:âyåØï¢"ÞI8§(±':ñm1ñØÚ×ÛA%pwÒÓÆ§zð/ ¹ï)@&®g'éâÜ_µË²#)ï¾'èB¾'ðPàosÑ-ÐïBDÆæ¾ØÜAQ¨Ppà9sQÎSqê²iù½SÓTÒô$¤÷Â8ßõ"'!¢f¿ËË³¦ïÑz'Äö¯Æ±¸ctYãø	?WÃþ^ãÞULÛgeåØ!Æã¨®ì^ÒKZÁ¨u{¤¥È]Õ¦Ù?±@ï0@¿wJ_IþSñ áwfÂS ?fõ>ÓñÄ0¤)rò{ü²£üºêÑW!;Îck-0ÂãúG»â¶7ùC@±ýâ×#­ÁÓÁY·.Ðo­ªº;'¢b¯R§°õØ{ðnMÒÒèP¥J±bk|D®NïÙX3ÄÄD³@£sÛW×6Õ6 ¢ûÕ>£-ØAõ!(°¦ï¡ÐÒÃîy.qÑ |¥0$;íï08X¬¥"Rô";W=}SE'¿p%èB'¶Ó÷}!N¦ ¹#¥Ë×ÙøvÜ -³a/bqY¨îÖBñ827wÄ¯Ç¿¹²HÔGHø(R b//ÒnÁ·'òî$ØÀhÊ;Ì¡}´]ìZ1Êaú0=} GZ¡àgßûÆÂÊ;»YXJ©1wÓåáácVÔ*$ÝÝaºú!R÷Ö{Z:,ÛÜW^ï$rgÄ|²òûÜÏÏú]ÓõÔu×uÎ´Ñ o6ö ×ÿIëÚ\gØ¯/ø­G3Ea¤Ê7â8»5^Å¹=Mª%equÛ#kõlË¡	÷¯1ê¸Cà¼|± y¬ú21çq+¹¯¸!ÒñÊèöTn³´tOnëáOEýû')!IoUY&=Mk×°nÂn"lRvéOO OàO O°OÐOO
OªOºOOâÏnÉnn¡n¥n½î¬î¤îÈî nO·ODföÞ.¡Ï©®] ]&]])­ëä¯"«ÄÏÏæÏ¦ofÕ5Õ}#v:ÊãOÕO$Â³N&"Q+Ü%ÐeØÓ}­<´Ù°©³qòoÝOô4i©µO¹Oò¤G¬î¸®Dª]½ý+Ýk+ÙÖåÑEÙµÖk°­9±)­É¯Åß»× i+°ÎG\¦)=}í®!°©óÆ>r®=MPG>º2ÊeSvù£Ó>GÏsEÙSÅÖ3eÏ%Î­À¦ûs§Ìà!Hñ>¢2&î= ü_Yý&YÜÞ©|·Wohyè¿Rj¨YPÛùÚÞ×Æ«ëã!,¼¶WÞ¿VqN©Otñ¥îÆ#ÜµÖý³ {S¾KÊ= CïKY'rÑéÞ¡¼#zSg>KºñS»ùÔÂC6hÄ+úïh#:ÜÖ bMÓ7-:;M _ij/·vy9O*Iwéjp©.Á´éðÐd#©|©p;Í77Qµí1")OªWKªR¶RÑxíÆ&p¹t&X$B©P¬¨Ä _VÅ³´=Môe¦iíJ[²qHáÏFçÏó·§U4½¹DKUüÍBOyµ÷Mèä{#Áíá¦$ÀítZj¥à^=MË"Ñµt[Æ= Jý'üåB_ô´.KvNpTÆÈá¥úo¿rVÂ¿õñ·ßx~P·ÿ¢Û:øýmxßxÝd®ÂÀ.M0Ôç{ÉqUÏ½,xd&_ô*¶d}»­%\kwa-7ûÅ0õ¾~mïýº² "èý©©Ry#m®î\y UôfYÅ1sóµqÁPzñ'È	;}®àÉÀÊ4¦4$Äp­= S¦ÏÃÀ{zîE*Ù \<Æ¹âA,=}úY#¨|!ÉÒf	9ep7¤H¡á©îÝNvPh½ëÔîEßAO©/¶7dÙxÕ'Fÿ[LÌL³b¬[.Aè*ü$"M¢ë^Sú)~.= p{L)~ä2¥z= TÄ4K ~p¥¼y[bü;ÆBs÷I"È)2 ®éNâ¤FMPô~O)ÇÅX;6<s!i&i=}	T= Ìlú(]= ãûæ,zÌÖi³#Ao»syQ0¥ X¾9÷¯¥º]ãN¯yNüi|ñåñõ­ËÿP,JJÐK"µpsàÊ-r	Þçsph¡ji{øyPè¨óX©Ùê]fB)e*ðúË5­»ÍÎì{áªEï£a©B*êXEâmÃúª¼F@âgyæènïtõí;QýcB(I>Ál«Z/Ú²:)ÔbMSª¯ØJÜhý	ÁYÄ!Æyª%G!(ÃnëÚúEÖåyR¿ÃÖp	YØ7ÁOeaò«âøÂ;¨-d£M«vRg#p¶(1s¸uéWu°ÓPB²ï©TùÄ{Mb]_½B#s5ZfB¡øû_P<d£å+eWq5ÖgAî¸î9'C)BÚ\/Ú8:)dì= ,Þ([Ü§dTïÁÜó1þI×=}#6	´½äjéÎF&ÄLàøù]?è»~ tË%È#É	#?&ùEïEòb}mm­¥?Ñ&×ÙÔsâÂå0¡ø"Ïè²ãx¯ºËqWðÅÂBD@@@DX(hósZzmíÔ$lk&Zô l^^KÝÔeÀa+n¥[etADóö¨+Möò;i:U*È+Éo¬]Yl±K1´àq
.I¬$Ê«qÓ)I4Wîù.I¥)t³*$TQ%©rþðÜ{TúÎKEHu«þ¤wáiÒÄHeÖ¡Æ= þé8E8v¤(o;spêJEÈVH',BªïÝ©_ö\n¡Yï>LÑ8k5HåÒeß>ÆµFäæ¯iº¶4|¯âUþ£ßvì1·¹= 1K=M= 3xWúr;%hîç_§5ÕÚyÜ¬ÓÞ?ÈEÄ¢ só3e·W;Õû  yöãÒÂ%0¯ð8 ¼Ò:©:~±§ííµÎXLÚfVú5 iULßØvÝSÍëø~G¯Y*gg*.µú¦÷ÔhQú¿Ï°aêQ\?àL¸×ÜËv²r:u:Å8²
+*iMhXÚJ8·ê<1òQ@õHaP+j3'õ1Cî·VÃ£5.e·û[>üìWC}Ð¤y¶Äf:5vyoSo¦[k#Ýaïç^Èªe³ç±gp/ïúbkö1}Qkp°ç®g1"²gà!®ØY»ÇvpÂ×¦XºYÂWÎûkäÕ1¥=Mµ3u[÷¡gb3wà¿Ç¾ig1çmÖõ/yZ¥Üg¶*;ÚPOÏ^<·*Þ©bZhQm®h6~QJ|À>ë·AuBv\°v¤î?E°ÉQõõÆËY|ð"\"òq,"(qe6ÜÞXAWF"?2*­Í0ì¬Ým3}qÊ­Í4?ÅÏ1ÝÖ]°SÅ(°Âkä= ÝzE7ÆzïR@»ª§zÏöõw 0ÓFã7S¢aÁw pñò«DCÜ6axß¼u|<_åá9 ¶dSK°¶bgU£\/ä¨Î:]³f= %íÜç"næÁG_»ø?µ1Í}Ë£»]FÎø(=M×5öµÎJ-è#3ÆMÜWÒ¾)uûòþÍ{ÙTÙY%Y¬¿ìócÝ/!V!Pß£QU÷F¿vKPµY$b'P¾ï$=}àWO¨Ñ¯îº{¸¿¥0r0=MaI<uú·¤Õ4# [°|½ìz$¶	«Îì~2*´Chbi~hÏTy¿û«[6þ\þ(e÷ù :÷ZÚþÌÑ¶ðw ³= HE¼x:´÷I"ËÔ®fT~ã6.Pý+»^}ôi?³YR×ëXp¾{?4Ñ¬l(÷K¨>dbCìp â+Þ!ÿE'b{¸uN,¾áZ>¬:ÚQóVÞ4~¢~¢E¢ »ýÑkÉ®}òÖ!âXlQtMÎQZNí1ô¿YOÔÅ.S¡Mþ3(ÍlÜ$)#)¶×qÂ«/h{w
°S03º¢a¥= Y34µö)bõÂ¹R­¾î©ôçwWQKÒÁ<Ø¾ãútË-ñ:ô·DÁKäxÿoÆï«omiÙøäê¹³k¢À.d:]Ó8¡KÞ qÐ¬$çS-ÆKÝÐx]|á!\µJç÷üÙäP©7º¥RÌw±f'%3È_\â!óìÒ¼÷'9¯£æÞË2GÏtgaR¦»±K°B*cX_(Úíª5l¢]¹MÕËÈýÓ%:hz¶f«=}'z ÇÏÕLã3]Ï¸6Æ¨ß£à:µàdf£ÝÉDKâ±@ÞsIYä&Z¶Ì5ãÍD«¿Ô³2êUÇÝkB%D)J~½²ìÕJ/ìòÙcÚæ¤e
×J]?Ëè{ W	&»ÓÂ÷y×H/Q8§.×8»oËÀ«½OÉ¶PjS÷Æµo ^ç
®Ü¶$âÚ¼Oû.§P+9)d®\ÂW£ÊºbÏ¨µ×¥ûñ^ÀµÒÓ)§rêõº¿ââÔépØ_âË¤qÖ«êO\ÉG È84ïÌÐèî¯<4(¶çÙC6Ì&2Ü
vý$òeùßXË.÷®l¾®X¹ÔØyÎ'ÓÕ©â5®A«¥òQ$7ßzQxûÏ¢÷=M]§Äß}åó8Á{/ËV¶µÌ5¾@ÅÐ¤<x=M7µZxaçÏ[ë¥5s§X0¹@ç)º|ØÏWH#ÏÕH]±á'KÝÂ°<ê}¦@b,Ø¬óÇ<= ²¶bçyùh«ê´õ>ëÉ\5µ²½ßoV)µ×·M?J«JROp= ¹Lsà|OU«]A=MMOvfHçqR7qøë=M
Zx#ìiläà#bÕgn6¼ÓüÍ¨Ö®GzdrìUK{*rÿÌOdUAò[Þ»Ý¾Ù33*ä= «0ä!*0F³nGªª,XC-2£ë[4Ê~)´1|¶ÔÔ@®IZ GÐ¡ÓëPÊgþÚlÉM
Bªa¯oçpÈVèOÜå÷ý×.¹XÊChÓ(KåC-§Ô3ð7QiüTn©ñ«Júa¥ÿ#øÏÌ	:5¯	¢dË¡r3a'd	nQNé6Ò£WKÚ+ä5ÊÄ\(µ2dòêfgm
º=}ÞÔ'LW_ K=MY¼ùFv#÷YAÎæK×bøcÃòáÏWòv;à_Å.CÚeý®NòòfÏøµ×G7¬75'î0wvõ>HáÊÃ5ÂRßw:kû£O<4qøJº1ìå¨ZâÚÒö²¿B}£8¾^"ø3Å£¿.à¾ ÿ<v=M¾¥=M¦¿ä [X/5°Ñv2å+]'¤Íõz÷÷÷.3ÿÖ3]qã
A,7>ÚFÛãÏ
§¶:B=M%ÿá\ÎÏ+}ôO´çmPÇÍ .ABÚBÆ-
=MX
ë= ôø
úÍ(°üW)Õ8,d7üL=Mä®GÛ8:ØK»'lJÒ#æìI4º×£CÉzzú5ÿ®Æ$]É,±­±ì= Ô®ó¢ïçü2}­Á\Î¨c £¥ï{ýÔt?	»×ÌÆOw²ÜÎ(õa&¹MFæNÎSÏvdSv³>âa¿É¹ÚÌÍQÊ<ôB½ «Ó3Û]Bsõ>äOL'b;ùìíGm¸\ì@Èñt½Ñ «KE¬4aV_6ºQ­hxd¹[«UßZd¹Kc¨OÔ543ìTPßwõûí®¯ô¨oKÃâWma¶o»?ûj¸¼6?ôkºu¢ò5}kA)lÝ¬õGÍ= ïÓ®1¤dD+ <fÚ­	ñJ?Û'tcB¢Zïìe±B¾ÕY§¾ÜUAB¾|dïRìÂ÷Â¬Í@ÔöRG2cø'øÎOLL¯1<¡ ©.b
4VLCKxxìd 9Æ^ãïÎvPýé·ï³i0:­iï×èIb£ßtDñ§´%ÖÆÕWFs;_Ô÷2éwGÕé]=MÔLÏ±mw«mÚýóÅ~ÔQ¬Ñéìx¤­£4ÔJçSîãIN[+U5©n¤_Áô³D¨.hÙùHA(YÞdç´èÂÑ ¸ýIä¢ò3,M?&}K{¼Pç,/~C7{õù}ÕÍU}+òçªA¬âìÌ8ÊÔPx"L$<ØA#óh.ÕBUdú¯oWTne}Å«Ñ c(½Ì?Ë	|Qã\¡iIL¬3®~?ÛëÙüÄüï{.Ên]ð¿ÿODÚ}õâh®mfäEK/¹Ë¾ÜÐvèùQq
ãôß¸{ìpÝ´¤©é+®d®óß§×{ö0ÞvýI êÔíïÊåçsØÁë(*ÜmhíÈerâÝð
y;@èìOCîbnî×ÔF%å}´5âK»ÓÉÆTðXïuauèöµCK,|EaøR®JqÉ9f@¨âç~CÝ¦cdï{K<Ý|BùÅÆ¡¨#ZÏzÌpÙ}¹»é:LÒQÉ¬±)ækÐTm*ÞirÃ_'ÏJì[îfuÍá7¥LÙ¥=Mûª·Jº)<Á×¦¢Ñ#xÆ*Zå3¶ÅÄX³áLÀ«DOPÊÔ¨m«ÜP_¦6$sÛTÖÄ¼Føêçîl.wýE{¸P0ç¨ÉºH²;Ôb/Â¾WÆ©0'¦}	×9æÄr{ËÎ@£ÝÅw¡ãó)RÊ¨/<´qçà ÃMv 	Éí£|« ]ÅÙÕ§B G®KØpf[P%É®ÉÒ.p.Ý©Ç¤<r´>hÉ¦[­Ô¾ÅÄ&ÊêmMkSõB§LÉ¡4¨: [À3é{ÿÀ­n4lÝÁÆ
)¬û4ð|ëOûÓâT¬m¡¡p)LS·pájEÚ4|SwbLð©$ÚÒYz}Ì²FCÍU-øÉ{Y%øDÓðÌJJ¾ufÀhk¢Ñ@<Ã­÷Ö¹²ÃQq«b>MòÀClQñIÙ;P8!ìËÿu·LÎ= "à	È¤ùLáOXîØîú#;¾òSßù%´gDR>	Üí)ê\Ì§J­°E´§U\SÍTk5ªE@ÞJæü&=}4gN´Tê}«ïÌPÀ|ÉU= ¨wêMJ¾âþÁ¦?+è~òAÄªæÂRÇíwBK¥ûÉ7±ÿVUÈÜ+èÜixD©H(°o@¿ÓîþæõÁpª&Ø%ëô«¿³.3hýEé»B¸ppau#Ôa¡GP\4;r§iÔ)çêØÔD»½¬kpD-ý¨ÛËVs¶+Epéýh	RãïIÔÂÑ/æ<[µCä/yojåmÈ	ynEj:mÈø1'iÔN~^áû½þ ÝôÐëqÄGmùÉ,Kc	=}Ðlïæz0EB¯83\ÍÓPËµfÜË hnzg{(âEyoË­(õ¢(mú~ÐtÛÈ^!CB|8ºÕf~¡ëìéS7áÌÑÛÉê}gZ«tû!v²ué ©ÑåPHµGð÷áiÔ¸Ø.BòÆÛ{£Û.M057ÌÙY~R >üöQè<nn
íû»e  ãÓûÒðTý¯äæ	e¤ syÏ'¥= yÉëå
6\=}ÞÂñ¢wIªT¼Rîw}F}°£H ô zäå= eÆI
Äm0anÅ,¦<¹®êL8@»ûRx(|½Ï³S|¨ðîL´Âß }&"Õð¢tÆ7	×Î¸hÊW= ç	«ôRY5Ç}lfª0\Álòäyú º©ÙÄðôyÈµí¤j¿£/Ï	àÈ,Q#Ô°Ni©¾*;íÛÈg9ÿÌüÏTÝag Êûm@7¸Ý
ÇK6«ÚØý|w5$¢}ÿj¯{áwìAËGSütmÒ4Ý:ÔËùbÒ[¬S=}ªT¾O»9·ûP.Ò°n]ðázå)«ÔÔµäÎ¾4	¦¿¦ðéOËþÐSdj= ÙùfÆ¬
CÓ,rõJ4¨	lÀjópf&µ]÷¿$ïÖt+µã1[QK/a¼ðëÈÊÔ¸ÊI¾%AûÂc4ªÔhZÝ{ÚÎYÙÙTïÕøÝ¤m×uLS¼m[= EFôþûÌ#Y×T=M»4

¼«*¼:]1Ñ Ùv Ct=}Ûlbâ-ípµ isÊðn{»û¡ûÐ®çºÅ}Tµô³Pg§cJh¼©îõñQ9æ0cÛ©
Òor>¢}ÛGD_Àûøx­ø²i©Sàô´-=MØ¢¹¬P°ôMmzpjHªu¡tõHÊä¡ DûN+æünLi :v%>Äô$Or¨þyÕÎÅÒ	t'5_öÉsªL¥D­s "§Ò«NÈ4£Ey3aPB¾âýõIj=}È7B/çªÀ¸ÁÓv ½úËIö^¤bW)Ò0ÃôÇEªÜTÕh)×ß(ÊÀ«j.Hl½/Õ®ÉpýüÌÔZzKlý4Tñ	_ÞàsïÅå	ÀYêso÷tzõÈ÷¬[¤ÓÓLó}ºPfl-Ï"³u[+ª_]Yø?(KPD;þÐa¤¤^~[×	wÐDt/ú²%àp9Åà^Zíæ°SºPE#@}wÑ·ÙÐËúfT·-NEeA°;³dÒaU)¦,){®ÞØ=}í	>"T~AèÈ/8b¢	S}ðç0½ºi)§Zl](z¤òªOk; ½pò)gB¤«Pûl.vk¾9ÞÅ·6·ó-=}¹	çÎ÷"ßõA= ¦pÉ3ïí]¹l Ä¼N+GHn~y«ëÓ3|òþò%K«C.Ûå_¯ÉÀ°÷K'ÞXJFs} ¤©¬ùÍpÓZËÜð]µA2Ç#Ê,ï*û0Oðù1Ü ÌI¢Kºf£¨ì:O4$N$¦óE°Bw»M5Òl­~Î©wÙ«ÜÄ<ÍÙ^Q@ÈL=MøF}æÔ¥GCO"6Ölñý§kÍ	|ëAôpñþg° lR¶ëú¡4ÐßÔ"áÔ8íþw¹bz= xÉ1Pd5,Ód·Ï4HÕ~#C	Ð«ÞõõØµ!~F~lGN^nIÅNëqÆÐÛùsLHX®,U­qïBÍÂÐUQº´ø%æIHðáwFÈÅ7ä~YEJ¯ÚÎ#¶_®QojýþS¶¯ÜÙi÷ý·´ë¥äl§0ÃÄn"oùÀuyó/Ç³vWÍ®ÉÑnjÒ
¼ëJ5:âöôi'úçøD}Ë#9ÐZ¬Ì= Þ@ãÍzMÇ®¨ÂúO@·o¥AÅ×*S{Ùpñ°4í_ÅzÖðL3>'Á£,S9ö±¹2>~	jöy\ÁÃ¾:5µ§NMdã=  ö(A«ï×pvTA¿K,Sàö	°ì	ÚtÛ_æÇxÜôv9Ì*4@c,[= æÇxÜôv9¡xÜô	øÂÃÀs\\Ü·wÊLðÚyyÇÅW=M	Û¡¹áE ^ï»;RØ!¹âGÙfÿr¢iQ¸gÑÜ¼PIFz2õmÑ	+ôÖÚõäèÅ+ú¯QäfvÊ÷§£Ïw$@8\zQ´÷ïQOÂtk= ?åê+P3×zRð´Ñ¾oæ,_æC»áTÂG;ò½Ï4¦)y§qk	:ËÅ~(éÏø üÅJtøF¤¢BÜ¯üEyO)òæqª»ö¯»Û^az
K§ZöÌÌ¹PzvR|,Ö\d8by9o Ù¯ÊÜÿNÃÈÊL±âËìV¼X_h®qzûW?¼lÚt$K'%è©çÉB'®K¦IÈúQÐß¥)ÿì6= `, new Uint8Array(107295));
    var UTF8Decoder = new TextDecoder("utf8");

    function UTF8ArrayToString(heap, idx, maxBytesToRead) {
      var endIdx = idx + maxBytesToRead;
      var endPtr = idx;

      while (heap[endPtr] && !(endPtr >= endIdx)) ++endPtr;

      return UTF8Decoder.decode(heap.subarray ? heap.subarray(idx, endPtr) : new Uint8Array(heap.slice(idx, endPtr)));
    }

    function UTF8ToString(ptr, maxBytesToRead) {
      if (!ptr) return "";
      var maxPtr = ptr + maxBytesToRead;

      for (var end = ptr; !(end >= maxPtr) && HEAPU8[end];) ++end;

      return UTF8Decoder.decode(HEAPU8.subarray(ptr, end));
    }

    var HEAP8, HEAP16, HEAP32, HEAPU8, HEAPU16, HEAPU32, HEAPF32, HEAPF64;
    var wasmMemory, buffer, wasmTable;

    function updateGlobalBufferAndViews(b) {
      buffer = b;
      HEAP8 = new Int8Array(b);
      HEAP16 = new Int16Array(b);
      HEAP32 = new Int32Array(b);
      HEAPU8 = new Uint8Array(b);
      HEAPU16 = new Uint16Array(b);
      HEAPU32 = new Uint32Array(b);
      HEAPF32 = new Float32Array(b);
      HEAPF64 = new Float64Array(b);
    }

    function _emscripten_memcpy_big(dest, src, num) {
      HEAPU8.copyWithin(dest, src, src + num);
    }

    function abortOnCannotGrowMemory(requestedSize) {
      abort("OOM");
    }

    function _emscripten_resize_heap(requestedSize) {
      var oldSize = HEAPU8.length;
      requestedSize = requestedSize >>> 0;
      abortOnCannotGrowMemory(requestedSize);
    }

    var ENV = {};

    function getExecutableName() {
      return "./this.program";
    }

    function getEnvStrings() {
      if (!getEnvStrings.strings) {
        var lang = (typeof navigator === "object" && navigator.languages && navigator.languages[0] || "C").replace("-", "_") + ".UTF-8";
        var env = {
          "USER": "web_user",
          "LOGNAME": "web_user",
          "PATH": "/",
          "PWD": "/",
          "HOME": "/home/web_user",
          "LANG": lang,
          "_": getExecutableName()
        };

        for (var x in ENV) {
          if (ENV[x] === undefined) delete env[x];else env[x] = ENV[x];
        }

        var strings = [];

        for (var x in env) {
          strings.push(x + "=" + env[x]);
        }

        getEnvStrings.strings = strings;
      }

      return getEnvStrings.strings;
    }

    function writeAsciiToMemory(str, buffer, dontAddNull) {
      for (var i = 0; i < str.length; ++i) {
        HEAP8[buffer++ >> 0] = str.charCodeAt(i);
      }

      if (!dontAddNull) HEAP8[buffer >> 0] = 0;
    }

    var SYSCALLS = {
      mappings: {},
      buffers: [null, [], []],
      printChar: function (stream, curr) {
        var buffer = SYSCALLS.buffers[stream];

        if (curr === 0 || curr === 10) {
          (stream === 1 ? out : err)(UTF8ArrayToString(buffer, 0));
          buffer.length = 0;
        } else {
          buffer.push(curr);
        }
      },
      varargs: undefined,
      get: function () {
        SYSCALLS.varargs += 4;
        var ret = HEAP32[SYSCALLS.varargs - 4 >> 2];
        return ret;
      },
      getStr: function (ptr) {
        var ret = UTF8ToString(ptr);
        return ret;
      },
      get64: function (low, high) {
        return low;
      }
    };

    function _environ_get(__environ, environ_buf) {
      var bufSize = 0;
      getEnvStrings().forEach(function (string, i) {
        var ptr = environ_buf + bufSize;
        HEAP32[__environ + i * 4 >> 2] = ptr;
        writeAsciiToMemory(string, ptr);
        bufSize += string.length + 1;
      });
      return 0;
    }

    function _environ_sizes_get(penviron_count, penviron_buf_size) {
      var strings = getEnvStrings();
      HEAP32[penviron_count >> 2] = strings.length;
      var bufSize = 0;
      strings.forEach(function (string) {
        bufSize += string.length + 1;
      });
      HEAP32[penviron_buf_size >> 2] = bufSize;
      return 0;
    }

    function _fd_close(fd) {
      return 0;
    }

    function _fd_read(fd, iov, iovcnt, pnum) {
      var stream = SYSCALLS.getStreamFromFD(fd);
      var num = SYSCALLS.doReadv(stream, iov, iovcnt);
      HEAP32[pnum >> 2] = num;
      return 0;
    }

    function _fd_seek(fd, offset_low, offset_high, whence, newOffset) {}

    function _fd_write(fd, iov, iovcnt, pnum) {
      var num = 0;

      for (var i = 0; i < iovcnt; i++) {
        var ptr = HEAP32[iov >> 2];
        var len = HEAP32[iov + 4 >> 2];
        iov += 8;

        for (var j = 0; j < len; j++) {
          SYSCALLS.printChar(fd, HEAPU8[ptr + j]);
        }

        num += len;
      }

      HEAP32[pnum >> 2] = num;
      return 0;
    }

    var asmLibraryArg = {
      "c": _emscripten_memcpy_big,
      "d": _emscripten_resize_heap,
      "e": _environ_get,
      "f": _environ_sizes_get,
      "a": _fd_close,
      "h": _fd_read,
      "b": _fd_seek,
      "g": _fd_write
    };

    function initRuntime(asm) {
      asm["j"]();
    }

    var imports = {
      "a": asmLibraryArg
    };

    var _malloc, _free, _mpeg_frame_decoder_create, _mpeg_decode_interleaved, _mpeg_frame_decoder_destroy;

    WebAssembly.instantiate(Module["wasm"], imports).then(function (output) {
      var asm = output.instance.exports;
      _malloc = asm["k"];
      _free = asm["l"];
      _mpeg_frame_decoder_create = asm["m"];
      _mpeg_decode_interleaved = asm["n"];
      _mpeg_frame_decoder_destroy = asm["o"];
      wasmTable = asm["p"];
      wasmMemory = asm["i"];
      updateGlobalBufferAndViews(wasmMemory.buffer);
      initRuntime(asm);
      ready();
    });
    this.ready = new Promise(resolve => {
      ready = resolve;
    }).then(() => {
      this.HEAP = buffer;
      this._malloc = _malloc;
      this._free = _free;
      this._mpeg_frame_decoder_create = _mpeg_frame_decoder_create;
      this._mpeg_decode_interleaved = _mpeg_decode_interleaved;
      this._mpeg_frame_decoder_destroy = _mpeg_frame_decoder_destroy;
    });
  }

}

exports.default = EmscriptenWASM;

},{}],57:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _common = require("@wasm-audio-decoders/common");

var _EmscriptenWasm = _interopRequireDefault(require("./EmscriptenWasm.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class MPEGDecoder {
  constructor(options = {}) {
    // injects dependencies when running as a web worker
    this._isWebWorker = this.constructor.isWebWorker;
    this._WASMAudioDecoderCommon = this.constructor.WASMAudioDecoderCommon || _common.WASMAudioDecoderCommon;
    this._EmscriptenWASM = this.constructor.EmscriptenWASM || _EmscriptenWasm.default;
    this._inputPtrSize = 2 ** 18;
    this._outputPtrSize = 1152 * 512;
    this._outputChannels = 2;
    this._ready = this._init();
  } // injects dependencies when running as a web worker


  async _init() {
    this._common = await this._WASMAudioDecoderCommon.initWASMAudioDecoder.bind(this)();
    this._sampleRate = 0; // input decoded bytes pointer

    [this._decodedBytesPtr, this._decodedBytes] = this._common.allocateTypedArray(1, Uint32Array); // sample rate

    [this._sampleRateBytePtr, this._sampleRateByte] = this._common.allocateTypedArray(1, Uint32Array);
    this._decoder = this._wasm._mpeg_frame_decoder_create();
  }

  get ready() {
    return this._ready;
  }

  async reset() {
    this.free();
    await this._init();
  }

  free() {
    this._wasm._mpeg_frame_decoder_destroy(this._decoder);

    this._wasm._free(this._decoder);

    this._common.free();
  }

  _decode(data, decodeInterval) {
    if (!(data instanceof Uint8Array)) throw Error(`Data to decode must be Uint8Array. Instead got ${typeof data}`);

    this._input.set(data);

    this._decodedBytes[0] = 0;

    const samplesDecoded = this._wasm._mpeg_decode_interleaved(this._decoder, this._inputPtr, data.length, this._decodedBytesPtr, decodeInterval, this._outputPtr, this._outputPtrSize, this._sampleRateBytePtr);

    this._sampleRate = this._sampleRateByte[0];
    return this._WASMAudioDecoderCommon.getDecodedAudio([this._output.slice(0, samplesDecoded), this._output.slice(this._outputPtrSize, this._outputPtrSize + samplesDecoded)], samplesDecoded, this._sampleRate);
  }

  decode(data) {
    let output = [],
        samples = 0;

    for (let offset = 0; offset < data.length; offset += this._decodedBytes[0]) {
      const {
        channelData,
        samplesDecoded
      } = this._decode(data.subarray(offset, offset + this._inputPtrSize), 48);

      output.push(channelData);
      samples += samplesDecoded;
    }

    return this._WASMAudioDecoderCommon.getDecodedAudioMultiChannel(output, 2, samples, this._sampleRate);
  }

  decodeFrame(mpegFrame) {
    return this._decode(mpegFrame, mpegFrame.length);
  }

  decodeFrames(mpegFrames) {
    let output = [],
        samples = 0;

    for (const frame of mpegFrames) {
      const {
        channelData,
        samplesDecoded
      } = this.decodeFrame(frame);
      output.push(channelData);
      samples += samplesDecoded;
    }

    return this._WASMAudioDecoderCommon.getDecodedAudioMultiChannel(output, 2, samples, this._sampleRate);
  }

}

exports.default = MPEGDecoder;

},{"./EmscriptenWasm.js":56,"@wasm-audio-decoders/common":1}],58:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _common = require("@wasm-audio-decoders/common");

var _EmscriptenWasm = _interopRequireDefault(require("./EmscriptenWasm.js"));

var _MPEGDecoder = _interopRequireDefault(require("./MPEGDecoder.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class MPEGDecoderWebWorker extends _common.WASMAudioDecoderWorker {
  constructor(options) {
    super(options, _MPEGDecoder.default, _EmscriptenWasm.default);
  }

  async decode(data) {
    return this._postToDecoder("decode", data);
  }

  async decodeFrame(data) {
    return this._postToDecoder("decodeFrame", data);
  }

  async decodeFrames(data) {
    return this._postToDecoder("decodeFrames", data);
  }

}

exports.default = MPEGDecoderWebWorker;

},{"./EmscriptenWasm.js":56,"./MPEGDecoder.js":57,"@wasm-audio-decoders/common":1}],59:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _codecParser = _interopRequireDefault(require("codec-parser"));

var _constants = require("./constants.js");

var _ISOBMFFContainer = _interopRequireDefault(require("./containers/isobmff/ISOBMFFContainer.js"));

var _WEBMContainer = _interopRequireDefault(require("./containers/webm/WEBMContainer.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of mse-audio-wrapper.
    
    mse-audio-wrapper is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    mse-audio-wrapper is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
const noOp = () => {};

class MSEAudioWrapper {
  /**
   * @description Wraps audio data into media source API compatible containers
   * @param {string} mimeType Mimetype of the audio data to wrap
   * @param {string} options.codec Codec of the audio data to wrap
   * @param {object} options.preferredContainer Preferred audio container to output if multiple containers are available
   * @param {number} options.minBytesPerSegment Minimum number of bytes to process before returning a media segment
   * @param {number} options.minFramesPerSegment Minimum number of frames to process before returning a media segment
   * @param {number} options.minBytesPerSegment Minimum number of bytes to process before returning a media segment
   * @param {boolean} options.enableLogging Set to true to enable debug logging
   */
  constructor(mimeType, options = {}) {
    this._inputMimeType = mimeType;
    this.PREFERRED_CONTAINER = options.preferredContainer || _constants.WEBM;
    this.MIN_FRAMES = options.minFramesPerSegment || 4;
    this.MAX_FRAMES = options.maxFramesPerSegment || 50;
    this.MIN_FRAMES_LENGTH = options.minBytesPerSegment || 1022;
    this.MAX_SAMPLES_PER_SEGMENT = Infinity;
    this._onMimeType = options.onMimeType || noOp;

    if (options.codec) {
      this._container = this._getContainer(options.codec);

      this._onMimeType(this._mimeType);
    }

    this._frames = [];
    this._codecParser = new _codecParser.default(mimeType, {
      onCodec: codec => {
        this._container = this._getContainer(codec);

        this._onMimeType(this._mimeType);
      },
      onCodecUpdate: options.onCodecUpdate,
      enableLogging: options.enableLogging
    });
  }
  /**
   * @public
   * @returns The mimetype being returned from MSEAudioWrapper
   */


  get mimeType() {
    return this._mimeType;
  }
  /**
   * @public
   * @returns The mimetype of the incoming audio data
   */


  get inputMimeType() {
    return this._inputMimeType;
  }
  /**
   * @public
   * @description Returns an iterator for the passed in codec data.
   * @param {Uint8Array | Array<Frame>} chunk Next chunk of codec data to read
   * @returns {Iterator} Iterator that operates over the codec data.
   * @yields {Uint8Array} Movie Fragments containing codec frames
   */


  *iterator(chunk) {
    if (chunk.constructor === Uint8Array) {
      yield* this._processFrames([...this._codecParser.parseChunk(chunk)].flatMap(frame => frame.codecFrames || frame));
    } else if (Array.isArray(chunk)) {
      yield* this._processFrames(chunk);
    }
  }
  /**
   * @private
   */


  *_processFrames(frames) {
    this._frames.push(...frames);

    if (this._frames.length) {
      const groups = this._groupFrames();

      if (groups.length) {
        if (!this._sentInitialSegment) {
          this._sentInitialSegment = true;
          yield this._container.getInitializationSegment(groups[0][0]);
        }

        for (const frameGroup of groups) {
          yield this._container.getMediaSegment(frameGroup);
        }
      }
    }
  }
  /**
   * @private
   */


  _groupFrames() {
    const groups = [[]];
    let currentGroup = groups[0];
    let samples = 0;

    for (const frame of this._frames) {
      if (currentGroup.length === this.MAX_FRAMES || samples >= this.MAX_SAMPLES_PER_SEGMENT) {
        samples = 0;
        groups.push(currentGroup = []); // create new group
      }

      currentGroup.push(frame);
      samples += frame.samples;
    } // store remaining frames


    this._frames = currentGroup.length < this.MIN_FRAMES || currentGroup.reduce((acc, frame) => acc + frame.data.length, 0) < this.MIN_FRAMES_LENGTH ? groups.pop() : [];
    return groups;
  }
  /**
   * @private
   */


  _getContainer(codec) {
    switch (codec) {
      case "mpeg":
        this._mimeType = `${_constants.AUDIO_MP4}"${_constants.MP3}"`;
        return new _ISOBMFFContainer.default(_constants.MP3);

      case "aac":
        this._mimeType = `${_constants.AUDIO_MP4}"${_constants.MP4A_40_2}`;
        return new _ISOBMFFContainer.default(_constants.MP4A_40_2);

      case "flac":
        this._mimeType = `${_constants.AUDIO_MP4}"${_constants.FLAC}"`;
        return new _ISOBMFFContainer.default(_constants.FLAC);

      case "vorbis":
        this._mimeType = `${_constants.AUDIO_WEBM}"${_constants.VORBIS}"`;
        this.MAX_SAMPLES_PER_SEGMENT = 32767;
        return new _WEBMContainer.default(_constants.VORBIS);

      case "opus":
        if (this.PREFERRED_CONTAINER === _constants.WEBM) {
          this._mimeType = `${_constants.AUDIO_WEBM}"${_constants.OPUS}"`;
          this.MAX_SAMPLES_PER_SEGMENT = 32767;
          return new _WEBMContainer.default(_constants.OPUS);
        }

        this._mimeType = `${_constants.AUDIO_MP4}"${_constants.OPUS}"`;
        return new _ISOBMFFContainer.default(_constants.OPUS);
    }
  }

}

exports.default = MSEAudioWrapper;

},{"./constants.js":60,"./containers/isobmff/ISOBMFFContainer.js":64,"./containers/webm/WEBMContainer.js":66,"codec-parser":6}],60:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.WEBM = exports.VORBIS = exports.OPUS = exports.MSE_AUDIO_WRAPPER = exports.MP4A_40_2 = exports.MP4 = exports.MP3 = exports.FLAC = exports.AUDIO_WEBM = exports.AUDIO_MP4 = void 0;
// containers
const MP4 = "mp4";
exports.MP4 = MP4;
const WEBM = "webm"; // codecs

exports.WEBM = WEBM;
const MP3 = "mp3";
exports.MP3 = MP3;
const MP4A_40_2 = "mp4a.40.2";
exports.MP4A_40_2 = MP4A_40_2;
const FLAC = "flac";
exports.FLAC = FLAC;
const VORBIS = "vorbis";
exports.VORBIS = VORBIS;
const OPUS = "opus";
exports.OPUS = OPUS;
const audio = "audio/";
const codecs = ";codecs=";
const AUDIO_MP4 = audio + MP4 + codecs;
exports.AUDIO_MP4 = AUDIO_MP4;
const AUDIO_WEBM = audio + WEBM + codecs;
exports.AUDIO_WEBM = AUDIO_WEBM;
const MSE_AUDIO_WRAPPER = "mse-audio-wrapper";
exports.MSE_AUDIO_WRAPPER = MSE_AUDIO_WRAPPER;

},{}],61:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of mse-audio-wrapper.
    
    mse-audio-wrapper is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    mse-audio-wrapper is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
class ContainerElement {
  /**
   * @abstract
   * @description Container Object structure Abstract Class
   * @param {any} name Name of the object
   * @param {Array<Uint8>} [contents] Array of arrays or typed arrays, or a single number or typed array
   * @param {Array<ContainerElement>} [objects] Array of objects to insert into this object
   */
  constructor({
    name,
    contents = [],
    children = []
  }) {
    this._name = name;
    this._contents = contents;
    this._children = children;
  }
  /**
   * @description Converts a string to a byte array
   * @param {string} name String to convert
   * @returns {Uint8Array}
   */


  static stringToByteArray(name) {
    return [...name].map(char => char.charCodeAt(0));
  }
  /**
   * @description Converts a JavaScript number to Uint32
   * @param {number} number Number to convert
   * @returns {Uint32}
   */


  static getFloat64(number) {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, number);
    return bytes;
  }
  /**
   * @description Converts a JavaScript number to Uint32
   * @param {number} number Number to convert
   * @returns {Uint32}
   */


  static getUint64(number) {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigUint64(0, BigInt(number));
    return bytes;
  }
  /**
   * @description Converts a JavaScript number to Uint32
   * @param {number} number Number to convert
   * @returns {Uint32}
   */


  static getUint32(number) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, number);
    return bytes;
  }
  /**
   * @description Converts a JavaScript number to Uint16
   * @param {number} number Number to convert
   * @returns {Uint32}
   */


  static getUint16(number) {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, number);
    return bytes;
  }
  /**
   * @description Converts a JavaScript number to Int16
   * @param {number} number Number to convert
   * @returns {Uint32}
   */


  static getInt16(number) {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setInt16(0, number);
    return bytes;
  }

  static *flatten(array) {
    for (const item of array) {
      if (Array.isArray(item)) {
        yield* ContainerElement.flatten(item);
      } else {
        yield item;
      }
    }
  }
  /**
   * @returns {Uint8Array} Contents of this container element
   */


  get contents() {
    const buffer = new Uint8Array(this.length);

    const contents = this._buildContents();

    let offset = 0;

    for (const element of ContainerElement.flatten(contents)) {
      if (typeof element !== "object") {
        buffer[offset] = element;
        offset++;
      } else {
        buffer.set(element, offset);
        offset += element.length;
      }
    }

    return buffer;
  }
  /**
   * @returns {number} Length of this container element
   */


  get length() {
    return this._buildLength();
  }

  _buildContents() {
    return [this._contents, ...this._children.map(obj => obj._buildContents())];
  }

  _buildLength() {
    let length;

    if (Array.isArray(this._contents)) {
      length = this._contents.reduce((acc, val) => acc + (val.length === undefined ? 1 : val.length), 0);
    } else {
      length = this._contents.length === undefined ? 1 : this._contents.length;
    }

    return length + this._children.reduce((acc, obj) => acc + obj.length, 0);
  }

  addChild(object) {
    this._children.push(object);
  }

}

exports.default = ContainerElement;

},{}],62:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _ContainerElement = _interopRequireDefault(require("../ContainerElement.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of mse-audio-wrapper.
    
    mse-audio-wrapper is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    mse-audio-wrapper is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
class Box extends _ContainerElement.default {
  /**
   * @description ISO/IEC 14496-12 Part 12 ISO Base Media File Format Box
   * @param {string} name Name of the box (i.e. 'moov', 'moof', 'traf')
   * @param {object} params Object containing contents or child boxes
   * @param {Array<Uint8>} [params.contents] Array of bytes to insert into this box
   * @param {Array<Box>} [params.children] Array of child boxes to insert into this box
   */
  constructor(name, {
    contents,
    children
  } = {}) {
    super({
      name,
      contents,
      children
    });
  }

  _buildContents() {
    return [...this._lengthBytes, ..._ContainerElement.default.stringToByteArray(this._name), ...super._buildContents()];
  }

  _buildLength() {
    if (!this._length) {
      // length bytes + name length + content length
      this._length = 4 + this._name.length + super._buildLength();
      this._lengthBytes = _ContainerElement.default.getUint32(this._length);
    }

    return this._length;
  }

}

exports.default = Box;

},{"../ContainerElement.js":61}],63:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _ContainerElement = _interopRequireDefault(require("../ContainerElement.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of mse-audio-wrapper.
    
    mse-audio-wrapper is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    mse-audio-wrapper is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
class ESTag extends _ContainerElement.default {
  constructor(tagNumber, {
    contents,
    tags
  } = {}) {
    super({
      name: tagNumber,
      contents,
      children: tags
    });
  }

  static getLength(length) {
    const bytes = _ContainerElement.default.getUint32(length);

    bytes.every((byte, i, array) => {
      if (byte === 0x00) {
        array[i] = 0x80;
        return true;
      }

      return false;
    });
    return bytes;
  }
  /**
   * @returns {Uint8Array} Contents of this stream descriptor tag
   */


  _buildContents() {
    return [this._name, ...this._lengthBytes, ...super._buildContents()];
  }

  _buildLength() {
    if (!this._length) {
      const length = super._buildLength();

      this._lengthBytes = ESTag.getLength(length);
      this._length = 1 + length + this._lengthBytes.length;
    }

    return this._length;
  }

  addTag(tag) {
    this.addChild(tag);
  }

}

exports.default = ESTag;

},{"../ContainerElement.js":61}],64:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _constants = require("../../constants.js");

var _ContainerElement = _interopRequireDefault(require("../ContainerElement.js"));

var _Box = _interopRequireDefault(require("./Box.js"));

var _ESTag = _interopRequireDefault(require("./ESTag.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of mse-audio-wrapper.
    
    mse-audio-wrapper is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    mse-audio-wrapper is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/

/**
 * @description Fragmented ISO Base Media File Format Builder is a class to
 * wrap codec frames in a MP4 container for streaming MP3 / AAC compatibility in Firefox.
 */
class ISOBMFFContainer {
  constructor(codec) {
    this._codec = codec;
  }

  getCodecBox(header) {
    /**
     * @description Codec mapping for `esds` box
     * https://stackoverflow.com/questions/3987850/mp4-atom-how-to-discriminate-the-audio-codec-is-it-aac-or-mp3
     * https://web.archive.org/web/20180312163039/http://mp4ra.org/object.html
     * 0x40 - MPEG-4 Audio
     * 0x6b - MPEG-1 Audio (MPEG-1 Layers 1, 2, and 3)
     * 0x69 - MPEG-2 Backward Compatible Audio (MPEG-2 Layers 1, 2, and 3)
     * 0x67 - MPEG-2 AAC LC
     */
    switch (this._codec) {
      case _constants.MP3:
        return this.getMp4a(header, 0x6b);

      case _constants.MP4A_40_2:
        return this.getMp4a(header, 0x40);

      case _constants.OPUS:
        return this.getOpus(header);

      case _constants.FLAC:
        return this.getFlaC(header);
    }
  }

  getOpus(header) {
    // https://opus-codec.org/docs/opus_in_isobmff.html
    return new _Box.default("Opus", {
      /* prettier-ignore */
      contents: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // reserved
      0x00, 0x01, // data reference index
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // reserved
      0x00, header.channels, // channel count
      0x00, header.bitDepth, // PCM bitrate (16bit)
      0x00, 0x00, // predefined
      0x00, 0x00, // reserved
      _Box.default.getUint16(header.sampleRate), 0x00, 0x00 // sample rate 16.16 fixed-point
      ],
      children: [new _Box.default("dOps", {
        /* prettier-ignore */
        contents: [0x00, // version
        header.channels, // output channel count
        _Box.default.getUint16(header.preSkip), // pre skip
        _Box.default.getUint32(header.inputSampleRate), // input sample rate
        _Box.default.getInt16(header.outputGain), // output gain
        header.channelMappingFamily, // channel mapping family int(8)
        header.channelMappingFamily !== 0 ? [header.streamCount, header.coupledStreamCount, header.channelMappingTable // channel mapping table
        ] : []]
      })]
    });
  }

  getFlaC(header) {
    // https://github.com/xiph/flac/blob/master/doc/isoflac.txt
    return new _Box.default("fLaC", {
      /* prettier-ignore */
      contents: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // reserved
      0x00, 0x01, // data reference index
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // reserved
      0x00, header.channels, // channel count
      0x00, header.bitDepth, // PCM bitrate (16bit)
      0x00, 0x00, // predefined
      0x00, 0x00, // reserved
      _Box.default.getUint16(header.sampleRate), 0x00, 0x00 // sample rate 16.16 fixed-point

      /*
      When the bitstream's native sample rate is greater
      than the maximum expressible value of 65535 Hz,
      the samplerate field shall hold the greatest
      expressible regular division of that rate. I.e.
      the samplerate field shall hold 48000.0 for
      native sample rates of 96 and 192 kHz. In the
      case of unusual sample rates which do not have
      an expressible regular division, the maximum value
      of 65535.0 Hz should be used.
      */
      ],
      children: [new _Box.default("dfLa", {
        /* prettier-ignore */
        contents: [0x00, // version
        0x00, 0x00, 0x00, // flags
        ...(header.streamInfo || [// * `A........` Last metadata block flag
        // * `.BBBBBBBB` BlockType
        0x80, // last metadata block, stream info
        0x00, 0x00, 0x22, // Length
        _Box.default.getUint16(header.blockSize), // maximum block size
        _Box.default.getUint16(header.blockSize), // minimum block size
        0x00, 0x00, 0x00, // maximum frame size
        0x00, 0x00, 0x00, // minimum frame size
        _Box.default.getUint32(header.sampleRate << 12 | header.channels << 8 | header.bitDepth - 1 << 4), // 20bits sample rate, 3bits channels, 5bits bitDepth - 1
        0x00, 0x00, 0x00, 0x00, // total samples
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 // md5 of stream
        ])]
      })]
    });
  }

  getMp4a(header, esdsCodec) {
    const streamDescriptorTag = new _ESTag.default(4, {
      /* prettier-ignore */
      contents: [esdsCodec, 0x15, // stream type(6bits)=5 audio, flags(2bits)=1
      0x00, 0x00, 0x00, // 24bit buffer size
      0x00, 0x00, 0x00, 0x00, // max bitrate
      0x00, 0x00, 0x00, 0x00 // avg bitrate
      ]
    }); // mp4a.40.2

    if (esdsCodec === 0x40) {
      streamDescriptorTag.addTag(new _ESTag.default(5, {
        contents: header.audioSpecificConfig
      }));
    }

    return new _Box.default("mp4a", {
      /* prettier-ignore */
      contents: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // reserved
      0x00, 0x01, // data reference index
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // reserved
      0x00, header.channels, // channel count
      0x00, 0x10, // PCM bitrate (16bit)
      0x00, 0x00, // Compression ID
      0x00, 0x00, // Packet size
      _Box.default.getUint16(header.sampleRate), 0x00, 0x00],
      // sample rate unsigned floating point
      children: [new _Box.default("esds", {
        contents: [0x00, 0x00, 0x00, 0x00],
        children: [new _ESTag.default(3, {
          contents: [0x00, 0x01, // ES_ID = 1
          0x00 // flags etc = 0
          ],
          tags: [streamDescriptorTag, new _ESTag.default(6, {
            contents: 0x02
          })]
        })]
      })]
    });
  }
  /**
   * @param {Header} header Codec frame
   * @returns {Uint8Array} Filetype and Movie Box information for the codec
   */


  getInitializationSegment({
    header,
    samples
  }) {
    return new _ContainerElement.default({
      children: [new _Box.default("ftyp", {
        /* prettier-ignore */
        contents: [_Box.default.stringToByteArray("iso5"), // major brand
        0x00, 0x00, 0x02, 0x00, // minor version
        _Box.default.stringToByteArray("iso6mp41")] // compatible brands

      }), new _Box.default("moov", {
        children: [new _Box.default("mvhd", {
          /* prettier-ignore */
          contents: [0x00, // version
          0x00, 0x00, 0x00, // flags
          0x00, 0x00, 0x00, 0x00, // creation time
          0x00, 0x00, 0x00, 0x00, // modification time
          0x00, 0x00, 0x03, 0xe8, // timescale
          0x00, 0x00, 0x00, 0x00, // duration
          0x00, 0x01, 0x00, 0x00, // rate
          0x01, 0x00, // volume
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // reserved
          0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // a b u (matrix structure)
          0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // c d v
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, // x y w
          0x00, 0x00, 0x00, 0x00, // preview time
          0x00, 0x00, 0x00, 0x00, // preview duration
          0x00, 0x00, 0x00, 0x00, // poster time
          0x00, 0x00, 0x00, 0x00, // selection time
          0x00, 0x00, 0x00, 0x00, // selection duration
          0x00, 0x00, 0x00, 0x00, // current time
          0x00, 0x00, 0x00, 0x02] // next track

        }), new _Box.default("trak", {
          children: [new _Box.default("tkhd", {
            /* prettier-ignore */
            contents: [0x00, // version
            0x00, 0x00, 0x03, // flags (0x01 - track enabled, 0x02 - track in movie, 0x04 - track in preview, 0x08 - track in poster)
            0x00, 0x00, 0x00, 0x00, // creation time
            0x00, 0x00, 0x00, 0x00, // modification time
            0x00, 0x00, 0x00, 0x01, // track id
            0x00, 0x00, 0x00, 0x00, // reserved
            0x00, 0x00, 0x00, 0x00, // duration
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // reserved
            0x00, 0x00, // layer
            0x00, 0x01, // alternate group
            0x01, 0x00, // volume
            0x00, 0x00, // reserved
            0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // a b u (matrix structure)
            0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // c d v 
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, // x y w
            0x00, 0x00, 0x00, 0x00, // track width
            0x00, 0x00, 0x00, 0x00] // track height

          }), new _Box.default("mdia", {
            children: [new _Box.default("mdhd", {
              /* prettier-ignore */
              contents: [0x00, // version
              0x00, 0x00, 0x00, // flags
              0x00, 0x00, 0x00, 0x00, // creation time (in seconds since midnight, January 1, 1904)
              0x00, 0x00, 0x00, 0x00, // modification time
              _Box.default.getUint32(header.sampleRate), // time scale
              0x00, 0x00, 0x00, 0x00, // duration
              0x55, 0xc4, // language
              0x00, 0x00] // quality

            }), new _Box.default("hdlr", {
              /* prettier-ignore */
              contents: [0x00, // version
              0x00, 0x00, 0x00, // flags
              _Box.default.stringToByteArray('mhlr'), // component type (mhlr, dhlr)
              _Box.default.stringToByteArray('soun'), // component subtype (vide' for video data, 'soun' for sound data or ‘subt’ for subtitles)
              0x00, 0x00, 0x00, 0x00, // component manufacturer
              0x00, 0x00, 0x00, 0x00, // component flags
              0x00, 0x00, 0x00, 0x00, // component flags mask
              0x00] // String that specifies the name of the component, terminated by a null character

            }), new _Box.default("minf", {
              children: [new _Box.default("stbl", {
                children: [new _Box.default("stsd", {
                  // Sample description atom

                  /* prettier-ignore */
                  contents: [0x00, // version
                  0x00, 0x00, 0x00, // flags
                  0x00, 0x00, 0x00, 0x01],
                  // entry count
                  children: [this.getCodecBox(header)]
                }), new _Box.default("stts", {
                  // Time-to-sample atom

                  /* prettier-ignore */
                  contents: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
                }), new _Box.default("stsc", {
                  // Sample-to-chunk atom

                  /* prettier-ignore */
                  contents: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
                }), new _Box.default("stsz", {
                  // Sample Size atom

                  /* prettier-ignore */
                  contents: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
                }), new _Box.default("stco", {
                  // Chunk Offset atom

                  /* prettier-ignore */
                  contents: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
                })]
              })]
            })]
          })]
        }), new _Box.default("mvex", {
          children: [new _Box.default("trex", {
            /* prettier-ignore */
            contents: [0x00, 0x00, 0x00, 0x00, // flags
            0x00, 0x00, 0x00, 0x01, // track id
            0x00, 0x00, 0x00, 0x01, // default_sample_description_index
            _Box.default.getUint32(samples), // default_sample_duration
            0x00, 0x00, 0x00, 0x00, // default_sample_size;
            0x00, 0x00, 0x00, 0x00] // default_sample_flags;

          })]
        })]
      })]
    }).contents;
  }

  getSamplesPerFrame(frames) {
    return this._codec === _constants.MP4A_40_2 ? frames.map(({
      data,
      header
    }) => _Box.default.getUint32(data.length - header.length)) : frames.map(({
      data
    }) => _Box.default.getUint32(data.length));
  }

  getFrameData(frames) {
    return this._codec === _constants.MP4A_40_2 ? frames.map(({
      data,
      header
    }) => data.subarray(header.length)) : frames.map(({
      data
    }) => data);
  }
  /**
   * @description Wraps codec frames into a Movie Fragment
   * @param {Array<Frame>} frames Frames to contain in this Movie Fragment
   * @returns {Uint8Array} Movie Fragment containing the frames
   */


  getMediaSegment(frames) {
    return new _ContainerElement.default({
      children: [new _Box.default("moof", {
        children: [new _Box.default("mfhd", {
          /* prettier-ignore */
          contents: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00] // sequence number

        }), new _Box.default("traf", {
          children: [new _Box.default("tfhd", {
            /* prettier-ignore */
            contents: [0x00, // version
            0b00000010, 0x00, 0b00000000, // flags
            // * `AB|00000000|00CDE0FG`
            // * `A.|........|........` default-base-is-moof
            // * `.B|........|........` duration-is-empty
            // * `..|........|..C.....` default-sample-flags-present
            // * `..|........|...D....` default-sample-size-present
            // * `..|........|....E...` default-sample-duration-present
            // * `..|........|......F.` sample-description-index-present
            // * `..|........|.......G` base-data-offset-present
            0x00, 0x00, 0x00, 0x01] // track id

          }), new _Box.default("tfdt", {
            /* prettier-ignore */
            contents: [0x00, // version
            0x00, 0x00, 0x00, // flags
            0x00, 0x00, 0x00, 0x00] // base media decode time

          }), new _Box.default("trun", {
            /* prettier-ignore */
            contents: [0x00, // version
            0x00, 0b0000010, 0b00000001, // flags
            // * `ABCD|00000E0F`
            // * `A...|........` sample‐composition‐time‐offsets‐present
            // * `.B..|........` sample‐flags‐present
            // * `..C.|........` sample‐size‐present
            // * `...D|........` sample‐duration‐present
            // * `....|.....E..` first‐sample‐flags‐present
            // * `....|.......G` data-offset-present
            _Box.default.getUint32(frames.length), // number of samples
            _Box.default.getUint32(92 + frames.length * 4), // data offset
            ...this.getSamplesPerFrame(frames)] // samples size per frame

          })]
        })]
      }), new _Box.default("mdat", {
        contents: this.getFrameData(frames)
      })]
    }).contents;
  }

}

exports.default = ISOBMFFContainer;

},{"../../constants.js":60,"../ContainerElement.js":61,"./Box.js":62,"./ESTag.js":63}],65:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.id = exports.default = void 0;

var _constants = require("../../constants.js");

var _utilities = require("../../utilities.js");

var _ContainerElement = _interopRequireDefault(require("../ContainerElement.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of mse-audio-wrapper.
    
    mse-audio-wrapper is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    mse-audio-wrapper is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
class EBML extends _ContainerElement.default {
  /**
   * @description Extensible Binary Meta Language element
   * @param {name} name ID of the EBML element
   * @param {object} params Object containing contents or children
   * @param {boolean} [isUnknownLength] Set to true to use the unknown length constant for EBML
   * @param {Array<Uint8>} [params.contents] Array of bytes to insert into this box
   * @param {Array<Box>} [params.children] Array of children to insert into this box
   */
  constructor(name, {
    contents,
    children,
    isUnknownLength = false
  } = {}) {
    super({
      name,
      contents,
      children
    });
    this._isUnknownLength = isUnknownLength;
  }
  /**
   * @description Converts a JavaScript number into a variable length EBML integer
   * @param {number} number Number to convert
   */


  static getUintVariable(number) {
    let buffer;

    if (number < 0x7f) {
      buffer = [0b10000000 | number];
    } else if (number < 0x3fff) {
      buffer = _ContainerElement.default.getUint16(number);
      buffer[0] |= 0b01000000;
    } else if (number < 0x1fffff) {
      buffer = _ContainerElement.default.getUint32(number).subarray(1);
      buffer[0] |= 0b00100000;
    } else if (number < 0xfffffff) {
      buffer = _ContainerElement.default.getUint32(number);
      buffer[0] |= 0b00010000;
    } else if (number < 0x7ffffffff) {
      buffer = _ContainerElement.default.getUint64(number).subarray(3);
      buffer[0] |= 0b00001000;
    } else if (number < 0x3ffffffffff) {
      buffer = _ContainerElement.default.getUint64(number).subarray(2);
      buffer[0] |= 0b00000100;
    } else if (number < 0x1ffffffffffff) {
      buffer = _ContainerElement.default.getUint64(number).subarray(1);
      buffer[0] |= 0b00000010;
    } else if (number < 0xffffffffffffff) {
      buffer = _ContainerElement.default.getUint64(number);
      buffer[0] |= 0b00000001;
    } else if (typeof number !== "number" || isNaN(number)) {
      (0, _utilities.logError)(`EBML Variable integer must be a number, instead received ${number}`);
      throw new Error(_constants.MSE_AUDIO_WRAPPER + ": Unable to encode WEBM");
    }

    return buffer;
  }

  _buildContents() {
    return [...this._name, ...this._lengthBytes, ...super._buildContents()];
  }

  _buildLength() {
    if (!this._length) {
      this._contentLength = super._buildLength();
      this._lengthBytes = this._isUnknownLength ? [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff] // unknown length constant
      : EBML.getUintVariable(this._contentLength);
      this._length = this._name.length + this._lengthBytes.length + this._contentLength;
    }

    return this._length;
  }

} // https://tools.ietf.org/id/draft-lhomme-cellar-matroska-00.html


exports.default = EBML;
const id = {
  AlphaMode: [0x53, 0xc0],
  AspectRatioType: [0x54, 0xb3],
  AttachedFile: [0x61, 0xa7],
  AttachmentLink: [0x74, 0x46],
  Attachments: [0x19, 0x41, 0xa4, 0x69],
  Audio: [0xe1],
  BitDepth: [0x62, 0x64],
  BitsPerChannel: [0x55, 0xb2],
  Block: [0xa1],
  BlockAddID: [0xee],
  BlockAdditional: [0xa5],
  BlockAdditions: [0x75, 0xa1],
  BlockDuration: [0x9b],
  BlockGroup: [0xa0],
  BlockMore: [0xa6],
  CbSubsamplingHorz: [0x55, 0xb5],
  CbSubsamplingVert: [0x55, 0xb6],
  Channels: [0x9f],
  ChapCountry: [0x43, 0x7e],
  ChapLanguage: [0x43, 0x7c],
  ChapProcess: [0x69, 0x44],
  ChapProcessCodecID: [0x69, 0x55],
  ChapProcessCommand: [0x69, 0x11],
  ChapProcessData: [0x69, 0x33],
  ChapProcessPrivate: [0x45, 0x0d],
  ChapProcessTime: [0x69, 0x22],
  ChapString: [0x85],
  ChapterAtom: [0xb6],
  ChapterDisplay: [0x80],
  ChapterFlagEnabled: [0x45, 0x98],
  ChapterFlagHidden: [0x98],
  ChapterPhysicalEquiv: [0x63, 0xc3],
  Chapters: [0x10, 0x43, 0xa7, 0x70],
  ChapterSegmentEditionUID: [0x6e, 0xbc],
  ChapterSegmentUID: [0x6e, 0x67],
  ChapterStringUID: [0x56, 0x54],
  ChapterTimeEnd: [0x92],
  ChapterTimeStart: [0x91],
  ChapterTrack: [0x8f],
  ChapterTrackNumber: [0x89],
  ChapterTranslate: [0x69, 0x24],
  ChapterTranslateCodec: [0x69, 0xbf],
  ChapterTranslateEditionUID: [0x69, 0xfc],
  ChapterTranslateID: [0x69, 0xa5],
  ChapterUID: [0x73, 0xc4],
  ChromaSitingHorz: [0x55, 0xb7],
  ChromaSitingVert: [0x55, 0xb8],
  ChromaSubsamplingHorz: [0x55, 0xb3],
  ChromaSubsamplingVert: [0x55, 0xb4],
  Cluster: [0x1f, 0x43, 0xb6, 0x75],
  CodecDecodeAll: [0xaa],
  CodecDelay: [0x56, 0xaa],
  CodecID: [0x86],
  CodecName: [0x25, 0x86, 0x88],
  CodecPrivate: [0x63, 0xa2],
  CodecState: [0xa4],
  Colour: [0x55, 0xb0],
  ColourSpace: [0x2e, 0xb5, 0x24],
  ContentCompAlgo: [0x42, 0x54],
  ContentCompression: [0x50, 0x34],
  ContentCompSettings: [0x42, 0x55],
  ContentEncAlgo: [0x47, 0xe1],
  ContentEncKeyID: [0x47, 0xe2],
  ContentEncoding: [0x62, 0x40],
  ContentEncodingOrder: [0x50, 0x31],
  ContentEncodings: [0x6d, 0x80],
  ContentEncodingScope: [0x50, 0x32],
  ContentEncodingType: [0x50, 0x33],
  ContentEncryption: [0x50, 0x35],
  ContentSigAlgo: [0x47, 0xe5],
  ContentSigHashAlgo: [0x47, 0xe6],
  ContentSigKeyID: [0x47, 0xe4],
  ContentSignature: [0x47, 0xe3],
  CRC32: [0xbf],
  CueBlockNumber: [0x53, 0x78],
  CueClusterPosition: [0xf1],
  CueCodecState: [0xea],
  CueDuration: [0xb2],
  CuePoint: [0xbb],
  CueReference: [0xdb],
  CueRefTime: [0x96],
  CueRelativePosition: [0xf0],
  Cues: [0x1c, 0x53, 0xbb, 0x6b],
  CueTime: [0xb3],
  CueTrack: [0xf7],
  CueTrackPositions: [0xb7],
  DateUTC: [0x44, 0x61],
  DefaultDecodedFieldDuration: [0x23, 0x4e, 0x7a],
  DefaultDuration: [0x23, 0xe3, 0x83],
  DiscardPadding: [0x75, 0xa2],
  DisplayHeight: [0x54, 0xba],
  DisplayUnit: [0x54, 0xb2],
  DisplayWidth: [0x54, 0xb0],
  DocType: [0x42, 0x82],
  DocTypeReadVersion: [0x42, 0x85],
  DocTypeVersion: [0x42, 0x87],
  Duration: [0x44, 0x89],
  EBML: [0x1a, 0x45, 0xdf, 0xa3],
  EBMLMaxIDLength: [0x42, 0xf2],
  EBMLMaxSizeLength: [0x42, 0xf3],
  EBMLReadVersion: [0x42, 0xf7],
  EBMLVersion: [0x42, 0x86],
  EditionEntry: [0x45, 0xb9],
  EditionFlagDefault: [0x45, 0xdb],
  EditionFlagHidden: [0x45, 0xbd],
  EditionFlagOrdered: [0x45, 0xdd],
  EditionUID: [0x45, 0xbc],
  FieldOrder: [0x9d],
  FileData: [0x46, 0x5c],
  FileDescription: [0x46, 0x7e],
  FileMimeType: [0x46, 0x60],
  FileName: [0x46, 0x6e],
  FileUID: [0x46, 0xae],
  FlagDefault: [0x88],
  FlagEnabled: [0xb9],
  FlagForced: [0x55, 0xaa],
  FlagInterlaced: [0x9a],
  FlagLacing: [0x9c],
  Info: [0x15, 0x49, 0xa9, 0x66],
  LaceNumber: [0xcc],
  Language: [0x22, 0xb5, 0x9c],
  LuminanceMax: [0x55, 0xd9],
  LuminanceMin: [0x55, 0xda],
  MasteringMetadata: [0x55, 0xd0],
  MatrixCoefficients: [0x55, 0xb1],
  MaxBlockAdditionID: [0x55, 0xee],
  MaxCache: [0x6d, 0xf8],
  MaxCLL: [0x55, 0xbc],
  MaxFALL: [0x55, 0xbd],
  MinCache: [0x6d, 0xe7],
  MuxingApp: [0x4d, 0x80],
  Name: [0x53, 0x6e],
  NextFilename: [0x3e, 0x83, 0xbb],
  NextUID: [0x3e, 0xb9, 0x23],
  OutputSamplingFrequency: [0x78, 0xb5],
  PixelCropBottom: [0x54, 0xaa],
  PixelCropLeft: [0x54, 0xcc],
  PixelCropRight: [0x54, 0xdd],
  PixelCropTop: [0x54, 0xbb],
  PixelHeight: [0xba],
  PixelWidth: [0xb0],
  Position: [0xa7],
  PrevFilename: [0x3c, 0x83, 0xab],
  PrevSize: [0xab],
  PrevUID: [0x3c, 0xb9, 0x23],
  Primaries: [0x55, 0xbb],
  PrimaryBChromaticityX: [0x55, 0xd5],
  PrimaryBChromaticityY: [0x55, 0xd6],
  PrimaryGChromaticityX: [0x55, 0xd3],
  PrimaryGChromaticityY: [0x55, 0xd4],
  PrimaryRChromaticityX: [0x55, 0xd1],
  PrimaryRChromaticityY: [0x55, 0xd2],
  Range: [0x55, 0xb9],
  ReferenceBlock: [0xfb],
  ReferencePriority: [0xfa],
  SamplingFrequency: [0xb5],
  Seek: [0x4d, 0xbb],
  SeekHead: [0x11, 0x4d, 0x9b, 0x74],
  SeekID: [0x53, 0xab],
  SeekPosition: [0x53, 0xac],
  SeekPreRoll: [0x56, 0xbb],
  Segment: [0x18, 0x53, 0x80, 0x67],
  SegmentFamily: [0x44, 0x44],
  SegmentFilename: [0x73, 0x84],
  SegmentUID: [0x73, 0xa4],
  SilentTrackNumber: [0x58, 0xd7],
  SilentTracks: [0x58, 0x54],
  SimpleBlock: [0xa3],
  SimpleTag: [0x67, 0xc8],
  Slices: [0x8e],
  StereoMode: [0x53, 0xb8],
  Tag: [0x73, 0x73],
  TagAttachmentUID: [0x63, 0xc6],
  TagBinary: [0x44, 0x85],
  TagChapterUID: [0x63, 0xc4],
  TagDefault: [0x44, 0x84],
  TagEditionUID: [0x63, 0xc9],
  TagLanguage: [0x44, 0x7a],
  TagName: [0x45, 0xa3],
  Tags: [0x12, 0x54, 0xc3, 0x67],
  TagString: [0x44, 0x87],
  TagTrackUID: [0x63, 0xc5],
  Targets: [0x63, 0xc0],
  TargetType: [0x63, 0xca],
  TargetTypeValue: [0x68, 0xca],
  Timestamp: [0xe7],
  TimestampScale: [0x2a, 0xd7, 0xb1],
  TimeSlice: [0xe8],
  Title: [0x7b, 0xa9],
  TrackCombinePlanes: [0xe3],
  TrackEntry: [0xae],
  TrackJoinBlocks: [0xe9],
  TrackJoinUID: [0xed],
  TrackNumber: [0xd7],
  TrackOperation: [0xe2],
  TrackOverlay: [0x6f, 0xab],
  TrackPlane: [0xe4],
  TrackPlaneType: [0xe6],
  TrackPlaneUID: [0xe5],
  Tracks: [0x16, 0x54, 0xae, 0x6b],
  TrackTranslate: [0x66, 0x24],
  TrackTranslateCodec: [0x66, 0xbf],
  TrackTranslateEditionUID: [0x66, 0xfc],
  TrackTranslateTrackID: [0x66, 0xa5],
  TrackType: [0x83],
  TrackUID: [0x73, 0xc5],
  TransferCharacteristics: [0x55, 0xba],
  Video: [0xe0],
  Void: [0xec],
  WhitePointChromaticityX: [0x55, 0xd7],
  WhitePointChromaticityY: [0x55, 0xd8],
  WritingApp: [0x57, 0x41]
};
exports.id = id;

},{"../../constants.js":60,"../../utilities.js":67,"../ContainerElement.js":61}],66:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _constants = require("../../constants.js");

var _utilities = require("../../utilities.js");

var _ContainerElement = _interopRequireDefault(require("../ContainerElement.js"));

var _EBML = _interopRequireWildcard(require("./EBML.js"));

function _getRequireWildcardCache(nodeInterop) { if (typeof WeakMap !== "function") return null; var cacheBabelInterop = new WeakMap(); var cacheNodeInterop = new WeakMap(); return (_getRequireWildcardCache = function (nodeInterop) { return nodeInterop ? cacheNodeInterop : cacheBabelInterop; })(nodeInterop); }

function _interopRequireWildcard(obj, nodeInterop) { if (!nodeInterop && obj && obj.__esModule) { return obj; } if (obj === null || typeof obj !== "object" && typeof obj !== "function") { return { default: obj }; } var cache = _getRequireWildcardCache(nodeInterop); if (cache && cache.has(obj)) { return cache.get(obj); } var newObj = {}; var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var key in obj) { if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } newObj.default = obj; if (cache) { cache.set(obj, newObj); } return newObj; }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of mse-audio-wrapper.
    
    mse-audio-wrapper is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    mse-audio-wrapper is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
class WEBMContainer {
  constructor(codec) {
    switch (codec) {
      case _constants.OPUS:
        {
          this._codecId = "A_OPUS";

          this._getCodecSpecificTrack = header => [new _EBML.default(_EBML.id.CodecDelay, {
            contents: _EBML.default.getUint32(Math.round(header.preSkip * this._timestampScale))
          }), // OPUS codec delay
          new _EBML.default(_EBML.id.SeekPreRoll, {
            contents: _EBML.default.getUint32(Math.round(3840 * this._timestampScale))
          }), // OPUS seek preroll 80ms
          new _EBML.default(_EBML.id.CodecPrivate, {
            contents: header.data
          }) // OpusHead bytes
          ];

          break;
        }

      case _constants.VORBIS:
        {
          this._codecId = "A_VORBIS";

          this._getCodecSpecificTrack = header => [new _EBML.default(_EBML.id.CodecPrivate, {
            contents: [0x02, // number of packets
            (0, _utilities.xiphLacing)(header.data, header.vorbisComments), header.data, header.vorbisComments, header.vorbisSetup]
          })];

          break;
        }
    }
  }

  getInitializationSegment({
    header
  }) {
    this._timestampScale = 1000000000 / header.sampleRate;
    return new _ContainerElement.default({
      children: [new _EBML.default(_EBML.id.EBML, {
        children: [new _EBML.default(_EBML.id.EBMLVersion, {
          contents: 1
        }), new _EBML.default(_EBML.id.EBMLReadVersion, {
          contents: 1
        }), new _EBML.default(_EBML.id.EBMLMaxIDLength, {
          contents: 4
        }), new _EBML.default(_EBML.id.EBMLMaxSizeLength, {
          contents: 8
        }), new _EBML.default(_EBML.id.DocType, {
          contents: _EBML.default.stringToByteArray(_constants.WEBM)
        }), new _EBML.default(_EBML.id.DocTypeVersion, {
          contents: 4
        }), new _EBML.default(_EBML.id.DocTypeReadVersion, {
          contents: 2
        })]
      }), new _EBML.default(_EBML.id.Segment, {
        isUnknownLength: true,
        children: [new _EBML.default(_EBML.id.Info, {
          children: [new _EBML.default(_EBML.id.TimestampScale, {
            contents: _EBML.default.getUint32(Math.floor(this._timestampScale) // Base timestamps on sample rate vs. milliseconds https://www.matroska.org/technical/notes.html#timestamps
            )
          }), new _EBML.default(_EBML.id.MuxingApp, {
            contents: _EBML.default.stringToByteArray(_constants.MSE_AUDIO_WRAPPER)
          }), new _EBML.default(_EBML.id.WritingApp, {
            contents: _EBML.default.stringToByteArray(_constants.MSE_AUDIO_WRAPPER)
          })]
        }), new _EBML.default(_EBML.id.Tracks, {
          children: [new _EBML.default(_EBML.id.TrackEntry, {
            children: [new _EBML.default(_EBML.id.TrackNumber, {
              contents: 0x01
            }), new _EBML.default(_EBML.id.TrackUID, {
              contents: 0x01
            }), new _EBML.default(_EBML.id.FlagLacing, {
              contents: 0x00
            }), new _EBML.default(_EBML.id.CodecID, {
              contents: _EBML.default.stringToByteArray(this._codecId)
            }), new _EBML.default(_EBML.id.TrackType, {
              contents: 0x02
            }), // audio
            new _EBML.default(_EBML.id.Audio, {
              children: [new _EBML.default(_EBML.id.Channels, {
                contents: header.channels
              }), new _EBML.default(_EBML.id.SamplingFrequency, {
                contents: _EBML.default.getFloat64(header.sampleRate)
              }), new _EBML.default(_EBML.id.BitDepth, {
                contents: header.bitDepth
              })]
            }), ...this._getCodecSpecificTrack(header)]
          })]
        })]
      })]
    }).contents;
  }

  getMediaSegment(frames) {
    const offsetSamples = frames[0].totalSamples;
    return new _EBML.default(_EBML.id.Cluster, {
      children: [new _EBML.default(_EBML.id.Timestamp, {
        contents: _EBML.default.getUintVariable(offsetSamples) // Absolute timecode of the cluster

      }), ...frames.map(({
        data,
        totalSamples
      }) => new _EBML.default(_EBML.id.SimpleBlock, {
        contents: [0x81, // track number
        _EBML.default.getInt16(totalSamples - offsetSamples), // timestamp relative to cluster Int16
        0x80, // No lacing
        data // ogg page contents
        ]
      }))]
    }).contents;
  }

}

exports.default = WEBMContainer;

},{"../../constants.js":60,"../../utilities.js":67,"../ContainerElement.js":61,"./EBML.js":65}],67:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.xiphLacing = exports.logError = void 0;

var _constants = require("./constants.js");

/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of mse-audio-wrapper.
    
    mse-audio-wrapper is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    mse-audio-wrapper is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/
const xiphLacing = (...buffers) => buffers.flatMap(buffer => {
  const lacing = [];

  for (let l = buffer.length; l >= 0; l -= 255) {
    lacing.push(l >= 255 ? 255 : l);
  }

  return lacing;
});

exports.xiphLacing = xiphLacing;

const logError = (...messages) => {
  console.error(_constants.MSE_AUDIO_WRAPPER, messages.reduce((acc, message) => acc + "\n  " + message, ""));
};

exports.logError = logError;

},{"./constants.js":60}],68:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "OpusDecoder", {
  enumerable: true,
  get: function () {
    return _OpusDecoder.default;
  }
});
Object.defineProperty(exports, "OpusDecoderWebWorker", {
  enumerable: true,
  get: function () {
    return _OpusDecoderWebWorker.default;
  }
});

var _OpusDecoder = _interopRequireDefault(require("./src/OpusDecoder.js"));

var _OpusDecoderWebWorker = _interopRequireDefault(require("./src/OpusDecoderWebWorker.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

},{"./src/OpusDecoder.js":70,"./src/OpusDecoderWebWorker.js":71}],69:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

/* **************************************************
 * This file is auto-generated during the build process.
 * Any edits to this file will be overwritten.
 ****************************************************/
class EmscriptenWASM {
  constructor(WASMAudioDecoderCommon) {
    var Module = Module;

    function ready() {}

    Module = {};

    function abort(what) {
      throw what;
    }

    for (var base64ReverseLookup = new Uint8Array(123), i = 25; i >= 0; --i) {
      base64ReverseLookup[48 + i] = 52 + i;
      base64ReverseLookup[65 + i] = i;
      base64ReverseLookup[97 + i] = 26 + i;
    }

    base64ReverseLookup[43] = 62;
    base64ReverseLookup[47] = 63;

    function base64Decode(b64) {
      var b1,
          b2,
          i = 0,
          j = 0,
          bLength = b64.length,
          output = new Uint8Array((bLength * 3 >> 2) - (b64[bLength - 2] == "=") - (b64[bLength - 1] == "="));

      for (; i < bLength; i += 4, j += 3) {
        b1 = base64ReverseLookup[b64.charCodeAt(i + 1)];
        b2 = base64ReverseLookup[b64.charCodeAt(i + 2)];
        output[j] = base64ReverseLookup[b64.charCodeAt(i)] << 2 | b1 >> 4;
        output[j + 1] = b1 << 4 | b2 >> 2;
        output[j + 2] = b2 << 6 | base64ReverseLookup[b64.charCodeAt(i + 3)];
      }

      return output;
    }

    Module["wasm"] = WASMAudioDecoderCommon.inflateDynEncodeString(String.raw`dynEncode003déúHé¶¶3{,ú´4"zÔù¨¬ÏbÔ'ÇßeÎØOO¢Kfîg´yÓ#ÙOÖÆboåãàÎ&ÆWPÞmM =}Ã.UÅíÂn I©nypÎsÐ	àGc}xt',<êòvÔÑÙÝåå¸3¨*òûòôû,¨Ô{8"åg<o¹^û®= ÷."C<ÒeL»öT&äçDÈ5èöë§F¬0)HTþ-èìKQÒ°ñ·ºÞZçö.çªKëõ¥R,Ý>Rò7¸ì/ç+ÒÃ}.¯¤áyLÈÇvÌtßÜjò5:(38ÜÑ9»ëf|¸ækÒç"ágÒd åËwâ{çWòGbõUÌäd££¨°®fë$= 8ìwNÚîj«ÉèHØ'ò©òæsëàöQkk×I¦;Ü: õX¼WÔßÔ3lÓ»{·æ!ß<é1hzX2§:üj7"û9£"æn^Td.ßhñöÅ¸¦vóøì!"hdg±fÊx= $Y)ßzâO¬"lâKéõ­"p â³Ø×6Të¡Ò9³ÆXëÏ\(¢T°+(Æèn]%éïW9 r«5ð§.¤§Ù5ðÖµÜjéH;©¦r/¤«r³;©§ù
Üêéh;©4§ùÜ*Ê48ðÀè.~¼³¥r{!Ëé%î{z@ï5f2ÅÒäßJ=M¶= =}-Ù¡.v¦Ý¶"	­õ'¤RWö²$±õá. i{Ç:6­æ¹¤hBq¢g9å6eÄVv¢"*ÒXë¢yöÛ²+» ½eär§2ËÈ·óÓa¿Ur+¨½Ö}x°ëÑ±;YtÕ %A°½åÜXUb¼Å¯ú.%ºÞ¶1C#²ío·«¯|$÷L¯>¹ê5®DUTZ'¢ILl'³Ýcë}= ZgEÌàùpeõ¦My>>Þ¡-	©­óbýì!Hð¯\Ù(z| LÓ¦}D§>õ± Ë!1ï­ð2Åè£ZáÀ(±c0hÎ3_
ÀceN2òVï¶¶Õø.J7w¨âþk¼ðXrhzYæÏ-m¢§0;äå· ¨Æ»¤"ªn^<âqËÞH\<Ì[97L:.ây[Ê  2|üð\ìØ rÍf¼²©ÊîaÖRëÖ(æJmÓQtäU¸2Ù<X$öÝ	ä2p·¿D¬Ú"ÿ%q¼]©±«é"³wÊxÃ¯dWû«E 89v´h¦G
ðA6® 29:âÛÛsïWà,"D¸ªÎ°ØbS·@Ç§»pòrÍü(2/|e2Gð(î¯¾¶½(!©têíEÏ[(úÔù¶0,¹~¥®àràJQ¼L:É;=}GÚ'Óß(ñ+gÝðâ6 ¨=}Ô@÷Æ¼#ÚàéÐpÇ7nió¯åëêfÞågNB·±;:·ñòÍU)æu""±1,á$ÍÙ·¯sÌÎP	ni¬Ç6ôöWàhd±®'Ç®õ51UýrÊÕ(¢í=MÁoë)àÆcÛóÕ
3·Ï-_ô×X¬ò/Æh6tK¦2¯öSæ:§¯ ëêª8êõî¨¦Z´ (D%=}ÈS(ÍK*õ'íú­nbn"µ&WÀB×´²ÚyûoSø9&±×@ÂdXÉYx«wíúË8¾ÞÚ$¦ÝÿítIÝ (ëÐÙ¦ä×ÛãÖýXÃ¨bPçêöî5íUîsÍ¦BÛUÈôÓïáÍ=M=M¨éô©h­ßÔ<ÿÒ»ã(=McÞFÀ©ý!váZCLñGÁ$¢+ý:Ë-ZÎéÆÚ+ÇÄMÈ.lT ÷'¢bF»è=Mz<ÞîêòÞcçLð\)1êýWð $× ,[ôþí.µàð	Ìõí'O#üº<Ñ?>6^cè3çóG¿âôJJzîFr;²jaÕéCd;\¼ ¦À7Aé 1'¢²r«æü[Í¤vHµzü.ÒQÓ=M§\¿¶ãRîà9Ì<Î¤MÅùm[(|²8øâò9òì:ÍUb1S4ì¤"ù°´¶oG= lNÁø:×Þ°ºÕª;¬ß»8,~ß'áR	ÅåýZýkXÞp,Êfï'VRLOÓaP[ÆûGÉ½êø%¹vÜy
Ó0Cïè·¿j^LëÜÕYS41Ò£Íùa÷]	öCâ:~o ioÿ±oÏaa>í¼¯íJå[ý¼ª@9xOcåÓõÄø¾ïeñ5UÍ»sÝ¸!rüIñLíûâ.JRÍ¥QµÈæ7º¿¤RñÓ^l¸Æ÷g§Xêh0}yåÇÓsG*Å"©¼P= Ãÿ@Õ%ÙM=M80®$:ÍLF«I9W°©SuÑ]PCÉ[½iFwËèTUY{D²Ò±DRqÊXÉEtjü^ÓqK2Â§rvvÛòÏREá½ô#wzcõôtPÔPì%1Ç\Úú?êàg¥}å±SqwX{Oa= :ÑÝÉJý²HÑsÖå8f änÛÆ´Ê"O_]¾ÁÕ- ¹ÞÔ)OùÉM|(rX	bIÝuhÁÁ~¹tÚî/«wä IàÞÐsIGuìU!Ä\ÓÁ')Ô¬ÔºWq²ò;ò»8QÑ0×«2ïû¹
ëáEðÌÞu±È#ÿÖrð#eIäÜîb²¾ö4½ïÂÒå§|Ìl¤JÚÚ+lÉI/V*'ã.±õðûÙèHHAzë¯ì¡ Mó­êëó}6ÿë¨1µ¸Ùô¤2sÿò¡àºJ®ÝfV	Uj¢ªqêe·]Ç]o= Çæròq½ðp  ÃÝHjàß°ÿ~îªJv4Uw¦chEwÚ»;vëcÐ×AsÏ¹¡ßm¾$¶:õî¹Úèë£>¥Ab©ÌXä·ð¶W¶p4Ïåü-$ãÐZk/¦Ò/NªÝ¿>= íG£j(IÌFPL§fpþ§£íÔrÀ#Îâ1VÏãØ:R.eµReÞx%QßóÒ j'û#çäÊçPz¼Ø$à,õ'øÌ:8YºXItÌ¼Ã èØ÷$¶àr2|¢Â ÒÛþÓ´éç¤ÞÔËãðª"Ø)Ô«â0ñI=}}4èÀ	H~Bó&ì£°üßºÃÓ#ûc>×«;x1ãÌëBÎºtØ°°¬èH«ÐØø2³÷ÝZ\i£6J²æækrÊ¦ð´zX?6¢_¿¼Òµì7«s(£¬úB9ãðcwD^Þ%^/¦lÀã¦ ¥:¸xñw'¿(ûj%ûMia6ñ ú¤¯ÃÖ©
#¬U,÷V¼°ê$>¬[saïmrwnJ¾½âQÇUÉéÝÂnXRÄíTÞ¸ùé+j÷LÙLÉX@ÀC=  Nè ïÞgUà;h
Cqý2H7Dvoè]wçã¸Âp«ãe?Û»¢¢Çm÷#v ÖÄ;I4%Û¥2âOÌªGM0%úà«ýôfRÔÉã×ätèøªÝ½ÛÂhÎÄØ'arA~ TÍv=}÷¤òÃX­ª=Mõt©cvª {Ám²C4IþÕÖèa½ ?~v«dá@W«TÉs}pdÙ=}ééÊåÑÕ	Ãb.t¥åi¼´Qï¸= M±d¨U­Åïµ{ßíÇz^i7kzÖ§å¡Pë6¡tÚ#õ}Û­ÆØnìWÁSõ½ÎbÐ"Ïa-1Ý8=}Êsßú%ø/¡zë¶ý7EHSùSW?È¦ÑI½6´ê:Ö%jÝÕIE'OP.Qò§Rrê,·B7=M9erÓ´1ÔõF®C±P§À·ä$×¼Vü
í%ÀË©ïÂ3*ù	CÜfUá±àè?4éfØ
³\Ö´swÑøÛr8¸XF¤Ín'µ*Gj¥±|öÝeÝvÏc½çÝÁBáÃùIÍÔb+!¦x¤9â¦¯Ó§|½3í®b¨ÊÅz¼R¡ðJÖChE¸©U%ÓcÎ:COZ±Wd·8í»»Ä7ôü<l:\¼1x<ùi¾<#
5%\ûÔîÝÈÊíçÓc=}=MñÂUª>W§¸ø§Øö3+Úæ?êJÇú2¡ô÷'ñô¨ó¼pÇètÙñ§)µÊr'Ð¥	©´wêÔÊZð\òòßVêëî.Q}ú:¼hLYúBÒI=Mý\e¨í6Úªõ6zþßÊñZq^ÉÜªIn7eú¿¦´¦3Í;×f(Ô=M³ôÀËô:O7ëïAU2Ø²ñ­"T~jác}SO¦FÛ(ß¡²ëÒB~8í«ôhcDlaÐ» ¯69Ji°ãnnYQ= è.X]ðZ*§ï 6:Ôð:¶6³ìèh£XÖ¨õ:¶¹j½æìË$Øk$"rñIRt»åT·1î'¢O7&Õ5çØ¡_dÂÎQU£©Ð{þë~Vý"ÚKµË»¨*TãR
²kóÇÏ*&«oªç¤= ÷ÐÚfªééï±îÉQ*ïá3¨Ä'ÌnD&z=M;úTw2óÏ<®ÚØmÈð±Hjk±}¾RÞaß2a<%þä£ý\J/ÑLNMÏ9j@1Hñ­=M4=MåX©ó!¼DÖM<ñë{b[tªË[ÙçDä§Wá­§õÒò1[gúÜöL´0qÇG¢´7ÝúJÝ=}«úÅá·Ü±Hä
¡q&g =M1[fÃ5wõ£¯ÆÊ¬Úl-ÌcÈXè¥ö73+L²ÞÌ×Óå|ù½ä»%aë+=}ñ1K×0zä9~wä¤°Ï :¹°aÊÛW\½o Pp÷úýyàé j£ÏIº(iSV$K7Ò¦CÖ9#ühÖóEßæxÓ<½:DÒr¼¤¶jü:eç»Æz±t|Á)qÓó1M]÷ÃÿÃ= ¦C¹}ñÑüÙ²7SÿC¤¤ÃÉùWü²VØ«cjW*Y=M,cÝí©(/ æ¿ù=M» é,\´rÞ4A"·Ìæ§8ÌÒSvðöåßÛ´± 
fJ³·MÓx|ÛÏnL#ñù/»jZ$vìbIqhzÌ÷Q*Ozd~ma9Å1I¹\£Ê0¤3±RÞ÷Ú[7Bëìô=M÷§9Ðæ9Ù¬íÐôë¢2ù\ìÒBHUíµ-·à®«pkp¾Ì"ò5hötß#nu	WLíw¤@÷ØÒ5êfÝX©0Ø%®ü[ðüðÐ·xãß$ô\w?1,;!:¼¿1¤Ê9 ÜWDªfª¡¶åÎ>´XXÙ9(Ü;Z£ÃCÞOfÞÆÔ ´á¹åK«¡I	±èÛô%Ø;¦$wú ò²pè,2;³èôøAß¹RÀÝ³TÕãRS= ¬~F@Iurj6ÃVùf»Gýú}#ghì64ûÊüCE£øö<þ5ÝÏÃõBÇ~P\ÉS²à¦¡'ZUãÒ7oâÏÊâwû*ß,kHÙó{ó= ìê¦H 9ZQ\Ï~y§ªìà%¨µygÜMð©U"¦{»²rkpsãÌì¿Ùé®½Þõ(é~¤·¦Gö#«à6pØ¬ð:ÝÃ¹¨ÇÈ÷-,
f¯>ÕÅ(6/ý¼ó|<<3(êæù¯oè³080<¸|×jtÐtØo6Ò¹Cq¶¤Çûóv<0zÑ5bQr·¨r;7iô%².æ9Àº¦ºýý¤møÌ.¬ÆÝ5[¦¥;fòÕOÊüLÂgì²ç*­&Jr3ÄµdÝ4±¹úÂð>¨Èè1Ã= Û^¬/·"úqt_ÂÐpl¦ì·*[à_¦ÕFÏÇYÝ;õ¦p?0EDñ õ|ûä K35JèVÈdÇøóôP_sMå=Mç§RnÏÿ7*$ôüjÏ¬= °øAÖdÊ	õFäjçõÊÍêÅ¹Ö¡
¼oÐ5GÕ5Ù<¢¶ÑmÅ@ÖöKmÿJµ3þnoÉ£lXUÓÉ-À·¥KóN<öé{|Ú/Çjê6Rçmpå½åèá×<vñø­£Êm-ÊºÎýéÆ=}éÎÄßÞàÊ<§H1¾ÕSHr|ù=}ZýswôFÝ>ÀoVvVC±ìÿª&=Mó¸
øÔËæðX·Æ'J@ØýÂw¼Ö(#tèú!$á}jÂX¬¯ sÝçYCÆÇ>"TsAÍ³/fú¼mhïL ÆS/±þäïhÍÜ^/¥½+M¼EÁY¨7
À§h²=}äñ~GEíö(c3,ZÊNG)9ÙüËmÂ¢}3àÔqSUÝñ³\¿=M¼:íA:×5ü¯Ëé¬Yå27²Ú½N\Y-ú©Õ¥Vðè*¹³M|=}Ç!Û'F¼=} ÐzWÒ Ú«YGóò=MÝ2Ý«ÊHuU.,§T¦ð¾¦º^µ¿ ¨9LÌ¨·úÚÛh=}2cíÀÊ¦Ú­$ë·	káE3	|ÿ¦QAÈî1?s7ëB;ÞQlYsÍªÎ÷oVxD³&ëæ»âßØóÄgýØ®¸L{9-QU%oäÿ	= lmø¯Mgvq_Ý3Á­å]Ð×ypõ._GÅ¾¬	ï]uû>êMHÆn \ç«¢×ú6óÝøgfó	~ïiX2¬u¦èz9°ÉYL£ò©ëøû]úsÙHõ0Â2¹×V'6në%»1I£N¡Hªe¨·ÒØu:ðís!Ê<{ÎÆ# j·÷ØJÈí|ÃÇØ¼îBw÷åäâhÉsçûù»zó&Ð)ß(6s5:ò9ìÆóùñÛì¦}+·ïÊz»Æð=}»%UïêWRÚFÃïn),Ò7O ûN»-SÑsõÖ¼Øæçn £Ùôöå_¦¦¬Q ¿?bTht×A9)CsÊoëXê2©v<= «7úÇ¬6WiÃï= ­E\«9ãúyîÓtMDw6u¥Ø­½íî¡¿P¿ùû¥ YÒ¢Àf:oèö_E¦Ú'-ßùú«úrÎK?²ôa=  {ûËoêÏ	jom¼þO(«éä5ð ,Öë=}.»>Þ¶¥©XÄ<F
jÀYÙ¾¾³ö+dä65w¸ùxè q#r>Ðð#ú[ä­áØJbð*ñ[Çø*w°Ørkº[qÅÀ¢ÎYuÎÐ ìØä"Óþ£ô£^|l¿zO·^ë%=}!_tè§FÊLq¨ë tieK¡ÊÕSbúìö
ºÒ <_g½]÷@:ñ±ÂRÔ6PßKæ=}Â·çf}ôòZzù=}»*) ­¬+¨0§Úx/ëUæ|oÑè8D)óV
1{ô@²ÜÖÎ¦+ÇQkäª4}Ü^ÒFD1±ò;ö=Mº®­Ç58ª´\*.«ðüÖ0±\&=Må&¢°®þyàE¤¡ón îþH_rÖ)ãf¼ÈÛ°åÆ«À$¯¡&·¤ß>¿ßba¸LÔ4Cásã}hE¢J¦Öcü"ètãB_êê^ìàBÿX¹ìÿ·:Ã&£ÝTµ¤aÔ«mç=}A@ÆÃ}0Íå=}¾³G}Q6ûf¢Oï#Ó]ÚÅ§ôìbö¾¤ç4a 4­JPt©#Ò âp °tdMKf:O*yTêÖ=}C©Q("Øï6 JøA@jGæ=M¥Ê2òÄÆìHJ}Q	¨[½Öz°ï¬Y(ûBçSàïzªä=M9%À¯ïª-ãòc¤¹%¹ä;TØx.98ò'yæ¼°Çâ&bá+úüfèÔiú	¬ÈKmÆ)À§±s­]ÿÍ"é%±øtÖc=MrÂñQ'{ò£©»¤ÖZôñO8zí!µàeÊåp¨µÀßxWU k[ýFÇÛ XH§x»ºt?¦#,bæü èäÞ#ÁÂ= WÀþa"1Âõ^~Px£ó§é =}1\ËEPÕØ®%×	¼Ây4ÐºW¬|òCÑ&¥®³ò6!ïòcþ}q´­¡¦6î{÷Õ«¿3t²ÒQËs,þpÄO q4äú½Á²g8³[ªàìå²Åõ|º 2ª~½Tg!ü${©]K­nX c¾û¤z	h(cÄ:üïièøtãÿ[®= fE@{gOÿ$ÀèãòfÚitÍ@»8Ê\;Pa<$<1lû¾ÆÿM¸ª9¿ÂBò+ÿCaÛõæz°3aÎUb)r@ªxdò!vÚÛ¤­Â@4^Ñ+=};9ÂhzÐ¹]sµz©^Rx=M$oÂáüÏÂoÊå\ÏD<Ó·ìùåRÔ|gðöùgJÅI tÄ Ï¦§þ~DèØ¤µ|ßrÔí¾é¼±/¼piRP#cã]Vß&¤Ê(qBÝ@£ËÂÎ£= D&ÑWÖ«XYü¶SH7gíA ãÀ·c2éÇ~Îû	=MX1Hû}§B3¯UßPTz=MueíÅ$û+3»:ò Ø5
9Tþr¦Z1bDZ|= 
ÏPÀ#ìå1¯«¶À³·vt{$/:±Ñ÷'ÙÔc'×CKë©pö|M±°«líã¨9	¸º¾þñõ×¶bµ	ÐíZ>vb¬=M.aG@û(ÿ#³>ãæ^ü«S@÷C%ÄiÿY«÷ÄàªBÌÑjÿ¸Oä©>	3òúa9px©\Lçæ0Þ&ìnÉ
}_9k.øuï©X½ý{etTÊY¢zú»=MîéÙ¡<:ÖU}>X= ªJ õ¦nµØE$r×]øÊ£
¹ªý´eä\
1+±ÀgÛ[ùUz%sa­y)2 ×V©^ú@p©gÆÝ,#ÏÀ«Äªq4¬æÏmlwü!=Mu³q±(þ÷DÍ¦hCã%ã	0«¨±DÊ=M¿oÇü,0îËrÕWÒûo)}ÓÌ.kÏwõúKÜ$KÜ@cK¼zç HfUÐ>ÙÅµGæqÄ_Êuq#×°¨MNÌscÀ;&ÓµùòµU{ëJ\ÇÚ £èµ)øeë{¹\{ë8N3çFSéåùAîÞ¿áé(W#"fv"UjÐÈ|}
óy39ujîx	©"©sÝ7ÑØXªÞ»K¦ç ÷ÄÂ1½K°&w	áÄ²Õ4&ÍáL(mÛ[ÞÐ{ßhºÄ÷çjºÄ7õK®·Ä·od5d£,hX°tÉ¿ ~cÍ NÈÎ5®ddrs}d:5a[²Ív£-MùÁ¯dUb'Ál¢ç-Ä-  ¡ÀÊ0)îð9ðf"3Ñüúwµ¢bð¤ÌKÜz'ÜVj»¡È\VùyÚ{o¹³|è&3 Ó*ÄDìiýè¶ó¬5©Üd*ITú3NBÍë!ÆVZ13ñv	x8´KL'¹ºLJ(¸¥-é ÜZU{xmµ-3KÜ*Zyöç¤%÷Ç¤&ÖsayØ$ÕnGáøq¤ÐµÉÊn<à+ àõ|!#;¶ÑjpºyWµSA+G´aC
øë³4îiAKéóCìäÃ=}6B\'þÛ_Å{9-ÔÁ±DÊxqU/f*3þ
bM° O©ot-«+Öáñe;³µ¦ÆÚ{ªËoþWòA!¨&Dð¥Tµödk54+HkfÕÐ Eå9«ÀN= ÈdÄL±öevY%¹Í^Ã#þQr¿B«à3AÊ·LËRHØ\6,jSÏ.ñFðóÆÞÃ,u
½.!ß$T¬ên-QË-¨ Þî,BNS]U'\l4oªØVnªCÿLWk÷Û<þÄbf0	å°æ1ÿ,ËÏ]r0½*^úû3a²H¢A,ôã½ÀXÐ»\pO©OußzKZáàsÿ=}MéÏ.0I¢ßI¤ÒLÿ}½LþtÚNm>à-k±¢îî/ÿ6CË6K°ë;GÂü&¡Ç	æ,9&¨Â^Ôÿ¦×o¿æõRXt~Ío2É7)ExPù»v2ÈiEÚ)¹/[§Sj*®ÓÊ(T!§]µÅ©HþYA×6tJµ,ÔÎ¸Xv:í1Á¶\èL®Çô Tè(uK·éã~Â±ÿ;K£I¡JcÂí½3>s!C[yjaDÛÌfmU:ªQÅÁæ_Øîew!ãbQá§4FRÏn)(ú?í]×¿DH;EsÛäÚ^¨¢våZÐ¥´4$é¿Ä:ÇÊÎ$¸MùVyá4½\ÎÃ¦Hw>K¥?uiÿvi·ÄV±ÐYãZwa&³Z(¯%ý4vñaÅäw2Ygí·KnéçiúûÌå®Õ÷¤Yó~ùu)£­uE?®uCoJÒ-VË [jM·ý»aÜî-ßy¸syÉí^ Í}¾~CKh8z0QDG?Doj#Pu´{ùïö÷ÕµS3^¥÷ùIdnÑµÞéº ¤4Êí%*Sôº-xÃ³QiW±+â8ÌQ)dç¬ã9çlü¶ ÷-)F?¸ÛX{ØXyH)JÜBæl;ÖEµc7ÜÏüÃ7¥-©& ðGýÛ:þð¤=Mþ*póç÷t)0y·±5K[ú4yÌÃQì÷n,+V {æ{G£ªµñ¤ÊÒ_¾fÝÛ>ðk6	±ã@ªË'ol>OÀþXi¯êýúnèråo	lMîuòL\é±¥Þ­ÃÙ	!T3×	­;tí°XÚ!°^qÄJe(ª"Z¥ûã¬ì´àÖñ¾¤2ìRØÁÊ¦1·_ßdùM²$zt».7ÈïÊÝ¥Í«µ)th"sNa"RÍ¡i 9Ú*KÉ4	¢ÊÔ$«Èã2~¼¥p¥ú^\iÉJÜS8YìébÃM;ÛN {§ÓtN$äoÅ5Õ ïã!µ×*ü	Ü@LP]kQ|s, ùþg°1XfØäN¼kÃAèågÃK¨£íë×¢ñHßdR.£áÏ #
 èýìã'(aüô §¡ó/y¼,\?æêRúñÈÈWwà8¬P8©Rþk¼÷?ÁÍ;çÖ7ìãpwÑVÖÕMÙ½Õ3Il	µB0ÐèÍ£~iY-äµIf#ù×"( Zó¢M­V-áu8%S°¿tu»ïËø	1Ë3=}DROË:Ä:û>òÄôçm.ê"CiðÒô0Ø\ISìTÖêµH<Ïw_AÄc»n4 êþWSª~l×f2Cvç;ÿ
@êîAÞ¦doÙn&£	kÂºü j3o}êUùeEÖT²MÎ×K³iimß"çó"sEä~Ü9KZé8ºº¤=MJüò<è²@ºdMx[Ë!t£§AVÿËðü
Ç¤ß¤%ÃrÑ~ò0ð	½#ZÖý»fâ2<×éæ>yÀRÍÕÂòcìL,Ü¶O'ØÎ¦¡/QWN·©Íâ)vÙ6©ÕÄQØQ!å>jrehËýõ¸ýòPÔá¨¦èöì)I}4½¨Vyu@ý\)e5{Û¡ÉXÒ´81ë!ÐÂXT½~0ÏùM¶.> ·ÖCúæ¦Î\øô_l÷4µ.¥äd-zfÿøxþ&ÒÇùì V\ñªÞ§G!ór­²¨¸DRWân4nå%å>ÿøìëÄ9ø([µÌàý ØqJéÛþ¸OÇ7Âh6WãI (¨ÇmB[d/§Î¨M¾Hí´õøH,TñÇ H²&õ¹ÇçîÒ£ÕÞôÁ?Êò±äö"pqì¬[¡§?þiUW$'ò©äd½v±ÓÛóÍü*ñ2þFøys¦¦÷pµN[1@dÀ3Íò<üÌ)"mr°ã<á»Ïý=MFï }Ç&f»-&õU4Jyí¶e·/ç8-FÔÑÐXÔviMÎZFss"7&alFÓµò6Ô-ãüàe¶ecKöóñ®µ_}Xûå= Ç1-^%(O¡RÉò¾= [±¶²«ÅkT/Teò²¦«×µ	Àé¸= SëÇ AË¬4aà)ñ#Ö%ÖÌñù^p«ÅùmT2®¢cÈ*¹ÉV"m>eãj?= Ü^:ÕªPtÆáÆ¤.¹"ÄGSöV2Ïã¼%¼^y;ïz;½]u<!½!4Óâ&:Éuÿz)¨e]ú^Cyè=M»¡¿9ønòèeYo?]É ©í$¬µ5AÂ¼´Öh©g(M×¢mF
ûë ºþUµyk$ºÜc
oõ)U^Ä¿m	ö;xqÑ\ö>}m»X+:íIÐ¡ðDW¶5%²üwñsùh×?¿½WW?
	Tõy«= ç[,\}öÚM/~ò¶ì2-ëìyÁK5 ¦Ê_F¹¨íôåÙXøR$ªG:´ºaùsªîÝ;é&ãÎ£Q!¼ =}­sÒ'ÒÊSmÙC þ·-VóGÝÐü±Óq××bh$ ¯Å=}­4õ¢NùPö¸a´lTSÅÜE X»,¢Ö-dÄQ÷ûÐáôäÒS@cú8M ¨«ä±ïmCÓ¨+ÛÒn½¦'§¤®¢}}9b³Ìö@_ö8_1ß¼¥&ÕLpß6]ÃÏ(ÿÌ©X. uìÕÍe&kMQ½ä©>K_Øº©)ë ô»$.¼2=M<<T4;üÜÑ^åöò+|ºDû]ÇH{ªvUó9}!]9|ßä­6úÏø<Á³bä--ºáÆqßÜÃÿ~8¢dF¤~óÆà÷¯×ø	ÔÆ¯[sÖtj&Ï5þwWPî/5çÔ±NÑRþØèýÖzÛËÕåÁãQ¬5¬µ;!èF; µ&Z
Èïþ¦þ§2ÀÉò½þÖb¾CE ">ß&³þÁæ~â®D]ªAç¨Ñk½]wÌM=}óò//¾Û7~Åº¡^mI>Í©)E1Ïä¯zK@Èñ|ñ2S3HVÐ÷ëï=}ÂÏ´åÃb|ô ¼ÐÕÝQí	UtZ¼¶p¨â¤æeCV¨_aÜÍ¬òbü@£ã= ÍgÇå­ÓÍ&ÊCÂk]º3aA{;ÁF¢\¶|-è'¥«;èüñãÉTE/</ðÖð.
Ø<
ü_sTêB;6²â\¡TMz§<(ù¸äNðkl8R©G³³ÏÑÿúxåb9¹_Þý¬VaC¹Ç/~I¶Fã8õcã©føù= â½Xñ"ÂÕiª-r0¯ÁêZ¯Vfôãv^ÃÄ&6HÅØóu#_s&$¿¬Þ:ÙÞÍQa
1õCêDøÝµ.=Mg¾vÏçK	äïo÷fvP;AÂñhfÄ"ÂqkÝC=}B%¬ÁÑ%¥~=}­Ù=}v3sC§böed'ÉQÝÆU©RÝC"Ûcç}8´i=M/­WfîËlíÍ	ï~maÇåÃMÞ»î:U
wIq»s!-à[V!cÝ0
Xa éKµ5ýÅ G6¬ò3i½ö×¢Ê¶=}n¡^mÚ]_wZæ¶û÷©ÂjÖAä¬}BÂ×:fÑFQ/(bMù8"¡Î»´=Me¨yû¬UL¿-çëe¼<¼ÈiÌÃáÃ <*C£/jAs0?¯lo?½âAp«)ÖT²X\ª!kò{åw)Îýv^ùâ¸DÎk·öó-R0a= »vMkH³{ª<Cª]oéiBäHW²å¾ÖÒÝF¹Ûjø]¢Ìt8é?
V¦ü¢bÒhá¼bÍhg¬;Â8j1ûîµþ²¶ð"$RNíäÌQaoö'Â3_'UGºë³Ö.lá¢Í¤x"óÔ~Nò¤H âº= ¦~åÇ÷ÌÏ_­¶¤Âæ¼R)Ã^HÄé¯z¶»;6PtìEK,Oýµµ ðâÞ~ clÑïª¯%»MáDhÁÁ°¥á4ûqÕ\JàÝ8¹CioÿeÜKÒ¯%¶uÛmÄWéw(ÿ©uÿI£!d~póZ)Ò;ê"Îe8ñäÑÐý¥l1µ/¥gÊ£óX.LúYN_Ì¿ò 9áÜÓ¹jÁ§£ZCb7Àz>'©tg*å"åÂ[	fñù2OëFöxM °/#nó­b4£×=}PÓ¡e!Øw}0ºùø£±RæÅñòÞº?½öLÍÃ¿
eEÁ¹JéKJ0]Ò= äI6Ý«ZWIw¸îv¼Ls³ñy3a}µ<3}ACl-~pf[+óX!]«VS \.2^6Dùï·Yõr¯6ÜÒh­ÑÜtúåSÅ¡>+Ëêt:¿j£õü= Ë¢ÍÏ=M©z|#¼¥½ªoM¦IÆðÓX9³þ­Ô{RÐav:àÉg¯æ;½ÝbõUÜv_uÿ/ /ûcG¬ÕjajÄéË3=M0uE£·è8s£÷åRÖkÍC]_Òë³jEMàËò°O<a4õç¶ò*Ê-ÕÁ*êaH5ÃæÄDYN=MÉmUmÃ¯×ÐÏtsñºHÚ d_E¡1ê¢·A=}kHJ&sç¡qIfÛZ/iËGDXDPÔÅk0fÔa9Pd)¿b/{]ëyBàGúÅòé'³ùè¢lA1B OG¸@:»¹¶6ÛÑv¹ù<î"Ø'D&kIWRf=}Ï±0IÅ-Éèü8¼{{l¥ ÖMEê¸!éú'ìa5¹T-ßzg7µî¼;0WK(*%=}W"3ö)¿e#PÐ­¤´3ÉB³ T·ïjøïÃØh³«$Qôö+5±T9VRÜÞÐ»Ä7ùKÒ1ì6ñlÁ­Û »z¸ºõ"Û¤u°Ô«öT+öô2ÜýûÍ{(Ûq±nú!ÛÀ×µÞÝÕìÅ£¥M7jò¼= ¼PT>GÞAcÀ´ô^¹¸è¯»°P!=M-ûNÏ x8º¡©dàÍlj5,g:lÊ®Ãêqpb6ÈO¯í¾¹³ú¬¬*bðh.´ógßàëû*ìÇé^dUÓÓ~°GÅÐò¯lO«3æImÅÁàþ@ÿÉÒº+pÏJû[Ng:+ìX;Cõü"°(Mñ>ëG5iiï	+Ñ9\Qóù^"ðH0kgâ^¥ã=MÎ¶7 DKYu·(¶b¿gÀ&TÈ¸Xi~Ü;Ê6îöÔ)]äJÈë$/4O¾}¢è}y;ñ§¥C= ©ÈPÄ\i^ºô8ñYkÁBå-\4úÄ@ªßà]ûe]{Qc&&®òLÜÂ©A¬oI®LKÙ®òà½,^ÖíªÏ?V4yNipdUüe³ÑÝíÄ´ÓHÙ/Áv<ïsúaÑléâã)Ù=}¶½)©³ØÒÁeÍZbnÿ,Æûß3+ <þü6*k'÷!f¥¤ÐÞý ÁaDHP÷$hÎòÍ{wAáIavÑ/¶bZ#dKÕòMÓLDEQßDYØß%¢Ký=}*âTõ'jP®+¹+qëo³ä°Ò²R+é®Î= :Ý/ºÑæ+3ïh»~­°»%l/V79×¾~jD3¨ÝÂ*á¿WáÞ1ÖTÈÈØYm2¢õ_ì½m=}5ókç^píL¿ú:JYÍfYLB"ÜN·5Òÿp!#-{E()_.ªebøÜK+p
üÁôåmÜ$8 FP¡Ái¸ºÏâVç¹û(Û6ì¢T¬âÁ?fmÜ8¥+l}ÄéRhÔ]ÇÉÎ®È9£ÍNÊ}UPØIF*²WÆùÝ+C²XÝwG²^ÿµAâ/²²¸¬Q?77®ûßLsP¬pÉRB>¦pwà$H[í+m¿Ýï=}kØP·ãA"³A­sKòÍl4#í6cæE³ÐEÄsäByí"ýþlDu4n'HàÝu íU±Ä}Ûn%KÈ>2îUoýàüJÙîQï¤>-BO= *&ö¤Bç;Ù¸j¥¯ûÕz °Í$,Öþ0ÔÕ<TÔáihGWþr-]Qñte%¥Át5#þÊxêVnñÛáTª¾¢»áòýU±º	]]TXD*íUó o6"s¿aOÐg½õÂÌþá	ì	]IÁ[= ÜVAà¨®Q¸òÓÝ[Â<f&/ºEJabè3¶u¦ò¦ç¸!n"Zx»&É=Mµ
ïjó(TüÕí=}ÒFjá!x¸ Á©þª	HÞ÷*Âº¹bÍèÊS-VAþqá@»¸ëë5.tò²0FÑ9Ø)Fwî¿êóõÌ¸²0sÀ¿-ñ>º;Y«U?:úÏæKï7wª~-Å*Eé#·k<n<F+'"±ÐåXÁËâÊÒvm%È|SïºÌ1nH/êÓgö»ÃJ
L+tËÍn©¯!þE¥];ß±x§ãEÖYCNÿ-µmhªÖ45Áý¤i:ï
ö¢?°±-ju= øo3âK÷àG	èu×Oqn[ú¹8±°a3¥äËµÑfÇêÓtpO§AÅÃóÜ{æaÅ·o4»!SÁUÜâÓLêª&hj°r¼:­[dfô	)9-Ã[áS»Òz õHEUºÙ±Ç¬ 4²{pî$F¨¿¿t»xÍ	-¨4¶S
&üÜPºé1"Ì¶Fg0´;î¦[ÁÒ9X;Ï*KÛ1¡ÜÓ=My:^Qcù7 9à¹T[ØÕW/V9!nR"ü<üTn5Ó£º7sìW¤1 xkh=MÁ:é½]ÜÚakÓ¹Ów¥½ Íï¥	1×4KtnùéÞöVÜ(ßåìhD¼©_{ïeþ58/3þ+¦và¡/ñ.-EH#^@À4= ÇOcºÌÙ¿Ýl»28o825	4ÂÇÙÿ7aJw´HùfB-\ÙûeÀ«¤è©fMuÍèÙ[ÿêHû= áN#tîiÊÛu
µ»8\ ¸6EN}o%há-ðñÕBY·Ñ8cþÿèøÚÐ÷ö#²{oá6èº;%lX§EÐ¼5({ª'ð^X$4)é¤:KXÈÿ]br_eªþÒV¿ßØúUÑ,ZÅDV¾áGSnÂQ!u¡fQÅÒáÆÙJ°³ü8tß­¸îÓ°Uÿ3¢
0éKÌRÍ¼üCÐ©nn»³ËíFì¡Ø9¤^sØÏ½®"£Ø© ¥s&/»ª¡_ÚÑÃk¼$íú{a¡¦	»°RRåë!àkå¸\lV=})¢ðék6Éì0¶_§òS1yoß¸sýùAJã<7­bb¦õUbé&Á1Z×¥â°Ï¥Ñ·äzµ.¼/)Ópá<Èï¹e§ÈÙ¥]Ä1tãyÑÓ6@å)w¯jö´2²Y	t6sq¿§ ¶rWÇò¯"SJ½îZB2ÂF¬ïÂáàvÖ(§Ãý=Mn£sDa@Ï4ÍCÀsMLØ_.Ã¦(ÇÂC®Ñ*¡ü;ÑBxèñãëg£G'ßªV^/¸£Ñ.()v¡ÕÜ²GnÒ0mÌùÈcNúWÐÄ\çØ}R)ðPXÞd6»áQA£öó?;ÊÎ¡#£S½Ý²Ù[QrÌ@#'ë¢ðßbÉ;ÛÜ vÙÖ ¨³FàÒÓñk~ý¹×èx²¦'$d4iÂ8¥º¡:~Í[¡5\Q¢w9ÕÑ?Sb·ü$ÐE^^:äbZdCTÒZÜ1ð}(ªÃ L¡RýÇcvä¥Õ½uìÜPß(¸½D8µÄEnc:â0¬ä{ñ¾Ç=}K@ó¢Pï©)QÓ-+úè9÷ ù(Þ^î«Bt ~í	ì=}{Ü= )¤0Ù	(!mdæzK(·Hé"0êýf.kånF"ýLDáAü}ºÿi/e£=M*àE +­Z)Ðp@L?NkS=}WÏ/×Ø5mb<Nv%a\Ð¦7Rqu=}ìök]Î®hëJ×5]L=}*ÔâÜOý×{=}e+>°É-[>[w)¾,'~Bô^Ì«­6êµ-r÷^ûvûñ6m/ÂhæC:rÎ õßYCÿýjzb°YÊÞÄC¦2BÃä @O¸!Óí>1\À£v0ÉÔë¯¦+H6#ðS>>ÙµÁÄIVÿn×5:	@ñd:ð\-td7ï¢hñ>"[àL%6%=MI#²L
£©!´PéáwsæS¿åó½XÊB0ø¶m}WUÚ[MÖÏÖ	ÌÇ$âÏ~CËÁõáà$ ´J!gö%Én¨]¢[qwz?	]#}Y¡L²S|uåìÁ³]¢Ëì ó¶Ù³=M¯¼!º<CØ{s}sEo=}hJUÝÍP­ËnæMb÷÷"pÍÂTÖ=}¢YøE@KKöeZ)³}>3Y/]ÂÚåbTïù$h?RxÏRõ
áÞÉºgIzVø×\ÝÈ¬^øí´.­Tãµ+p¾üSÂÎgÈtqÍ"eÀìäÔ"1öéÅ¹/¯y¬	>Ñ^{ftÁÎ>½l¼²þec-Ý{ àãÞ~ýFiL-6èäÈ&º¯AnÅÝVo®*=}= :SÀO6ä»qÑmÑJà "e¡Áé©Æuÿù/é]ÞÅÞ1ôÖÄÅ= ë·%&¡f«ÇÈ«<¢Dá¨EÝð»V|EE;¢·ïE&ÞçÈ£ÔYïoéÒD_¦	±ý/Z.´óh5Qa²ï£¬N­1Ç¯ÍÑÏ/f£¤[= !kð=}8Þÿo+2þUä_Âd~ð¾VFÜ¦¨ä= b= V~=MLµP÷OGgªWµFv0Êj8ÖAÙâ÷ç%ÈÃ4]= VuuÐOI¨s¥BïÖöà®¼èÿoBÉe¼ÔW½ÀÇØðñÊÅw¼ÌÿøÝ¥	Ñ!¼Hê±!hcÀ¾ÁJuIÐbkté×ÃIKóKÖÐXÔÝãÏp¾áõs)ð}îb¬J!sB1&ºpSýú¾+læ£¡%û%«2Dçjov6ð_W= [¹¶_õ{WÌò×(Çí¬È$oÓÿÃár"ÆOÛ~KEßñ~%ÛjoI4za½É2ðê?Ä¬b(ãûZùh&9[NvT(á°wªûêõÔÀW/À
D°9í 5Ñsn+,é=}£(=M··+]æÑÒ
î5ªåé¨ÄiV|ÝºýÀH¨Oe14¾Á-_¢= ze*iÐÏç@+¹æo6þûQ ï¨ù¦Ç$Á${êáNÎÂêõ zh+üròõ3ÁÜIøÁSDØ¬¬ÀóÎ"ÔòINsã'iuL»½k>³ZÓó~Í´IgÜ=M¯Ù1s:CUuýÚõXU÷sAØ/so/?¨zçVÛUkm}×¿¿Üô;Xnj{G= //å"?ÜÀæ* Ôç~8á|®00NR.(ýì½ºo¬³¨ÛVrâH}÷ò×ö­\ºØLèî\í8(,×@=M^:Ó»rn êûtP[.jEùÙCî·= «BröR©-¶v½/S,#äÈÚ°°ÁKôPdå´Ã&­ùÌÔð%i+-*L\hçÔ.Òíl8éä7/Û¹Ãï {³yY!ûqdy©J¾³ð0)f°µ®èìò°awÜ\Â'Íº=ML OrnÆõ7Ñù*5õÉËÔ"à3T«YwAº@kbIhûÜÀº!¢	*Ò÷ËhvÅ]Nö8÷cãA9Íï¦² Î'Ú,_:zbþ·*
-,èÅp>@ä8Äî«ÏkÊðfÉÐ7ÞÛxdç°Á»³/çãL¯3çÿ ÑD´?kíæÞßßË½|= pZ4ùu5{ÿ/ª®æ349ibÚ)å_*øÇI(à^KÑ¡[0î´&¿ËiÏ£³0×è,2¾¸LÏ>dÎø1ùé.äøÔjÓQµ{³×¦b¹J=}Î?®5ù¡-¶ñx9NÏdjI§Qëógd\j,RJ³ÿGËIgÕÃ¡'£¶ó~¼jØ-Îiµ6eóÍåÛÕ¨jû¢y|ªùÒlÈó"gRP|÷¢{±sÄMJ3aæñMäCÄð@{ÀÙDÎD=}'ßÏCø dZÔF	*c ¶3vZÚ]ÈÆ e[®ÁfOúóìxÄEÿ9LÆ"ïùePø¹ÍÌÅ¨×¢PzùA¦Üq
Ø}!#ÑüJ\ñQYzÖU¥våÆjî1G7éE¡Uäû^pÔñ¦ÐÏ»¢Ø=M¿C¸H¼êôc¦|hI¤úR?òTÚ±ÄYy×	2É-ànÁaoE0+Þ#RfùÇ£M¹~åææÅuoä[Î~HY"b©q³sé]vQOsj0FüH#+,{pA,îÊ/F3|3À¯r= AË\BiUãÒØ3fr6[q¨a¤*ØÔ}lM£¶~Lä6±KÖ"s.Ìå¤k1¢ôI\çùÝè®2Ùë£½YO/}­$©×ðQ7%eßíy¼Îzÿ·*G-·¬Y'-6
âð§öÔh¡kòr¥Õ¼ÇYW2'®L¦}45äÇî6a£Ý®¾hÙÉ&=  kÇòÆªAüÃòP*È¨Ý]/t8,1@µäëÝá;@}3ÙØeißbÓ:k&£ó­&ÜÎxªk×§õe§=MÛµã#Kùge²CîæÅÞÏî4,±´~6ð¼_UÔÊ_rÊÃRhO4PºD¥°þq8ÔÌUÊcLÂ@Õ×ýÀ	÷Oº{)^ºêÐ°³sUúþ|;­OVìbiëèÛhgõøÅ+Øk§d+ïåº-~=MßÆøÝðcI¬ÖE"Þ¯{*ûú£îxxK·C¼ÍÂ°Ö´¿a°ÓSUõQé¦	9f-wT+ÿ2p}é¦ïäÐïÃiü¹JÜõþB
z¤+²¬ Õ-Y$÷µX|ó) Ü¹5p_æujWëò(NÛÊ*}D*E38Ï¾&B¢áóÌÕÍVD=ME{§Y]²;£³þX Ø1ÝîÈÊöd
1}ê\ MÕd¿öQ¡{ÔGl@ÚJð:Óúÿ:-ÆùV²_½NTÇò¹[ó¬V
ò{éÖ,oêEK¶%!{KOI7ÌhúÎªµP/CåÌ½H:1#?¬óÇ
á¢­Èùx+áíÑ<Gxå@çÍ&H»0kjõÈð1/vð=}¨®Y}o4f¾ÉÕðbugT¢âë£L²;2«ÜFêxÀ°×*Ñ¬¦Rºa'UcÃªÏM÷ÚÏ:©qÀÏ*ÛÿX¡¯!7Ûc1JzùÐN~ÜÕ!"Ðþp6/qjDðüFó%2Óº=M0*ûÆmîoñç³Óæ¼FI¹­ÝÐÐk¯;¢t°µ |U4j3Tn5mTî	^åÆHnÍÌ¶äI)¬¡Êü]Ík×¯	héBôr.lµd+.îi³g£0Ô,MÛ,·S.(@»4,ôFz9é±+éÃ¤÷Ü:ÓT5=M¬ Ë·þöë60E8ØíüP/¬/;c6y¡pÃiå:b ÍåØÖaÌ[.÷±uEÇ12ZgO_ÇBeÌN©ÿ//#¸pç8ßå=M,*ã<'Þ#9SûÇa¤rüLÇR¦	,.Ê+©GÜï4I2ò,_ªp³RÈ<hÚG-ñéÐÌ8êDüBBõ9ÚlEÞÜ=M9sCùe³6î¸AäHÿ!®cv\ïNÕA{]!"O\
&|tõC¸§ítAñ¿v!W·|uRëM¼
P·­ÚÿÀ¡k¼yi¶2ó V.l/¬zyµìú®ü&^RYgK«°JwY¦ÙÔjC&§þ¡ãu-Ï¸N=}3}´µÆ·­éø	}òÀRÿäÒ8*ûæ"Q~ÿÜQII ã15ÿy÷þLp3ýDfy¬å = o½ìÆ»	z'@G$ûöÈ{f$.ü®u.ÕlHhå:«=}kR]¹ÀûÆó§ÄmùXCìa(@´\Xýèf¨È5ú­	/\ßÕ÷yù×XêVÕº	¼r4>ÉùDëÕ^NA0°ì"Ýj4ÅÍï6BÒ¿MÈØw¶EsîÃ!Á¶Ø³HP)(ÕA¼JµN>8zþ ¹¸ÊupÂ\8áB{ÌÃ@(GW.mH#|9ó2Ú,6®Uj«<eËçA×VMÓª&ï¿ç¿Ô*ÇÐ_WðÖ?ÃUWE÷1QwG®ÏÿoÌåÓ?ñ6áæb¤ï6éÎµÖÇì×Y
ä¿Ç_â{D­±¤C\1¤Ís¥­4¿'9Ô*pòvµlúÛÅÐ¿_<¼QjÑ¼õ	t½Tv¿ê4·[(fÿ¼;|Pþ n9f´rÎ/3û:d/AÐÓöÑ¼Ì°(ÄþgâH|?Öð;ú|È1ôðwK1ü2t¼í	Ý»îßµ&d/3rk®¿mèfmMèOæ ýj$|¤_w ÜwP<X:P{¿ÌUú<oèúþ¤Ð+9t"1zÏûè«Pû¡KaâaÂ N$dÈÀÓË¡Þùqv<ëP%{Üüò zÚ¾:s', XÏ8I»(¬:JL<h)]Èü6c¶F¹·8l»å^U±"-¼kR%@m5,ÚOÐÇe?H²ÀÏåX$¢VkoR£ÿÛqÓ§£Ãûû2:Å8ÇñpôpO è¬é¥ÄãÎCé_é\*<ëéL,Ó¯Ê».ÇY?ÖE^ë12z^V{L¢-þþ_²½º*ÂE±ìHìÞß}zv>¹1þî¨j}	ÖZ	Pp³Løº<ºÿæîí7,=M§ª¶ibó­r­ó;Ýëc¢g>¢î¥Qe>¢hlÇe8,¸(%eïê¬õçxO&Ea^ÁE~¿CdÍÞ®´´ÔÁ½P-~ÀxÀøJÛwÁ­¤­´´
4äw^°Üxú,,|l
´Úwk8©6ª¥ò^ÈåÍ²ýÍâäUï §ÄKÝ^h÷Ôz<	|çÛUYe 9º;v§0ðëòcÇqíUÔNÆ¨Mß¦ÆT¬ûà¥º8T¦[ÎFës¾êdtþmì¬q=Mu¼KFÐ»Ù?èI§ùâÒÕÆÞ&Õçô%ÅgûhÜ
÷<Ò~7}¶ AÆs(z'Ý:c=M?§I>A§a[FdÏDßEJñB6¬ û]ÈB[uhÍ5ß
¾ãÞêÆßÆï	qþUG¾FÈ­jlh¤°A¾dÆÁÊúº}dc¨UP/üVPÅçÊF6ÊÆYÕÐ")n~ªiAò³*pßS<«ÓkcPõôCuÿëZ½_ÒXµ= ÑæZ~Ï=}hz&8=M ½¡Å÷Mu×MÔÙ¿QÂø©
.t¸²AD¢føvÄ#Ø±½nx®³í(1f]Þ\í¸¡,lW{Ä´¬oäfç1ììØdxCXÝ~øDåã=  ìBÙÏGD"×MÛÍX>Õ©S+èAGé·Â$Woð«RLFµ@#B~+áÒ Ù»ÎO¯D¾^ùbï}dK?Ú×C½}â«ý³ÖG>­§Êo¾ÂÉVÝdõ-d?Rm®ë)HjDà+Kù¡¥^úàÞ¦¡dÖg+O½SÕý^×b÷ãb^êc´þ Nn%éöÏMjÑ3@D-¿õL1²Â«a!F;<A¥_!v·MâµÖAã@¯p>× ²í4]24Õ<uëÀYÊÍ}ÝqÈ&bááUX >¸ÕñÓr= ÙÁ¢÷:[ÙUFz¾4àñö¥ )Æmí¼ù½RÆÂ*ìÎäR×EloVF)Õ%lpvö«]B¯D¸< §Ú·}i¨1±Ë~èÎ
Ùí¨coE,âÆ=M'ã1MfNä¶OjgÄújûUåº<ì58ÍàYÂ»aÊû:w±HÉCWî¿»Z^ Ýg1Dî]&DK>ciq$Ñ¹]?jø½M®¥[¡µÕÅT}Õ&©BM<¤N= WÎ	X²·Ä¡ÅFÏ¥pbËi}ÆwÍôG5G(¥°EV{±þàôaêMÉÿãæR4àiªìBgÑ¦Ì?gÍ]q°2¥5Ý~ý=MÁ¦×Oåh¦|=Möp ñ}-|ßò
¢ÅaÿNyÆaÚ<MÆ5=}Z «½O!]>®yS#UUÓñ;¬ÎHÁÂÈk8_»ªàBçà°MìW%ø]ªçÖOÃ?.FÅêøÜ÷q_róc¾é¯ñ¶ÜiËdGdqwkÎYÀýW¨rqñIÅ¬1öuuVM¿Ñ/ÊëdÍqñÞ XÏOÀcy}>Â¡.ÿÏADq©¨mÆôWE/X#²nwî¥ºHzÚ®"zª7=}Üàw °ý¸=}~NµPe^Aî#ô+wÐ
~6ÁzÑ}u]´SUzfMëlæV3là=M\O+MÁPµÅêÝ·@ÓÀGj×Y÷7Í<ý ï½'îKícB^Æa?=MØs]­Såù¾¢?Ìýÿtñ»-X´½ÿðGtÝpN×Ðq{'Ñ¾%l/@=M!bÇíÝIØ4'|WV¨N;É1þëáøIðß!½æBÞ~²öqÛé»bML¥ÓàowþnÊöÆûpÝüI5Z!Þ[!xZ¯ OFxo(áóÀâåÐÛÐSÌ¨Iÿ½ËÔÃA¹ãÆ¹ã¸nº­Do1ý|uF/&ÅH	{kãÍìc/>º%®rÌÒñ&,jßk»3m«Ëÿ*ÖpY<ûÑØå~381;{:	·¼·ËÆìmØèÊ:QnãKrÎ»r'}]è&ib}à	UÛû-ã|MÓÀÈr?[õÂc^·= Ãý¬m³fu+ÁÓÂjËe~÷I>Ç_)Wú®È½A#CÞ9~uX|Mâ^ûùÎÐJ«|8vQ'ðS\2­@ìßX}èª´L%2N½KÁ¤ÒJÁB?úëh&¦GTnhVEXOñrmy~FFxR8ËÅE:À	M á?qÈÍI'DÃZý¹:[ðå{GFú9ë>MÝörðm%Ë§FNx%lE÷JZ«MK;µ¡¾i/v§+DLÂ7ôg=Mod/a!gõ$élY%@t*\èêÕá÷R C\ÂSFßÍuwÈãèèRÊÕÎ|Ç£MkëÌXñÐßVf#¦3keÂõ@L½+ÅA²Óy¿@×K ®áÃ}]jò=M··=M/=}«áfHi.w*¡ñ²ÏÚ:JÇÌ!Åo?'yÿwRÆYT@½-Ùßî ¸£r^Ií=M=M]ÇGºÖ= ðË ¦Zku*õÓ³¦Q¶xÝJBÆ¢àqÑZa~_bU¿@¿Ø+×?fÓfÉ9ydzÁdx{ÏõEÿ7a÷PRH_XÛk&¡dý~þ*Oª¿=M¼ÍñRK¶&z]ÛÿõÅÃhç}= Ô=M9TÖ·R0FÝMMGÞúVåuµ%þQ5GîrÊuþ	Ozda´=M1ßAMSJÞËgIw)Å1LE¼î1i¬N4ôþC»ßò¯Ë¦å ãÚF°À£¿ÁUcøätK"]^ì ­;?ÂrÑõXÏË«C$O:tà=M<rQÍfã5E×ß¾ WqÜjÆQÌxêD=}£	Ø¶æÊ§14µ5ØZÒcÏtÎ1)ªð¥Q(Ó[é!-|éñÇào5ÿ±Áº= ª:u¤®þÉWI¤¬Få	§JOWÓVËÎ×éÖ[Í#SzèttÿèWUÎ/ÄÎëó®ÜspÔ£ÄN 
Më æ\ÇWZ«Zþo²ùBÈºâzæ£<s9Wÿca«¶}ÙVékºÞ6mQfJ£()hï ùÖºB [¾íª½RuÉM]Í{c',¾%M.IxïÁND	lwnxvãF´´3é­B°6éé­"°}]¶DíG~åÕðé!î©a3¨OXâ!µ ?qìÏ³õjJF­í¦^[pÅ{= ú«oB5Lü&?àmÊm8äHMýqØ­ñkB÷LOäÆZ[=}ÄAteý7_C*c~FV)t*mq+]uýJòðÝ÷ÙÿdZ6=M·ëÚñ·eèPÕuÇU?ê1àâ¤?Ié3ÍúO'TÒ6ãAEÖð
}Z;ê´¥säsÑÉ¥y·= DEI-Àí}N×@QÕÀ§êFÖM?ùho´ò<8mØ¦ ÷yÕùóGNÿAR\Ïàý ÒAôÏrjuW9Õú8âG&OVw®t¹v ý·_IÙXî¢0Ô=MWï£¨©»Êá:óØ-,T¨Ør?èÁ= L¢('¿³->º¦'\QÒ¼Kß>ÕK{¦ÚY-a!Åû<Ê|= mÄïqù0|®ÉÁÉ)v=M]âþv=M4ÌYm<ÛÀ¶Ðð©°^5uJºÈ-ðpw/HÓ\ibDèÈÚD]b*Ä±W>ÔVE= >qð ~ïX4Pã(éÈ«¡?ÑÜ×FÃ>hqbx_v$^n(®£­æWqK¯>ZÙ#ÀØm¨$ÄéÔDØFÇMTûîàÏ-Ú'=}ìJþSþ.]ÛÄ}ÂÐP§QõMÚ^¹E¾|áP¶ò³?Ò*wÓi<»õËb÷ÄóJzw
²éSTebW^?¼zÄHDè¿xmóxþ>EhÑ= ËQ}1'Á°QÚ1*²ÿÂ)·îã¾OPÄå\Jc±ÿkdbë~Â{óùÛfõç¯OlèýY@>õádÔ;ÀFiÆ=}Æ¥;ÿb7]4Q1GEî}Þ[¼cÂõÇ[qaâ7õôA2JÊv d<ÓÔáiþú¼¡É?õïc1Óyh\þ	oár3¼!;rxT0<C¨ãÓJÎOM¥ËØ ÀÔæNÎ!e;}SqæÓy:]C¯É¥÷<ÏoÓbJWØzï¦Bßî*ìÖÖ&Y^Pã¶êKÕþ¯Ç­n3/eA®WR®øFHU§SN¥ÿ¿ð©iþ®O0=Mñ[jÕ+jhµå3BâcFO«cÕÄÂDö9(xÅF&Óá_Ù ÕÃÏ= î¿#?Òy":QýªbX	Mø,º~É Å$¨FÐoªÊ!¦Ö%ÈIÚ2ÿÃ¶w^ð§wÁw§y×ÕJIñQê&é]r]
=}âÊ¢ÌQ#ÝÉõNQZ|Åáo/pûó?*¡âw#N±>|FîIÒ= ­=MO/y<õ·â½÷D&=M7LM!Cmm0Â}
ös'FôF×r[ÖßFlö#L~ØýÐe½ëíÜé|áKUK.OýíbÞØ»¿_ÀÈ|Â6E&['qóPW;ON?©Õ=M¾m=Ms=}½qÝêý~ }O_âÍ³¨ýg¥r¤öõ^GÛµÿÐÉ-%)©ô³y¨xé]¤Bù¶dAÃV.Lª+ABIÚ=}RßX­= {%iBrçÍYôHs;õíòWU#ãoLw_½ª­n¦¾\É UIÏíßE@ÇGË^CÑiMñëÀb|CQ~0îËàjR]k².Øù¬FQ¨PÇÕ:w£kúaÁÕãMgþÇJI¾×SÖìøù>P×ýBË^¡¬1cÁ¿3Më}0uÛ±BÏÉ'LáJöc%îQÑÜÞ%{=}¦P©Os.?ýVña.¾rMfgqZ§BÌç¿MaÛgùÝr=M¥ÞcJ¾PqÞoVWYácMsJMÇEN&w§dÌH¬~HWàæ^B¹ÓÖÓRwM*C¬uuHU>1E2¿Í9æÜ¥·ípþWëj*cMFæÀIPú?hWyv~gKHjÑñÿH­qhL.s²Ý£gYÁ¬o¯}õ®?c mÆ eç _F}H~Z®ïT>¥aÏ?[qÆáFËñïöú@F¾úµQÁÆÞkJ)@ =}åoáG­ædá!¬?¨YlßÆ+í¤}Y°,Íà3¡À?¨q±ÖAdÆ¸EÃtupA\«ûéÔ0¾å_»þuôÍ=MÖu+×ÏËC	¬JÈ.gØ¢Ø>ÑÁ kÍ[gDO°|ÇÜÿæH×E#%6×àoFPA7jýRgM:q¦¤­ôìIµ :S3X1êÁ0¢r£êgâE©U¯ÙBìo®-aìêOG%Ù¨³-¡Iz>U)ÜµÄb[¾»ÈU­e(×Î=MlñÆõ(óýçzk:¹}ÏÉoø¾]'hQå3B@hdnú°õõ^ Q¿BM= í£
/dâêÄ±{ÿî
Î¾é¯FÊ¿æLmAHÿùÿ³kDÖBËà dÐ±^?*iM
eù%>Ùi×q»Â³wqÂ²èr@íø£ÿbs»IÐ8L¤- Ý¥Ó8MßêÂ¹Á?{ÆÁñ÷GxÝIÎ3 ÝnësÈ.buö³Á|}^Ë>Q6¼@ZËÊ
+'N B8N¦OHT§_Nÿº9>zÕß¥A´A©¬Dèdf=}8GÉÀ=}×ö}|ÈÊIm¥SâJ¬ï=M»iY<
ÆøHNÆ¥åÜÅÓ*7yµjàU­ÀüUÂ<QÈDÛR;_:yu5áU1D=}"<Q
áX¼ù<vWÆI1MF=M;n×ØSJçf,:°qO^C÷N¼ËC¼¬Qàt:F:$¥ñ+1DÎ<QjôSêp:f3ÙÒñä|<YjÌSJ·$;;°ñùñ#1Dó<QjÜSên:Æ9$¥}aßU2&L<fEÌÅØ;dNØ)0CtZ<jBÃ¥t/i]uÅ­þÃÆ½ 3æÞ.·;®§Ås9Ìpq¼ÛUßF<0ùM5ÜäÂ¥ÿ<yjP;$¦:üØS;Ø¦N6ÈÇ<ñe8\äÂUi3¦.¼´íE^Æ=MvíxGLó9Uo¢îc#zjuÊ= w!ÈÊ{ØÖ~Umñ5MFGUÊ]ÍVaTðy<ÅÝ½¼Åá­6ECj¿"\= ÕñE<UþÈ8ÌNñE¶<n?¶°ä^.lN)ËÔaa[|WMÑ]C"üÙá§
c_6E!ÙÏC|­_9EA¯À,\= ÕñE×Ì+¼TþÈ)\= õ¦NG< A¸ðÂ;Õ×j$Õ;Øp¼|ãþÉóx	_cYáMlÔñH=} )xfÞ¶1NûZE= ¥¢r2Wæb}¦EÊ+¬¬¾Bà¶ð[Í¦Ë]ðAJ/ýÆ@ubÁ~Õkå?¥y.Ôÿ¬õ-ÇF#_ìGáþÈ}Kj}Ï_{ÜÀ=})ùªc§jDH%MoB®ïÛ°:AÐuI¥ÈZXõ4Pw&Gd¼¡ÐÎÐ23òPYÞk¥f;õlß"µaë*v×öÙ6=}ÆBÊÓ¼0h·rh«³¼NòId3;¯Ï®ÍEoHóbdÁ?:ÿ±C§xfç2V7ÇQÆqÏ3Ãi½(Ú]9ÿX~~ÝÒ
k¥ªªf¬»,äHAa}ïHÁ\ª!-¼eÊ=Mkd¶Ój=},Ä§o8²þ¶rQG/½^½îçúÕÐÅTíÜlÄÐP·¾~Id¯5j«	º8[®»eIFÇe.(Ý¥}Ýßb( \|¬<56Ô:d=}£EûâêÎýkRëa]ö°ï?9¾yÊ}EûI X_n+#qCPQ¼¾d¼0dÇàp5.¿ìÊðúÃµ=}SÏîl= ±IïCÝôi3Rlb	¯yO¤= Ü±û¯MLöb.AÙ=}ÇT#L&Dn½"OÌ%Ùaí&¶Mà"3Ä¯¼WtÈÙþã Öt¡¿cýÒx¡ÕéC®Ð1»ó?ª5N&¦hÜÞà^= á¹î[pAî¦i@mÆÁ AW:A»ôDHtc§|Ý%8M&ªÜ~s½¨õâ¼2¬FâêÖÓ4ÝE¹sÞÍ~-ñPSVéA@Gu|?âxy*LuqÜý?xðÎOË)Wâp~WçÅZç0w?ìkþ³0
ðô©z&Äed:'?:	j ÖTÍýIÐ	î?CÐJÝ3XKZr¥­F£Er^JqÖÁG¯å½ýÍB¨ÕÅva!ÆÝ\Ûô0~&@¯ÊPÁ¹yr¾ç2ÝÆcqUUneºmaw=MBãBPbÎÚÆkWcg^ç~Íf~nnJr¨	G>PYÃ<ªÐAÑÁ×v<Íf¦ÌÞ«^Cn;ï¢ìî= = ÓáøGð^ßú]l¡õö¿¼JO^ã}]V§êÝ!Âo¢º lÁÁ÷b¡ %¨¨¥x= 9©<Î=M}R)ÕP$ÄrÎ×¤SÖcÕcäÁì¤Úd¹¤ð¯ô«I¦¹¥¾,^qí¡}]¢6= Zõ3B¹UMyÉÂºF6M0TFL¼M?OûBÿ4Vµõö¢Á= }^fNï}ÿ¹òH;¯TF
U¸'j7y3·éÆ{ idÌï[¨¯J.( ìéÓ\Ì~¢z3[Ø>;(õýË·¯%£%Óþz}ùRK!*ßù"0 j\ªaªbÜ¯×|yè Ðp?5FÚêâ:NÙãj¦VF+{VV¥X©FéWnÙêýÒ¾­Ùc=}¥FF£Vf]=M}Í¿Û=}?mJâÈ¢ë¬$/}ºDMhi¢ã%Mu©ÎýÃO«ÚB{Xr}¢Å kÐ4þm&ÒÒuAuD@üE~!@W¤©ÉK¹NÏCû/M½k8UR5Ê~¾l¬ÉF¹¶ÿPS?²aJxÑu¯!au#kÈne9ëeÃVVRAR\uãöð?TßE!D¥aÀìE7Hî9Á,¼Nl-«\kÿY"­^oVU'®:Þ¢ÉN8÷\= µâí¯}K¤|ð±ïÿs×ºQq£üO>îÔ}Xy/ . ¶¡ü?$Á1iA)2JÓcÿ3@'ªrNñc¿×)b¿Ù¡¨T¤\1ï¦¶*5Æñ?°'p¸×.Ë=MåUÞfÉå?j¡mXÅÉÃê-^h³IOïDVÁñÔsVª&á¢mÅ+Fµ
­N]Z¼à^º>ènðhZéÚfÝÇôÝï¡£cîÐ¢Ðä¡ßÇA>7Ãç"ëJ¸µ@QêÀqÞO!H´þ5K½è°?Wâ&¬§0¦Wfwú¬F-Eª+DQã8»m2r´ÌÕd°N³sÀ~³VUª%¿ D¾Úo=}ù 8?¤L
­mAË6¾¦¥DÂýÇåyD½ÿ³]lj³¤·n=MÃ¶*w9ÚÆ{ïXé¡¶PkÄuCÀØãíRÀrkf4ëIa÷= +i%N k{dlÖåmSÁî£ó0Ê+,Ts¶ñàÝBâºF©ÁB£-¤ßV:¢t°[vÏ!óÛ7a¾}DØPÆ­Éu6FîÞv*= µéÌáWcH= itî{#é^b3Lâ5îÜ¦ñ»sö@ÁËmÀ8ai0-An:)è<e<eQâIOM OKpqg= 5ArÏ&®ß²)ZÌÀK=MAVaMF_e¼3>ð×Ô'Ê"ÎM7ðò¢±îê¥§gcz×ÊZÙÐÿAþ1F¶^èíÔ}áÊ$írH=Mk¿Nl Ê>²Ç»PõËÀ¡üã@8£üi¡ÁbÎmWq^ÙsÌ&Ù8q~åå¯môÁt
rOfÍI]úÐSX\×½,×óã-²ãÞ»¥|rUp·DÿkÞ&Vß¦Gdiuxî¬qÎÅ= yBV%NÓtÅu%Vÿ9Í}ô¾é¦aHa ðcßp5ÝZÊi¼] QÏz+ÿ]èõõb9ÅÈVÁs¿
;Bª$jjQ<¸Jeå»ÀãFfô¿ã^tµ-ï¹V7Õ.Þ|tM0Öû­ÅÝØ]CfGN°3ð?ÒJ/ÿÄ´Í 1MD¿¿ÎYµxL®aÔ½wïêL®_ÝiÏ#¶·Åð#¾HDZÿO&½hÕÓÚÇ#EyxRíÅ¸g=M9QÔv^¨^áEn#Â/ÎÇÓ¥³gßv®>ph¤g«æ¥Æ£äßbg>Þ}êG"Q"Òê[²ÁÀ÷Ì®dUQÖÏr2Rwÿ7wu ³ùÔÅlXø@_êq2Nd'm!.þ«â» ÑwB1l²Îä-½-Â1ÂzAFÅCõÀ¾OõºÿD{îäÄµjÃZmyåÓËºâ$1Mçb1{&oz0K'°ÿÊ±Y
³g[ÚòÛÇdÏâ¸g+AXÅÙæUñI^{vþ×pRj)ñ°ã?©±áO?= àM,é¹Ýù×= ÒoxR®¦Þ^Ë½STÑ!n]M\=M=MÿéXaÑ
WÇÙßZÎàÇ3y<øñ$&ê"Æl¥v>Wï­ïMÛþ×\0Y5;zHÎ ÌiËý£Éï]äÑB	;ÑïÓëeÙÄ-!¦57ñ¤9×ÿ¿>(õZòATíHSÕhò~øs¡ø¥k±mò¥JOYSø9iÀBþÕÀOïO2|*Å G3Mc1ïIÎ÷Ø³T¶_¨8Û-gÿÇ]ÚybjyH¸~*íÿ:m/Â³lM>Hm%¥2b|½ö¥]²»e/xáF7Æ¡ÌXvVP§n/½FÂdMØ_òoVõÔaF©u=}¾Ra¿p¢´gcùÎìUÞgÞVÏï­òKAÝóüyFr¤¾æælØ¥ëª¿=Mã{OY ½ÎOÄ­kCøbRx´v÷sóqPAA#±Ë[J^QºÅÞÎfY {tÛ1±~ä¦i©óQåÚÂc~òàj9ÅâNÞá.@0Ê
æVðJ8¥ÃQQz»ÒT¡e<¸K<(AØ~\XxÛ5= Áãaê'û~7×;ì¸UÉ±É½KVñ!'æý,íÁFb»~êGà[0eqï®àºSØùíhS^-Eñ©)äÊ^Æs	áðoºNcJ²¾f=}hÁO÷Õÿ[*Äqed<uëØPÃI*§æTI ý«W_ì=MZâS±zEÄÊ·]1lÉ^­,Â¨eÑ	}%oH[^^E D°|sÜqn²ÌUÍù(=}Î=M$õl©Z	=Mñ¾gøâË2¨QÄéwî:(åYl 	²ïðãcóN:XWxiVì¦ËÅ<b¼Å
OÙ
¤êXáêvPQUíï8¿Woä£yé<cÁfècwâÂý·Aé±'^2r
¨Ï%±×ïÚv£Ë= 4¼Óêc,ÝgÖ=}[ô
¡ñÅýóC¿üíÒKqü/§ÁuEmJ¾Í}#CøÞfõ×äi¿¢bq>Ç cJÂÇësÝ8h	(¥]:X~{¨ß= ÞÂÎæÈ-ú1 3= ¿ÏÛØ·%¹©¶ÆG_d±Ccrrm§AxÓ´_Å=MMaò= 5ÏïX^Q
fædþ3fs|ùö}ßæab°PÈf¿}V0Ä"pIíNxphïÍaTªzàUtDd(~ì¨¯íÏqCå³Ï
¾2pSYA/æ*DÀ÷]/_Q!lãÝµWçz²E.PxèµÇµÞÀ3ñmù·èÛ&³púùÅ@ü}¿Ä¬B}þí|ÞÇÎèÓÝù ãQ@»Ëõa½ß\Sjï^¶Mzâ´EúKÊ/ÇÝe¦AêyÎR.³Ë/!¶9¿ñÏ¯êyÎâØo5_4¡$Æ&:,ê»0é]Á= ±t®xmtn¨FöÙ±ûQb T'rZ}-MÏÔû¹?ãÄ!ViÅD¤Gß"XKy,Í¹¿&ÔE³Lg¼1ÍM¸.IXQmñJa¥Vjqe­ÃåZ»àS]@¢yR*ëD»Å%zkkDñsÆqÕW¯j=}Y'ÀDBÉÚÄ½dÝ ]-^¬Á {§J±dnTÞlQýùÿSCDsÿÅÄ¯_0÷O,ý?%«lHA½Â S7VyZdgKûEÈ­FAç®×Ã¹Ya¥÷Í9µâÍRG]«%U*¿ÝJ&·!MOÃãÄQRë"~¶¥Iýè%ÞÝÝýq/ëÈ(ù½ÀkÍC|Fõ}¬BG d=}5Âz ¨ÉZ¤vu¤¼ÅF1ÞÝ_Ñó#QQøÛæCäd¹ÎZîQþ^ò¥q^}ËK.Þ.Ø"½µvvàÉ¸üÆPÖÛ×¦8tOÈõ·´ÝæÃp>º¶G­Ë) GZ?(Tìru!´±A×(r
-Ü
}ÜFªCÒ)^Þß¤Z=M¸©Ä]=M1Í9WqÆ¥>Îç@rÊPnÈnÅ¥Ý_1ÍùîÆläS/ÇÔØ´¿ýSCN@§ Ñõ|;À-ÁÓRÿINãÐDýóÅàÚ]åt¥ÈÀwø~µ1¾%í<BÕlv÷ýÒ÷}A BêÊ0S:Aãr¯ÝþBÙo²?ÞgàÆñßcãFæ=}JÝ#È¦$æ²Q6cX
1ÉäLu8ÊsYE;ÛñãzÌ«ÑK@hOD«×sT]ÄüàqKÝ¹é
nnÖmôÑH_ñ&éö_¬í	n81OD2ÿ81¨jäj²²EfÓc'I4=M_«Fjf_wOqqzFæqª½Ò)¢Mîi>ïQK	¯µ6n0 Ï?ó¥WÍ÷=}m =}"CTBî·§ÃÝ-Äa/ "q1º¾Ý¿µP¶QýU.HG ÕGÂÚiÝ9ÉLÅ±Tà®w§§ÜÂ%"Ï~¢¤¥òS ½¿QM	=}#ÿ3n'ÌÏ_«Íe«{aÁymfr4¦$F¯-Âe!|l¢%ä¢Pjxq½ò¢d]eåz¡ê]3Þ¨áloìÿT*v:ÞÍK¢óo&FøoÞÎªN]#jOÍÉæÎÔÞA-X'PÒ¶<Fþ¥	3vå.4Ó$I°ewK§%
¹qÄ²³ÓÜ]äð	PãË ¤S[P²òju\11~ãÖ^î§]±±P·]]*Ä¸¿¾÷^U ÑúZB= 8ÅÈ³]Lw­5æ¥-}BîpÆÇ?C=}ÞäÞ¼]²áM=MòÚ=MI¥f¡oNÆ= }bw ¡AÓIUàMÊÝ&ÆBÞáÎÂÎe=}I¢RaòÐ¥= pZêMYv§ëv%VÎòæ³FµAjbñ= Ùêßj¨Lê= ÅX_qpÚ^Ô}#¿W'N®-= ­åÃZ:ãñ=Mç«äPZ§¦¤hÆEÇ«I*±±
_×³¥ u.= SpþíH¦è~f¯ý¿ææé¢ÚÁJËuTrD_ùT%¢JV\·!lAáHºNòÌ%·¦CÂdHå~T}}WhÑÓLúA¼^×èx¡uJîÓH/fÐkO8v¹ô¹F¿8¬#zïvïücÙ<&z8âcVïQÓõß]9ÚÆo¶Æ)×þù}ÒçE)·*_¤*ëIQÃPá°}âÀÌ[¸&¯:´ò_o= Fa÷lpÇ£¥<ûò@·¾ÚqÊl=M7¸ÞÂ¾Ó£^ÜéÀêÕ"33B<b8IúÙ=M×ÎÔ%OY¼;¨Ü9´òÃ «0VÖé= F·=}¾qÛííöGNã½-hùøU]N´BM/Nå²F iá¿1?>dKa¼h®mbºk¾~3 úR=}^¥?×Aízd4Uà¡Ø*ÀÓ®îúÇU+¿&Å%mÝ±¨I=M¼½öÞxHY±K×É£õ¹áo¨æÂÒés²)l¡h5/?>  a¥ßÒ©ÁN¾¿²éá¾~|a$^q^æö'o©×= Tðtáf(û­Ü~4Æ3oã^L'áF4àvº#âª´Üý»½>Q!MãºWD= ÿ^gÍ,=MUQ-ôÑÞ­H.~HþÎWáYCÊ$_ÌÐûUlÝ,ï<nmÙæ?3uÈúí6|Q@}*î#ÅI5E ñÑA» nzd¶\sXÎçã4;4¯ÿ;{ñ/¾kOÏ¿÷¯ð8(ýµE£¾Ëk=Mñ1u>XváÓéèfq®e>Üvýx]ó®ª±= X¾§J_^Áõ_zlr¥¼>	^= Á-w±:lhGÎ²Ë%R;%RAÑ§¡^½;äõ×±×#çýuOòDL uQxÈºI]Ý×2×q~k©WG­KÅãKÁ"p]QÁt~^õ½ù²fÍ¤¿¸HçUÇ¯pâvVdI³¶bðw¯-b,¥2=}P~-Ð)+[rêñÉ×:mkRÏ1é#Ì,&«<xFUÔ£¯µeÓe%V¨§m}ÊÜbûÑÆYð}­jGïüùÂÉôÖ?¥|*c©è0ÔÑà8qÉD¦ô½SôýLËBMÌ±HÏP9¾B?cÂ¹MÉª¼ÚÙxÞ7e+?>ßXdèØ:k=MD%kÅ-dh¹3o~Ë#3±ºðÂwÍÐ%ë^h¬÷HRg®ÑoTþ
Û?ÝòQX=M×[bhB5í¯ïÿøñõ(ÓÒ¿-ÀÞ$áfmÈl*H7?è8;kBå= J@~Xya^ï´]þÍRé}o(÷ô>S¿_(;Ïqs)"aa;nîwÐ3¿ãÿòÅ¸]XcJlÈÁé&n/!üfGDÕnH{é=}cÍã@êN= PPßhÄµþz=MSzø'ÝåVN £Â5ÿùYäw;×;A¶RÍ×tMzÊb8Öo³P°½±Þ¸ÞXÍCbâ¤~ñ¿Ü?ãÙ[Ê@oxbYé´èÙqÃ­êÏ2kýV,àøÛ¥j¼TªÉnë¾q\RÔ½ùÄ7Ä=MW^"d^E)e×#P_,l~ÎhØ*ã|^áõáÁb:M·g_üwPó7Ø°øË#¯RþbÇv#öÈ³A(kÇô$_°-gcÚ	¥o×BóQjçyu"é¦7GEdþ:%]m%òôï¶)æJÅD}ÑS>d¨t*ÏâÁD¦l®ñedõYnß[vo
ç¦yþÞãýukþSê\Yß= _E÷C 8g×Ë»bßÁ?=MÆË Ñ­Í 6c	XÉÍÎ¦+i-ÁÁNbE7¯ù=MBOXNqzòëÿ=}Q Nø¢áÂ4Åãép_SR·14)³dÑqlxoÞÍÌ|í«Tìx¿åØÔ+×·wùÑ\'¼cTWM%Ëðµ~@VÎêDñîg}zÄÑ÷yDlÙPBøb§ ^ÙcÇ©ïr{êM0q.RªXWÓ.ÅÉÚ&QÅ¿bÏiÅáÒ?xà$ë¨î4)¬¢6ù=MÛHaÑ\î AG\¹IÇ²KPa×.g>HÀ#d2¶]ÔMgÁ×ä>ÇÐo¨®Ð¹MÝ é0=}Æ\\m.MhÔyÀ÷_Q@w= Pq>¦ûÜÊO¥ý=MÄi³]ÍPmM?dC¥f¥LJ§DGMÈ"G¡vW³³¬[?@ò¾ëác ãá'=MýSÈY±×Iÿw»màáiïd#]¥M-oÁE¬«>1Uªâ¦ÐEÔ÷aX0ïRª:= õ°þ&¨(ÍéÞe'm²NºÖÈÝÑÓODCÈ,Dmr=}¹çÖçWç#2!e1¿Ïj£­É¥yy]9#þÊ?mÐÔ@>+Æ]Ë¦b
@§ê\ÏüÅ\q_M¾ayØÙä¥jËÜÓ-·êF¢x±°@µ¼MìËSd±ø-±h1¨¤;%\ê¨e¶ßûna(I­§+¥Òñ+HñS= ½ÑYê =}µf¡ßa3P Pc!ZÈuÔÙÿ­)]ÚÇ+Rùa7°>B¥ÆY=}caÍliÍ§?
"¿?ôEëø½}½ßÑ×±ß¾Z]å^Osc<ªtc´#kýHr Âz;Íè-=}²|.Õù,?¼^õÿv?i¬¯K|Ä=}$q,=M³½]8»f©ZÁxTèißÇQTW}¨ò\÷]Pâùþ«}#þöBþFY= $}$R(fáò=}Y¾·XVÏÝÏó­>z¿J±M-¦ËZÆÆC§Å ÂàµJÂtHÑqbá%µEWèS¾ã¾úRÞ4øÞæi"íg=}ByEoüB^^r¯FlGås3°ÉP¾¼ MdV¿(>¿Ë­%ÔÁ j³º¯½u­MnmÉsÞS?I©·nM¿Rßãé»º¹Ù>H5SÄ]/×¤ õOc¢E´?Ú}â;¹½~UNeá­~bÄsªE=M+|qFÃ³jñ¯jYÁJífÒQä]ªPH£k%~ÆSÄÌ¯8éÀ³Z§\!5xUAlaYEÏ;d=M\¦OF^jIBâúNl>$"kw?AWí¶ÁFÉ3Pê@M4:r»ì¯Í+BÝnA7é³iGW .O}t+§¥GL¯=MtMÝ%N(Íº¨Å~5^Ðqb¢Éy¾ìL>Å=}ÄgrE
Ð=M6Q3¤JpÿFBÝíïN4¦Õ = cíÅH"C·Pµ¿°)mÍù?ýEB®ô{þ¿(¹¸ YÞêÎYçeÐQ~ÿàÝPy~+}ÖýJÉ/Ãày¶	³ó{³ó{?eöµíTÀÁÿ8Ðô$]õ=MblAAÂl]ã)Ó´?ÅíÅ<}= Ø=}ÆQ3ãº	ådWãåÝÿþÝ}äFÂ)&BwÑ;îûÀI
èf¹ÄDº ÊnOMF//IM½ª~6=}êìJuY«k?ä×½½°_8uyAÆÇ}ÑöÚP§ýB¥ Y§Pïq]~÷= ONtîÊ/§~¥fð8ÀDe¯Íð¯]^ï¤ãqêñM0ËMu¢¢?®ÕzPßÍ;4ñ'U0#-23ÝMÏÚHX×,%i}:^}
üÒ³wNã§&¡Ü*
Ûj©ÆÃßf×i6«NpRâ	½¼ßZî«¨øaâ#ßm>A«{ÓIoMé{~ÒH.©TÍ?FÆKæ8NÓ­¬Ý
 tOSåíDyÎ}QÎ Â5CÎ¾÷lQ ®ñ=M¥ÓÃÅÌósÿ.hqÕ4Í= a¯ôºj~ÑÑR¾D·~Sðó³¿Ë+ÀxÐ²ôì­â¡¾N´Ø"Nß2ø«|MÔ=MDOÁÁCK7Ùx·I¥]ðm¢$ÙNJ]þÄaÑ¬n~­ ª>d?YV§{Q¥RñL2YcáÖ­3ÂhmnJÂl1öMOpLzÈti¢í°¿ïý?mäÙñÚGv¨Ý WÍcVàNK"øÍÏi«·xpV¾-«tÿÔ*,=}Ó;úà~%N EÀµÖ?
ýÏ¥>y5?2°~ÕDÖ
= ]ðJ#+C¤Då%Ëtow&ZYJï¶ù0Ã2)öhâ	¯?>>Xjó¸M<!v44<J4-PT7,­â±{a(EßÏ.ý;ÿÌüìZÛdà<ÖoO9ë8ã¼8ç<'-.0TäËÃL|oLNØ/ä_RZÇ]¯­àþ±Ö7,s·ÝRrÄï»<+-
.äìËIÜü¹oNHfUZÙZaÝ9x
c0±ÎTËÛé_¶oøÓ,üÂÇãôùÙ&aòÐ£+Î¹áN48§-i0§£¦# 	¯ÚìC>h è= ánÖÞ¶7cñJT.ÑC¢CPpT¼2ôa	§w= ,pHÜÜvb:;:tDÄ>º"=Mþt¥t¬fÌ!eùÍ6rgòÒÙ{#\Ö±bÚ×Kø¡â´ôÒ ,·&²#	Öwg½-o°´#		jÖââöü+ßõnh»ìÀ[ÏÈ¡}¨ú¹Ù¶x0c;'þÅ%kêÓ=}^]\[F&'¬º±úOákÖ$ûUÃÑÒëèL&4r452úÛ¤o(cú°#µºHä£Hp%û%¨£#:ÔÂg
YÞ,/· ÆRÖË7¬xÃ))ã7+°Ö¨!âÜôØâÝ,¾,@\DGyMõw­ý¾ãý6Ó!(×la½æ>@Û$ÚÒô;À9;H/QðìÏ{Z{b¹Ó!ó!2=MøÞ4£lÈ|= [6yÃKö$³,+ó2àRÔ#= cÐæë®¿Íð®W'õî{t{ÃWÓ)4º"ô(°¼ª5¢$@Üû¼é1n; Ë4,¹Ô1³<X ØãìTù·9ïl«|ì5¹7ðÔX|74l\²»±+ÄD\¼­%»:8T,²ü4;+!øÂ,[÷Pº0Ë·¸ý*=M¬j÷6,¬[÷ö%#=MØê¬gtH	º±´÷öêØè¹ö¥wÄÇ*ùÖ_~{+C&ê0Ä4«{´/%~ºwô«ø&BÀ@¹újkÚ1èða*uÀ}<YÙ¹ÚU'k¶ ü»­l$c¼ÿ{ùl=}øKÚ|G»H'Â¹oè5¼;¡ç@s³·ôÄôR'ür¹´-<×ä¢:Úý©9Õø¤$ÿy· d,[ÜY1\È!ÎB6¹ìøø{pÔb)ð¼^´x= êpüæe¼-'U-~¯&#!µðXé·Ú.0Ò%:m·ðPð øõ\|8ú(|³(-ú~!èÄaºþ#ûL±ë@°ºê_pp¼àtÜéê|ù3³¥'Ëô<ÿ.î3\"¬ö¨A»+Q3îr7yñÿtÃxy©¥x(aàærCûQËm?¾;ö!Ì©´1ÿ*ä+÷D¥=M= ¶3ãàôùÇªp¥9ï¤,ø5Òë¢%É2«!fà*ÝîÈôÜù"×ø %ÎHóÜù(+éþÐ\ù+"èq*{±§2+ýÊ·JÚú35Ú>êðZùÖìúk cì°3ÛÔ×ZÃö<ÛMâÔ5¦èK3HëðýfhKRã³Ôõ¦(K4KeêªüZUò±!XãþÍnÈó\öÖh¬
p[õÙdõÒ£®°sÙõ"\*t²;°ôù0+s­ù
ëÁQÊ§=M9jd,6AÑ,ÏqÔª¤,"hî¹'ßê[!Ge1Ü9²<-Cú»ñ*ÜL@*Óq¸0Þè¿È,m©;ô?òWm«º¤+5#h¹éÒ¸ËhMâ¶,5BË¬sV&0ÿ-ÿo»r5ªðôæêÎ+ªÀ3Ö«¦IÈüÕîñ®çfÐ³4óÀî?jmëðó3Lp3ÿël
Ê-È/öu$ Â¯viÙËÀ¡®±Åq×%j·xÌ^¢úHp«m¹oËQvb]û²Æ(±!ô=}âÃ¯Ã^\Î0M.½üöR´X¦ù¾Ñ,!= V³õ	²Ö¨¤Û¿®,óÞÎ¾ø²mút~ökUK vÁ¶ÂöËÆuZ4Kà¹°Ï'ÕùôJ|·@{Zû$ké÷z§õY®±~!úPb<í
2ÙÈuáòåîÎÞÐ(¦(#Ô#ìÃX)êòÝ¨^À
QãWsér{r«³÷öøæÆ6Ã¥ÒBe$\#= ôó¶øfW"ºÀO2´è 3¶HfLÇ3U(ÿòqîóöóvQ¢v©}8R±
¤û§/nÈorõßüßFE	D,oºß"lÅ×Ãßqb®4÷¶ú¸!øS¦X(YêIDÊÌÌ=M¸¥ô3«æ«¸IbÙ¼o¡Õ×C×ßÔ[Öøé÷6	¤_ª.Ã|óãâ3*ß¦àCÒ= gÓfRù¿Þ^¾·¹43&àÔÌèØtjÚvk¶³§Ój×|ìôÔäÈs)Ö°¤<oá*¨´¬[³ù¶	L¡HêKçÃÃÃÁÃðWÞ¢Ã1éú7#ÛèÄ¬[w!$vPËø(5Ü,Ûø¤4'ô;ò¸4ôÔ3+8³,hP·
ò¸9ÍÚ0$ÉXº¶ëòlìØ|.*×økü± ìFTä)8¨2Ü
ø·ÿhPÔv³¦9'z,´Yï8+FøÌ&pá·2+\ü3'02ëö9:÷.P<(	,Ûø&~¦¢»<7»*$pÒZÌ4D§Ö%äxØWÌd·=MÌÌt²$}®Û«%ýVÚ:¶
~Ê¯×ó.Öxõ´S|Kq0è²Ê»ièP²VûâfWî>|ËcGìqO|3èPÞ1{ÔÖ6bÞ·4²³¿Ï{Àå±ÝL%j.vFß_ob÷WÏáÔ]¡ÿbænÿÁg«ÏqRþä6Wj÷LVr Éptõ7Âåé(=}!Â(3[ü7Z¨¢ 3f #éº/ë=Méä»f|lÍ»/pL,?¢gt©PÐu£/d¬ûqöDÒæá0½ÈsáÜõ7Íè}V¨àë@c	úª<ügíÃê7Ìò85ÒäSìÝ=MÇÊ2Ê\t¬ÛPÜÖ0SêôÜÞ ¤ê»-9*ÓOÎ2aËí£4Èô	6Ç]ÿíî°)v3 Tì½ONò´\wwªË Ô[¶5!lî~8%ne,Æ(yÇÔ 2I[z¸ûWj>Âh§h9ù²&dì|ðµÂÃ¬d»1éøÌ:2= Ý¹êcZ¸äÉØö¹¨0ÓW²VÙw¶;'*Dµ«­¦îüª8µÎìÑåºÿ%¦sçdë{®0Gj[üP#ê7y@È¬TÐu÷údëz²2Eië£ðÀ
:ì{0ÚüâÃZ7bÙü³æØlJ+^âèr(sµ±1Ølj(ñ)¼5ü)y²(ÒÄ¾ïé8ÛFàäk<µRé¸pÓ«¸!ÿÚÛ¾¢èô+RÔo#lå¹Ó½Ï2d]ÿ£á4z;²³&ÔÍ70ã¼zè S¨;´ÜV5×0Öä÷õ÷iý4¹}¹%;>0?i6-¦§)ûºÂ¶éÔµ¤kÊª½È/®Q¨$×)¯ýY%¯Y¬¡âÙ3mæçù6Ú¨Aó[Tµ= |µÛWpí¹4e¤Ö¡mj}ëÑ+G0.Y&éqÂ÷Z¦å¹N#4ãÔe,@ö¯¢Â6öc°É4iìäÐ(^!Í)Ïb²ÂÖS´XSý¹#¾ã"úÚz(¸imsn|}z÷õñ$p0ãkò9¥Rê¢ï»_ä}Î'PÈïÕøàÉ¡ÔE0£ô
«(?NÄÛ:µá¦9+ctñT§òµ!f÷÷!%;zý²Ü¨«©_D-«¦1Dò¹h^\§),Ú¨ëÈà8}kk	jP¦VÅw=MIÐè"áRñæ'î¶xâ}bµÌ7èL	Ôø8Ì}×èßLÒ_±þ¯þIñõèÌ¬'$¢b¼ÆsðZjA¬t¤gÎI0.e¶««ê&øø?,´R%þµðÞµ°¾5_Üi"iùæú¨ÈµkgZº[Öß:å2ðA:
·Xäð$JÌkk@æÔ×Õì= LgfºåJcÖsÝÂ'õêq9_¬¾GFÓëV_tê!|¯xÿ(¿Þô(ôëéÜø	³ªÅs½jy@ |òÄ¦Í= >ëq÷åQqà%ªØ&fó*RÎ·(NWXsÕÞ6s? ÃÓûÇ,*·r}1Qòê»NàÆÕÖH-xM%fz#= ný²g#RÑ«å}M¢|¾a0sÒqw®±È#
ZØmµü«xrçó±µ.ß~¾;ÛcúÑ6":|Ë[î§"lðda2(ó:×r_ÇÄ5#oxvw%â¦s¬í®6ÓÊD´Yüà÷rï³Èó. £o¶û¡ùd´,Æúyqá0/Õøô,Ûð)2ÏY±£¹+6úxì(úï¤Ûà¦ÎWsÉzîÌp¼9y® Þ³ëõ3Zº©ìWè4WW\ðn S+n´Õpè|ÜoicåQeF´+ 8É&wó4Ë+xÊ&ð·
çð·e³&n5KFæw7Ì4Ècñ':/-..úLWxû÷%^l;y¢4)ú3Ä¥6ÜÆêø´	ä ¸3ØTçLY<è¶¶+Cì×íî¤4#w4ÕÞFÞü80<3S)^~xiå:5¯sàZ;95/­°¤®$"ÛÓ«Èê*/vON®¤´l¾1ùP	×	BK0A­ää¸¸. p&é7þ)_ûJÇÊ\,g¶_zWò±Õ@]_ÃìkvÈa¾NÞÔG¦CJ\PÕõ·ÙÉÀ%â³¿ËízHëÐ½u@*ÉtweT¥FGö®ùuÀ}<«Ke#²9;©<%×{K]Ã«ÌoÀõüÁ6ê96  òTfÕ|um]ì¼[|Üö}X·­õnu½ÿ(3¼*ÌæÔ³Õ´¸þ:ÞÄüz.òé»É¶Ù´üÛ>²ÀçS+Ä4,{{´)%Îtsêî6OöfV¤æÇ±¹Ó1$¬hÐ8râ±6ÁÞÅg c&û1#;8Ôå´&¡áQkBê¨^*0Ð0·ÓÎkéXßå±°<ÏNÚþ*I7736*à|³	WrñSò= RK/0¯´r<e3öpäË\ö·¯,÷¢H5¸øÖÙYå'#t/Êàx
ÖÍü¨(rÒÇâÈR\%,Ø#ouÆÔ4ªÛ|^Þòß¶ÇÁb0= >mCoQ¢/µ÷<êÊK2fÛ8,´kiXé¯]qÛdúxá¯uÜ,*Xï{l¡è61!ÿ+B= ·rèë­Û[ëc&8ädäÓte¬nv¨®oüº·®Òl¥Nýg0Ô4«Ysdæ¨úGÂ@¯ö}<­²±ò_¶zÉbùñ Ò÷²±è÷«ÊÉÂÐß= G¶ÏßÙ¶óy÷·o_Ô1³ªð1.Å_¨X8vÛ[f,æÔ{||üõ¦»´&0À èñk$$aºº»¦´ÂzZá¬¬«ZvßªÝè7;;\x¤f# {üù®EgþÖV
êôL:wúúO»kqÜûº¹»*/N*= 0¸W%	/*(¸¤ó,|ÊwVG­eç±÷ñ1q·ôøó7±^òÅÐ163×;KÔDgK$ääÔ±h&¾2.""Zà×ÁÖ¦{w÷ucØ)à¨ñi*@ï|000¸7i!"67#3NÑë{wW¹º4i"Ô{{ø¯ÔNZÑ?ß±|ü÷º¯ñ;Ê!°´ßv÷ "âæ{ø²$| YâìLtñ1[ê%ëÐûúúùù ~Põá,«äÌë"Ì¹¸<5{RºåM\Ü3ÈÏ_xíuë£>Tî+¹¹¹C |yôu¹<9/§7	Õ§ÞSYHØx3G>ëËÇ3;.B§4ßöñË~¾OâXfZæazUÖDz7±®¡1 Jêå±ìËÌç%ã¼nü>(äÄV= ê{Élll(ÚØX¸þFNòý´4Ìj'Ph0* ÐÈtl#âjÓ%%ÀÈDERÀ.ÄóyëB¼ðó	»87¾®2ÈµÇ~©úþ)ë°q÷¶8$lÝª,Áî%+Ç#",âçr¥Þ^ðä¬¥.	OXó'8ÉëÝ_¢ç£³)Zx­9¯rWô+pÈ¦L,·ú{h½*[cÏ*<*&Ô¬ûO9P»9= «uðpKðb>Ãá8oãu+3$màõ·ãµ£8x¾¹Ù%øuÆ4­÷WðN#'Ë-ìÜ±¡ªÔ±ËÐáÂÇâà_*´áN-¸ù\Hew/0fFîêÿùÉñ£jê¡+In¿:0Úõ:´&Ø;JN}#Å=}Y^Àa&hs*Býªliûb&]aÁ3ê= áøQÛ= Á_¥/B(þ:Ï69ÿÉ<T;5< ÝFPÕci×éqn¦o¸]µ^½¿µ¿ýÏ9Nm´á}o]Q#ÌE^I>°ÅÙªÕ|q¤áoE"Mg]]Ý¶Á¾R¾i[§]åÀLÞ>¶m¥¿=MIÞBhÁs!Ñ½= Mw^±^XLÁEºMMN7= I½1ÿw_b]Ia¯AþÃÍÇmGdO^ÉÕÅ-pÿQÁ¦EpM£_	ÕÈm\^ÿÁâEü]é}ÂíÃårÁJEØMó]©5Rdÿ«ÁúCÐ^ÁIÁM»d®KÿÁ EdN= ÙuÌ­>ÁEMë^}õÂ­D[ÿ@ÁEMÛ^ù}µÂ-CZ?¡ädÁlE½g3>1|?smFé¡=}^=}t-%¼ALAlÁE{E»E;E>E¾EþEñ=}S}eÁMÃQÞu?Q©âE¢M^}ôÇ}½?= Ä%¼AhrÁWEòM']¥½=MEÞFpÁSEêM]M>ÞPÒ{c¦Õß®º:ª*²ß¹ N]ß¯ &¾í>PZ¿ÂE,M×ä¿ÍHÐ_VNX)dN§Ï¡]î :Ë=M=}P#o\)M£/Ñÿë´S^KÂHýË´QUc®Ùz+^iá'Æs ·ÃíX$Î.ÕZ­CfÄ#È»õ½Çâ$þÕÿÁØØT OÐ+ä¹UðÕµæõ»ÿ!8VØýruã OeÅ´nNz=M]"Ç].½4ÊF6éA/BÐ¯¦¦ÑBPðuc#í/e= c¤=}c¤YÅ¿Ó 8JÐñLc&"çå¨²VPÇÆ×XªTª¿CÐ2ñ ñVhmØÝ= òØóóX «ýá*¾XÉ¸èh7ßx7AA¬1q7GP4¦Õõ@Æjm®àm® m®:m®n®Zn®¢ÍÍÏ= cëhcë\c«Uc«Qc«H¾Õõm=}»úÃÆ¨ÙÀy#^ìB°N/¿o3ýá½8FÐó·Ñ²= ùV¢Á¿þÐ¨T'ñD²ÄwïÛ¡ê®M²|Ásý:ZPòþfñ
VñNc&tÖÔ=M³ÕÝ¤n-«ßnvÌ¯K¸ÅóùÄÆö1âó3°³U
BÉ~hÉxYPáW ULmË{)m}lUD»%´Ë»ÓäL=MÄ =MAÉÐ\,à
:=Mûóûõ[Ç$¥Ü¥Ä	¢ÅÌ·và9»TÎ\SÇi?Ly¢¦Ucj ñóÒâî}B.ö[¢&þ Yí­;òÒ=Mæ²Ï0eKi9mæw&~½Wl.·f ÚW¸l6¶vówKçÀ1ìÀ1&@"Ybv¯Ã³¾Æ²ÏduL;­ÏÃBx©=}Ñimî·Xaü¥ÀÑÖÍé¶ÊÀÞ&ÜSÏT×a%ç»î£Æo¯jT&þT¦Æl²Òo/õ ¤ö»u	£ö _z§Î{R2Ío´¶¯Z6çä!t£¬f²Òô1Ý£k¦àOØÏï1Î2Î9ý2å&dü6L³!Î{J3Ô©¢0æ\08@aüÆ6acÏ¾P3=}# ëA¹ÅÑ¾Æusb/(}ïrhe¢hazå7oiA.ÈaüÇbúÁÑùá1Ý´õqiòÑSÒÓéùI/lh6öÒÔohÍé:gLÓÜ«Ï©¾Î§ôe¶ú_6ºOì¨Ò!ââDç Íuìf¢QëÊ7Î9É2aÅ7CÀ!dºPf°¯K©kv¬¬^6r©bî¤êâ¦ªâDÒà;ZaóíÐ¡ªB*/øï3,jzåWjº/,h{Çò·JæN(^÷ïp
Àòe@¨H1ám	´= #©g#gss= sÚíï]üÐ¡f ñiêFÄ¡ºFE1}ÉÔ·	~ ?&¼´Ïÿ3vÈuþn+£ÓÉ¼öáoS×o3j¢Ù2Òéî;ÏnoÜñãíÑÎYg,H(ÈææZhíefé%}pÝV©À°¥¤	 Ïî¼¦A÷câÌÐÿÐÉ*$/ÁRÏ»ð¡)ûG0ziâóyl0ÑÉ¹cVÄºÎocW&dXz !r= !Éº²¢¶»¸viùü©ZfäÜbä3dX
V¯Üï¹öÙ®ô#£Ýµm¤ÚÔ½Õvô£*Úò"ç0= ~àuúå¥åÔÄJXT
Äzä3öäô#²° ç%é
^ QD¨÷À®ÄrÓ=}ÉdJZ"-ÎË´´uWÜvã+I²úþõ­Ë |Ù!ÐÛVØwìVn .ßð2²[2kC ÄrÃrUéQ §a Õ"çuñõ; Ák³¡YY3¯Évò,ªðîÇ×@ÈÉX¡ÉPzêõWÒ²ð¼îXõ1+/ì+ÛøXX±ðá<Ï·÷ÖÄ.¦ÌíJz"= äzpór05ll '«µ¤é¢Éî! Î×S&Ð'.äá^ûô»/»¯à¶É^<í=MZ;æÚ·#ò4Hð3½.1Á¹Vj§D(=}8Ýr£C¤5²FÎÈÁ$LøçHrûY×¡¾Vñ É÷ 
1ýwKAá(¡=M¾Ø= }±ølpô&áýIzÍYâ²¼w±X«püø¢ozâ¸äºáÏ?áZâlÚÈX¯)âásRW7j*á¯7éÝïÐ'ÚlbD\ÎGZúlzªÑôhf<1éÊåµöÌ±¶ûDöþ/÷Ú²Ï± Ì%»&Ñ¼ ¿ûh7knòYÛù$M=M{îòË·*ÙC$:'ÝW$;ô÷VCk£é¬·3#Î&Ht
°¬y±æ3$S4ûáø*'=}'¿[PÔ3÷ø­à0²ûp»ü+3ÜïJÕ#¹x-È=MÍÜ|ËF: ¥4ÿê´·äQÒ¤}ÔW³ùR_wQuPvóég²Ùd³±¨*[:W©7ªÐjwò¹û.ö¦Úº#V·;íd£¬XC;'´d¾Ä±F=}JoM±ýq)îGLTÚ1e~l
#eÒ ¹k{ý÷²G;jì1©¤f«·æ*C$¾Ì âå âcB\ùÇb|úûk\ªôø%Zk,7CÃ#KV@ÖàòpäÐðÙ¤oW= O³Ö'ñ*µ)ãDì¥ÌÂWµÜw dúª<R8 ?	iY·¶~©ø[ö«&Ååk3rsi+-$ª8«êÑ;4A~kìÓâfn·&_dÆ"´Îoß¯³!ÔºÊÍoØñÐ!Pb4õð}£0³V ²+äx&D!ÍÖU"a,¥£Õïè&Ô«©aÉ?ü8&sè,¿ÖÒÑTç)ráýn8íF=  pVj@0ªí/e#BBa¨àñ§= aÌLaö#Û$^,hôw¢RI¥öµ©Ú,v
º[v¹>öû°¦È/õûð²"ñ9¯ü l.Z= 
º¼ÇVü³z5Tet³IûYit:ÿï"ûè·VGÂºË92~ø½Á½.ØÓQ|÷¯ßq;ûÜYnèàkg4bÄøbU¬R{!NélXQ¸¡!êw0³Ø±æÔGvºU24J;óÆä+ùü]=  bj_7äMü$'âKj÷å	j 0ÖÝglAê"=}×çTKwr­Íµéæ¹ËýE¡ÇuÍ#ò5½6à-OñgÚÆÞ.%©WA¿6BA%a·[AwóGK¼@}SCZV íÊý>ïp¥Ô±Åñðª±ýNIe¤á¨?ÐJO?¬hÂ}×MkJþô;·oÜÐsëÀiuaýÐ5ü+ªØté¢êãµÞÝy³J5»úwñ©ìãò¯öÏÂ@ºÆ bâaI%æðÃòèÓle BW XwåÔ³jñø6@¹ic¶'5Î@ ·±§ñ»
gNvuÌøy¤ÁÆ®:8±ªï®§RRJ2ÓÔ
Ø9ÐªûzxôªÝS/hÎüÙf bLÅ+îPg±®,= 3¼Äo3*÷2lÈ#ãâ3+´ol³½ÇÏ5dT{ûuÄ³ÒQÚ4$Ç4#è¡%°ò¤êgÌ,óòïûÅ ¡5Å*¡SÛº:¸!4nì_$ìðv«eOr7}
å£4ø¶É\Vr³.Éå Ú´dß×¬÷R"zÑ>¤"/âæ}â4ÜÒF´gg¨g¦¾
Rèèo6=M=}¢0©Øñâð8Q¢úíhÈÑ>gÔ9tfw,y3¯â£Þ= ¢¤ÑÞkh¦¸¬fk
[hÜúÙ¼ÈËBó²ÞÈé.²tqôTð-Bß:¾)Ñ9);ÂÍáßÉòj9GÓLëÔ¤°¢ùQ38ahµÚg£Â(î Wï¸ ×íºØðRî{ÌíWó3)0äË©­Øk©ÿ«i L³7Ì	 \³«I(fÓr³%Vý+(Cî1KÀ^ÉÜÉ ê+ð
4O)°Ú² ~ ÞÆ)þîóí Oh´dÆj¥Ð	Laðn¾f)7½Qó«¤Gx:sÂRIðînj©Z« ð#Æês#º/;¦ = ,òäsó ÊÊ5¥ û¬s#Ù¦ hM[_¹Ý²P= ®)u¢OívÚnj¿mnIÕ]K5=}­î¡³Yårá[õunP,Å;« pû_ z/µª .:Mô®<gÛ< nd©©¬¬ÌÊâ¬ïî ªi=}¢|s©)&}XÈ,£ 2×ü's³úÉÊ
Hîîis36G5uÂ:¹nÂZjäíOðpGxhÂÊ¦ÑÿäíT¶YGØ/]ÖÚ|Û	·«£rädð^ÏèS©6¡³^´oÈ¹Ü<Î¬²ãcîdºÐÒ	|qÆê6Û¡ôaï-FÆ)¨Ô#PÎ÷dïå¸ *z ï Àë5«u°[ÿlL >¨Äîó Äî²Ãî= û ä83Þé'sõþ3´e·d¾ÚÍýgbaíi¾ÖIFé&µyh{ÛGË¤Î4 Òò®©³©YèW[éìÄíñª"^ÂïtÀîêÀþ>À¹.þi ~	¸"]ú]£xÅvY¾íê3}ÓÖv½òv½&7JÞ@:ë:;©1ø»Éê+×ò*3Ø8în8Çûîi]¬i¸®él0\ÔjjÔÊu\ 3 ßné¥s¦qha×ÒxÄ
) W!, ÷\(
kJ%
$+
k)*w´+§x12¡¢'3¡"Ü3ð¼+þÒ%þO²¤,øð|÷p²Óm;øoë)©}3£TÓ=MéH¨<ép{ãp¨UÖòÆZ¬Æj÷Î)Cµ±¡:³$g²0ò¤Ä÷ñ¤ªó ñ Xºî~èïÂRïOíêíî4ðÀpØ×69Ç67ò= Ôô¡jó¡p³ôÒçò2q¤ÄØt¤Xìs ¯4£É|«[J¥©,ØíÎÆ(	)1åiÌ° ³«¹= 3Å:ö^°¨ÉWí¤«JÕ²¯º#%ÜÛÌo Ü»ç&'oZ39ª³·ªS7ßS¸øSHøÐ:ócÐ0((pçðRèðÏXèî¢6èîÜ$¢lçï= = éig)gé-¢+¢	¼ÜÿQÄB©ÞQP= 8Ò(	±åOHeÆªYþ3×= êÁÇé*G)ì7RÚZ"¶s¡¹v3*#óiØÎÃjfÃÂf
çûhkòj.­svqÙªWÏòµ¿âsgþ¬j7µT¤ÂÈîÕ|ÈïGRÈïÆ°Çí\ Æ©Ëÿé±ëÿé	ÉÜfkSlÃeýL¢çÃïrH0ð!Ì^)M³·ºm¨Q	²G\´Cï?Ó}³ø{S@Õb´=}*ØÔÊ{/57ð§î¶Õ±ýÌr*8ïj&{i  ·²
»6rTÈ´«ò3£´µn¤óêëdXnÀzµ¡Lh%î+©,BtsvüX8{ýÒÖTó
!ÿ{ôqðXé°= XP¡²X7©Ðìp¨Æ
$ú²+Ki'dz°|æ  ù²©¦xÖ²C{þ¢Ä,Çàì¾þÑ{f; |gV+\Ñzðf¾¬ÒhhÈÇûÛ«»Þh4Ö÷8æ/m/ÆoÌ|\gö»øìå³nYùàè³w­v"Ãoúãç¹®2Ô¯ü	¢âã|ÒXTÒü9ÞaDÙ7
wèÙ­xà	[°v4*ÁÏy!õo4.â$= HÄÑ²»cá<ãyJ|ÝY7¢üÔØh4ãh|*2àÑ;¨Ô/çâ!+Ò$Âóhb¤ª(ôeN@tfKtej(ë+èJàIÜñ¶.»Â/ß0¯b&o¢³ÖâÒBÈÒKÈÑ'ºTeã×è!wF´Ûâ'ØãÁÚØëÕhÜßi9¦ªÏï)=MA¢µb¥â.0ÜÑÍàÒgØzÒ(4ÑrèOÒ·JSÇÛXåui,äI+Oà#(ê±:èø/­£T"± Ë[°x"þ:!#6cÄ$JQûßëoúºj"l')= ÑÅÒÑÊ4hZ#Ò»«MëÒÇh ÑçHg¯"7ZGë$;g%ä	â	6¦°é)Ù§×hËP¶V;j¦ÿ8å¾ôÒæ1eçñä\Æ7r'Ñ»æå:LKúëÙNòÛå«¬È'«9îhàYòõåÑ&,ÌÉo$:f§)Ür 8²-+W²®0åJ¨ÛXiçî±ÌåêêYß»ú0iïð65÷ø_
H= ¬WV6và!4=MyÎÌÛøç¯"OT´Üèv­,÷(´3ëÙ¥§Äºô÷Ëôa¹6ûäºË´°ºâóuäÚhº÷
Ï&6çâìtºÞæ²74ûzÀ\8É4|oc:ÿ&*Hââ´øul:%â&Béü¹° ÷!ÌÔ;:;¾1òÌã\ÆwÐ91÷ìâlì¹tú &Àcúü# 7ùüûätìü·wæò·UxzCÈ·êÊÔw¤ª«2.¤|2=}òù]òà9'êGÂ¦N²"6'6Ý'åï'ìøhåzYhèpWh§â6ò*ú''OòF2^8XçZIªÊåÀ¤òTªäSF&á74'çë(ÞCû%êShXªû ÍW:^zÕ7°Ïw¨ÄÊXÛç-Xâ+vzÉw+
2.'dç@ËÔ4ÙéK¬iÙãêuzÜã+ÅÚâãw¬lÖè;Vn*±«¾wi·Î×ô*u´æm9Tr6=M¯ò°8Ò'æè åò9æÊtê¬åûøíÚ¸È÷0òþá*§ü½Zç¢ rêÛ{öº»Üw/÷×sÉè¾V§;ñ@'ÝÀ'ñ2üè\hY\ußÃquãûµ2'¹:2f24>¤ç\çª$ËT§PlçîÓ§£¢2Ð,Rò
¿è§}²ò#X'6Í§lô%:"Û·_!¾®&G¹éÃkµßk0ºãK¸ëë°¼æÓÖ-2±µà»èÛ»4X8~ú¹4à÷¤ò-l§ê×4¹þ= "¸9+µÖ¬êç Bû%µ"ª·;{¾tH®!
kx/´Ùµ×yèpóýL4q/;c;/ñÆüV¢#pgõ-ðÌ57ÂëyñîXìå°$Lôö0zitôDÜºÀ¬Ë4!G·.ÊTù5ñòk[µhT|ovtt7-¨Lºµ*ÖûùóÌº'Z#!8è7°4¤;9"éùùÒ=}8=}<{j\lfÍúR0ÌLÜC0TÀ¶áM;­»»$»«ÈF"èH-3G-ÂjH/ÜG¯{üMOÕØ¬Q#ÖómÛYÁÌÁ¸±kH¢S"DTS LhT$lT$üÔ ù/*Ø/þ2ÿ68ÓÇ\4l
$;×|«Ãä|e zÑ"Lº®óæYðy,´òyìnå?ÎLÎ<[[þ¤ZÉ4\Ðg0@«ÎüaÏ¤Á.8à5ÃGü¯à7nûh c
¹é9#l»ô¡¶¬é£rëÛæTòêæL1êþZ8Ï§/Ä7¹9Á¹ÞâslmèsL/ì dlë 8$ìp" ÿ'.º('.«(0X(°C90Cù¨ÆÃyÛñNlðãN¬ínüüénüØìF¬yìFlÙèfÌÚÑ$ps Òs üº«´K§°|«¬±«þz<©þt¬´£ñ!Âôù§}¨;±¨;« ÄK« ª Ôr¬ØY©¸Ó¦¬lª¼°¬*6*6ÎSZõÏ¾8S(
'|¢³!Öúx.¤x.oNÚ¶bÚ6Xäk9kùök9¢6ëmüh\.úh¬âXÜ;té}´´Û¯üxìðD¬õßD<Ð(ÐÜ¸/Ë;úµÀÁ¹öù·.ù¹ 
ù¼\{®\+-åLü	ßö®q¸O
Pè-º¦nù
 Uå¯û!$ûùÊûùµim_Ó4uP ?8.Xî:5ú:5¼ß¼;®¼+<ñ|Ü»=},r=}Ü·±=}´4Y,ôVúÓK!ð\I!@ÈLCJB´K/Ô~ùñoÕ,WnÕäZU	L'Ä-wÄ-Íµ Ã-°¯Y
5öáuµ´YL»T¨Á01%µ{«¶y¶jÛ$Úýltld-¸PõèA[­e\³elo¶el×nÑdüVÀHI öK *I ì¼Z<÷xÉ¸·J$0çI$À Ä0Â°Ä0üL$tI$\:O¶Ô§Æy[ÏÓÄ,!~ôPöÌ^ÆôlÛs$ Ïõ a{£¬O¬®jÆL;Û¬!#0Ñ¡;Ä¡;vnÖlÛØ	ä,#$b0ëÐvpã-{65êQûçGPØÿ:¼$ä-Àõ(Qû)G<&G<¤ â°5¿s+ ¨µÞs[8õ eX¼u:S5	s¦èÊL¤ ¼;« |Úï.Ès»!×Ê´õ¨ Ìªy7ÂÊ¶  ¨{5µ,ØÊ\9ËÖs;V¤EÙº¹ÿÖR¤¹u,#ü ªËkX¨4ÈÊRÛ¥ ÂCãs¨tXh-M$³Ûÿ÷äí{¢ÕrpÖrwÏ	££Ð®ÙaîDPÐÀ')ä³¯º_¸{Îpbï¨ÄðZ*Äðð/­6m³çmó2#³²5°e°ÒýY_OÍ£yøyÛZ÷[4Å ®ÌÄí'ºÄí[Cðü·J£üWKñ[_K¡sÍÒu½*
p½jVÜºÌ¥Ì
W¡³Þ#®qÃ*IÇ ßZ-s_¹8í6z·ð;Ø¸îz\¸ïaâdÒÀ2|=MÚjÔ÷ðóÎñõëé;7k©/
éÊ¤¤óÆ(Î&$³ÃÉ3©:³)ñîZØáj8øJ8úrÙÇØÏÚ¿²¬ÓÛ©c¦Gz¥ÿs£ {q¢üs¡(ûttû¤¼¹êcºéì(íãÌ§ð[¨î¤¨ïlVr%
úB=Mçé¼hhßG0Ç)[ÂÊ8YGç	ó¬è<Yþs²ìgppX¢o)¦sïf#$NKgþ©ÈÇðÓÈîÞø©'ïÿ)©Ý~epË/h^i+M°5bÍÚ¨×ÌÒ?C¼³è[³/ »èº3Cö)Ilóòédx®ÿWL±¤/kiæÇÖÚ9#W= Öâäv¿t"ý1x±iâ÷	/;Ïæ106¹'Ð¯)#¸"+ÈtÐìlÒyÒëÑØ[LÒ¤4ÑAìJb¹¦êüéQ6±~;1Ù¯/¦¢ÆPR;^"8Q~8ÒjRæ["ãb:s¢&
	²XÑ¢àgäéGÒë©ÒÓg k»oöNxÖOÎãi/Ù5®Ùn~Æ¦z¦Ö´ñ¯/7E¢Di¹Åïô¯|"%ìúÑCøeªÓòoúØh»§Ý±¸ææÇ·qvSÖwèÕo%°>¢¡8}"{bîJrh/\K}8ìÀÂ*øRð4\JzLV3)Ë¦º¥:å&hãvYZ"¶is§õ ðå¦å"®>'ßËâÜË©Ö¼¡TôwÎüìv§µz×ì3·(óì.Á8éÞ3&uqºb:2Ës&ÌÄLð¥©·¬¦&k\ð ·h··+$ä<Ö;Ø"·Ükì¸©ìØ)á3K³|<#â{(ÛjMéëªSò9zìïwÞç'täówiéÎ×óèÂï¸² &ë'5ºÈ8è= wè¬aæ
tãçæèRHÊD²ÖåÃØéuxz&q¦Ë7ù,¹²ÿ§Æâ§ÒþÞèJæ²sç¼
ßKôè;t´ç¸o4å2?2­Iò}À§ø{Äkf-¦dºå#0'èúTîüíããÛBêµ;ó÷#9z20ÖÄ§7.d' Ûè´üxì¼è-~
xð· tróÁ2¢,äw-lZ6$3ù;N@8py83± {¶.[¹:a{2ÆTüxTÌÛØL9+ 4ô1 t!±¶6ÁS>õg\|;{ÍÜå[	ÊµÒ9yqñ=}<SÍ(sT¬G0¢È-ÀÈ/fÇ®3éu´kÏ&UáÒËÑ#ä{Ô¼Rf\ók|Éëý²Øg¯$|= õ;b;geÏÜëW$²µàNÉ|×Â4;LÚå"õø',Ð\1ëC#xÇô"¼ |$½W/åÊ5¯Ê¶O5í=Mãùë¬p»	Ù¼5ÙÜ÷¿tuÏLÇ×lª Ô±ªR¨x[T=MÛ|ñ$²¦ü±!.Úµ
¹ÌT»6·T«ÒìÆ*ØÔ?ª/÷xlõâDìPÐhÈ¼ùÈÌÕØd, \û& ¼O
'-:ì 52º¶4îù.î¹|	ð|,öó|¥Ñ>¹
ö>9¾ù¾ù]{|Õ¼XtÕtL[ÐÃ-u[pwË6Wâ~ÝR+0
Põ,¾Aûò{= ªe8¦el»Uüù´U|&xÙ(CL$ ËJ$b@P¶%ý·¼_|'Ï c.HÐ59£o%Ï	¨j#Êkc0kfÞGy]ÂÑÿY,â-u\XLè¡ ÓósqþÄð.Ìèª¹ª÷Êvª hë5p)zõT9[9U8,z-òôîªi¦ÆÊ
)¨  Çîxf©f	yÂîÉ¡ñ«oèºaÆRëÙ{i¡&Ö ÅcV/:nÑVZÄoìßFé£
µóû¢Y¨»EèG9ÀÕ.¾iì=}±æ\îeÓ¦ÔâÕ 	{	ì¬s(3÷Lãy)có,[\'	H²BwíÿîÜï£òðÃó¡PTt¤~&9)ÔèJ727)Ü²ÖÎi¦¯²£*ÒÚgÂzº\Âºæoèx¿ª-ëýiø¿×Âzk¯bQ¤zûS"ÃT£SÄw"¤8LDî2Â0îr= :\T¹Íé¬ls ÒÂjü&Oú	ißÇ¾º(&[ÉîrpÒ³@|fðäúz§©ºÝ«øâ¸B9èHÇ/å¯à-¬½8ÑÚ³e7«0êã\6VYð&(y6ºþ"­F+*àÑ :ÄhþnîÇ8ò£ôÝ×=M8ÇþÇg"Ç/¢'Ò»ÛZ|T2Ôëå(êSºÖxo§7z/#Æ×¨wW¡"ÉÞT4Qì{­è|,)èÜez
ú·ë÷ wjÌèãÄ1ûÙ=M9s:P¤ò!Y¬2 Üþ'G²âr*[ªmÞâ·¯tò.Ã>§Êç¨ðÜcçëRäèÛ$åz2È®Â·¦(wò#Sò¥2'âNç!À'ÒØR7ð§Ê½|õ¢+å.Ì:^lÜ,6L{è$ùRzüO$üp-óÄ
9 ±tùòD¬) 
Û
ä7.p//y¤0.»þ¹Úevà]\\Ll¤µÔ¸¼G$BÑ#xXÔ j´û-÷r_¶ünGìýè-Æl­Ë0æþ ¼ì   ÓJ5óóÊõÝFÜûVÓøB\1éb<º¨{pâj|îz,7å@ìuòPìùH,òühäx|²áD¼OÈØìo0Ú µ02º¶0{ù}¼÷&=}û«}¨]«ØxÕ|Õ|ÁÙN0PíCK"bÚÃ.ÄÄ®ÜÑyjiÎø[@êfÆµÑº8a°"oìpÂ$ÛÿùJQXm´éð.ö¤ªùXËvùO0tJoçB0]ôGòîÇ= ôêÉ*ãaïtÒÃð|3I¢[+F)ºÂu³Þ£mK¡ìó1 Üÿ8ïæ 7íÏ·ï£xøîp]då¾õÃ&ÒÓé%ÅãéÿÃé é÷)SÚìg8ñnÇTþ ïHïî(ÈídÈGmsaÅS4¤Ë$ëÊié4«PÈnxïOÐûh;µêù·ºîz9ö0Ñoë(>âÐÒ_
eSlûÚ×ßXæÙwWà±F¬~v¼pì/çÂ&8±Ïqlg1*e<"¸= añz'ûú8øâ4'ígx:§÷;È~Z©ìÓºMâklj­Í'VoZ,uj¸·î·^¦ú¢ô×d.´òð'$l[æÄLúä+Ã+md[W)ÿ¼)þ¸S1¸0/vVþyú¿ù+Ðßù"6­«~v{çb;*áÿüÓê4JèÐ$ à$s¾ÀØ.âÂ.«x/6w/-õ8-+9l+k×D%(h	Vø+V	Ì«Æ öO58¹ µ­­ÙO¶Ø90 ¡+ófÂLæ¦ +©9°XTSºv;¢F	 äf{Æ¯&Å±ï+6sÎòDõÜ"5ùÑïüe8 avºïkbh¯ªöîÙ2!,n8Õ{G{ê!¯öìÙ2!,nvºwp[gäàELºö©"6ü9d¬¥þÇShß¡âÑjûÂÅÒ= àQéèìðêÿþ"_ßçêèú7JXtªçø3Zx´*è»@CbIVäÖ§²Wr¨ë Ô+z81\Y|ifb²ÆÐäâ
×x¼.lhéõ¢;ùâéJ±ÈVqq¢1õÜä
Ùøµ÷
´ä,|¹/9âèô+z¹.+ëÊ÷I[Üó­"Z&üZzº6Ðty/ðÓÆP$éï44Tì¼3líú³ºÕ{¬&'Ê´è9¶:ÐÔ,ojÞs:ù4þÔ¬|»:YôÅ(6ìoÊX2Ø-Û´øQçj®'/ZÄkº2
éýè4¹Ï&çêªFü7þæän¨Ì|³kg®;ë|ÛvÒ*o» ÖÔËNð4|­é¼îtËR·
¸n¯\Zé t±å£>ºNøÂã:O9ú¸4êèR÷6O<Ü{º%=MæHI¸éVVVx´ëÜâ]íwºÆÉÉ*çSãU31ÌHI¸éPÌ[ô¬0H Å¼DKYò¨ ¨^ÇÌ²1=MÞ¸4«×òí¡ós,K(i*DE]íÊÍ«!b¯RFG¯¤¶ü©Í· gQÓÂâ®æsÍ§@]4ÓÌ=}¡½±GÔäÿ£µg§ ¶ði!>/VT7mÔáÇ/Yößq7eòÓ´ê>N#È.¸³½;~}·ÊÓâæ÷ùëËö"]´ÔLk&ÁÛaTÐcâ7/·öûñ[%³º"Pïôq7ghä¢âq&êktÔó/M6LvìÑaÒ_"B¯áñ}7gòÔ4*âºåµÂv~TqAæ=MÈÂ²¿Gò=Mâíp%_¤¤YÂÊýµ	*.íå= ìÎ(ý£ÿe4ÎÌ[=M|ÈVvkB::=M:_t¾BÂÄy{h8þ³ o15$Níÿ5A½¯X5 !ï= i}»ÄRÿ¯>¯ÀzþGöCéoY"[/,ïh)~ÿc¤å<IÅC½j¨=}XJv{f$¿²Be	Ñþ Z©J»Òý·]ÔYdÍ@h¯J3GH"eº¹À"~÷>3X>=}|øc(áë>]ËAÙ&s=MÆÔâ¢m(g\Íñ±g_ÍÈPá¶êÈòh{c@1wdÒÓäââ&¨ææù«gªÒyîCÚÐ0 âüá/yõÛDÉÑó/[öêñ= LÔ<ÏÚáÛ^æÝykeÊ¾v­¶âfvÒxaø:áF¶ï×izÔWX"Ã+dÜÏ°.=}=M
Ïðá4¶Ä^"Ó "È¯{fBÈð_lÏR¦N©"wçâ¹Rì·9CÈÌ¯»
¾*l¯rý%"«/¬ïVót<nkGh×dí!dÀzÉËÎÌívL¨ÍV¯Vù¾söVé ù!þ/¶\(3RÃ	Ôh ÿ#Héy3*h ld¡¤4YÃÂöM)±[ý¡ÒHSt¯l=}=Mö $q)ãbò0?Ó= Ø!íü®Ô8ä¢\;9F(Ð¯B-¹½ZöRé®¹!A6vM³}tÈï£í%ÁFÔxþsdótÀÉ1±À×HÌ¨ö¬= XpJùõ¬X¸­geú!Xèî¢7ãþs#27ä1"©éãb&ÛÖ[¸ü
KT4áíþxãôuÚ	ì³Ìò¤,Hòý"a{y*]Æú(Úð@a=M9ç'ÚK9ú¨ux¶üö§yÉÊ9Ê¹sÑr­&ìËKYSõdæÌ¨cí$àèFÖ/¶¿{K)û%¦§µM<Ì'ýÞÀ-GÈº1]ó°¯2ª ¾© ò§à@Õò9Sruð\ÐÐ³ç.ÄVsIò åûiÈD"²< §û(º³2'
ãôúå;ÈúÆöçKÖÀêZ¹Ò:÷ð¾@\ç|+Ù¸yH¼+	Gr¹è¬Æj3:°D§|+ë¨9,'5Ï×ªÿ>ûeòr¸|ý@óò¡Fî£'°3ÁX¼.æf¸-û+n+:Xnö6¹Jß»ùéz³)¼{Äú¬§ï<»3²°¨»;JºH/VèíxG0±B'À¢-òoø0¸®[ïr¿R 6RÌ¢âv¶×bÜï5
­Ì VYËõI,­ùÍCI¦¯á
ÍDI¶¯!
CËïmÑÆà©I¢!ehÖvDË÷mFa[(s"åhÚv'=MCYªþ=McYª =MYª=M£¡_=MÃYªæÝv~X°ñò¿s$¥¸BºýTG7Áà¬Q1Nf%pËû=MÄYºæÝv7~\°1ò¿{$%¸B ½ ieUPY þUþ®¢ö¿n n³QÉ^Ëîá®ÉjB É éfU°Y þU!UÈGamvç¿nn³RÉËîé°ÉªB Ù éhU0Y þYÕHG#Amu#Q#IÆÿYÕÕY°hG°É ë®	úe	~ËöUÂvnt= nv#§a#iÔÿ¼Ãs E÷q´&v
Ç°Ôäö&â1¦+»q´f<<ìé°<÷Ë5T!_ÃTQnl½@å0¿½?ßµÀDA!ÏB	Mjpî>êÉÙ¶ÖÓëéÓÊêñü¢Êi°¨è7æê|Ý4(µ§8«0y$0v$:w$¹Ë»Lí·Ô2þk(ÂLø)D³\)ï¢<íÈzT8ýk3¿)DøP³îl)¬;íÈ|T<ýk;¿9Dø5P³.l)¬<íÈ[Tºýk·¾1@ø%F³T)ßt¼íÈ[Tºÿë&)ßíÈûTú k7Äµ½5½µ¾5¾µ¿5¿µÀ )ÿ= )ÿd)ÿh)¯.<9Vì.[¤5i4Ð¸0Z¹T´ðCÿ×X¨¡êéÖòðD3ÿÛX¸¡ì)Öú @©¾íJsÿI©ÆîjsY @¹¾-J{ÿ5I¹Æ.j{5Yà>ñ½c=MCW~h¥C*Ý^ñÁã=MSW¨¥K*Þ~ñÅccWè¥S*ßñÉãsW(¥[* =}iýA©ýEéýI)ýMiþQ©þUéþY)þ]iÿa©ÿeéÿi)§%R<Ã®¼üîI-8©]54)]Ã5·G¹ºS¨Åvû»ÈaÜgÓ,Vn
* îËÕ$3ð±8éa£÷:jÓO|S¨Æö+|È¡4ì§ó8vn2îÛÕ,7î}­ºë]¤õ;iÔÍÜÓ¨vë!aô"g¯Ó(¯Vv
6í°»iTÏPÚlÒ!$¯fv6ñ²»jTÐÐÚ¬!©$¯vv À"·¯ûLèBåFyûê}
.§F§GÌ¨°µ9ïÁ× Øgi[<éÓÞã.5¥òKrÌèÂåÆyûê
!.§f§gÌ¨°¶9óÉ×	 ø§©[<êÓàã09ò[rÜ$LèBæFzüê
%6§§¨°·;ïÑ×0ØçéÛ<éÓâã29¥òkrì$èÂæÆzüê
Yàd|14j40nì m,d0¶U#»m	:Õ,Àû\ÃLIð{'@H é\ÃLIð|U£üm	;U¸ým3¾)B LÃîdI UmÉ:U¼ým;¾9B 5LÃ.dI UmÉ<Uzým7½1? %DÃPIàlU¬mÉ;å<=M= IàUìmÉ»Uz m7Ã1K %\Ã>Ã@ÃBÃDÃFÃHÃJÃLÃNÃPÃRÃkìä*r 2óºÓ¸µz«4#xùô,£Jà8ó³3$>X¸10¿*ZX5¶ÿ©ÀÊ9ùó Ã»[n |ìÕ*.¾Ü¤	t5x#x¹%$^0j{30Ï6[J5¶ñ¾9ù¢~»[pªÞn|ìÖ3=MÝÜ$Ø¥¸ãq)$~sW40ß¦\C9y¦©ýÅÜtÊZU/0åîB »r3=MðB»ûrP1F2írÑéÚè»zaïúé('£zM¡æ±ÚãÎþ²Ê¥ëËø'vBö'¬ÚÄhneô'r2è~Òwº'²J~7j&²ÒãCò'ºáËÁcÄqåH1æcÍi%Ïw×C¯:Ý1)Y2¸d~Ð$öèFa¨6¶úÜ¥V¦Ì%°Ãe%²2Êrváßqnß}Ý0'DÊÑÎ@'?:å¦b²'H¤¥}mZÚ'&Il§d$Ë[Åêì÷xÎ~ó7kz'ùÉGÓçÈ¯ºÑñÝZÕ4ÀÆÝ;ª'¹Þ®9²¬ëæ¼ÐÞ®9'9ë¤	#èh°~ºÖ.·÷)f² »GãDÌå|°Z×¾×ÏïÎqª¢Î7aìåÏçdå|/èÛ< b²}¨2z+¦âw^\åTOèÆg
'Ö¹æiâ'ßùÞ{ããáY4!L®f´!ß7= Pq"Ý÷_|¨o·2{äàE¿ë¯çpñËµ¸5[<60©¡úç-5³J¸ÇâÅeæ]wç4ÄáÉg¦ >¶oûaÏ´"Î/&¶²ô+t{jÎà"ö/¢Ð¹Øk,ëÐ¼DX°!Ì
/¡¶¥ê¹Ñ]üiÎ¤!Òa6biX0!Ìª/Ãyj\ßï¦à©Ùchà¡âï+[*¥é©g(ß¶ï¦ð©ÙfhÀ¢ÒY¢È)qÓçÑê1ìéù³#Æ å¹JÏÇÖh5, $+w*·#M(1'Ä¤¤%2µ_a¨?9#º_»"ÿ¦Õ³Øë:¨Ì"²å3Õã§¤ òô©*²Ñ³x8ZåÊ7£¨ú= ñêv(0¡¦0;:v{)&´óPÎÞ<42¿]õêèrÔ²Ú²®$±2%wâ(v<6ñë+<ùÄÜ5(j<üS3ÈÅ:¨}.þÂÄÇTól¥Üì¨~¸ª*ï'Òø´ÂZZdÄW¯z#©xp÷ðÌ£´	vÏ¸uä= äàÝ²¦ºõçñçoùëå£ãù*ð3ÂÛÕÍs¨6 âR¢b²÷-àÞªfªfLxv9Åë1KûV¶h'1%)ÂÊXÓ©Iìóëª¿ùj60ï3*zyÞ^ªñ¿'÷9ãÉ#1Z³ä*¨¸oæ ©$Å = [·n;ÿ-¨®t{É7a/*%ÈnFú¶xÓÑëj÷Þõ¦°3ëéÙÓðxzªÎÎ.µº3	ª4t¦¬/þ!= fOUº£!Ân¤ÐëcùRTTP´)þúÂê"¨§¬Öü¥°°.ÙzDï3¡ò"YÚr"9Ð WÏ¥uàoViàB×Hr[øm¥|'{Ü>®9Ý	PRT|_±ÄÊÜm®¯ç;^
¡ãv6Õòü2ó¾:8:@`, new Uint8Array(91457));
    var HEAP8, HEAP16, HEAP32, HEAPU8, HEAPU16, HEAPU32, HEAPF32, HEAPF64;
    var wasmMemory, buffer, wasmTable;

    function updateGlobalBufferAndViews(b) {
      buffer = b;
      HEAP8 = new Int8Array(b);
      HEAP16 = new Int16Array(b);
      HEAP32 = new Int32Array(b);
      HEAPU8 = new Uint8Array(b);
      HEAPU16 = new Uint16Array(b);
      HEAPU32 = new Uint32Array(b);
      HEAPF32 = new Float32Array(b);
      HEAPF64 = new Float64Array(b);
    }

    function JS_cos(x) {
      return Math.cos(x);
    }

    function JS_exp(x) {
      return Math.exp(x);
    }

    function _emscripten_memcpy_big(dest, src, num) {
      HEAPU8.copyWithin(dest, src, src + num);
    }

    function abortOnCannotGrowMemory(requestedSize) {
      abort("OOM");
    }

    function _emscripten_resize_heap(requestedSize) {
      var oldSize = HEAPU8.length;
      requestedSize = requestedSize >>> 0;
      abortOnCannotGrowMemory(requestedSize);
    }

    var asmLibraryArg = {
      "b": JS_cos,
      "a": JS_exp,
      "c": _emscripten_memcpy_big,
      "d": _emscripten_resize_heap
    };

    function initRuntime(asm) {
      asm["f"]();
    }

    var imports = {
      "a": asmLibraryArg
    };

    var _opus_frame_decoder_create, _malloc, _opus_frame_decode_float_deinterleaved, _opus_frame_decoder_destroy, _free;

    WebAssembly.instantiate(Module["wasm"], imports).then(function (output) {
      var asm = output.instance.exports;
      _opus_frame_decoder_create = asm["g"];
      _malloc = asm["h"];
      _opus_frame_decode_float_deinterleaved = asm["i"];
      _opus_frame_decoder_destroy = asm["j"];
      _free = asm["k"];
      wasmTable = asm["l"];
      wasmMemory = asm["e"];
      updateGlobalBufferAndViews(wasmMemory.buffer);
      initRuntime(asm);
      ready();
    });
    this.ready = new Promise(resolve => {
      ready = resolve;
    }).then(() => {
      this.HEAP = buffer;
      this._malloc = _malloc;
      this._free = _free;
      this._opus_frame_decoder_create = _opus_frame_decoder_create;
      this._opus_frame_decode_float_deinterleaved = _opus_frame_decode_float_deinterleaved;
      this._opus_frame_decoder_destroy = _opus_frame_decoder_destroy;
    });
  }

}

exports.default = EmscriptenWASM;

},{}],70:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _common = require("@wasm-audio-decoders/common");

var _EmscriptenWasm = _interopRequireDefault(require("./EmscriptenWasm.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class OpusDecoder {
  constructor(options = {}) {
    // injects dependencies when running as a web worker
    this._isWebWorker = this.constructor.isWebWorker;
    this._WASMAudioDecoderCommon = this.constructor.WASMAudioDecoderCommon || _common.WASMAudioDecoderCommon;
    this._EmscriptenWASM = this.constructor.EmscriptenWASM || _EmscriptenWasm.default;

    const isNumber = param => typeof param === "number"; // channel mapping family >= 1


    if (options.channels > 2 && (!isNumber(options.streamCount) || !isNumber(options.coupledStreamCount) || !Array.isArray(options.channelMappingTable))) {
      throw new Error("Invalid Opus Decoder Options for multichannel decoding.");
    } // channel mapping family 0


    this._channels = isNumber(options.channels) ? options.channels : 2;
    this._streamCount = isNumber(options.streamCount) ? options.streamCount : 1;
    this._coupledStreamCount = isNumber(options.coupledStreamCount) ? options.coupledStreamCount : this._channels - 1;
    this._channelMappingTable = options.channelMappingTable || (this._channels === 2 ? [0, 1] : [0]);
    this._preSkip = options.preSkip || 0;
    this._inputPtrSize = 32000 * 0.12 * this._channels; // 256kbs per channel

    this._outputPtrSize = 120 * 48;
    this._outputChannels = this._channels;
    this._ready = this._init(); // prettier-ignore

    this._errors = {
      [-1]: "OPUS_BAD_ARG: One or more invalid/out of range arguments",
      [-2]: "OPUS_BUFFER_TOO_SMALL: Not enough bytes allocated in the buffer",
      [-3]: "OPUS_INTERNAL_ERROR: An internal error was detected",
      [-4]: "OPUS_INVALID_PACKET: The compressed data passed is corrupted",
      [-5]: "OPUS_UNIMPLEMENTED: Invalid/unsupported request number",
      [-6]: "OPUS_INVALID_STATE: An encoder or decoder structure is invalid or already freed",
      [-7]: "OPUS_ALLOC_FAIL: Memory allocation has failed"
    };
  } // injects dependencies when running as a web worker


  async _init() {
    this._common = await this._WASMAudioDecoderCommon.initWASMAudioDecoder.bind(this)();

    const [mappingPtr, mappingArr] = this._common.allocateTypedArray(this._channels, Uint8Array);

    mappingArr.set(this._channelMappingTable);
    this._decoder = this._common.wasm._opus_frame_decoder_create(this._channels, this._streamCount, this._coupledStreamCount, mappingPtr, this._preSkip);
  }

  get ready() {
    return this._ready;
  }

  async reset() {
    this.free();
    await this._init();
  }

  free() {
    this._common.wasm._opus_frame_decoder_destroy(this._decoder);

    this._common.free();
  }

  _decode(opusFrame) {
    if (!(opusFrame instanceof Uint8Array)) throw Error(`Data to decode must be Uint8Array. Instead got ${typeof opusFrame}`);

    this._input.set(opusFrame);

    const samplesDecoded = this._common.wasm._opus_frame_decode_float_deinterleaved(this._decoder, this._inputPtr, opusFrame.length, this._outputPtr);

    if (samplesDecoded < 0) {
      console.error(`libopus ${samplesDecoded} ${this._errors[samplesDecoded]}`);
      return 0;
    }

    return samplesDecoded;
  }

  decodeFrame(opusFrame) {
    const samplesDecoded = this._decode(opusFrame);

    return this._WASMAudioDecoderCommon.getDecodedAudioMultiChannel(this._output, this._channels, samplesDecoded, 48000);
  }

  decodeFrames(opusFrames) {
    let outputBuffers = [],
        outputSamples = 0;
    opusFrames.forEach(frame => {
      const samplesDecoded = this._decode(frame);

      outputBuffers.push(this._common.getOutputChannels(this._output, this._channels, samplesDecoded));
      outputSamples += samplesDecoded;
    });

    const data = this._WASMAudioDecoderCommon.getDecodedAudioMultiChannel(outputBuffers, this._channels, outputSamples, 48000);

    return data;
  }

}

exports.default = OpusDecoder;

},{"./EmscriptenWasm.js":69,"@wasm-audio-decoders/common":1}],71:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _common = require("@wasm-audio-decoders/common");

var _EmscriptenWasm = _interopRequireDefault(require("./EmscriptenWasm.js"));

var _OpusDecoder = _interopRequireDefault(require("./OpusDecoder.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class OpusDecoderWebWorker extends _common.WASMAudioDecoderWorker {
  constructor(options) {
    super(options, _OpusDecoder.default, _EmscriptenWasm.default);
  }

  async decodeFrame(data) {
    return this._postToDecoder("decodeFrame", data);
  }

  async decodeFrames(data) {
    return this._postToDecoder("decodeFrames", data);
  }

}

exports.default = OpusDecoderWebWorker;

},{"./EmscriptenWasm.js":69,"./OpusDecoder.js":70,"@wasm-audio-decoders/common":1}],72:[function(require,module,exports){
/**
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
module.exports = Worker;
},{}],73:[function(require,module,exports){
(function (global){(function (){
"use strict";

var _icecastMetadataPlayer = _interopRequireDefault(require("icecast-metadata-player"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

window.jQuery = require('jquery');
window.$ = global.jQuery;
var player = window.player || {};
player = new _icecastMetadataPlayer.default("https://subspacefm.xyz/stream", {
  onMetadata: metadata => {
    var str = htmlentities.decode(metadata.StreamTitle);
    $("#metadata").text(str.substring(0, 48));
  }
});
window.player = player;
$(function () {
  $("#play").click(function () {
    player.play();
  });
  $("#stop").click(function () {
    player.stop();
  });
});

}).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"icecast-metadata-player":46,"jquery":54}],74:[function(require,module,exports){


// function to set a given theme/color-scheme
function setTheme(themeName) {
    localStorage.setItem('theme', themeName);
    document.documentElement.className = themeName;
}// function to toggle between light and dark theme
function toggleTheme() {
   if (localStorage.getItem('theme') === 'theme-dark'){
       setTheme('theme-light');
   } else {
       setTheme('theme-dark');
   }
}// Immediately invoked function to set the theme on initial load
(function () {

   var themes = [
   "theme-light",
   "theme-dark",
   "theme-pink",
   "theme-green",
   "theme-yellow"
   ];

   var theme = localStorage.getItem('theme');
   for (var i = 0;i < themes.length ;i++)  {
         if (theme === themes[i]) {
              setTheme(theme);
              }
         } 
   if (i == themes.length - 1) {
       setTheme('theme-light');
   }

    $("#light").click(function(){

       theme = localStorage.getItem('theme');
       for (var i = 1;i < themes.length;i++)  {
             if (theme === themes[i]) {
                  setTheme(themes[--i]);
                  return;
                  }
             }       
       setTheme(themes[themes.length - 1]); 
      }); 
    $("#dark").click(function(){

       theme = localStorage.getItem('theme');
       for (var i = 0;i < themes.length -1;i++)  {
             if (theme === themes[i]) {
                  setTheme(themes[++i]);
                  return;
                  }
             }       
       setTheme(themes[0]); 
      }); 
})();
},{}],75:[function(require,module,exports){
/* * 
 * audio visualizer with html5 audio element
 *
 * v0.1.0
 * 
 * licenced under the MIT license
 * 
 * see my related repos:
 * - HTML5_Audio_Visualizer https://github.com/wayou/HTML5_Audio_Visualizer
 * - 3D_Audio_Spectrum_VIsualizer https://github.com/wayou/3D_Audio_Spectrum_VIsualizer
 * - selected https://github.com/wayou/selected
 * - MeowmeowPlayer https://github.com/wayou/MeowmeowPlayer
 * 
 * reference: http://www.patrick-wied.at/blog/how-to-create-audio-visualizations-with-javascript-html
 */

window.AudioContext = window.AudioContext || window.webkitAudioContext || window.mozAudioContext;


var visualizerStart = function() {
   //breaks chrome if not here
    
   if (player.started != undefined)
       return;
   player.started = 1;
   var ctx = new AudioContext();
    var analyser = ctx.createAnalyser();
    var audioSrc = ctx.createMediaElementSource(player.audioElement);

    
    // we have to connect the MediaElementSource with the analyser 
    audioSrc.connect(analyser);
    analyser.connect(ctx.destination);
    // we could configure the analyser: e.g. analyser.fftSize (for further infos read the spec)
    // analyser.fftSize = 64;
    // frequencyBinCount tells you how many values you'll receive from the analyser
    var frequencyData = new Uint8Array(analyser.frequencyBinCount);
     var top,mid,btm,cap_color;
     switch(localStorage.getItem('theme')){
     case 'theme-dark':
             btm = [1,'#717e80']
             mid= [0.5, '#3d4445'];
             top = [0,'#131b1c'];
             cap_color = '#131b1c';
             break;
    default:        
    case 'theme-light': 
             btm = [1,'#000']
             mid= [0.5, '#777'];
             top = [0,'#bbb'];
             cap_color = '#000';
             break;
     case 'theme-pink':               
             btm = [1,'#af9bbb']
             mid= [0.5, '#c5bdc9'];
             top = [0,'#fff'];
             cap_color = '#fff';
             break;
     case 'theme-green':
             btm = [1,'#bfcabc']
             mid= [0.5, '#96b68d'];
             top = [0,'#fff'];
             cap_color = '#538740';
     break;                     
     }
    // we're ready to receive some data!
    var canvas = document.getElementById('canvas'),
        cwidth = canvas.width,
        cheight = canvas.height - 2,
        meterWidth = 10, //width of the meters in the spectrum
        gap = 2, //gap between meters
        capHeight = 2,
        capStyle = cap_color,
        meterNum = 800/ (10 + 2), //count of the meters
        capYPositionArray = []; ////store the vertical position of hte caps for the preivous frame
    var gradient;
    ctx = canvas.getContext('2d'),
    gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(btm[0],btm[1]);
    gradient.addColorStop(mid[0],mid[1]);
    gradient.addColorStop(top[0], top[1]);


    // loop
    function renderFrame() {
        var array = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(array);
        var step = Math.round(array.length / meterNum); //sample limited data from the total array
        ctx.clearRect(0, 0, cwidth, cheight);
        for (var i = 0; i < meterNum; i++) {
            var value = array[i * step];
            if (capYPositionArray.length < Math.round(meterNum)) {
                capYPositionArray.push(value);
            };
            ctx.fillStyle = capStyle;
            //draw the cap, with transition effect
            if (value < capYPositionArray[i]) {
                ctx.fillRect(i * 12, cheight - (--capYPositionArray[i]), meterWidth, capHeight);
            } else {
                ctx.fillRect(i * 12, cheight - value, meterWidth, capHeight);
                capYPositionArray[i] = value;
            };
            ctx.fillStyle = gradient; //set the filllStyle to gradient for a better look
            ctx.fillRect(i * 12 /*meterWidth+gap*/ , cheight - value + capHeight, meterWidth, cheight); //the meter
        }
        requestAnimationFrame(renderFrame);
    }
    renderFrame();
};
$(function(){

$("#dark").click(function(){
   visualizerStart();
}); 
$("#play").click(function(){
   visualizerStart();
}); 
});
},{}]},{},[73,75,74]);
