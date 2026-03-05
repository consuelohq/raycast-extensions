/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** scan directories - comma-separated directories to scan for git repos */
  "scanDirs": string,
  /** repo scan depth - how deep to look for git repos */
  "maxDepth": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `find-files` command */
  export type FindFiles = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `find-files` command */
  export type FindFiles = {}
}

