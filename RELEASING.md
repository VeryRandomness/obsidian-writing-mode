# Releasing

Only published releases are installed on anyone's device: the plugin updates itself from the repo's **latest GitHub release**, never from the main branch. It refuses a release whose plugin ID doesn't match, or whose tag doesn't match the version inside it.

To ship a change:

1. Raise `version` in `manifest.json` and commit.
2. Push, and wait for the **CI** workflow to pass (`npm test`: a syntax check and the updater tests).
3. Push a tag with the same number: `git tag 1.0.7 && git push origin 1.0.7`.

The **Release** workflow checks the tag against `manifest.json`, runs the tests, builds `writing-mode.zip` (the download the README links to) and publishes the release with `main.js`, `manifest.json`, `styles.css` and the zip. If anything fails, no release is made and nothing reaches any device.

Run the tests yourself with `npm test`.

(Installs older than 1.0.6 updated from the main branch, so `main` keeps `main.js` and `manifest.json` in step with the latest release until those are gone.)
