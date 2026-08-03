// 這三個套件都是純 JS、只吃 Uint8Array，桌面與手機（WebView）皆可用。
// 宣告檔放 core/ 是因為 core 與 renderer 兩套 tsconfig 都要看得到它
// （原本在 src/main/，只有 tsconfig.node 掃得到）。
declare module 'png-chunks-extract' {
  interface PngChunk {
    name: string
    data: Uint8Array
  }
  export default function extractChunks(data: Uint8Array): PngChunk[]
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
