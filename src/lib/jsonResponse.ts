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
    readonly request: string,
    readonly status: number,
    readonly contentType: string
  ) {
    super(
      `${request} answered ${status} with ${contentType || "an unknown content type"} instead of JSON. ` +
        "A development server whose .next directory was deleted while it was running serves this until it " +
        "rebuilds: stop the server first, then delete .next and start it again."
    );
    this.name = "NonJsonResponseError";
  }
}

/**
 * Parses a JSON response, or throws an error that says what arrived instead.
 *
 * The method and query string are part of the report on purpose. This page
 * calls one route three ways — start a search, request a tax-inclusive total,
 * read a saved session — so a path alone does not identify which call failed,
 * and those three have entirely different diagnoses.
 */
export async function readJsonResponse<T>(response: Response, method = "GET"): Promise<T> {
  const body = await response.text();
  try {
    return JSON.parse(body) as T;
  } catch {
    const url = new URL(response.url, "http://localhost");
    throw new NonJsonResponseError(
      `${method.toUpperCase()} ${url.pathname}${url.search}`,
      response.status,
      response.headers.get("content-type") ?? ""
    );
  }
}
