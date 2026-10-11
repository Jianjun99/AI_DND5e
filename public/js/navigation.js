// One lifetime per accepted navigation, including initialization still awaiting HTTP.
// The hash is an additional guard during the gap before hashchange dispatches;
// returning to the same hash never revives a disposed lifetime.
export function createNavigation(hash) {
  let disposed = false;
  const disposers = new Set();
  const navigation = {
    isCurrent: () => !disposed && (location.hash || '#/') === hash,
    onDispose(cleanup) {
      let done = false;
      const once = () => {
        if (done) return;
        done = true;
        disposers.delete(once);
        cleanup();
      };
      if (disposed) once(); else disposers.add(once);
      return once;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const cleanup of [...disposers]) {
        try { cleanup(); } catch (error) { console.error('View cleanup failed', error); }
      }
    }
  };
  return navigation;
}

/** @typedef {ReturnType<typeof createNavigation>} Navigation */
