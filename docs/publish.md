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
