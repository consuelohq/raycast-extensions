/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** whisper model path - path to ggml whisper model file */
  "whisperModel": string,
  /** ollama model - ollama model for post-processing */
  "ollamaModel": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `voice-note` command */
  export type VoiceNote = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `voice-note` command */
  export type VoiceNote = {}
}

