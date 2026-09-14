# Changesets

Add one changeset for every user-visible change to either public product:

```sh
vp run changeset
```

The CLI and Web packages form one fixed release group. A changeset naming either product
therefore versions both to the same release number. Internal `@skillbench/*` workspaces stay
private and are neither versioned nor tagged.

Before creating a release tag, consume the pending files and review both generated changelogs:

```sh
vp run version-packages
vp install
vp run check
```

Commit the resulting manifests, changelogs, and lockfile before tagging. Publication is owned
exclusively by `.github/workflows/release.yml`; do not run `changeset publish`.
