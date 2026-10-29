module.exports = {
  hooks: {
    readPackage(pkg) {
      // TypeDoc needs the legacy compiler API, not the native compiler used by workspace builds.
      if (pkg.name === "typedoc" && pkg.version === "0.28.20") {
        pkg.dependencies = { ...pkg.dependencies, typescript: "~6.0.3" };
        delete pkg.peerDependencies.typescript;
      }

      return pkg;
    },
  },
};
