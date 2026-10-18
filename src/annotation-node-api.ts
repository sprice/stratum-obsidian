/** Minimal desktop HTTP host contracts, independent of ambient Node declarations. */
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
  end(body?: string): unknown;
}

export interface AnnotationHttp {
  request(
    this: void,
    url: string,
    options: { method: string; headers: Record<string, string> },
    listener: (response: AnnotationHttpResponse) => void,
  ): AnnotationHttpRequest;
}
