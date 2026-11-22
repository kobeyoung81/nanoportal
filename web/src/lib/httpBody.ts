// Reading a response body without falling over the empty one.
//
// A successful DELETE answers 204 with no body at all. Parsing that as JSON
// threw "Unexpected end of JSON input" into the console for every delete the UI
// made — harmless to the request, noisy enough to hide real errors.

/** readJsonBody returns the parsed body, or undefined for a body-less 204. */
export async function readJsonBody<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}
