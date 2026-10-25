# Releasing

Only published releases are installed on anyone's device: the plugin updates itself from the repo's **latest GitHub release**, never from the main branch. It refuses a release whose plugin ID doesn't match, or whose tag doesn't match the version inside it.

To ship a change:

1. Raise `version` in `manifest.json` and commit.
2. Push, and wait for the **CI** workflow to pass (`npm test`: a syntax check and the updater tests).
3. Push a tag with the same number: `git tag 1.0.8 && git push origin 1.0.8`.

The **Release** workflow checks the tag against `manifest.json`, runs the tests and builds `writing-mode.zip` (the download the README links to), keeping the tested files. Publishing then **waits for a manual approval**: GitHub > Actions > the release run > **Review deployments** > tick **release** > **Approve and deploy**. Only then is the release published, with exactly the files that were tested. If anything fails, or nobody approves, no release is made and nothing reaches any device.

Release tags are permanent: they can't be moved or deleted, and `main` can't be force-pushed or deleted. If a tagged release goes wrong, fix it with a new version number. Actions > **Release** > **Run workflow** on `main` is a dry run: it tests and builds and publishes nothing.

Run the tests yourself with `npm test`.

(Installs older than 1.0.6 updated from the main branch, so `main` keeps `main.js` and `manifest.json` in step with the latest release until those are gone.)
