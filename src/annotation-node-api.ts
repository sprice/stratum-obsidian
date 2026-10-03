/** Minimal desktop host contracts, independent of ambient Node declarations. */
export interface AnnotationFileSystem {
  constants: { O_RDONLY: number; O_NOFOLLOW?: number };
  realpath(path: string): Promise<string>;
  open(
    path: string,
    flags: number,
  ): Promise<{
    stat(): Promise<{ size: number; isFile(): boolean }>;
    read(
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: null,
    ): Promise<{ bytesRead: number }>;
    close(): Promise<void>;
  }>;
}

export interface AnnotationPath {
  join(...parts: string[]): string;
}

export interface AnnotationHttpResponse {
  statusCode?: number;
  on(event: "data", listener: (chunk: unknown) => void): unknown;
  on(event: "error", listener: (error: unknown) => void): unknown;
  on(event: "end", listener: () => void): unknown;
}

export interface AnnotationHttpRequest {
  destroy(error?: Error): unknown;
  setTimeout(milliseconds: number, listener: () => void): unknown;
  on(event: "close", listener: () => void): unknown;
  on(event: "error", listener: (error: unknown) => void): unknown;
  end(body: string): unknown;
}

export interface AnnotationHttp {
  request(
    this: void,
    url: string,
    options: { method: string; headers: Record<string, string> },
    listener: (response: AnnotationHttpResponse) => void,
  ): AnnotationHttpRequest;
}
