/*
 * Reading a JSON response without losing the reason it was not JSON.
 *
 * `await response.json()` on an HTML body throws `Unexpected token '<',
 * "<!DOCTYPE "... is not valid JSON`, which names neither the request nor its
 * status. That message reached the interface unchanged and was untraceable:
 * every route could produce it, and the one fact worth having — which request,
 * answered with what — was thrown away by the parser.
 *
 * A non-JSON body from a local route is a real condition rather than a bug to
 * assert away. A stale dev build serves the HTML 404 page, and a crashed route
 * serves an error page; both are worth reporting as themselves.
 */

export class NonJsonResponseError extends Error {
  readonly code = "non_json_response";

  constructor(
    readonly url: string,
    readonly status: number,
    readonly contentType: string
  ) {
    super(
      `${url} answered ${status} with ${contentType || "an unknown content type"} instead of JSON. ` +
        "If the development server was started before the last change, stop it, delete .next, and start it again."
    );
    this.name = "NonJsonResponseError";
  }
}

/** Parses a JSON response, or throws an error that says what arrived instead. */
export async function readJsonResponse<T>(response: Response): Promise<T> {
  const body = await response.text();
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new NonJsonResponseError(
      new URL(response.url, "http://localhost").pathname,
      response.status,
      response.headers.get("content-type") ?? ""
    );
  }
}
