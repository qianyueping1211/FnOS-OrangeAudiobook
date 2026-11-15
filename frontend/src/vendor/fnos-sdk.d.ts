// Vendored build of @trimjs/web-app (fnOS host SDK), copied from the sibling
// FnOS-OrangeMusic repository where it is already shipped (app/static/fnos-sdk.js).
// The package is not published on npm, so the dist file is kept here verbatim;
// do not edit it. Only nasFileManager.ts imports it, and only on demand, so the
// bundle keeps it out of the first paint.
export declare class TrimApp {
  constructor(options?: { debug?: boolean });
  readonly isStandaloneWeb: boolean;
  readonly isWeb: boolean;
  ready(): Promise<void>;
  openFileManager(path: string): Promise<unknown>;
  showFileDetails(paths: string[], options?: unknown): Promise<unknown>;
}
export default TrimApp;
