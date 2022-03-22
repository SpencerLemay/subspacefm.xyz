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
},{"./WASMAudioDecoderCommon.js":2,"buffer":5,"web-worker":71}],4:[function(require,module,exports){
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

},{"../FrameQueue.js":45,"../global.js":48,"./Player.js":51,"mse-audio-wrapper":58}],51:[function(require,module,exports){
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

},{"../FrameQueue.js":45,"../global.js":48,"./Player.js":51,"mpg123-decoder":54,"opus-decoder":67}],53:[function(require,module,exports){
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

},{"./src/MPEGDecoder.js":56,"./src/MPEGDecoderWebWorker.js":57}],55:[function(require,module,exports){
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

},{}],56:[function(require,module,exports){
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

},{"./EmscriptenWasm.js":55,"@wasm-audio-decoders/common":1}],57:[function(require,module,exports){
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

},{"./EmscriptenWasm.js":55,"./MPEGDecoder.js":56,"@wasm-audio-decoders/common":1}],58:[function(require,module,exports){
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

},{"./constants.js":59,"./containers/isobmff/ISOBMFFContainer.js":63,"./containers/webm/WEBMContainer.js":65,"codec-parser":6}],59:[function(require,module,exports){
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

},{}],60:[function(require,module,exports){
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

},{}],61:[function(require,module,exports){
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

},{"../ContainerElement.js":60}],62:[function(require,module,exports){
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

},{"../ContainerElement.js":60}],63:[function(require,module,exports){
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

},{"../../constants.js":59,"../ContainerElement.js":60,"./Box.js":61,"./ESTag.js":62}],64:[function(require,module,exports){
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

},{"../../constants.js":59,"../../utilities.js":66,"../ContainerElement.js":60}],65:[function(require,module,exports){
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

},{"../../constants.js":59,"../../utilities.js":66,"../ContainerElement.js":60,"./EBML.js":64}],66:[function(require,module,exports){
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

},{"./constants.js":59}],67:[function(require,module,exports){
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

},{"./src/OpusDecoder.js":69,"./src/OpusDecoderWebWorker.js":70}],68:[function(require,module,exports){
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

},{}],69:[function(require,module,exports){
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

},{"./EmscriptenWasm.js":68,"@wasm-audio-decoders/common":1}],70:[function(require,module,exports){
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

},{"./EmscriptenWasm.js":68,"./OpusDecoder.js":69,"@wasm-audio-decoders/common":1}],71:[function(require,module,exports){
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
},{}],72:[function(require,module,exports){
"use strict";

var _icecastMetadataPlayer = _interopRequireDefault(require("icecast-metadata-player"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const player = new _icecastMetadataPlayer.default("https://subspacefm.xyz/stream", {
  onMetadata: metadata => {
    console.log(metadata);
  }
});
$("play").click(function () {
  player.play();
});
$("stop").click(function () {
  player.stop();
});

},{"icecast-metadata-player":46}]},{},[72]);
