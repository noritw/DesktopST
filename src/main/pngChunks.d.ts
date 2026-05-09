declare module 'png-chunks-extract' {
  interface PngChunk {
    name: string
    data: Uint8Array
  }
  export default function extractChunks(data: Buffer | Uint8Array): PngChunk[]
}

declare module 'png-chunks-encode' {
  interface PngChunk {
    name: string
    data: Uint8Array
  }
  export default function encodeChunks(chunks: PngChunk[]): Uint8Array
}

declare module 'png-chunk-text' {
  interface EncodedChunk {
    name: 'tEXt'
    data: Uint8Array
  }
  export function encode(keyword: string, content: string): EncodedChunk
  export function decode(data: Uint8Array | { name: string; data: Uint8Array }): { keyword: string; text: string }
}
