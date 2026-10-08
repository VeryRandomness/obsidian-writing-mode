# Writing mode

A distraction-free way to write: a focus mode that fades the interface and dims the text around your cursor, plus a typewriter mode that keeps the line you're typing at a steady height.

## Install (about 2 minutes)

You don't need a GitHub account. You do need [Obsidian](https://obsidian.md) installed and a vault open.

**Step 1: install the helper plugin (one time only)**

1. In Obsidian, click the **gear icon** (bottom-left) to open **Settings**.
2. Click **Community plugins**. If you see a button that says **Turn on community plugins**, click it.
3. Click **Browse**, search for **BRAT**, click it, then click **Install**, then **Enable**.

**Step 2: add this plugin**

1. Open the Obsidian **Command palette** (press `Ctrl+P`, or `Cmd+P` on a Mac).
2. Type **BRAT: Add a beta plugin for testing** and press Enter.
3. Paste this exactly, then click **Add Plugin**:

   ```
   VeryRandomness/obsidian-writing-mode
   ```

4. When it says it's installed, go to **Settings → Community plugins** and switch **Writing mode** on.

That's it.

## How to use it

- Click the **pen icon** in the left ribbon, or run **Toggle writing mode** from the Command palette, to start. Click it again (or press `Esc`) to leave.
- Other commands: **Toggle focus mode**, **Toggle typewriter mode**, **Toggle current line bar**.
- To adjust fading, dimming, the highlight bar and the session word count, open **Settings → Writing mode**.

## Updates

Updates install themselves. Each time you open Obsidian, the plugin checks for a newer version and installs it, then shows a short message. To check right away, open the Command palette and run **Writing mode: Check for update now**.

## Installing without BRAT (manual)

1. Go to the [Releases page](https://github.com/VeryRandomness/obsidian-writing-mode/releases/latest) and download `main.js`, `manifest.json` and `styles.css` (if listed).
2. In Obsidian, open **Settings → Community plugins** and click the **folder icon** next to "Installed plugins".
3. Create a new folder named `writing-mode` and put the downloaded files inside it.
4. Restart Obsidian, then switch the plugin on under **Settings → Community plugins**.

## Something not working?

[Open an issue](https://github.com/VeryRandomness/obsidian-writing-mode/issues) or message Chris.
