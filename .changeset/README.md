# Changesets

Changesets versions and publishes only public workspace packages.

For Signa this means `@signajs/react` and `@signajs/react-native`. The application packages are private and internal shared packages are ignored because they are deployed through Docker/git tags instead of npm.
