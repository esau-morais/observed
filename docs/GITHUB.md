# GitHub and Slack reference

Details of the GitHub Action. The
[README](../README.md#run-on-pull-requests) has the workflow to copy.

## Inputs

| Input | Default | Purpose |
| --- | --- | --- |
| `project` | `.` | Directory holding `observed.json`, relative to the repository root |
| `base` | required | Revision to compare against. Use `${{ github.event.pull_request.base.sha }}`, which stays fixed when the base branch moves or the job is re-run |
| `candidate` | `HEAD` | Revision to capture. `HEAD` is the merge commit GitHub checks out for the pull request |
| `timeout` | `120000` | Milliseconds allowed for each capture |
| `artifact-name` | `observed-bundle` | Name of the uploaded bundle. The report page adds `.html`. Give each call its own name when a workflow runs the action more than once, such as in a matrix |
| `retention-days` | `7` | Days GitHub keeps the artifacts |
| `github-token` | `${{ github.token }}` | Token that titles the check and posts the comment |
| `comment` | `always` | `always` posts one comment and edits it on later runs. `off` posts none; the check and job summary still carry the result |
| `image-upload-token` | empty | A user's token that shows the screenshot crops in the comment instead of linking them. See [Screenshots in the comment](#screenshots-in-the-comment) |
| `github-app-client-id`, `github-app-private-key` | empty | Sign the comment with your own GitHub App |
| `slack-bot-token`, `slack-channel`, `slack-images` | empty, empty, `false` | Post failures to Slack |
| `job-outcome` | empty | Deprecated. It has no effect and prints a warning |

`fetch-depth: 0` in the checkout step fetches the history that contains
`base`. The `concurrency` block cancels an older run, so it can't overwrite
the comment with a stale result. On Linux the action installs packages with
passwordless `sudo`, which GitHub-hosted runners provide. Each journey is its
own capture of each revision, so raise `timeout-minutes` when you add
journeys.

## Permissions

| Permission | Why |
| --- | --- |
| `contents: read` | Check out the base and the candidate |
| `checks: write` | Put the result in the title of this job's own check |
| `pull-requests: write` | Post one comment and edit it on later runs |

## Pinning and upgrades

The full commit SHA pins the action to one release, and the comment beside it
names the tag. The action installs `@observed-software/cli` at the same
version. To upgrade, use the commit of a newer
[release](https://github.com/esau-morais/observed/releases) tag, or let
Dependabot's `github-actions` updates propose it. `@v0` follows the latest
stable 0.x release and can move, so pin a SHA. 0.1.0 lacks inputs such as
`github-token` and `slack-images` and posts only through a GitHub App.

`uses:` works for any public repository. The GitHub Marketplace listing is
only for finding the action.

## Other toolchains

The action installs the Bun version pinned in Observed's `package.json` and
the browser, and nothing else. Install what `setup` or `start` needs in a step
before Observed's, pinned by full commit SHA:

```yaml
      - uses: actions/setup-go@b7ad1dad31e06c5925ef5d2fc7ad053ef454303e # v7.0.0
        with:
          go-version-file: go.mod
      - uses: esau-morais/observed@1d21e79bd7180b54a1e1cd9a1607114dce9e6f87 # v0.2.0-alpha.4
```

## Secrets

A journey that signs in reads its secret from an environment variable, as in
`{ "env": "LOGIN_PASSWORD" }`. Pass the repository secret to the action step:

```yaml
      - uses: esau-morais/observed@1d21e79bd7180b54a1e1cd9a1607114dce9e6f87 # v0.2.0-alpha.4
        env:
          LOGIN_PASSWORD: ${{ secrets.LOGIN_PASSWORD }}
        with:
          project: .
          base: ${{ github.event.pull_request.base.sha }}
```

GitHub gives no Actions secrets to pull requests from forks or Dependabot. The
variable is then empty, both captures fail, and the job reports unavailable.
Dependabot runs read Dependabot secrets, so store the secret there as well.

Use a disposable account. The report page and bundle hold screenshots of
every page the journey reaches, and literal fill values appear in both as
written.

## Job result

| Exit code | Conclusion | Job |
| --- | --- | --- |
| 0 | No regression, not checked, or preview | Passes |
| 1 | Unavailable: a revision or capture could not be used | Fails |
| 2 | A named check failed or regressed | Fails |

The job also fails when Observed rejects `observed.json`, writes no readable
result, or writes a result that disagrees with the exit code. A failure to
post never changes the job's result.

A job cannot be neutral, so a preview or a project without named checks
passes. Add a check to `observed.json` before you require the job.

## What the run posts

| Place | Content |
| --- | --- |
| Check title | The verdict line, such as `Regression: Median LCP 52 ms → 452 ms, at most 250 ms` |
| Job summary and comment | The verdict and the values that decided it. One line per failing or unknown check, and a count of the rest. Why a capture failed. The screenshot difference with its crops. Up to 10 changed files inside the captured source, by path from the repository root, and a count of the files outside it. Each check that `observed.json` adds, removes or alters, and the base and head commits. What the passing checks covered, the agent prompt and run details are collapsed |
| Prompt for your agent | A copyable prompt built from the result: values, commits, evidence and artifact paths, and the reminder that a changed value is not a regression by itself |
| File links | Each listed file and the verdict line's source location link to that file's diff in the pull request, at the line when there is one. A file outside the diff, or a run outside a pull request, links to the file at the head commit |
| Hidden `<!-- observed:agent -->` block | The result schema version, commits, artifact name and `result.json` paths |
| Open the report | `observed-bundle.html`, the same report as `observed view`, in one file |
| Screenshot crops | `observed-bundle-screenshots.png`: before, after and changed pixels around the largest changed region of each journey whose screenshots changed |
| `observed-bundle` artifact | Raw captures, `result.json` and the exported viewer. Open it with `observed view <download>/run/report` |

Later runs edit the comment. A workflow that calls the action more than once
gets one titled job and one comment per `artifact-name`. The action posts only
when the captured candidate is the pull request's head commit or its merge
commit. To run Observed again, re-run the job.

GitHub shows the report page only to signed-in users who can read the
repository. It serves the page through a storage link that expires after
about 10 minutes, so share the summary link, not the address the page opens
at.

Every run ends with one line saying what was posted, such as
`Posted: check title and comment.` Each item that was not posted gets an
annotation with the reason.

| Situation | What you see |
| --- | --- |
| Pull request from this repository, with the permissions above | The titled check, the comment and the report link |
| No `checks: write` | The verdict in the job's result and the comment. A warning names `checks: write` |
| No `pull-requests: write` | The titled check. A warning names `pull-requests: write` |
| Pull request from a fork | The verdict in the job's result. GitHub gives fork pull requests a read-only token, so there is no title and no comment, and a notice says so |
| Dependabot pull request | The same as a pull request from this repository, because `permissions:` raises Dependabot's read-only token |

## Screenshots in the comment

When screenshots changed, the action uploads the crops as their own artifact
and the comment links them. GitHub opens the PNG in the browser for signed-in
users who can read the repository. Signed-out visitors get a 404, even on a
public repository.

GitHub has no documented API that adds an image to a comment. `gh` 2.99.0 and
later upload one for `--attach` through an endpoint that accepts only a user's
OAuth or personal access token with write access to the repository. It answers
404 to `github-token` and to GitHub App installation tokens
([cli/cli#14309](https://github.com/cli/cli/issues/14309); the 404 for
`github-token` was reproduced 2026-10-03). Set `image-upload-token` to such a
token from a repository secret to show the crops in the comment. The image is
uploaded as that user, only when the comment is posted, and shows page
content. If the upload fails, the comment keeps the link, and the run
details and the job summary say why. The upload never changes the verdict.

## Require the check

In **Settings > Rules > Rulesets**, add a branch ruleset with **Require status
checks to pass** and the check **Observed**, the job's name. The job reports
on every pull request, forks and Dependabot included, so the required check
always arrives. A matrix names each job after its values, such as
`Observed (ubuntu-24.04)`. Require each one.

## Your own GitHub App

A GitHub App changes only who signs the comment. The job's check keeps
carrying the verdict, because only the App that created a check run can
update it. The App needs no server or webhook.

1. Create a GitHub App under your account or organization's Developer
   settings. Give it **Pull requests: Read and write**. Leave the webhook
   inactive and subscribe to no events.
2. Install it on the repositories that run Observed, and only those.
3. Generate a private key. Store it as the repository secret
   `OBSERVED_APP_PRIVATE_KEY` and the App's Client ID as the repository
   variable `OBSERVED_APP_CLIENT_ID`, then delete the downloaded key file.
4. Pass both to the action, and keep `checks: write` in `permissions:`.

```yaml
      - uses: esau-morais/observed@1d21e79bd7180b54a1e1cd9a1607114dce9e6f87 # v0.2.0-alpha.4
        with:
          project: .
          base: ${{ github.event.pull_request.base.sha }}
          github-app-client-id: ${{ vars.OBSERVED_APP_CLIENT_ID }}
          github-app-private-key: ${{ secrets.OBSERVED_APP_PRIVATE_KEY }}
```

When one input is empty, or the App token can't be created, the run shows the
error and posts the comment with the workflow token. Pull requests from forks
and Dependabot get no Actions secrets, so `github-actions` signs their
comment.

## Slack

The action posts to one Slack channel when a pull request's result starts
failing: a regression, a failed check, or unavailable evidence.

- Later runs of that pull request edit the same message, so retries notify
  nobody again. A recovery posts one reply in the message's thread.
- A pull request that never fails posts nothing. Runs outside pull requests
  post nothing. Forks and Dependabot receive no secrets, so they post nothing.
- The message has the check's headline, the base and head commits, the count
  of failed checks, and buttons for the report and the pull request.
- It shows check names, metric names, measured numbers and commits. It shows
  no captured text, because a channel can include people who can't read the
  repository.
- Editing the earlier message needs `pull-requests: write` and `comment:
  always`, because the pull request comment remembers which Slack message
  belongs to it. Without them, every failing run posts a new message.
- The report link needs a GitHub account that can read the repository.

`slack-images: true` with the `files:write` scope posts the screenshot crops
in the thread. The image includes any text around the change. Without the
scope, the message goes out without the image and the job summary says why.

1. Create a Slack app at https://api.slack.com/apps with **From a manifest**
   and give its bot only the `chat:write` scope:

   ```yaml
   display_information:
     name: Observed
   features:
     bot_user:
       display_name: Observed
       always_online: false
   oauth_config:
     scopes:
       bot:
         - chat:write
   settings:
     org_deploy_enabled: false
     socket_mode_enabled: false
     token_rotation_enabled: false
   ```

2. Install it to the workspace and copy the **Bot User OAuth Token**
   (`xoxb-...`). Store it as the repository secret `OBSERVED_SLACK_BOT_TOKEN`.
3. Invite the bot to the channel with `/invite @Observed`. Copy the channel
   ID, such as `C0123456789`, from the bottom of the channel's **About** tab
   and store it as the repository variable `OBSERVED_SLACK_CHANNEL`. A channel
   name doesn't work.
4. Add both to the action:

   ```yaml
             slack-bot-token: ${{ secrets.OBSERVED_SLACK_BOT_TOKEN }}
             slack-channel: ${{ vars.OBSERVED_SLACK_CHANNEL }}
   ```

## Turn it off

1. Remove **Observed** from the branch ruleset first. Otherwise every open
   pull request waits for a check that no longer runs.
2. Delete `.github/workflows/observed.yml` and `observed.json`.
3. If you set up your own App, uninstall and delete it, and delete the
   `OBSERVED_APP_PRIVATE_KEY` secret and `OBSERVED_APP_CLIENT_ID` variable.

Earlier comments and check titles stay on old pull requests.
