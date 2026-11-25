import "@testing-library/jest-dom/vitest";
import { webcrypto } from "node:crypto";
import { ReadableStream, TransformStream, WritableStream } from "node:stream/web";

// vmThreads + jsdom do not inherit these browser APIs from Node's outer realm.
// Match real browser capabilities for streamed responses and WireGuard keys.
Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
Object.assign(globalThis, { ReadableStream, TransformStream, WritableStream });
