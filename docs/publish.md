## Releases

Publishing is handled by GitHub Actions using npm trusted publishing. Configure
the package once on npmjs.com under `Package settings > Trusted Publisher` with:

- Organization or user: `ubershmekel`
- Repository: `caroushell`
- Workflow filename: `publish.yml`

Then cut a release locally and push the generated commit and tag:

```bash
npm run release -- patch
```

The workflow in `.github/workflows/publish.yml` runs lint, tests, build, and
then `npm publish` with GitHub OIDC instead of an npm access token.

`npm run release` refuses to start when the branch is behind its upstream, and
pushes the version commit and its tag atomically. Both guards exist because a
rejected push once left a tag behind locally; the next release pushed both tags
at once, the two workflow runs raced, and the older version won the `latest`
dist-tag. If that ever happens again, point `latest` back at the newest version:

```bash
npm dist-tag add caroushell@<version> latest
```
