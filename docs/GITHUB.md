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
`github-token` and `slack-images`.

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
      - uses: esau-morais/observed@8b26814fe0bf890621400c752846357e6e9ec018 # v0.2.0-alpha.3
```

## Secrets

A journey that signs in reads its secret from an environment variable, as in
`{ "env": "LOGIN_PASSWORD" }`. Pass the repository secret to the action step:

```yaml
      - uses: esau-morais/observed@8b26814fe0bf890621400c752846357e6e9ec018 # v0.2.0-alpha.3
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
| Job summary and comment | The verdict and the values that decided it, one line per failing or unknown check, a count of the rest, why a capture failed, and the base and head commits |
| Prompt for your agent | A copyable prompt built from the result: values, commits, evidence and artifact paths, and the reminder that a changed value is not a regression by itself |
| Hidden `<!-- observed:agent -->` block | The result schema version, commits, artifact name and `result.json` paths |
| Open the report | `observed-bundle.html`, the same report as `observed view`, in one file |
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
      - uses: esau-morais/observed@8b26814fe0bf890621400c752846357e6e9ec018 # v0.2.0-alpha.3
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
- Editing the earlier message needs `pull-requests: write`, because the pull
  request comment remembers which Slack message belongs to it. Without it,
  every failing run posts a new message.
- The report link needs a GitHub account that can read the repository.

`slack-images: true` with the `files:write` scope posts the largest changed
screenshot region in the thread. The image includes any text around the
change. Without the scope, the message goes out without the image and the job
summary says why.

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
