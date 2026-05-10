# Changesets

Changesets ([docs](https://github.com/changesets/changesets)) drive `ssc`'s versioning and changelog. To record a change:

```bash
npx changeset
```

Pick a bump level (patch/minor/major) and write a 1-line summary. The release workflow turns these into a `CHANGELOG.md` entry, bumps `package.json`, tags, and publishes to npm.
