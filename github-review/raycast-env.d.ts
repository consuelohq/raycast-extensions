/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** repositories - comma-separated repos (owner/name) */
  "repos": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `list-prs` command */
  export type ListPrs = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `list-prs` command */
  export type ListPrs = {}
}

