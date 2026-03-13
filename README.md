# WP Translate JS

A lightweight, local Node.js server to automatically translate WordPress `.po` and `.pot` files using the Google Translate API, while **safely preserving** `%s`, `%d`, `%1$s`, HTML tags, and HTML entities.

## Features:

- Preserves WordPress `sprintf` variables like `%s`, `%1$s`.
- Preserves HTML tags like `<strong>`, `<a href="...">`
- Translates Plurals correctly (creating multiple `msgstr` arrays for `ru`, `fr`, etc.)
- Uses `gettext-parser` for perfect PO file structure encoding
- Built-in web UI with a progress bar.

## Installation and Quick Start

1. **Clone this repository / download the folder**
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Start the local server:**
   ```bash
   node server.js
   ```
4. **Open your browser and navigate to:**
   `http://localhost:3000`

## How it works:

1. Upload your theme/plugin's original `.pot` file (or an existing `.po` file).
2. Select your target language (e.g., Russian).
3. The server converts the file using `gettext-parser`, scans for strings, hides important variables using placeholder tokens (so Google Translate doesn't corrupt them), translates the text, and restores the variables in the translated string.
4. When finished, you'll receive a prompt to download the perfect, ready-to-use `.po` file.

Open the downloaded file in **Poedit** or **Loco Translate** and save it to generate the `.mo` file for WordPress!

## Note:

This script uses the free, undocumented Google Translate API frontend endpoint (`translate_a`). It contains artificial rate limiting (sleeping between requests) to avoid IP bans. For massive files or production pipelines, please rewrite the `translateText()` function to use the official Google Cloud Translation API via a paid API key.

## Improvements:

1. Support for paid translation providers
2. Adding more languages
3. Bug fixes
4. Implementing AI error correction

I'm counting on you, good luck!